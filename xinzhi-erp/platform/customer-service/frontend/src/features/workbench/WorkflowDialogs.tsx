import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Check, ClipboardPlus, Search, UserRound, UsersRound, X } from "lucide-react";
import { Conversation, PlatformAPI, Shop, Ticket, TransferCandidate } from "../../api";
import { errorText, userDisplayName } from "../shared/helpers";

export function TransferDialog(props: {
  api: PlatformAPI;
  conversation: Conversation;
  onClose: () => void;
  onDone: () => Promise<void>;
  setToast: (value: { tone: "success" | "error" | "info"; text: string }) => void;
}) {
  const [mode, setMode] = useState<"agent" | "group">("agent");
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [targetAgentID, setTargetAgentID] = useState("");
  const [targetSkillGroup, setTargetSkillGroup] = useState("咨询接待");
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    props.api.listTransferCandidates(props.conversation.id)
      .then((items) => { if (active) setCandidates(items); })
      .catch((error) => { if (active) setFailure(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.api, props.conversation.id]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return candidates.filter((item) => !normalized || [item.agent.displayName, item.agent.email].some((value) => value.toLowerCase().includes(normalized)));
  }, [candidates, query]);
  const groups = Array.from(new Set(candidates.map((item) => item.skillGroup).filter(Boolean)));

  useEffect(() => {
    if (groups.length && !groups.includes(targetSkillGroup)) setTargetSkillGroup(groups[0]);
  }, [groups, targetSkillGroup]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "agent" && !targetAgentID) return;
    setSubmitting(true);
    setFailure("");
    try {
      const result = await props.api.createTransfer(props.conversation.id, mode === "agent"
        ? { targetAgentId: targetAgentID, note }
        : { targetSkillGroup: targetSkillGroup || groups[0] || "咨询接待", note });
      props.setToast({ tone: "success", text: result.status === "pending" ? "转接请求已发送，等待目标客服接收" : "会话已转接" });
      await props.onDone();
      props.onClose();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="workflow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <form className="workflow-dialog transfer-dialog" onSubmit={submit}>
      <header><div><ArrowRightLeft size={19} /><div><strong>转接会话</strong><span>空闲客服直接接入，离线或接待已满时需要对方确认</span></div></div><button type="button" onClick={props.onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="workflow-segments"><button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}><UserRound size={15} /> 按客服</button><button type="button" className={mode === "group" ? "active" : ""} onClick={() => setMode("group")}><UsersRound size={15} /> 按技能组</button></div>
      {mode === "agent" ? <>
        <label className="workflow-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客服姓名或邮箱" /></label>
        <div className="transfer-candidate-list">
          {visible.map((item) => <button type="button" className={targetAgentID === item.agent.id ? "selected" : ""} key={item.agent.id} onClick={() => setTargetAgentID(item.agent.id)}>
            <span className={`presence-dot ${item.presence}`} /><div><strong>{userDisplayName(item.agent)}</strong><span>{item.skillGroup} · {item.activeConversations}/{item.capacity} 个会话</span></div><em>{presenceLabel(item)}</em>{targetAgentID === item.agent.id ? <Check size={16} /> : null}
          </button>)}
          {!visible.length && !loading ? <div className="workflow-empty">当前店铺没有可转接客服</div> : null}
          {loading ? <div className="workflow-empty">正在读取客服状态...</div> : null}
        </div>
      </> : <div className="transfer-candidate-list">
        {groups.map((group) => {
          const count = candidates.filter((item) => item.skillGroup === group).length;
          return <button type="button" className={targetSkillGroup === group ? "selected" : ""} key={group} onClick={() => setTargetSkillGroup(group)}>
            <UsersRound size={18} /><div><strong>{group}</strong><span>{count} 名客服，优先分配给当前空闲人员</span></div>{targetSkillGroup === group ? <Check size={16} /> : null}
          </button>;
        })}
        {!groups.length && !loading ? <div className="workflow-empty">当前店铺没有可转接技能组</div> : null}
      </div>}
      <label className="workflow-field"><span>转接说明（选填）</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明客户问题和当前处理进度" /></label>
      {failure ? <div className="workflow-error">转接会话失败：{failure}</div> : null}
      <footer><button type="button" onClick={props.onClose}>取消</button><button className="primary" type="submit" disabled={submitting || (mode === "agent" ? !targetAgentID : !groups.length)}><ArrowRightLeft size={15} /> {submitting ? "转接中" : "确认转接"}</button></footer>
    </form>
  </div>;
}

export function CreateTicketDialog(props: {
  api: PlatformAPI;
  conversation: Conversation;
  shop: Shop | null;
  onClose: () => void;
  onDone: (ticket: Ticket) => Promise<void>;
  setToast: (value: { tone: "success" | "error" | "info"; text: string }) => void;
}) {
  const [ticketType, setTicketType] = useState<"customer" | "internal">("customer");
  const [title, setTitle] = useState(props.conversation.subject || "客户问题跟进");
  const [category, setCategory] = useState("咨询跟进");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
  const [ticketAssigneeIDs, setTicketAssigneeIDs] = useState<Set<string>>(new Set());
  const [targetAgentID, setTargetAgentID] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingCandidates(true);
    props.api.listTransferCandidates(props.conversation.id)
      .then((items) => { if (active) setCandidates(items); })
      .catch((error) => { if (active) setFailure(errorText(error)); })
      .finally(() => { if (active) setLoadingCandidates(false); });
    return () => { active = false; };
  }, [props.api, props.conversation.id]);

  useEffect(() => {
    let active = true;
    props.api.listTicketAssignees()
      .then((items) => { if (active) setTicketAssigneeIDs(new Set(items.map((item) => item.id))); })
      .catch(() => { if (active) setTicketAssigneeIDs(new Set()); });
    return () => { active = false; };
  }, [props.api]);

  const eligibleCandidates = ticketType === "customer"
    ? candidates
    : candidates.filter((item) => ticketAssigneeIDs.has(item.agent.id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !targetAgentID) return;
    setSubmitting(true);
    setFailure("");
    try {
      const ticket = await props.api.createTicket({
        type: ticketType,
        conversationId: props.conversation.id,
        shopId: props.conversation.shopId,
        customerName: props.conversation.customerName,
        customerEmail: props.conversation.customerEmail,
        title: title.trim(),
        category,
        priority,
        status: "open",
        assignedGroup: ticketType === "customer" ? category : undefined,
        assignedAgentId: targetAgentID,
        description: description.trim() || "请跟进当前客户问题并记录处理结果。",
        attachments: []
      });
      const recipient = eligibleCandidates.find((item) => item.agent.id === targetAgentID);
      props.setToast({ tone: "success", text: ticketType === "customer"
        ? `客户工单已交给 ${recipient ? userDisplayName(recipient.agent) : "目标客服"}，接收后自动接管会话`
        : `内部任务已交给 ${recipient ? userDisplayName(recipient.agent) : "目标客服"}，可只读查看完整会话` });
      await props.onDone(ticket);
      props.onClose();
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="workflow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <form className="workflow-dialog ticket-create-dialog" onSubmit={submit}>
      <header><div><ClipboardPlus size={19} /><div><strong>新建工单</strong><span>{props.shop?.displayName || "当前店铺"} · 选择客户交接或内部协作</span></div></div><button type="button" onClick={props.onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="ticket-create-type-switch">
        <button type="button" className={ticketType === "customer" ? "active" : ""} onClick={() => setTicketType("customer")}><UserRound size={15} /><span><strong>客户工单</strong><small>接收后接管会话并继续回复客户</small></span></button>
        <button type="button" className={ticketType === "internal" ? "active" : ""} onClick={() => setTicketType("internal")}><UsersRound size={15} /><span><strong>内部任务</strong><small>查看完整会话，仅处理内部事项</small></span></button>
      </div>
      <div className="workflow-form-grid ticket-customer-core">
        <label className="workflow-field wide"><span>标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="简要说明需要处理的事项" /></label>
        <label className="workflow-field wide"><span>描述</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="填写当前情况、需要完成的事项和预期结果" /></label>
      </div>
      <div className="workflow-form-grid ticket-customer-options">
        <label className="workflow-field"><span>问题类型</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>咨询跟进</option><option>订单处理</option><option>退款售后</option><option>物流异常</option><option>投诉建议</option></select></label>
        <label className="workflow-field"><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
        <div className="workflow-field wide ticket-linked-customer"><span>关联客户</span><div><UserRound size={16} /><span><strong>{props.conversation.customerName || props.conversation.customerEmail || "当前会话客户"}</strong>{props.conversation.customerEmail ? <small>{props.conversation.customerEmail}</small> : null}</span></div></div>
      </div>
      <section className="ticket-recipient-section">
        <header><strong>负责人</strong><span>{ticketType === "customer" ? "对方接收前，当前会话仍由你处理" : "负责人可查看完整实时会话，但不能直接回复客户"}</span></header>
        <div className="transfer-candidate-list">
          {eligibleCandidates.map((item) => <button type="button" className={targetAgentID === item.agent.id ? "selected" : ""} key={item.agent.id} onClick={() => setTargetAgentID(item.agent.id)}>
            <span className={`presence-dot ${item.presence}`} /><div><strong>{userDisplayName(item.agent)}</strong><span>{item.activeConversations}/{item.capacity} 个会话</span></div><em>{ticketRecipientPresence(item)}</em>{targetAgentID === item.agent.id ? <Check size={16} /> : null}
          </button>)}
          {!eligibleCandidates.length && !loadingCandidates ? <div className="workflow-empty">{ticketType === "customer" ? "当前店铺没有其他可接收工单的客服" : "当前店铺没有可负责内部任务的客服"}</div> : null}
          {loadingCandidates ? <div className="workflow-empty">正在读取接收客服...</div> : null}
        </div>
      </section>
      {failure ? <div className="workflow-error">创建工单失败：{failure}</div> : null}
      <footer><button type="button" onClick={props.onClose}>取消</button><button className="primary" type="submit" disabled={submitting || !title.trim() || !description.trim() || !targetAgentID}><ClipboardPlus size={15} /> {submitting ? "创建中" : ticketType === "customer" ? "创建客户工单" : "创建内部任务"}</button></footer>
    </form>
  </div>;
}

function ticketRecipientPresence(item: TransferCandidate) {
  if (item.presence === "available") return "在线";
  if (item.presence === "full") return "接待已满";
  return "离线";
}

function presenceLabel(item: TransferCandidate) {
  if (item.presence === "available") return "空闲 · 直接转接";
  if (item.presence === "full") return "接待已满 · 需确认";
  return "离线 · 需确认";
}

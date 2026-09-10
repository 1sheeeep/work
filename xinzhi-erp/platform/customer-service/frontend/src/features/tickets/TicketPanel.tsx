import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  Link2,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Search,
  Send,
  UserRound,
  X
} from "lucide-react";
import { Conversation, PlatformAPI, Shop, Ticket, TicketComment, TicketContext, TicketCustomer, User } from "../../api";
import { Badge, Empty } from "../../components/ui";
import { errorText, ticketStatusTone, timeLabel, userDisplayName } from "../shared/helpers";
import { T, ToastTone } from "../shared/types";
import { hasPermission, PERMISSIONS } from "../../permissions";
import { TicketCustomerPicker } from "./TicketCustomerPicker";

type TicketView = "mine" | "created_by_me" | "waiting_for_me" | "review_for_me" | "active" | "completed";

const emptySummary = {
  total: 0,
  customer: 0,
  internal: 0,
  open: 0,
  inProgress: 0,
  pendingReview: 0,
  overdue: 0,
  mine: 0,
  waitingForMe: 0,
  reviewForMe: 0,
  createdByMe: 0,
  active: 0,
  completed: 0
};

export function TicketPanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  users: User[];
  currentUser: User;
  refreshToken: number;
  contextRefreshToken: number;
  t: T;
  onOpenConversation: (conversation: Conversation) => void;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [selectedID, setSelectedID] = useState("");
  const [view, setView] = useState<TicketView>("mine");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  const [failureTitle, setFailureTitle] = useState("工单加载失败");
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [comment, setComment] = useState("");
  const [context, setContext] = useState<TicketContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSource, setCreateSource] = useState<Ticket | null>(null);
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitReason, setWaitReason] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTargetID, setConvertTargetID] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const selected = tickets.find((ticket) => ticket.id === selectedID) || null;
  const canManage = hasPermission(props.currentUser, PERMISSIONS.ticketsManage);
  const canOpenWorkbench = hasPermission(props.currentUser, PERMISSIONS.workbenchAccess);
  const availableUsers = useMemo(() => {
    const byID = new Map<string, User>();
    [...props.users, ...assignees, props.currentUser].forEach((user) => byID.set(user.id, user));
    return [...byID.values()].sort((a, b) => userDisplayName(a).localeCompare(userDisplayName(b)));
  }, [props.users, assignees, props.currentUser]);
  const usersByID = useMemo(() => new Map(availableUsers.map((user) => [user.id, user])), [availableUsers]);
  const shopsByID = useMemo(() => new Map(props.shops.map((shop) => [shop.id, shop])), [props.shops]);

  async function loadTickets() {
    setLoading(true);
    setFailure("");
    try {
      const [items, counts] = await Promise.all([
        props.api.listTickets({ view, type, search, page, pageSize }),
        props.api.getTicketSummary({ type, search })
      ]);
      setTickets(items);
      setSummary(counts);
      setSelectedID((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    } catch (error) {
      setFailureTitle("工单加载失败");
      setFailure(errorText(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void props.api.listTicketAssignees().then(setAssignees).catch((error) => {
      setFailureTitle("工单加载失败");
      setFailure(errorText(error));
    });
  }, [props.api]);

  useEffect(() => {
    void loadTickets();
  }, [view, type, search, page, props.refreshToken]);

  useEffect(() => {
    setWaitOpen(false);
    setWaitReason("");
    setMoreOpen(false);
    setSettingsOpen(false);
    setConvertOpen(false);
    setConvertTargetID("");
    if (!selectedID) {
      setComments([]);
      return;
    }
    let active = true;
    void props.api.listTicketComments(selectedID)
      .then((items) => { if (active) setComments(items); })
      .catch((error) => {
        if (active) {
          setFailureTitle("工单加载失败");
          setFailure(errorText(error));
        }
      });
    return () => { active = false; };
  }, [props.api, selectedID, props.refreshToken]);

  useEffect(() => {
    setContext(null);
    if (!selectedID) return;
    let active = true;
    const ticket = tickets.find((item) => item.id === selectedID);
    if (ticket?.conversationId) {
      setContextLoading(true);
      void props.api.getTicketContext(selectedID)
        .then((value) => { if (active) setContext(value); })
        .catch((error) => {
          if (active) {
            setFailureTitle("关联会话加载失败");
            setFailure(errorText(error));
          }
        })
        .finally(() => { if (active) setContextLoading(false); });
    }
    return () => { active = false; };
  }, [props.api, selectedID, selected?.conversationId, props.contextRefreshToken]);

  async function refreshSelected(updated?: Ticket) {
    if (updated) {
      setTickets((current) => current.map((item) => item.id === updated.id ? updated : item));
    }
    const [nextComments, counts] = await Promise.all([
      selectedID ? props.api.listTicketComments(selectedID) : Promise.resolve([]),
      props.api.getTicketSummary({ type, search })
    ]);
    setComments(nextComments);
    setSummary(counts);
  }

  async function runAction(action: "complete" | "wait" | "resume" | "review" | "cancel" | "convert-to-customer", input: { reason?: string; note?: string; approved?: boolean; assignedAgentId?: string } = {}) {
    if (!selected) return;
    setBusy(action);
    setFailure("");
    try {
      const updated = await props.api.runTicketAction(selected.id, action, input);
      await refreshSelected(updated);
      setWaitOpen(false);
      setWaitReason("");
      props.setToast({ tone: "success", text: ticketActionSuccess(action, input.approved) });
      if (view !== "active" && !ticketMatchesViewClient(updated, view, props.currentUser.id)) {
        await loadTickets();
      }
    } catch (error) {
      setFailureTitle("工单操作失败");
      setFailure(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function acceptSelected() {
    if (!selected) return;
    setBusy("accept");
    setFailure("");
    try {
      const result = await props.api.acceptTicket(selected.id);
      await refreshSelected(result.ticket);
      props.setToast({ tone: "success", text: result.conversation ? "已接收，会话已转入你的工作台" : "已接收内部任务" });
      if (result.conversation) props.onOpenConversation(result.conversation);
    } catch (error) {
      setFailureTitle("工单操作失败");
      setFailure(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    setBusy("comment");
    try {
      const item = await props.api.addTicketComment(selected.id, comment.trim());
      setComments((current) => [...current, item]);
      setComment("");
    } catch (error) {
      setFailureTitle("工单操作失败");
      setFailure(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function openConversation() {
    if (!selected?.conversationId) return;
    try {
      props.onOpenConversation(await props.api.getConversation(selected.conversationId));
    } catch (error) {
      setFailureTitle("会话加载失败");
      setFailure(errorText(error));
    }
  }

  const isOwner = selected?.assignedAgentId === props.currentUser.id;
  const isCreator = selected?.createdBy === props.currentUser.id;
  const canAccept = canManage && isOwner && selected?.status === "open";
  const canWork = canManage && isOwner && (selected?.status === "in_progress" || selected?.status === "pending");
  const canReview = canManage && isCreator && selected?.status === "pending_review";
  const canCreateRelatedInternal = Boolean(selected?.type === "customer" && isCreator && selected.conversationId);
  const canConvertToCustomer = Boolean(
    selected?.type === "internal" &&
    isCreator &&
    selected.conversationId &&
    !["resolved", "closed", "cancelled"].includes(selected.status)
  );
  const hasActionRow = canWork || canReview || canCreateRelatedInternal || canConvertToCustomer;
  const canEnterConversation = Boolean(
    canOpenWorkbench &&
    selected?.type === "customer" &&
    selected?.conversationId &&
    selected.status !== "open" &&
    selected.assignedAgentId === props.currentUser.id
  );

  const queues: { id: TicketView; label: string; count: number }[] = [
    { id: "mine", label: "我的待办", count: summary.mine },
    { id: "created_by_me", label: "我创建的", count: summary.createdByMe },
    { id: "waiting_for_me", label: "待我接收", count: summary.waitingForMe },
    { id: "review_for_me", label: "待我验收", count: summary.reviewForMe },
    { id: "active", label: "全部未完成", count: summary.active },
    { id: "completed", label: "已完成", count: summary.completed }
  ];

  return <section className="ticket-page ticket-page-redesign">
    <header className="ticket-page-header">
      <div><ClipboardList size={21} /><div><strong>工单</strong><span>客户交接与内部协作统一处理</span></div></div>
      {canManage ? <button className="primary" type="button" onClick={() => { setCreateSource(null); setCreating(true); }}><ClipboardPlus size={15} /> 新建内部任务</button> : null}
    </header>

    <nav className="ticket-queue-tabs" aria-label="工单队列">
      {queues.map((queue) => <button key={queue.id} type="button" className={view === queue.id ? "active" : ""} onClick={() => { setView(queue.id); setPage(1); }}>
        <span>{queue.label}</span><strong>{queue.count}</strong>
      </button>)}
    </nav>

    <form className="ticket-compact-filters" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setPage(1); }}>
      <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
        <option value="">全部类型</option>
        <option value="customer">客户工单</option>
        <option value="internal">内部任务</option>
      </select>
      <label><Search size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索标题、描述、客户或邮箱" /></label>
      <button type="submit">查询</button>
    </form>

    {failure ? <div className="ticket-page-error">{failureTitle}：{failure}</div> : null}
    <div className="ticket-layout">
      <section className="ticket-list">
        <header><strong>{queues.find((item) => item.id === view)?.label}</strong><span>{loading ? "加载中" : `${tickets.length} 条`}</span></header>
        {tickets.map((ticket) => <button type="button" className={ticket.id === selectedID ? "active" : ""} key={ticket.id} onClick={() => setSelectedID(ticket.id)}>
          <div>
            <span className="ticket-list-type"><Badge tone={ticket.type === "internal" ? "warning" : "blue"}>{ticketTypeLabel(ticket.type)}</Badge>{isOverdue(ticket) ? <Badge tone="danger">已逾期</Badge> : null}</span>
            <strong>{ticket.title}</strong>
            <span>{ticketContextLabel(ticket, shopsByID)}</span>
          </div>
          <div><Badge tone={priorityTone(ticket.priority)}>{priorityLabel(ticket.priority)}</Badge><span>{ticketStatusLabel(ticket.status, ticket.type)}</span></div>
        </button>)}
        {!tickets.length && !loading ? <Empty text="当前队列暂无工单" /> : null}
        <footer className="paged-list-controls">
          <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
          <span>第 {page} 页</span>
          <button type="button" disabled={tickets.length < pageSize} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </footer>
      </section>

      <section className="ticket-detail">
        {!selected ? <Empty text="选择工单查看详情" /> : <>
          <header className="ticket-detail-head">
            <div><span>{ticketTypeLabel(selected.type)} · {selected.id}</span><strong>{selected.title}</strong><small>{ticketContextLabel(selected, shopsByID)}</small></div>
            <div><Badge tone={ticketStatusTone(selected.status)}>{ticketStatusLabel(selected.status, selected.type)}</Badge>
              {isCreator && !["resolved", "closed", "cancelled"].includes(selected.status) ? <div className="ticket-more">
                <button type="button" aria-label="更多操作" onClick={() => setMoreOpen((current) => !current)}><MoreHorizontal size={17} /></button>
                {moreOpen ? <div><button type="button" onClick={() => void runAction("cancel")}>取消工单</button></div> : null}
              </div> : null}
            </div>
          </header>

          <section className="ticket-primary-action">
            <UserRound size={18} />
            <div><span>当前负责人</span><strong>{userName(usersByID, selected.assignedAgentId || "", props.currentUser)}</strong><small>{statusHint(selected)}</small></div>
            {canAccept ? <button className="primary" type="button" disabled={busy === "accept"} onClick={() => void acceptSelected()}><Check size={15} /> {selected.type === "customer" ? "接收并接管会话" : "接收任务"}</button> : null}
            {canEnterConversation ? <button type="button" onClick={() => void openConversation()}><ArrowRight size={15} /> 进入会话</button> : null}
          </section>

          {hasActionRow ? <div className="ticket-action-row">
            {canWork && selected.status === "in_progress" ? <button type="button" onClick={() => setWaitOpen((current) => !current)}><Pause size={15} /> 等待</button> : null}
            {canWork && selected.status === "pending" ? <button type="button" onClick={() => void runAction("resume")}><Play size={15} /> 继续处理</button> : null}
            {canWork ? <button className="primary" type="button" disabled={busy === "complete"} onClick={() => void runAction("complete")}><CheckCircle2 size={15} /> 完成</button> : null}
            {canReview ? <><button type="button" onClick={() => void runAction("review", { approved: false })}>退回处理</button><button className="primary" type="button" onClick={() => void runAction("review", { approved: true })}><Check size={15} /> 验收完成</button></> : null}
            {canCreateRelatedInternal ? <button type="button" onClick={() => { setCreateSource(selected); setCreating(true); }}><ClipboardPlus size={15} /> 新建关联内部任务</button> : null}
            {canConvertToCustomer ? <button type="button" onClick={() => setConvertOpen((current) => !current)}><ArrowRight size={15} /> 转为客户工单</button> : null}
          </div> : null}

          {waitOpen ? <form className="ticket-inline-wait" onSubmit={(event) => { event.preventDefault(); if (waitReason.trim()) void runAction("wait", { reason: waitReason.trim() }); }}>
            <Clock3 size={16} /><input autoFocus value={waitReason} onChange={(event) => setWaitReason(event.target.value)} placeholder="说明等待什么，例如：等待仓库确认" /><button type="button" onClick={() => setWaitOpen(false)}>取消</button><button className="primary" type="submit" disabled={!waitReason.trim()}>确认等待</button>
          </form> : null}
          {convertOpen ? <form className="ticket-inline-convert" onSubmit={(event) => { event.preventDefault(); if (convertTargetID) void runAction("convert-to-customer", { assignedAgentId: convertTargetID }); }}>
            <span>选择接收客服。对方接收后，关联会话才会整体转入其工作台。</span>
            <select value={convertTargetID} onChange={(event) => setConvertTargetID(event.target.value)}><option value="">选择客服</option>{availableUsers.map((user) => <option key={user.id} value={user.id}>{userDisplayName(user)}</option>)}</select>
            <button type="button" onClick={() => setConvertOpen(false)}>取消</button>
            <button className="primary" type="submit" disabled={!convertTargetID || busy === "convert-to-customer"}>确认转换</button>
          </form> : null}

          <section className="ticket-overview">
            <div><span>优先级</span><strong>{priorityLabel(selected.priority)}</strong></div>
            <div><span>创建人</span><strong>{userName(usersByID, selected.createdBy, props.currentUser)}</strong></div>
            <div><span>截止时间</span><strong>{selected.dueAt ? timeLabel(selected.dueAt, props.t) : "未设置"}</strong></div>
            {selected.customerName || selected.customerEmail ? <div className="wide"><span>关联客户</span><strong>{[selected.customerName, selected.customerEmail].filter(Boolean).join(" · ")}</strong></div> : null}
            {selected.waitingReason ? <div className="wide"><span>等待原因</span><strong>{selected.waitingReason}</strong></div> : null}
          </section>

          <section className="ticket-description">
            <header><strong>描述</strong>{canManage && selected.type === "internal" ? <button type="button" onClick={() => setSettingsOpen((current) => !current)}><Pencil size={14} /> 编辑任务</button> : null}</header>
            <p>{selected.description || "暂无描述"}</p>
            {settingsOpen ? <TicketSettings api={props.api} ticket={selected} users={availableUsers} currentUser={props.currentUser} onUpdated={(updated) => void refreshSelected(updated)} setFailure={(value) => {
              setFailureTitle("工单操作失败");
              setFailure(value);
            }} /> : null}
          </section>

          {selected.conversationId ? <section className="ticket-context">
            <header><div><MessageSquareText size={16} /><strong>关联会话</strong></div><span>实时只读，接收客户工单后才可回复</span></header>
            {contextLoading ? <p className="ticket-context-empty">正在加载会话记录...</p> : context ? <div className="ticket-context-messages">
              {context.messages.map((message) => <article key={message.id} className={message.direction}>
                <header><strong>{message.direction === "agent" ? "客服" : message.direction === "system" ? "系统" : context.conversation.customerName || "客户"}</strong><span>{timeLabel(message.createdAt, props.t)}</span></header>
                <p>{message.body || `[${message.type}]`}</p>
              </article>)}
              {!context.messages.length ? <p className="ticket-context-empty">暂无会话消息</p> : null}
            </div> : <p className="ticket-context-empty">无法加载关联会话</p>}
          </section> : null}

          <section className="ticket-comments">
            <header><MessageSquareText size={16} /><strong>处理记录</strong></header>
            <div>{comments.map((item) => <article className={item.kind === "system" ? "system" : ""} key={item.id}><strong>{item.kind === "system" ? "系统记录" : userName(usersByID, item.authorId, props.currentUser)}</strong><span>{timeLabel(item.createdAt, props.t)}</span><p>{item.body}</p></article>)}</div>
            {!comments.length ? <p className="ticket-comment-empty">暂无处理记录</p> : null}
            {canManage && !["resolved", "closed", "cancelled"].includes(selected.status) ? <form onSubmit={addComment}><textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="记录进展、结果或交接信息" /><button type="submit" disabled={!comment.trim() || busy === "comment"}><Send size={14} /> 添加记录</button></form> : null}
          </section>
        </>}
      </section>
    </div>

    {creating ? <CreateInternalTaskDialog
      api={props.api}
      shops={props.shops}
      users={availableUsers}
      currentUser={props.currentUser}
      sourceTicket={createSource}
      onClose={() => setCreating(false)}
      onCreated={(ticket) => {
        setCreating(false);
        setView("created_by_me");
        setTickets((current) => [ticket, ...current]);
        setSelectedID(ticket.id);
        props.setToast({ tone: "success", text: "内部任务已创建" });
      }}
    /> : null}
  </section>;
}

function TicketSettings(props: {
  api: PlatformAPI;
  ticket: Ticket;
  users: User[];
  currentUser: User;
  onUpdated: (ticket: Ticket) => void;
  setFailure: (value: string) => void;
}) {
  const [title, setTitle] = useState(props.ticket.title);
  const [description, setDescription] = useState(props.ticket.description || "");
  const [priority, setPriority] = useState(props.ticket.priority);
  const [ownerID, setOwnerID] = useState(props.ticket.assignedAgentId || "");
  const [dueAt, setDueAt] = useState(toLocalDateTimeInput(props.ticket.dueAt));
  const [saving, setSaving] = useState(false);
  const ownerChanged = ownerID !== (props.ticket.assignedAgentId || "");

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    props.setFailure("");
    try {
      const updated = await props.api.updateTicket(props.ticket.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
        assignedAgentId: ownerID,
        dueAt: dueAt ? new Date(dueAt).toISOString() : "",
        handoverNote: ownerChanged ? "由工单详情重新分配" : undefined
      });
      props.onUpdated(updated);
    } catch (error) {
      props.setFailure(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return <form className="ticket-settings-form" onSubmit={save}>
    <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>负责人<select value={ownerID} onChange={(event) => setOwnerID(event.target.value)}>{props.users.map((user) => <option key={user.id} value={user.id}>{userDisplayName(user)}</option>)}</select></label>
    <label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
    <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
    <label className="wide">描述<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <button className="primary" type="submit" disabled={saving || !title.trim() || !description.trim()}>{saving ? "保存中" : "保存设置"}</button>
  </form>;
}

function CreateInternalTaskDialog(props: {
  api: PlatformAPI;
  shops: Shop[];
  users: User[];
  currentUser: User;
  sourceTicket: Ticket | null;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const [title, setTitle] = useState(props.sourceTicket ? `内部处理：${props.sourceTicket.title}` : "");
  const [description, setDescription] = useState("");
  const [ownerID, setOwnerID] = useState(props.currentUser.id);
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [requiresAcceptance, setRequiresAcceptance] = useState(false);
  const [collaboratorIDs, setCollaboratorIDs] = useState<string[]>([]);
  const [shopID, setShopID] = useState(props.sourceTicket?.shopId || "");
  const inheritedCustomer = props.sourceTicket && (props.sourceTicket.customerName || props.sourceTicket.customerEmail)
    ? {
        customerRef: props.sourceTicket.customerRef || (props.sourceTicket.customerEmail ? `email:${props.sourceTicket.customerEmail.toLowerCase()}` : `conversation:${props.sourceTicket.conversationId || props.sourceTicket.id}`),
        shopId: props.sourceTicket.shopId || "",
        customerName: props.sourceTicket.customerName,
        customerEmail: props.sourceTicket.customerEmail,
        conversationId: props.sourceTicket.conversationId || "",
        lastMessageAt: props.sourceTicket.updatedAt
      } satisfies TicketCustomer
    : null;
  const [customer, setCustomer] = useState<TicketCustomer | null>(inheritedCustomer);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim() || !ownerID) return;
    setSubmitting(true);
    setFailure("");
    try {
      const ticket = await props.api.createTicket({
        type: "internal",
        parentTicketId: props.sourceTicket?.id,
        conversationId: props.sourceTicket?.conversationId || customer?.conversationId || undefined,
        shopId: props.sourceTicket?.shopId || customer?.shopId || shopID || undefined,
        customerRef: props.sourceTicket?.customerRef || customer?.customerRef,
        customerName: props.sourceTicket?.customerName || customer?.customerName,
        customerEmail: props.sourceTicket?.customerEmail || customer?.customerEmail,
        title: title.trim(),
        category: "内部事务",
        priority,
        status: "open",
        assignedAgentId: ownerID,
        collaboratorIds: collaboratorIDs,
        description: description.trim(),
        attachments: [],
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        requiresAcceptance
      });
      props.onCreated(ticket);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="workflow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <form className="workflow-dialog ticket-simple-dialog" onSubmit={submit}>
      <header><div><ClipboardPlus size={19} /><div><strong>新建内部任务</strong><span>{props.sourceTicket ? "会关联当前客户工单及完整会话" : "用于内部事项交接与协作"}</span></div></div><button type="button" onClick={props.onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="ticket-simple-body">
        <label>标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="简要说明需要处理的事项" /></label>
        <label>描述<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="填写当前情况、需要完成的事项和预期结果" /></label>
        <div className="ticket-simple-options">
          <label>负责人<select value={ownerID} onChange={(event) => setOwnerID(event.target.value)}>{props.users.map((user) => <option key={user.id} value={user.id}>{userDisplayName(user)}</option>)}</select></label>
          <label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label>
          <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <fieldset className="ticket-collaborator-options"><legend>协作人（选填）</legend><div>{props.users.filter((user) => user.id !== ownerID).map((user) => <label key={user.id}><input type="checkbox" checked={collaboratorIDs.includes(user.id)} onChange={() => setCollaboratorIDs((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />{userDisplayName(user)}</label>)}</div></fieldset>
          <label className="ticket-acceptance-option"><input type="checkbox" checked={requiresAcceptance} onChange={(event) => setRequiresAcceptance(event.target.checked)} /><span><strong>完成后由我验收</strong><small>负责人提交完成后，任务进入你的待验收队列</small></span></label>
          <fieldset className="ticket-association-options"><legend>关联客户（选填）</legend>
            {props.sourceTicket
              ? <div className="ticket-customer-summary"><UserRound size={16} /><span><strong>{props.sourceTicket.customerName || props.sourceTicket.customerEmail || "当前客户"}</strong>{props.sourceTicket.customerEmail ? <small>{props.sourceTicket.customerEmail}</small> : null}</span></div>
              : <div><label>店铺<select value={shopID} onChange={(event) => { setShopID(event.target.value); setCustomer(null); }}><option value="">不关联</option>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label><label>客户<TicketCustomerPicker api={props.api} shopId={shopID} value={customer} onChange={setCustomer} /></label></div>}
          </fieldset>
        </div>
      </div>
      {failure ? <div className="workflow-error">{failure}</div> : null}
      <footer><button type="button" onClick={props.onClose}>取消</button><button className="primary" type="submit" disabled={submitting || !title.trim() || !description.trim() || !ownerID}>{submitting ? "创建中" : "创建任务"}</button></footer>
    </form>
  </div>;
}

function ticketTypeLabel(type: string) { return type === "internal" ? "内部任务" : "客户工单"; }
function ticketStatusLabel(status: string, type = "customer") {
  return ({ open: "待接收", in_progress: "处理中", pending: "等待中", pending_review: "待验收", resolved: type === "internal" ? "已完成" : "已解决", closed: "已关闭", cancelled: "已取消" } as Record<string, string>)[status] || status;
}
function priorityLabel(priority: string) { return ({ urgent: "紧急", high: "高", normal: "普通", low: "低" } as Record<string, string>)[priority] || priority; }
function priorityTone(priority: string): "blue" | "muted" | "warning" | "danger" { return priority === "urgent" ? "danger" : priority === "high" ? "warning" : priority === "normal" ? "blue" : "muted"; }
function userName(usersByID: Map<string, User>, userID: string, currentUser: User) {
  return usersByID.get(userID)?.displayName || (userID === currentUser.id ? userDisplayName(currentUser) : "未分配");
}
function ticketContextLabel(ticket: Ticket, shopsByID: Map<string, Shop>) {
  const shop = ticket.shopId ? shopsByID.get(ticket.shopId)?.displayName || ticket.shopId : "内部";
  const subject = ticket.customerName || ticket.customerEmail || ticket.orderNumber || (ticket.conversationId ? "关联会话" : ticket.category);
  return `${shop} · ${subject}`;
}
function isOverdue(ticket: Ticket) {
  return Boolean(ticket.dueAt && !["resolved", "closed", "cancelled"].includes(ticket.status) && new Date(ticket.dueAt).getTime() < Date.now());
}
function toLocalDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function statusHint(ticket: Ticket) {
  if (ticket.status === "open") return ticket.type === "customer" ? "接收前会话仍由原客服处理" : "等待负责人接收";
  if (ticket.status === "pending") return ticket.waitingReason || "等待外部条件";
  if (ticket.status === "pending_review") return "已提交完成，等待创建人验收";
  if (ticket.status === "in_progress") return "负责人正在处理";
  return "工单已结束";
}
function ticketActionSuccess(action: string, approved?: boolean) {
  if (action === "review") return approved ? "工单已验收完成" : "工单已退回继续处理";
  return ({ complete: "工单已提交完成", wait: "工单已转为等待", resume: "工单已恢复处理", cancel: "工单已取消", "convert-to-customer": "已转为客户工单" } as Record<string, string>)[action] || "工单已更新";
}
function ticketMatchesViewClient(ticket: Ticket, view: TicketView, viewerID: string) {
  if (view === "mine") return ticket.assignedAgentId === viewerID && ["in_progress", "pending"].includes(ticket.status);
  if (view === "waiting_for_me") return ticket.assignedAgentId === viewerID && ticket.status === "open";
  if (view === "review_for_me") return ticket.createdBy === viewerID && ticket.status === "pending_review";
  if (view === "created_by_me") return ticket.createdBy === viewerID;
  if (view === "active") return !["resolved", "closed", "cancelled"].includes(ticket.status);
  return ["resolved", "closed", "cancelled"].includes(ticket.status);
}

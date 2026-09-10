import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, FileText, Image as ImageIcon, RefreshCw, Search, X } from "lucide-react";
import { Message, PlatformAPI, ProcessingRecord, ProcessingRecordFilters, ProcessingRecordsResponse, RecordCategoryOption, Shop, User } from "../../api";
import { Badge, Empty } from "../../components/ui";
import { hasPermission, PERMISSIONS } from "../../permissions";
import { errorText, timeLabel } from "../shared/helpers";
import { T, ToastTone } from "../shared/types";

const recordTimeCopy: T = { unknownTime: "未知时间" };
const emptyResult: ProcessingRecordsResponse = {
  items: [],
  summary: { total: 0, byPrimary: {}, bySecondary: {} },
  page: 1,
  pageSize: 30,
  totalPages: 0
};

const recentRanges = [
  { days: 1, label: "今天" },
  { days: 7, label: "最近7天" },
  { days: 30, label: "最近30天" }
];

export function ProcessingRecordsPanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  users: User[];
  agentsByShopId: Record<string, User[]>;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [categories, setCategories] = useState<RecordCategoryOption[]>([]);
  const [filters, setFilters] = useState<ProcessingRecordFilters>({});
  const [result, setResult] = useState<ProcessingRecordsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [monthExportOpen, setMonthExportOpen] = useState(false);
  const [exportMonth, setExportMonth] = useState(currentMonthValue());
  const [error, setError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<ProcessingRecord | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const agents = useMemo(() => {
    const candidates = filters.shopId ? props.agentsByShopId[filters.shopId] || [] : props.users;
    return candidates.filter((user) => user.status === "active" && hasPermission(user, PERMISSIONS.workbenchAccess));
  }, [filters.shopId, props.agentsByShopId, props.users]);
  const primaryOptions = useMemo(() => Array.from(new Set(["待确认", ...categories.map((item) => item.primary)])), [categories]);
  const secondaryOptions = useMemo(() => Array.from(new Set(categories.map((item) => item.secondary))), [categories]);
  const hasScope = Boolean(filters.shopId || filters.agentId || filters.startDate || filters.endDate);

  useEffect(() => {
    let cancelled = false;
    void props.api.listRecordCategories()
      .then((items) => { if (!cancelled) setCategories(items); })
      .catch((reason) => { if (!cancelled) setError(`加载处理分类失败：${errorText(reason)}`); });
    return () => { cancelled = true; };
  }, [props.api]);

  async function load(nextFilters = filters, page = 1) {
    const scoped = Boolean(nextFilters.shopId || nextFilters.agentId || nextFilters.startDate || nextFilters.endDate);
    if (!scoped) {
      setError("请先选择店铺、客服或日期范围，再查询处理记录。");
      setResult(null);
      return;
    }
    setLoading(true);
    setError("");
    closeDetail();
    try {
      const records = await props.api.listProcessingRecords({ ...nextFilters, page: String(page), pageSize: "30" });
      setResult({ ...records, items: Array.isArray(records.items) ? records.items : [] });
    } catch (reason) {
      setResult(null);
      setError(`查询处理记录失败：${errorText(reason)}`);
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void load(filters, 1);
  }

  async function downloadRecords(nextFilters: ProcessingRecordFilters) {
    setExporting(true);
    try {
      const file = await props.api.exportProcessingRecords(nextFilters);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      props.setToast({ tone: "success", text: `处理记录已导出：${file.filename}` });
      return true;
    } catch (reason) {
      props.setToast({ tone: "error", text: `导出处理记录失败：${errorText(reason)}` });
      return false;
    } finally {
      setExporting(false);
    }
  }

  async function exportRecords() {
    if (!hasScope) {
      setError("请先选择店铺、客服或日期范围，再导出处理记录。");
      return;
    }
    setError("");
    await downloadRecords(filters);
  }

  function applyRecentRange(days: number) {
    const nextFilters = { ...filters, ...recentDateRange(days) };
    setFilters(nextFilters);
    void load(nextFilters, 1);
  }

  async function exportSelectedMonth(event: FormEvent) {
    event.preventDefault();
    const range = monthDateRange(exportMonth);
    if (!range) {
      props.setToast({ tone: "error", text: "请选择需要导出的月份。" });
      return;
    }
    const succeeded = await downloadRecords({ ...filters, ...range });
    if (succeeded) setMonthExportOpen(false);
  }

  async function openDetail(record: ProcessingRecord) {
    setSelectedRecord(record);
    setMessages([]);
    setMessagesError("");
    setMessagesLoading(true);
    try {
      setMessages(await props.api.listMonitorMessages(record.conversationId));
    } catch (reason) {
      setMessagesError(`加载会话消息失败：${errorText(reason)}`);
    } finally {
      setMessagesLoading(false);
    }
  }

  function closeDetail() {
    setSelectedRecord(null);
    setMessages([]);
    setMessagesError("");
  }

  function openRowWithKeyboard(event: KeyboardEvent<HTMLTableRowElement>, record: ProcessingRecord) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void openDetail(record);
    }
  }

  const displayed = result || emptyResult;

  return (
    <section className="records-admin-page">
      <header className="records-page-header">
        <div><h2>处理记录</h2><p>查询客服分类、备注和完整会话，消息内容仅在打开详情时加载。</p></div>
        <button type="button" onClick={() => void exportRecords()} disabled={loading || exporting || !hasScope}><Download size={15} />{exporting ? "导出中" : "导出 Excel"}</button>
      </header>

      <div className="records-date-actions" aria-label="处理记录快捷日期范围">
        {recentRanges.map((range) => (
          <button
            key={range.days}
            type="button"
            className={matchesRecentRange(filters, range.days) ? "active" : ""}
            aria-pressed={matchesRecentRange(filters, range.days)}
            disabled={loading}
            onClick={() => applyRecentRange(range.days)}
          >
            {range.label}
          </button>
        ))}
        <button type="button" disabled={exporting} onClick={() => { setExportMonth(currentMonthValue()); setMonthExportOpen(true); }}><CalendarDays size={15} />按月导出</button>
      </div>

      <form className="records-filter-bar enhanced" onSubmit={submit}>
        <input value={filters.search || ""} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="客户、邮箱、订单号或备注" aria-label="搜索处理记录" />
        <select value={filters.shopId || ""} onChange={(event) => {
          const nextShopId = event.target.value;
          const eligibleAgentIDs = new Set((nextShopId ? props.agentsByShopId[nextShopId] || [] : props.users)
            .filter((user) => user.status === "active" && hasPermission(user, PERMISSIONS.workbenchAccess))
            .map((user) => user.id));
          setFilters((current) => ({ ...current, shopId: nextShopId, agentId: current.agentId && eligibleAgentIDs.has(current.agentId) ? current.agentId : "" }));
        }}><option value="">全部店铺</option>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select>
        <select value={filters.agentId || ""} onChange={(event) => setFilters((current) => ({ ...current, agentId: event.target.value }))}><option value="">全部客服</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName || agent.email}{agent.role === "admin" ? "（管理员支援）" : ""}</option>)}</select>
        <select value={filters.status || ""} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">全部状态</option><option value="open">排队</option><option value="assigned">接待中</option><option value="closed">已结束</option></select>
        <select value={filters.channel || ""} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value }))}><option value="">全部渠道</option><option value="chat">在线聊天</option><option value="email">邮件</option></select>
        <select value={filters.primary || ""} onChange={(event) => setFilters((current) => ({ ...current, primary: event.target.value }))}><option value="">全部一级分类</option>{primaryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={filters.secondary || ""} onChange={(event) => setFilters((current) => ({ ...current, secondary: event.target.value }))}><option value="">全部二级分类</option>{secondaryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <input type="date" value={filters.startDate || ""} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} aria-label="开始日期" />
        <input type="date" value={filters.endDate || ""} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} aria-label="结束日期" />
        <button className="primary" type="submit" disabled={loading}><Search size={15} />查询</button>
        <button type="button" title="重置筛选" aria-label="重置筛选" onClick={() => { setFilters({}); setResult(null); setError(""); closeDetail(); }}><RefreshCw size={15} /></button>
      </form>

      <div className="records-scope-note">必须选择店铺、客服或日期范围后才查询，避免一次加载全部店铺记录。</div>

      {result ? (
        <div className="records-summary" aria-label="处理记录统计">
          <div><span>记录总数</span><strong>{displayed.summary.total}</strong></div>
          <div><span>已发货</span><strong>{displayed.summary.byPrimary["已发货"] || 0}</strong></div>
          <div><span>已签收</span><strong>{displayed.summary.byPrimary["已签收"] || 0}</strong></div>
          <div><span>未发货</span><strong>{displayed.summary.byPrimary["未发货"] || 0}</strong></div>
          <div><span>未下单</span><strong>{displayed.summary.byPrimary["未下单"] || 0}</strong></div>
          <div><span>待确认</span><strong>{displayed.summary.byPrimary["待确认"] || 0}</strong></div>
          <div><span>售后问题</span><strong>{displayed.summary.bySecondary["售后问题"] || 0}</strong></div>
        </div>
      ) : null}

      {error ? <div className="records-page-error" role="alert">{error}</div> : null}

      {result ? (
        <>
          <div className="records-table-wrap">
            <table className="records-table enhanced">
              <thead><tr><th>处理时间</th><th>店铺</th><th>客服</th><th>客户</th><th>订单号</th><th>状态</th><th>一级分类</th><th>二级分类</th><th>三级分类</th><th>渠道</th><th>客服备注</th></tr></thead>
              <tbody>
                {displayed.items.map((item) => (
                  <tr key={item.conversationId} className="records-clickable-row" tabIndex={0} role="button" onClick={() => void openDetail(item)} onKeyDown={(event) => openRowWithKeyboard(event, item)}>
                    <td>{formatRecordTime(item.handledAt)}</td><td>{item.shopName}</td><td>{item.agentName || "未分配"}</td><td><strong>{item.customerName || "-"}</strong><span>{item.customerEmail || "-"}</span></td><td>{item.orderNumber || "-"}</td><td><Badge tone={item.status === "assigned" ? "green" : item.status === "open" ? "warning" : "muted"}>{recordStatusLabel(item.status)}</Badge></td><td>{item.primary || "-"}</td><td>{item.secondary || "-"}</td><td>{item.tertiary || "-"}</td><td>{item.inboundChannel || "-"}</td><td className="record-remark-cell">{item.remark || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !displayed.items.length ? <div className="records-empty">当前筛选条件下没有处理记录</div> : null}
            {loading ? <div className="records-empty">正在加载处理记录</div> : null}
          </div>
          <footer className="records-pagination">
            <button type="button" disabled={loading || displayed.page <= 1} onClick={() => void load(filters, displayed.page - 1)}><ChevronLeft size={15} />上一页</button>
            <span>第 {displayed.page} / {Math.max(displayed.totalPages, 1)} 页，共 {displayed.summary.total} 条</span>
            <button type="button" disabled={loading || displayed.totalPages === 0 || displayed.page >= displayed.totalPages} onClick={() => void load(filters, displayed.page + 1)}>下一页<ChevronRight size={15} /></button>
          </footer>
        </>
      ) : (
        <div className="records-query-empty"><Search size={32} /><strong>按范围查询处理记录</strong><span>选择店铺、客服或日期范围后点击查询。</span></div>
      )}

      {selectedRecord ? (
        <div className="monitor-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}>
          <aside className="monitor-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="record-detail-title">
            <header>
              <div><strong id="record-detail-title">{selectedRecord.customerName || selectedRecord.customerEmail || "访客"}</strong><span>{selectedRecord.shopName} · {selectedRecord.agentName || "未分配客服"}</span></div>
              <button type="button" onClick={closeDetail} aria-label="关闭会话详情"><X size={18} /></button>
            </header>
            <div className="monitor-detail-meta"><Badge tone="muted">只读会话</Badge><span>{selectedRecord.subject || "无主题"}</span></div>
            <div className="monitor-message-list">
              {messages.map((message) => <RecordMessage key={message.id} api={props.api} message={message} />)}
              {messagesLoading ? <div className="monitor-message-loading"><RefreshCw className="spin" size={18} />正在加载消息...</div> : null}
              {messagesError ? <div className="monitor-error">{messagesError}</div> : null}
              {!messagesLoading && !messagesError && !messages.length ? <Empty text="该会话暂无消息" /> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {monthExportOpen ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) setMonthExportOpen(false); }}>
          <section className="records-month-dialog" role="dialog" aria-modal="true" aria-labelledby="records-month-title">
            <header>
              <div><strong id="records-month-title">按月导出处理记录</strong><span>保留当前店铺、客服、状态、渠道和分类筛选</span></div>
              <button type="button" disabled={exporting} onClick={() => setMonthExportOpen(false)} aria-label="关闭按月导出"><X size={18} /></button>
            </header>
            <form onSubmit={exportSelectedMonth}>
              <label><span>选择月份</span><input type="month" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)} required autoFocus /></label>
              <footer>
                <button type="button" disabled={exporting} onClick={() => setMonthExportOpen(false)}>取消</button>
                <button className="primary" type="submit" disabled={exporting || !exportMonth}><Download size={15} />{exporting ? "导出中" : "导出 Excel"}</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function shanghaiDateValue(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDateValue(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthValue(value = new Date()) {
  return shanghaiDateValue(value).slice(0, 7);
}

function recentDateRange(days: number, now = new Date()) {
  const endDate = shanghaiDateValue(now);
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(days - 1, 0));
  return { startDate: utcDateValue(start), endDate };
}

function matchesRecentRange(filters: ProcessingRecordFilters, days: number) {
  const range = recentDateRange(days);
  return filters.startDate === range.startDate && filters.endDate === range.endDate;
}

function monthDateRange(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const end = new Date(Date.UTC(year, month, 0));
  return { startDate: `${match[1]}-${match[2]}-01`, endDate: utcDateValue(end) };
}

function RecordMessage(props: { api: PlatformAPI; message: Message }) {
  const imageURL = props.api.resolveAssetURL(props.message.metadata?.url);
  const fileURL = props.api.resolveAssetURL(props.message.metadata?.url);
  const message = props.message;
  return (
    <article className={`monitor-message ${message.direction === "agent" ? "agent" : message.direction === "system" ? "system" : "customer"}`}>
      <span>{message.direction === "agent" ? "客服" : message.direction === "system" ? "系统" : "客户"} · {timeLabel(message.createdAt, recordTimeCopy)}</span>
      {message.type === "image" && imageURL ? <a href={imageURL} target="_blank" rel="noreferrer"><img src={imageURL} alt={message.metadata?.fileName || "会话图片"} /></a> : null}
      {message.type === "file" && fileURL ? <a className="monitor-file-link" href={fileURL} target="_blank" rel="noreferrer"><FileText size={18} />{message.metadata?.fileName || message.body || "附件"}</a> : null}
      {message.type !== "image" && message.type !== "file" && message.body ? <p>{message.body}</p> : null}
      {message.type === "image" && !imageURL ? <p><ImageIcon size={15} />图片记录不可用</p> : null}
    </article>
  );
}

function formatRecordTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString("zh-CN", { hour12: false });
}

function recordStatusLabel(status: string) {
  if (status === "open") return "排队";
  if (status === "assigned") return "接待中";
  if (status === "closed") return "已结束";
  return status;
}

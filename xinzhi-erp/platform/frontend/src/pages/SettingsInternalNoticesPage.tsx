import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { SettingsPageHeader } from "../components/SettingsPageLayout";
import {
  internalNoticeApi,
  type InternalNotice,
  type InternalNoticeFilters,
  type InternalNoticeInput,
  type InternalNoticeStatus,
} from "../modules/internalNoticeApi";
import "./WarehouseArchiveShells.css";

const PATH = "/settings/tasks/notices";
const PAGE_SIZES = [25, 50, 100] as const;
type NoticeQuery = {
  title: string;
  status: "在用" | "已归档";
  pinned: "全部" | "置顶" | "普通";
  page: number;
  size: (typeof PAGE_SIZES)[number];
};

function bounded(value: string | null, maximum: number) {
  return (value ?? "").trim().slice(0, maximum);
}

export function parseInternalNoticeQuery(search: string): NoticeQuery {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "0");
  const size = Number(params.get("size") ?? "25");
  const status = params.get("status") === "已归档" ? "已归档" : "在用";
  const pinned = ["置顶", "普通"].includes(params.get("pinned") ?? "")
    ? params.get("pinned") as NoticeQuery["pinned"] : "全部";
  return {
    title: bounded(params.get("title"), 160), status, pinned,
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    size: PAGE_SIZES.includes(size as NoticeQuery["size"])
      ? size as NoticeQuery["size"] : 25,
  };
}

function noticeUrl(query: NoticeQuery) {
  const params = new URLSearchParams();
  if (query.title) params.set("title", query.title);
  if (query.status === "已归档") params.set("status", query.status);
  if (query.pinned !== "全部") params.set("pinned", query.pinned);
  if (query.page > 0) params.set("page", String(query.page));
  if (query.size !== 25) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized ? `${PATH}?${serialized}` : PATH;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Awaited<ReturnType<typeof internalNoticeApi.list>> };

export function SettingsInternalNoticesPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("settings.notice.write");
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseInternalNoticeQuery(search), [search]);
  const filters: InternalNoticeFilters = useMemo(() => ({
    title: query.title || undefined,
    status: query.status === "已归档" ? "ARCHIVED" : "ACTIVE",
    pinned: query.pinned === "全部" ? undefined : query.pinned === "置顶",
  }), [query.pinned, query.status, query.title]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<{ notice: InternalNotice; target: InternalNoticeStatus }>();
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" }); setSelected(new Set());
    void internalNoticeApi.list({ ...filters, page: query.page, size: query.size, signal: controller.signal }).then(
      (data) => setState({ status: "ready", data }),
      () => { if (!controller.signal.aborted) setState({ status: "error", message: "暂时无法读取内部公告。" }); },
    );
    return () => controller.abort();
  }, [filters, query.page, query.size, reload]);

  const navigate = (next: Partial<NoticeQuery>) => router.history.push(noticeUrl({ ...query, ...next }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    router.history.push(noticeUrl({
      title: bounded(String(data.get("title") ?? ""), 160),
      status: ["在用", "已归档"].includes(String(data.get("status"))) ? String(data.get("status")) as NoticeQuery["status"] : "在用",
      pinned: ["全部", "置顶", "普通"].includes(String(data.get("pinned"))) ? String(data.get("pinned")) as NoticeQuery["pinned"] : "全部",
      page: 0, size: query.size,
    }));
  };
  const refresh = (message?: string) => {
    if (message) setFeedback({ kind: "success", message });
    setReload((value) => value + 1);
  };

  const create = async (input: InternalNoticeInput) => {
    setBusy(true); setFeedback(undefined);
    try {
      await internalNoticeApi.create(input);
      setCreateOpen(false); refresh("内部公告已发布。");
    } catch (error) {
      setFeedback({ kind: "error", message: noticeError(error) });
    } finally { setBusy(false); }
  };
  const pin = async (notice: InternalNotice) => {
    setBusy(true); setFeedback(undefined);
    try {
      const result = await internalNoticeApi.setPinned(notice.id, notice.version, !notice.pinned);
      refresh(result.pinned ? "公告已置顶。" : "公告已取消置顶。");
    } catch (error) {
      setFeedback({ kind: "error", message: noticeError(error) });
    } finally { setBusy(false); }
  };
  const transition = async () => {
    if (!action) return;
    setBusy(true); setFeedback(undefined);
    try {
      await internalNoticeApi.transition(action.notice.id, action.notice.version, action.target);
      const message = action.target === "ARCHIVED" ? "公告已归档。" : "公告已恢复。";
      setAction(undefined); refresh(message);
    } catch (error) {
      setFeedback({ kind: "error", message: noticeError(error) });
    } finally { setBusy(false); }
  };
  const archiveSelected = async () => {
    if (state.status !== "ready") return;
    const notices = state.data.items.filter((item) => selected.has(item.id) && item.status === "ACTIVE");
    if (!notices.length) return;
    setBusy(true); setFeedback(undefined);
    try {
      await internalNoticeApi.archiveBatch(notices.map(({ id, version }) => ({ id, version })));
      setBatchConfirm(false); refresh(`已归档 ${notices.length} 条公告。`);
    } catch (error) {
      setFeedback({ kind: "error", message: noticeError(error) });
    } finally { setBusy(false); }
  };

  const rows = state.status === "ready" ? state.data.items : [];
  const selectable = rows.filter((item) => item.status === "ACTIVE");
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  return <main className="warehouse-archive-page settings-page" aria-labelledby="settings-notices-title">
    <SettingsPageHeader id="settings-notices-title" section="任务公告" title="内部公告" description="向企业成员发布运营通知，并保留可恢复的归档记录。" />
    <section className="warehouse-archive-card" aria-label="内部公告筛选与结果">
      <form className="warehouse-archive-filters procurement-plan-filters" key={search} onSubmit={submit}>
        <label>标题<input name="title" defaultValue={query.title} maxLength={160} placeholder="输入公告标题" /></label>
        <label>状态<select name="status" defaultValue={query.status}><option>在用</option><option>已归档</option></select></label>
        <label>置顶状态<select name="pinned" defaultValue={query.pinned}><option>全部</option><option>置顶</option><option>普通</option></select></label>
        <div className="warehouse-archive-filter-actions"><button className="is-primary" type="submit">搜索</button><button type="button" onClick={() => router.history.push(PATH)}>重置</button></div>
      </form>
      {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
      <div className="warehouse-archive-actions">
        {canWrite && query.status === "在用" && <button className="is-primary" type="button" disabled={busy} onClick={() => setCreateOpen(true)}>发布公告</button>}
        <button type="button" disabled={busy} onClick={() => navigate({ status: query.status === "已归档" ? "在用" : "已归档", pinned: "全部", page: 0 })}>{query.status === "已归档" ? "返回公告" : "已归档"}</button>
        {canWrite && query.status === "在用" && <button type="button" disabled={busy || !selectable.some((item) => selected.has(item.id))} onClick={() => setBatchConfirm(true)}>批量归档</button>}
        <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新</button>
      </div>
      {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      <div className="warehouse-archive-table-wrap"><table aria-label="内部公告列表"><thead><tr>
        <th><input type="checkbox" aria-label="选择本页在用公告" checked={allSelected} disabled={!canWrite || !selectable.length} onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map((item) => item.id)) : new Set())} /></th>
        <th>公告标题</th><th>公告内容</th><th>置顶</th><th>状态</th><th>发布人</th><th>发布时间</th><th>更新时间</th><th>操作</th>
      </tr></thead><tbody>
        {state.status === "loading" && <tr><td colSpan={9}><Empty text="正在读取内部公告…" /></td></tr>}
        {state.status === "ready" && rows.length === 0 && <tr><td colSpan={9}><Empty text={query.status === "已归档" ? "暂无已归档公告" : "暂无在用公告"} /></td></tr>}
        {rows.map((notice) => <tr key={notice.id}>
          <td><input type="checkbox" aria-label={`选择 ${notice.title}`} disabled={!canWrite || notice.status !== "ACTIVE"} checked={selected.has(notice.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(notice.id) : next.delete(notice.id); return next; })} /></td>
          <td><strong>{notice.title}</strong></td><td><span className="settings-notice-content" title={notice.content}>{notice.content}</span></td><td>{notice.pinned ? "是" : "否"}</td><td>{notice.status === "ACTIVE" ? "在用" : "已归档"}</td><td>{notice.createdByDisplayName}</td><td>{formatTime(notice.publishedAt)}</td><td>{formatTime(notice.updatedAt)}</td>
          <td><div className="table-row-actions">{canWrite && notice.status === "ACTIVE" && <><button className="text-button" type="button" disabled={busy} onClick={() => void pin(notice)}>{notice.pinned ? "取消置顶" : "置顶"}</button><button className="text-button" type="button" disabled={busy} onClick={() => setAction({ notice, target: "ARCHIVED" })}>归档</button></>}{canWrite && notice.status === "ARCHIVED" && <button className="text-button" type="button" disabled={busy} onClick={() => setAction({ notice, target: "ACTIVE" })}>恢复</button>}{!canWrite && "只读"}</div></td>
        </tr>)}
      </tbody></table></div>
      {state.status === "ready" && state.data.totalPages > 0 && <div className="procurement-plan-table-footer"><div className="pagination"><label>每页<select value={query.size} onChange={(event) => navigate({ size: Number(event.target.value) as NoticeQuery["size"], page: 0 })}>{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label><button type="button" disabled={query.page === 0} onClick={() => navigate({ page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {state.data.totalPages} 页，共 {state.data.totalElements} 条</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ page: query.page + 1 })}>下一页</button></div></div>}
    </section>
    {createOpen && <CreateNoticeDialog busy={busy} error={feedback?.kind === "error" ? feedback.message : undefined} close={() => setCreateOpen(false)} save={create} />}
    {action && <NoticeActionDialog title={action.target === "ARCHIVED" ? "归档公告" : "恢复公告"} description={action.target === "ARCHIVED" ? "公告将移入已归档列表，并取消置顶。" : "公告将恢复到在用列表。"} notice={action.notice} busy={busy} error={feedback?.kind === "error" ? feedback.message : undefined} close={() => setAction(undefined)} confirm={() => void transition()} />}
    {batchConfirm && <NoticeActionDialog title="批量归档公告" description={`将归档已选择的 ${selected.size} 条公告；之后仍可从已归档列表恢复。`} busy={busy} error={feedback?.kind === "error" ? feedback.message : undefined} close={() => setBatchConfirm(false)} confirm={() => void archiveSelected()} />}
  </main>;
}

function CreateNoticeDialog({ busy, error, close, save }: { busy: boolean; error?: string; close: () => void; save: (input: InternalNoticeInput) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void save({ title: String(data.get("title") ?? ""), content: String(data.get("content") ?? ""), pinned: data.get("pinned") === "on" });
  };
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog settings-task-dialog" role="dialog" aria-modal="true" aria-labelledby="notice-create-title"><header className="table-heading"><div><h2 id="notice-create-title">发布内部公告</h2><p>公告发布后立即对本企业成员可见。</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><form onSubmit={submit}><label>公告标题<input name="title" required maxLength={160} autoFocus /></label><label>公告内容<textarea name="content" required maxLength={4000} rows={7} placeholder="填写需要企业成员了解的事项" /></label><label className="warehouse-archive-checkbox"><input type="checkbox" name="pinned" />置顶显示</label>{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? "正在发布…" : "发布公告"}</button></div></form></section></section>;
}

function NoticeActionDialog({ title, description, notice, busy, error, close, confirm }: { title: string; description: string; notice?: InternalNotice; busy: boolean; error?: string; close: () => void; confirm: () => void }) {
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="notice-action-title"><header className="table-heading"><div><h2 id="notice-action-title">{title}</h2>{notice && <p>{notice.title}</p>}</div><DialogCloseButton disabled={busy} onClick={close} /></header><div className="warehouse-confirm-body"><p>{description}</p>{error && <div className="inline-alert" role="alert">{error}</div>}</div><footer className="warehouse-confirm-actions"><button type="button" disabled={busy} onClick={close}>返回</button><button className={title.includes("归档") ? "is-danger" : "is-primary"} type="button" disabled={busy} onClick={confirm}>{busy ? "正在处理…" : "确认"}</button></footer></section></section>;
}

function Empty({ text }: { text: string }) {
  return <div className="warehouse-archive-empty" role="status"><strong>{text}</strong><span>可调整筛选条件或刷新后重试。</span></div>;
}

function noticeError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "公告已被其他操作更新，请刷新后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有维护内部公告的权限。";
  return "公告操作失败，请检查填写内容或稍后重试。";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

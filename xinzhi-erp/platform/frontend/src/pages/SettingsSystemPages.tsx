import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { SettingsPageHeader } from "../components/SettingsPageLayout";
import {
  enterpriseProfileApi,
  type EnterpriseProfile,
  type EnterpriseProfileInput,
} from "../modules/enterpriseProfileApi";
import {
  enterpriseBrandingApi,
  notifyEnterpriseBrandingChanged,
  type EnterpriseBranding,
  type EnterpriseBrandingInput,
} from "../modules/enterpriseBrandingApi";
import {
  operationalTaskApi,
  type OperationalTask,
  type OperationalTaskFilters,
  type OperationalTaskStatus,
  type OperationalTaskUrgency,
} from "../modules/operationalTaskApi";
import {
  systemGeneralSettingApi,
  type SystemGeneralSetting,
} from "../modules/systemGeneralSettingApi";
import "./WarehouseArchiveShells.css";

const TASK_PATH = "/settings/system/task-management";

const TASK_SEARCH_OPTIONS = ["标题", "执行人", "任务对象", "任务编号"] as const;
const TASK_STATUS_OPTIONS = ["全部", "未执行", "执行中", "已完成", "执行失败", "已删除"] as const;
const TASK_URGENCY_OPTIONS = ["全部", "普通", "紧急"] as const;
const TASK_PAGE_SIZES = [25, 50, 100] as const;
const TASK_COLUMNS = [
  "任务编号",
  "任务标题",
  "分类",
  "任务对象",
  "紧急程度",
  "创建人",
  "执行人",
  "创建时间",
  "完成时间",
  "状态",
  "操作",
] as const;

type TaskQuery = {
  searchBy: (typeof TASK_SEARCH_OPTIONS)[number];
  keyword: string;
  startDate: string;
  endDate: string;
  status: (typeof TASK_STATUS_OPTIONS)[number];
  urgency: (typeof TASK_URGENCY_OPTIONS)[number];
  page: number;
  size: (typeof TASK_PAGE_SIZES)[number];
};

const searchValues: Record<TaskQuery["searchBy"], OperationalTaskFilters["searchBy"]> = {
  标题: "TITLE", 执行人: "ASSIGNEE", 任务对象: "OBJECT", 任务编号: "TASK_NO",
};
const statusValues: Record<TaskQuery["status"], OperationalTaskStatus | undefined> = {
  全部: undefined, 未执行: "PENDING", 执行中: "IN_PROGRESS", 已完成: "COMPLETED", 执行失败: "FAILED", 已删除: "DELETED",
};
const urgencyValues: Record<TaskQuery["urgency"], OperationalTaskUrgency | undefined> = {
  全部: undefined, 普通: "NORMAL", 紧急: "URGENT",
};
const taskStatusLabels: Record<OperationalTaskStatus, string> = {
  PENDING: "未执行", IN_PROGRESS: "执行中", COMPLETED: "已完成", FAILED: "执行失败", DELETED: "已删除",
};
const taskUrgencyLabels: Record<OperationalTaskUrgency, string> = {
  NORMAL: "普通", URGENT: "紧急",
};

function bounded(value: string | null, maximum = 500) {
  return (value ?? "").trim().slice(0, maximum);
}

function dateValue(value: string | null) {
  const candidate = bounded(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function optionValue<T extends readonly string[]>(
  value: string | null,
  options: T,
  fallback: T[number],
): T[number] {
  const candidate = bounded(value, 30);
  return options.includes(candidate as T[number]) ? (candidate as T[number]) : fallback;
}

export function parseSettingsTaskManagementQuery(search: string): TaskQuery {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "0");
  const size = Number(params.get("size") ?? "25");
  return {
    searchBy: optionValue(params.get("searchBy"), TASK_SEARCH_OPTIONS, "标题"),
    keyword: bounded(params.get("keyword")),
    startDate: dateValue(params.get("startDate")),
    endDate: dateValue(params.get("endDate")),
    status: optionValue(params.get("status"), TASK_STATUS_OPTIONS, "全部"),
    urgency: optionValue(params.get("urgency"), TASK_URGENCY_OPTIONS, "全部"),
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    size: TASK_PAGE_SIZES.includes(size as typeof TASK_PAGE_SIZES[number])
      ? size as typeof TASK_PAGE_SIZES[number] : 25,
  };
}

function taskUrl(query: TaskQuery, path = TASK_PATH) {
  const params = new URLSearchParams();
  if (query.searchBy !== "标题") params.set("searchBy", query.searchBy);
  if (query.keyword) params.set("keyword", query.keyword);
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  if (query.status !== "全部") params.set("status", query.status);
  if (query.urgency !== "全部") params.set("urgency", query.urgency);
  if (query.page > 0) params.set("page", String(query.page));
  if (query.size !== 25) params.set("size", String(query.size));
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function SettingsTaskManagementPage() {
  return <OperationalTaskWorkspace />;
}

export function OperationalTaskWorkspace({
  path = TASK_PATH,
  title = "任务管理",
  description = "查看任务处理情况。",
  section = "系统设置",
}: {
  path?: string;
  title?: string;
  description?: string;
  section?: string;
}) {
  const router = useRouter();
  const { currentUser, hasPermission } = useAuth();
  const canWrite = hasPermission("settings.task.write");
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const query = useMemo(() => parseSettingsTaskManagementQuery(search), [search]);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: Awaited<ReturnType<typeof operationalTaskApi.list>> }
  >({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ task: OperationalTask; target: OperationalTaskStatus }>();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  const filters: OperationalTaskFilters = useMemo(() => ({
    searchBy: searchValues[query.searchBy], keyword: query.keyword || undefined,
    startDate: query.startDate || undefined, endDate: query.endDate || undefined,
    status: statusValues[query.status], urgency: urgencyValues[query.urgency],
  }), [query]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" }); setSelected(new Set());
    void operationalTaskApi.list({ ...filters, page: query.page, size: query.size, signal: controller.signal }).then(
      (data) => setState({ status: "ready", data }),
      () => { if (!controller.signal.aborted) setState({ status: "error", message: "暂时无法读取任务，请稍后重试。" }); },
    );
    return () => controller.abort();
  }, [filters, query.page, query.size, reload]);

  const navigate = (next: Partial<TaskQuery>) => router.history.push(taskUrl({ ...query, ...next }, path));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    router.history.push(taskUrl({
      searchBy: optionValue(String(data.get("searchBy") ?? ""), TASK_SEARCH_OPTIONS, "标题"),
      keyword: bounded(String(data.get("keyword") ?? "")),
      startDate: dateValue(String(data.get("startDate") ?? "")),
      endDate: dateValue(String(data.get("endDate") ?? "")),
      status: optionValue(String(data.get("status") ?? ""), TASK_STATUS_OPTIONS, "全部"),
      urgency: optionValue(String(data.get("urgency") ?? ""), TASK_URGENCY_OPTIONS, "全部"),
      page: 0,
      size: query.size,
    }, path));
  };

  const refresh = (message?: string) => {
    if (message) setFeedback({ kind: "success", message });
    setReload((value) => value + 1);
  };

  const create = async (input: Parameters<typeof operationalTaskApi.create>[0]) => {
    setBusy(true); setFeedback(undefined);
    try {
      const result = await operationalTaskApi.create(input);
      setCreateOpen(false); refresh(`任务 ${result.taskNo} 已创建。`);
    } catch (error) {
      setFeedback({ kind: "error", message: taskErrorMessage(error) });
    } finally { setBusy(false); }
  };

  const transition = async () => {
    if (!action) return;
    setBusy(true); setFeedback(undefined);
    try {
      const result = await operationalTaskApi.transition(action.task.id, action.task.version, action.target);
      setAction(undefined); refresh(`任务 ${result.taskNo} 已更新为“${taskStatusLabels[result.status]}”。`);
    } catch (error) {
      setFeedback({ kind: "error", message: taskErrorMessage(error) });
    } finally { setBusy(false); }
  };

  const completeSelected = async () => {
    if (state.status !== "ready") return;
    const tasks = state.data.items.filter((item) => selected.has(item.id) && ["PENDING", "IN_PROGRESS", "FAILED"].includes(item.status));
    if (!tasks.length) return;
    setBusy(true); setFeedback(undefined);
    try {
      await operationalTaskApi.completeBatch(tasks.map(({ id, version }) => ({ id, version })));
      refresh(`已完成 ${tasks.length} 个任务。`);
    } catch (error) {
      setFeedback({ kind: "error", message: taskErrorMessage(error) });
    } finally { setBusy(false); }
  };

  const exportTasks = async () => {
    setBusy(true); setFeedback(undefined);
    try {
      const result = await operationalTaskApi.exportCsv(filters);
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setFeedback({ kind: "success", message: `已导出 ${result.rowCount} 个任务。` });
    } catch (error) {
      setFeedback({ kind: "error", message: taskErrorMessage(error) });
    } finally { setBusy(false); }
  };

  const rows = state.status === "ready" ? state.data.items : [];
  const completable = rows.filter((item) => ["PENDING", "IN_PROGRESS", "FAILED"].includes(item.status));
  const allCompletableSelected = completable.length > 0 && completable.every((item) => selected.has(item.id));

  return (
    <main className="warehouse-archive-page settings-page" aria-labelledby="settings-task-management-title">
      <SettingsPageHeader id="settings-task-management-title" section={section} title={title} description={description} />
      <section className="warehouse-archive-card" aria-label={`${title}筛选与结果`}>
        <form className="warehouse-archive-filters procurement-plan-filters" key={search} onSubmit={submit}>
          <fieldset className="procurement-plan-search-fields">
            <legend>搜索字段</legend>
            <div>
              {TASK_SEARCH_OPTIONS.map((option) => (
                <label key={option}>
                  <input type="radio" name="searchBy" value={option} defaultChecked={query.searchBy === option} />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="procurement-plan-keyword">搜索内容
            <input name="keyword" defaultValue={query.keyword} maxLength={500} placeholder="输入完整或部分内容" />
          </label>
          <label>起始日期<input type="date" name="startDate" defaultValue={query.startDate} /></label>
          <label>截止日期<input type="date" name="endDate" defaultValue={query.endDate} /></label>
          <label>状态
            <select name="status" defaultValue={query.status}>{TASK_STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>
          </label>
          <label>紧急程度
            <select name="urgency" defaultValue={query.urgency}>{TASK_URGENCY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>
          </label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary" type="submit">搜索</button>
            <button type="button" onClick={() => router.history.push(path)}>重置</button>
          </div>
        </form>
        {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
        <div className="warehouse-archive-actions">
          {canWrite && <button className="is-primary" type="button" disabled={busy} onClick={() => setCreateOpen(true)}>创建任务</button>}
          <button type="button" disabled={busy} onClick={() => navigate({ status: query.status === "已删除" ? "全部" : "已删除", page: 0 })}>{query.status === "已删除" ? "返回任务" : "已删除"}</button>
          {canWrite && <button type="button" disabled={busy || !completable.some((item) => selected.has(item.id))} onClick={() => void completeSelected()}>批量完成</button>}
          <button type="button" disabled={busy || state.status !== "ready"} onClick={() => void exportTasks()}>{busy ? "正在处理…" : "导出筛选结果"}</button>
          <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新</button>
        </div>
        {state.status === "error" && <div className="inline-alert" role="alert">{state.message}<button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
        <div className="warehouse-archive-table-wrap">
          <table>
            <thead><tr><th scope="col"><input type="checkbox" aria-label="选择本页可完成任务" checked={allCompletableSelected} disabled={!canWrite || !completable.length} onChange={(event) => setSelected(event.target.checked ? new Set(completable.map((item) => item.id)) : new Set())} /></th>{TASK_COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {state.status === "loading" && <tr><td colSpan={TASK_COLUMNS.length + 1}><EmptyState subject="正在读取任务" /></td></tr>}
              {state.status === "ready" && rows.length === 0 && <tr><td colSpan={TASK_COLUMNS.length + 1}><EmptyState subject="任务" /></td></tr>}
              {rows.map((task) => <tr key={task.id}>
                <td><input type="checkbox" aria-label={`选择 ${task.taskNo}`} disabled={!canWrite || !["PENDING", "IN_PROGRESS", "FAILED"].includes(task.status)} checked={selected.has(task.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(task.id) : next.delete(task.id); return next; })} /></td>
                <td><strong>{task.taskNo}</strong>{task.description && <span title={task.description}>{task.description}</span>}</td>
                <td>{task.title}</td><td>{task.category}</td><td>{task.taskObject}</td>
                <td>{taskUrgencyLabels[task.urgency]}</td><td>{task.createdByDisplayName}</td><td>{task.assigneeName}</td>
                <td>{formatTaskTime(task.createdAt)}</td><td>{task.completedAt ? formatTaskTime(task.completedAt) : "—"}</td>
                <td>{taskStatusLabels[task.status]}</td>
                <td><TaskRowActions task={task} canWrite={canWrite} busy={busy} choose={(target) => setAction({ task, target })} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {state.status === "ready" && state.data.totalPages > 0 && <div className="procurement-plan-table-footer"><div className="pagination"><label>每页<select value={query.size} onChange={(event) => navigate({ size: Number(event.target.value) as TaskQuery["size"], page: 0 })}>{TASK_PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label><button type="button" disabled={query.page === 0} onClick={() => navigate({ page: query.page - 1 })}>上一页</button><span>第 {query.page + 1} / {state.data.totalPages} 页，共 {state.data.totalElements} 条</span><button type="button" disabled={query.page + 1 >= state.data.totalPages} onClick={() => navigate({ page: query.page + 1 })}>下一页</button></div></div>}
      </section>
      {createOpen && <TaskCreateDialog busy={busy} defaultAssignee={currentUser?.displayName ?? ""} error={feedback?.kind === "error" ? feedback.message : undefined} close={() => setCreateOpen(false)} save={create} />}
      {action && <TaskActionDialog action={action} busy={busy} error={feedback?.kind === "error" ? feedback.message : undefined} close={() => setAction(undefined)} confirm={() => void transition()} />}
    </main>
  );
}

function TaskRowActions({ task, canWrite, busy, choose }: { task: OperationalTask; canWrite: boolean; busy: boolean; choose: (target: OperationalTaskStatus) => void }) {
  if (!canWrite) return <span>只读</span>;
  const actions: Array<[string, OperationalTaskStatus]> = task.status === "PENDING" ? [["开始", "IN_PROGRESS"], ["完成", "COMPLETED"], ["删除", "DELETED"]]
    : task.status === "IN_PROGRESS" ? [["完成", "COMPLETED"], ["标记失败", "FAILED"], ["删除", "DELETED"]]
      : task.status === "FAILED" ? [["重新开始", "IN_PROGRESS"], ["完成", "COMPLETED"], ["删除", "DELETED"]]
        : task.status === "COMPLETED" ? [["删除", "DELETED"]] : [["恢复", "PENDING"]];
  return <div className="table-row-actions">{actions.map(([label, target]) => <button className="text-button" type="button" key={target} disabled={busy} onClick={() => choose(target)}>{label}</button>)}</div>;
}

function TaskCreateDialog({ busy, defaultAssignee, error, close, save }: { busy: boolean; defaultAssignee: string; error?: string; close: () => void; save: (input: Parameters<typeof operationalTaskApi.create>[0]) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void save({ title: String(data.get("title") ?? ""), category: String(data.get("category") ?? ""), taskObject: String(data.get("taskObject") ?? ""), urgency: String(data.get("urgency") ?? "NORMAL") as OperationalTaskUrgency, assigneeName: String(data.get("assigneeName") ?? ""), description: String(data.get("description") ?? "") || undefined });
  };
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog settings-task-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-task-create-title"><header className="table-heading"><div><h2 id="settings-task-create-title">创建任务</h2><p>登记负责人、任务对象和处理要求。</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><form onSubmit={submit}><label>任务标题<input name="title" required maxLength={160} autoFocus /></label><div className="warehouse-dialog-grid"><label>分类<select name="category" defaultValue="运营任务"><option>运营任务</option><option>数据处理</option><option>异常处理</option><option>库存协同</option><option>其他</option></select></label><label>紧急程度<select name="urgency" defaultValue="NORMAL"><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label><label>任务对象<input name="taskObject" required maxLength={160} placeholder="例如订单、商品或店铺" /></label><label>执行人<input name="assigneeName" required maxLength={160} defaultValue={defaultAssignee} /></label></div><label>处理说明<textarea name="description" maxLength={1000} rows={4} placeholder="补充完成标准或注意事项（可选）" /></label>{error && <div className="inline-alert" role="alert">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="is-primary" type="submit" disabled={busy}>{busy ? "正在保存…" : "创建任务"}</button></div></form></section></section>;
}

function TaskActionDialog({ action, busy, error, close, confirm }: { action: { task: OperationalTask; target: OperationalTaskStatus }; busy: boolean; error?: string; close: () => void; confirm: () => void }) {
  const descriptions: Record<OperationalTaskStatus, string> = { PENDING: "恢复后任务回到未执行状态。", IN_PROGRESS: "任务将进入执行中状态。", COMPLETED: "任务将记录完成时间。", FAILED: "任务将标记为执行失败，可稍后重新开始。", DELETED: "任务将移入已删除列表，可从列表中恢复。" };
  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog warehouse-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-task-action-title"><header className="table-heading"><div><h2 id="settings-task-action-title">{taskStatusLabels[action.target]}任务</h2><p>{action.task.taskNo} · {action.task.title}</p></div><DialogCloseButton disabled={busy} onClick={close} /></header><div className="warehouse-confirm-body"><p>{descriptions[action.target]}</p>{error && <div className="inline-alert" role="alert">{error}</div>}</div><footer className="warehouse-confirm-actions"><button type="button" disabled={busy} onClick={close}>返回</button><button className={action.target === "DELETED" ? "is-danger" : "is-primary"} type="button" disabled={busy} onClick={confirm}>{busy ? "正在处理…" : "确认"}</button></footer></section></section>;
}

function taskErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "任务已被其他操作更新，请刷新后重试。";
  if (error instanceof ApiError && error.status === 403) return "当前账号没有维护任务的权限。";
  return "任务操作失败，请检查填写内容或稍后重试。";
}

function formatTaskTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

const GENERAL_CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY", "CAD", "AUD", "SGD", "HKD"] as const;

type GeneralLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SystemGeneralSetting };

function generalSettingError(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "系统设置已被其他操作更新，请刷新后再保存。";
  if (error instanceof ApiError && error.status === 403)
    return "当前账号没有维护系统设置的权限。";
  return "保存失败，请检查币种和时间段后重试。";
}

function formatGeneralTime(value?: string) {
  if (!value) return "尚未保存";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function SettingsGeneralConfigurationPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("settings.parameter.write");
  const [state, setState] = useState<GeneralLoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    setFeedback(undefined);
    void systemGeneralSettingApi.get(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      () => { if (!controller.signal.aborted) setState({ status: "error", message: "暂时无法读取系统设置。" }); },
    );
    return () => controller.abort();
  }, [reload]);

  return (
    <main className="warehouse-archive-page settings-page" aria-labelledby="settings-general-title">
      <SettingsPageHeader id="settings-general-title" section="系统设置" title="系统设置" description="管理企业默认币种和 Shopify 订单拉取时段。" />
      <section className="warehouse-archive-card" aria-label="系统设置表单">
        {state.status === "loading" && <p role="status">正在读取系统设置…</p>}
        {state.status === "error" && <div className="warehouse-archive-empty" role="alert"><strong>无法读取系统设置</strong><span>{state.message}</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
        {state.status === "ready" && <GeneralConfigurationForm
          key={`${state.data.version}-${state.data.defaultCurrency}-${state.data.orderPullBlackoutStart ?? "off"}`}
          setting={state.data}
          canWrite={canWrite}
          saving={saving}
          feedback={feedback}
          refresh={() => setReload((value) => value + 1)}
          save={async (input) => {
            setSaving(true); setFeedback(undefined);
            try {
              const saved = await systemGeneralSettingApi.save(state.data.version, input);
              setState({ status: "ready", data: saved });
              setFeedback({ kind: "success", message: "系统设置已保存并立即生效。" });
            } catch (error) {
              setFeedback({ kind: "error", message: generalSettingError(error) });
            } finally { setSaving(false); }
          }}
        />}
      </section>
    </main>
  );
}

function GeneralConfigurationForm({ setting, canWrite, saving, feedback, refresh, save }: {
  setting: SystemGeneralSetting;
  canWrite: boolean;
  saving: boolean;
  feedback?: { kind: "success" | "error"; message: string };
  refresh: () => void;
  save: (input: { defaultCurrency: string; orderPullBlackoutStart?: string; orderPullBlackoutEnd?: string }) => Promise<void>;
}) {
  const [blackoutEnabled, setBlackoutEnabled] = useState(Boolean(setting.orderPullBlackoutStart));
  const [start, setStart] = useState(setting.orderPullBlackoutStart ?? "23:00");
  const [end, setEnd] = useState(setting.orderPullBlackoutEnd ?? "06:00");
  const currencies = GENERAL_CURRENCIES.includes(setting.defaultCurrency as typeof GENERAL_CURRENCIES[number])
    ? GENERAL_CURRENCIES : [setting.defaultCurrency, ...GENERAL_CURRENCIES];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save({
      defaultCurrency: String(data.get("defaultCurrency") ?? ""),
      orderPullBlackoutStart: blackoutEnabled ? start : undefined,
      orderPullBlackoutEnd: blackoutEnabled ? end : undefined,
    });
  };
  return <form onSubmit={submit}>
    <div className="settings-general-layout">
      <fieldset><legend>业务默认值</legend><label>系统默认币种<select aria-label="系统默认币种" aria-describedby="system-default-currency-help" name="defaultCurrency" defaultValue={setting.defaultCurrency} disabled={!canWrite || saving}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select><small id="system-default-currency-help">新建订单默认使用此币种，仍可在订单中单独修改。</small></label></fieldset>
      <fieldset><legend>Shopify 订单拉取</legend><label className="warehouse-archive-checkbox"><input type="checkbox" checked={blackoutEnabled} disabled={!canWrite || saving} onChange={(event) => setBlackoutEnabled(event.target.checked)} />启用禁止拉取时段</label><div className="settings-general-time-grid"><label>开始时间<input aria-label="禁止拉取开始时间" type="time" value={start} disabled={!canWrite || saving || !blackoutEnabled} onChange={(event) => setStart(event.target.value)} required={blackoutEnabled} /></label><label>结束时间<input aria-label="禁止拉取结束时间" type="time" value={end} disabled={!canWrite || saving || !blackoutEnabled} onChange={(event) => setEnd(event.target.value)} required={blackoutEnabled} /></label></div><small>按北京时间执行；支持跨午夜。禁用时段内，平台订单预览和导入都会被后端拒绝。</small></fieldset>
      <aside className="settings-deadline-summary" aria-label="当前设置状态"><span>当前来源</span><strong>{setting.configured ? "企业已设置" : "系统默认"}</strong><span>最后更新</span><strong>{formatGeneralTime(setting.updatedAt)}</strong><span>操作人</span><strong>{setting.updatedByDisplayName ?? "—"}</strong></aside>
    </div>
    {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
    <div className="warehouse-archive-actions"><button type="button" disabled={saving} onClick={refresh}>刷新</button>{canWrite && <button className="is-primary" type="submit" disabled={saving || (blackoutEnabled && (!start || !end || start === end))}>{saving ? "正在保存…" : "保存"}</button>}</div>
  </form>;
}

type EnterpriseLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: EnterpriseProfile };

function enterpriseMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "企业资料已被其他操作更新，请重新加载后再保存。";
  if (error instanceof ApiError && error.status === 403)
    return "当前账号没有维护企业资料的权限。";
  return "企业资料保存失败，请检查联系人信息或网络后重试。";
}

export function SettingsEnterpriseInformationPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("settings.enterprise.write");
  const [state, setState] = useState<EnterpriseLoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  useEffect(() => {
    const controller = new AbortController();
    setFeedback(undefined);
    setState({ status: "loading" });
    void enterpriseProfileApi.get(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      () => { if (!controller.signal.aborted) setState({ status: "error", message: "暂时无法读取企业资料。" }); },
    );
    return () => controller.abort();
  }, [reload]);

  const save = async (event: FormEvent<HTMLFormElement>, profile: EnterpriseProfile) => {
    event.preventDefault();
    if (!canWrite || saving) return;
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const input: EnterpriseProfileInput = {
      companyName: value("companyName"), province: value("province") || undefined,
      city: value("city") || undefined, district: value("district") || undefined,
      detailedAddress: value("detailedAddress") || undefined,
      contactName: value("contactName"), contactEmail: value("contactEmail"),
      contactQq: value("contactQq") || undefined,
      contactMobile: value("contactMobile"),
      contactTelephone: value("contactTelephone") || undefined,
    };
    setSaving(true); setFeedback(undefined);
    try {
      const saved = await enterpriseProfileApi.save(profile.version, input);
      setState({ status: "ready", data: saved });
      setFeedback({ kind: "success", message: "企业基础资料已保存。" });
    } catch (error) {
      setFeedback({ kind: "error", message: enterpriseMessage(error) });
    } finally { setSaving(false); }
  };

  return (
    <main className="warehouse-archive-page settings-page" aria-labelledby="settings-enterprise-title">
      <SettingsPageHeader id="settings-enterprise-title" section="系统设置" title="企业信息" description="维护企业与联系人基础资料；企业编号和管理员由组织权限统一管理。" />
      <section className="warehouse-archive-card" aria-label="企业信息表单">
        {state.status === "loading" && <p role="status">正在读取企业资料…</p>}
        {state.status === "error" && <div className="warehouse-archive-empty" role="alert"><strong>无法读取企业资料</strong><span>{state.message}</span><button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
        {state.status === "ready" && <form key={`${state.data.configured}-${state.data.version}-${state.data.updatedAt ?? "new"}`} onSubmit={(event) => void save(event, state.data)}>
          <fieldset><legend>企业身份（只读）</legend><div className="warehouse-archive-filters">
            <label>企业编号<input value={state.data.tenantCode} readOnly /></label>
            <label>企业名称<input value={state.data.tenantName} readOnly /></label>
            <label>企业超级管理员<input value="在“组织与权限”中维护" readOnly /></label>
          </div></fieldset>
          <fieldset><legend>公司资料</legend><div className="warehouse-archive-filters">
            <label>企业名称（必填）<input name="companyName" required maxLength={160} disabled={!canWrite || saving} defaultValue={state.data.companyName ?? state.data.tenantName} /></label>
            <label>省 / 州<input name="province" maxLength={100} disabled={!canWrite || saving} defaultValue={state.data.province} /></label>
            <label>市<input name="city" maxLength={100} disabled={!canWrite || saving} defaultValue={state.data.city} /></label>
            <label>区 / 县<input name="district" maxLength={100} disabled={!canWrite || saving} defaultValue={state.data.district} /></label>
            <label>详细地址<input name="detailedAddress" maxLength={500} disabled={!canWrite || saving} defaultValue={state.data.detailedAddress} placeholder="请填写详细地址" /></label>
          </div></fieldset>
          <fieldset><legend>联系人资料</legend><div className="warehouse-archive-filters">
            <label>联系人（必填）<input name="contactName" required maxLength={160} disabled={!canWrite || saving} defaultValue={state.data.contactName} /></label>
            <label>联系邮箱（必填）<input name="contactEmail" type="email" required maxLength={254} disabled={!canWrite || saving} defaultValue={state.data.contactEmail} /></label>
            <label>联系手机（必填）<input name="contactMobile" type="tel" required maxLength={32} pattern="[+()0-9 .\-]{6,32}" disabled={!canWrite || saving} defaultValue={state.data.contactMobile} /></label>
            <label>联系 QQ<input name="contactQq" inputMode="numeric" maxLength={20} pattern="[0-9]{5,20}" disabled={!canWrite || saving} defaultValue={state.data.contactQq} /></label>
            <label>联系电话<input name="contactTelephone" type="tel" maxLength={32} pattern="[+()0-9 .\-]{6,32}" disabled={!canWrite || saving} defaultValue={state.data.contactTelephone} /></label>
          </div><p className="cell-secondary">联系人属于企业资料，仅在本企业内维护；审计记录不会保存这些字段的明文。</p></fieldset>
          {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
          <div className="form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={() => router.history.back()}>返回</button>{canWrite && <button type="submit" className="button button-primary" disabled={saving}>{saving ? "正在保存…" : "保存企业资料"}</button>}</div>
        </form>}
        <EnterpriseWatermarkPanel canWrite={canWrite} />
      </section>
    </main>
  );
}

type WatermarkLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: EnterpriseBranding };

function watermarkError(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "页面水印设置已被其他操作更新，请刷新后重试。";
  if (error instanceof ApiError && error.status === 403)
    return "当前账号没有维护页面水印设置的权限。";
  if (error instanceof ApiError && error.status === 400)
    return "启用水印时至少选择一项内容。";
  return "页面水印设置操作失败，请稍后重试。";
}

function EnterpriseWatermarkPanel({ canWrite }: { canWrite: boolean }) {
  const [state, setState] = useState<WatermarkLoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void enterpriseBrandingApi.get(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [reload]);

  const changed = (data: EnterpriseBranding, message: string) => {
    setState({ status: "ready", data });
    setFeedback({ kind: "success", message });
    notifyEnterpriseBrandingChanged();
  };

  const save = async (input: EnterpriseBrandingInput) => {
    if (state.status !== "ready") return;
    setBusy(true); setFeedback(undefined);
    try {
      changed(await enterpriseBrandingApi.save(state.data.version, input), "页面水印设置已保存并立即生效。" );
    } catch (error) {
      setFeedback({ kind: "error", message: watermarkError(error) });
    } finally { setBusy(false); }
  };

  return (
    <section className="enterprise-branding-panel" aria-labelledby="enterprise-watermark-settings">
      <div className="table-heading">
        <div><h2 id="enterprise-watermark-settings">页面水印</h2><p>为登录后的业务页面添加企业内可追溯水印。</p></div>
        <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新</button>
      </div>
      {state.status === "loading" && <p role="status">正在读取页面水印设置…</p>}
      {state.status === "error" && <div className="warehouse-archive-empty" role="alert"><strong>无法读取页面水印设置</strong><span>请稍后重试。</span><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>重试</button></div>}
      {state.status === "ready" && <BrandingSettingsForm key={state.data.version} data={state.data} canWrite={canWrite} busy={busy} save={save} />}
      {feedback && <p className={`warehouse-export-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
    </section>
  );
}

function BrandingSettingsForm({ data, canWrite, busy, save }: {
  data: EnterpriseBranding;
  canWrite: boolean;
  busy: boolean;
  save: (input: EnterpriseBrandingInput) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(data.watermarkEnabled);
  const [userName, setUserName] = useState(data.watermarkUserName);
  const [companyName, setCompanyName] = useState(data.watermarkCompanyName);
  const [time, setTime] = useState(data.watermarkTime);
  const [phoneSuffix, setPhoneSuffix] = useState(data.watermarkPhoneSuffix);
  const valid = !enabled || userName || companyName || time || phoneSuffix;
  return <form className="enterprise-watermark-form" onSubmit={(event) => { event.preventDefault(); void save({ watermarkEnabled: enabled, watermarkUserName: userName, watermarkCompanyName: companyName, watermarkTime: time, watermarkPhoneSuffix: phoneSuffix }); }}>
    <fieldset><legend>页面水印</legend><label className="warehouse-archive-checkbox"><input type="checkbox" checked={enabled} disabled={!canWrite || busy} onChange={(event) => setEnabled(event.target.checked)} />启用页面水印</label><p>水印只用于登录后的业务工作区，不影响打印和导出文件。</p><div className="enterprise-watermark-options"><label className="warehouse-archive-checkbox"><input type="checkbox" checked={userName} disabled={!canWrite || busy || !enabled} onChange={(event) => setUserName(event.target.checked)} />当前用户姓名</label><label className="warehouse-archive-checkbox"><input type="checkbox" checked={companyName} disabled={!canWrite || busy || !enabled} onChange={(event) => setCompanyName(event.target.checked)} />企业名称</label><label className="warehouse-archive-checkbox"><input type="checkbox" checked={time} disabled={!canWrite || busy || !enabled} onChange={(event) => setTime(event.target.checked)} />当前时间</label><label className="warehouse-archive-checkbox"><input type="checkbox" checked={phoneSuffix} disabled={!canWrite || busy || !enabled} onChange={(event) => setPhoneSuffix(event.target.checked)} />手机号后 4 位</label></div>{!valid && <p className="field-error" role="alert">启用水印时至少选择一项内容。</p>}</fieldset>{canWrite && <div className="form-actions"><button className="button button-primary" type="submit" disabled={busy || !valid}>{busy ? "正在保存…" : "保存水印设置"}</button></div>}
  </form>;
}

function EmptyState({ subject }: { subject: string }) {
  return (
    <div className="warehouse-archive-empty" role="status">
      <strong>{subject === "正在读取任务" ? subject : `暂无${subject}数据`}</strong>
      <span>{subject === "正在读取任务" ? "请稍候。" : "请调整查询条件后重试。"}</span>
    </div>
  );
}

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Inbox,
  LoaderCircle,
  MailCheck,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Tag,
  X
} from "lucide-react";
import {
  type EmailProcessingCategory,
  type EmailProcessingOption,
  type EmailProcessingTag,
  type EmailProcessingTagColor,
  type EmailStatisticsDetail,
  type EmailStatisticsExportJob,
  type EmailStatisticsFilters,
  type EmailStatisticsPage,
  type EmailStatisticsRecord,
  PlatformAPI
} from "../../api";
import { errorText } from "../shared/helpers";
import type { ToastMessage } from "../shared/types";
import { readViewDataCache, writeViewDataCache } from "../shared/viewDataCache";
import { subscribePlatformEvents } from "../shared/platformEvents";

type Props = {
  api: PlatformAPI;
  setToast: (value: ToastMessage) => void;
};

const emptyPage: EmailStatisticsPage = {
  items: [], page: 1, pageSize: 10, total: 0, totalPages: 1,
  shops: [], mailboxes: [], providers: []
};
const emailStatisticsCacheMs = 60_000;

function emailStatisticsCacheKey(filters: EmailStatisticsFilters) {
  return `email-statistics:${JSON.stringify(filters)}`;
}

const categoryLabels: Record<EmailProcessingCategory, string> = {
  verification: "验证码",
  security: "安全通知",
  payment: "支付财务",
  logistics: "物流库存",
  platform: "平台通知",
  other: "其他通知"
};

const tagColors: Array<{ value: EmailProcessingTagColor; label: string }> = [
  { value: "red", label: "红" },
  { value: "orange", label: "橙" },
  { value: "yellow", label: "黄" },
  { value: "green", label: "绿" },
  { value: "blue", label: "蓝" },
  { value: "purple", label: "紫" },
  { value: "gray", label: "灰" }
];

const emailStatisticsColumnStorageKey = "xzdesk.email-statistics.column-widths.v1";
const emailStatisticsExportJobStorageKey = "xzdesk.email-statistics.export-job.v1";

function readEmailStatisticsExportJobID() {
  try {
    return window.sessionStorage.getItem(emailStatisticsExportJobStorageKey) || "";
  } catch {
    return "";
  }
}

function storeEmailStatisticsExportJobID(id: string) {
  try {
    if (id) window.sessionStorage.setItem(emailStatisticsExportJobStorageKey, id);
    else window.sessionStorage.removeItem(emailStatisticsExportJobStorageKey);
  } catch {
    // Export remains usable when browser storage is unavailable.
  }
}

const emailStatisticsColumns = [
  { key: "receivedAt", label: "收件时间", defaultWidth: 122, minWidth: 122 },
  { key: "uniqueId", label: "邮件唯一ID", defaultWidth: 170, minWidth: 110 },
  { key: "mailbox", label: "邮箱账号", defaultWidth: 190, minWidth: 130 },
  { key: "sender", label: "发件人", defaultWidth: 185, minWidth: 120 },
  { key: "recipient", label: "收件人", defaultWidth: 190, minWidth: 130 },
  { key: "subject", label: "标题或内容摘要", defaultWidth: 320, minWidth: 180 },
  { key: "provider", label: "平台", defaultWidth: 88, minWidth: 70 },
  { key: "shop", label: "店铺名称", defaultWidth: 130, minWidth: 100 },
  { key: "shopNote", label: "店铺备注", defaultWidth: 210, minWidth: 120 },
  { key: "attachment", label: "附件", defaultWidth: 70, minWidth: 60 },
  { key: "category", label: "邮件分类", defaultWidth: 104, minWidth: 88 },
  { key: "status", label: "处理状态", defaultWidth: 104, minWidth: 88 },
  { key: "actions", label: "操作", defaultWidth: 108, minWidth: 96 }
] as const;

type EmailStatisticsColumnKey = typeof emailStatisticsColumns[number]["key"];
type EmailStatisticsColumnWidths = Record<EmailStatisticsColumnKey, number>;

const maximumEmailStatisticsColumnWidth = 720;

function clampColumnWidth(value: number, minimum: number) {
  return Math.min(maximumEmailStatisticsColumnWidth, Math.max(minimum, Math.round(value)));
}

function defaultEmailStatisticsColumnWidths() {
  return Object.fromEntries(emailStatisticsColumns.map((column) => [column.key, column.defaultWidth])) as EmailStatisticsColumnWidths;
}

function readEmailStatisticsColumnWidths() {
  const defaults = defaultEmailStatisticsColumnWidths();
  if (typeof window === "undefined") return defaults;
  try {
    const stored = JSON.parse(window.localStorage.getItem(emailStatisticsColumnStorageKey) || "{}") as Partial<Record<EmailStatisticsColumnKey, number>>;
    return Object.fromEntries(emailStatisticsColumns.map((column) => {
      const value = Number(stored[column.key]);
      return [column.key, Number.isFinite(value) ? clampColumnWidth(value, column.minWidth) : defaults[column.key]];
    })) as EmailStatisticsColumnWidths;
  } catch {
    return defaults;
  }
}

function localDateValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function initialDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { startDate: localDateValue(start), endDate: localDateValue(end) };
}

function dateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function providerLabel(value: string) {
  if (value.toLowerCase() === "gmail") return "Gmail";
  if (value.toLowerCase() === "outlook") return "Outlook";
  if (value.toLowerCase() === "imap_smtp") return "其他邮箱";
  return value || "-";
}

function statusLabel(value: string) {
  return value === "closed" ? "已处理" : "待处理";
}

function senderLabel(record: EmailStatisticsRecord) {
  return record.senderName || record.senderEmail || "未知发件人";
}

function mailboxConnectionLabel(mailbox: EmailProcessingOption) {
  if (!mailbox.connected) return "已解绑";
  return mailbox.syncable ? "可主动收取" : "实时同步";
}

function mailboxConnectionTone(mailbox: EmailProcessingOption) {
  if (!mailbox.connected) return "disconnected";
  return mailbox.syncable ? "receive" : "push";
}

type EmailStatisticsPageToken = number | `ellipsis-${string}`;

function emailStatisticsPageTokens(currentPage: number, totalPages: number): EmailStatisticsPageToken[] {
  if (totalPages <= 9) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const visible = new Set<number>([1, totalPages]);
  const start = currentPage <= 5 ? 2 : currentPage >= totalPages - 4 ? totalPages - 5 : currentPage - 2;
  const end = currentPage <= 5 ? 6 : currentPage >= totalPages - 4 ? totalPages - 1 : currentPage + 2;
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) visible.add(pageNumber);
  const pages = Array.from(visible).filter((value) => value >= 1 && value <= totalPages).sort((left, right) => left - right);
  const tokens: EmailStatisticsPageToken[] = [];
  pages.forEach((pageNumber, index) => {
    if (index > 0 && pageNumber - pages[index - 1] > 1) tokens.push(`ellipsis-${pages[index - 1]}-${pageNumber}`);
    tokens.push(pageNumber);
  });
  return tokens;
}

export function EmailStatisticsPanel(props: Props) {
  const range = useMemo(initialDateRange, []);
  const initialExportJobID = useMemo(readEmailStatisticsExportJobID, []);
  const initialFilters: EmailStatisticsFilters = { startDate: range.startDate, endDate: range.endDate, page: 1, pageSize: 10 };
  const initialCachedPage = readViewDataCache<EmailStatisticsPage>(props.api, emailStatisticsCacheKey(initialFilters), emailStatisticsCacheMs);
  const [data, setData] = useState<EmailStatisticsPage>(initialCachedPage || emptyPage);
  const [search, setSearch] = useState("");
  const [selectedMailbox, setSelectedMailbox] = useState<EmailProcessingOption | null>(null);
  const [mailboxSuggestionsOpen, setMailboxSuggestionsOpen] = useState(false);
  const [highlightedMailboxIndex, setHighlightedMailboxIndex] = useState(-1);
  const [provider, setProvider] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState(range.startDate);
  const [endDate, setEndDate] = useState(range.endDate);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jumpPage, setJumpPage] = useState("1");
  const [loading, setLoading] = useState(!initialCachedPage);
  const [receiving, setReceiving] = useState(false);
  const [exporting, setExporting] = useState(Boolean(initialExportJobID));
  const [exportProgress, setExportProgress] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<EmailStatisticsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagLabel, setTagLabel] = useState("");
  const [tagColor, setTagColor] = useState<EmailProcessingTagColor>("blue");
  const [columnWidths, setColumnWidths] = useState<EmailStatisticsColumnWidths>(readEmailStatisticsColumnWidths);
  const loadRequest = useRef(0);
  const exportJobId = useRef(initialExportJobID);
  const columnResize = useRef<{ key: EmailStatisticsColumnKey; startX: number; initialWidth: number } | null>(null);
  const validDateRange = Boolean(startDate && endDate && endDate >= startDate);
  const tableMinimumWidth = useMemo(
    () => emailStatisticsColumns.reduce((total, column) => total + columnWidths[column.key], 0),
    [columnWidths]
  );

  const filters = useMemo<EmailStatisticsFilters>(() => ({
    sourceId: selectedMailbox?.id,
    provider: provider || undefined,
    category: category || undefined,
    status: status || undefined,
    search: search.trim() || undefined,
    startDate,
    endDate,
    page,
    pageSize
  }), [category, endDate, page, pageSize, provider, search, selectedMailbox, startDate, status]);

  const shopLabels = useMemo(() => new Map(data.shops.map((item) => [item.id, item.label])), [data.shops]);
  const mailboxByAccount = useMemo(() => {
    const options = new Map<string, EmailProcessingOption>();
    data.mailboxes.forEach((item) => {
      const key = `${item.shopId || ""}\u0000${item.label.trim().toLowerCase()}`;
      const current = options.get(key);
      if (!current || (item.connected && !current.connected)) options.set(key, item);
    });
    return options;
  }, [data.mailboxes]);
  const mailboxSuggestions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query || selectedMailbox) return [];
    return data.mailboxes.filter((item) => {
      const shopName = item.shopId ? shopLabels.get(item.shopId) || "" : "";
      return item.label.toLocaleLowerCase().includes(query) || shopName.toLocaleLowerCase().includes(query);
    }).slice(0, 8);
  }, [data.mailboxes, search, selectedMailbox, shopLabels]);
  const pageTokens = useMemo(() => emailStatisticsPageTokens(data.page, data.totalPages), [data.page, data.totalPages]);

  const finishExport = useCallback(async (job: EmailStatisticsExportJob) => {
    if (!exportJobId.current || job.id !== exportJobId.current) return;
    if (job.status === "queued" || job.status === "running") {
      const attachmentProgress = job.attachmentTotal > 0
        ? ` ${Math.min(job.attachmentProcessed, job.attachmentTotal)}/${job.attachmentTotal}`
        : "";
      setExportProgress(`${job.progressStage || "后台生成中"}${attachmentProgress}`);
      return;
    }
    if (job.status === "failed") {
      exportJobId.current = "";
      storeEmailStatisticsExportJobID("");
      setExporting(false);
      setExportProgress("");
      props.setToast({ tone: "error", text: `导出失败：${job.lastError || "后台生成失败"}` });
      return;
    }
    if (job.status !== "completed") return;
    try {
      const file = await props.api.downloadEmailStatisticsExport(job);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      const attachmentResult = job.attachmentFailed > 0
        ? `，附件成功 ${job.attachmentSucceeded} 个、失败 ${job.attachmentFailed} 个，原因已写入表格`
        : `，附件 ${job.attachmentSucceeded} 个`;
      props.setToast({ tone: job.attachmentFailed > 0 ? "info" : "success", text: `已导出当前筛选范围内的 ${job.rowCount} 封完整邮件${attachmentResult}` });
    } catch (reason) {
      props.setToast({ tone: "error", text: `下载导出文件失败：${errorText(reason)}` });
    } finally {
      exportJobId.current = "";
      storeEmailStatisticsExportJobID("");
      setExporting(false);
      setExportProgress("");
    }
  }, [props.api, props.setToast]);

  useEffect(() => subscribePlatformEvents((event) => {
    if (event.type !== "email_export.updated") return;
    const job = event.payload as EmailStatisticsExportJob | undefined;
    if (job?.id) void finishExport(job);
  }), [finishExport]);

  useEffect(() => {
    const reconcileExport = () => {
      const id = exportJobId.current;
      if (!id || document.visibilityState !== "visible" || navigator.onLine === false) return;
      void props.api.getEmailStatisticsExport(id).then(finishExport).catch((reason) => {
        exportJobId.current = "";
        storeEmailStatisticsExportJobID("");
        setExporting(false);
        props.setToast({ tone: "error", text: `读取后台导出状态失败：${errorText(reason)}` });
      });
    };
    reconcileExport();
    window.addEventListener("online", reconcileExport);
    document.addEventListener("visibilitychange", reconcileExport);
    return () => {
      window.removeEventListener("online", reconcileExport);
      document.removeEventListener("visibilitychange", reconcileExport);
    };
  }, [finishExport, props.api, props.setToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(emailStatisticsColumnStorageKey, JSON.stringify(columnWidths));
      } catch {
        // Column resizing remains available when browser storage is unavailable.
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [columnWidths]);

  useEffect(() => () => {
    document.body.classList.remove("email-statistics-column-resizing");
  }, []);

  function setColumnWidth(key: EmailStatisticsColumnKey, value: number) {
    const column = emailStatisticsColumns.find((item) => item.key === key);
    if (!column) return;
    setColumnWidths((current) => ({ ...current, [key]: clampColumnWidth(value, column.minWidth) }));
  }

  function startColumnResize(key: EmailStatisticsColumnKey, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    columnResize.current = { key, startX: event.clientX, initialWidth: columnWidths[key] };
    document.body.classList.add("email-statistics-column-resizing");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueColumnResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resize = columnResize.current;
    if (!resize) return;
    setColumnWidth(resize.key, resize.initialWidth + event.clientX - resize.startX);
  }

  function stopColumnResize() {
    columnResize.current = null;
    document.body.classList.remove("email-statistics-column-resizing");
  }

  function resizeColumnWithKeyboard(key: EmailStatisticsColumnKey, event: ReactKeyboardEvent<HTMLSpanElement>) {
    const step = event.shiftKey ? 24 : 8;
    const delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    setColumnWidth(key, columnWidths[key] + delta);
  }

  const load = useCallback(async (force = false) => {
    const requestID = loadRequest.current + 1;
    loadRequest.current = requestID;
    if (!validDateRange) {
      setLoading(false);
      setError("请选择有效的开始日期和结束日期。");
      return;
    }
    const cacheKey = emailStatisticsCacheKey(filters);
    const cached = force ? null : readViewDataCache<EmailStatisticsPage>(props.api, cacheKey, emailStatisticsCacheMs);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await props.api.listEmailStatistics(filters);
      if (loadRequest.current !== requestID) return;
      setData(next);
      writeViewDataCache(props.api, cacheKey, next);
      if (next.page !== page) setPage(next.page);
    } catch (reason) {
      if (loadRequest.current !== requestID) return;
      setError(`加载邮件统计失败：${errorText(reason)}`);
    } finally {
      if (loadRequest.current === requestID) setLoading(false);
    }
  }, [filters, page, props.api, validDateRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detail]);

  useEffect(() => {
    setJumpPage(String(data.page));
  }, [data.page]);

  function resetPage() {
    setPage(1);
  }

  function goToJumpPage() {
    const target = Number.parseInt(jumpPage, 10);
    if (!Number.isFinite(target)) {
      setJumpPage(String(data.page));
      return;
    }
    const nextPage = Math.min(data.totalPages, Math.max(1, target));
    setJumpPage(String(nextPage));
    setPage(nextPage);
  }

  function chooseMailbox(mailbox: EmailProcessingOption) {
    setSelectedMailbox(mailbox);
    setSearch("");
    setProvider("");
    setMailboxSuggestionsOpen(false);
    setHighlightedMailboxIndex(-1);
    resetPage();
  }

  function clearSelectedMailbox() {
    setSelectedMailbox(null);
    setMailboxSuggestionsOpen(false);
    setHighlightedMailboxIndex(-1);
    resetPage();
  }

  function handleMailboxSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setMailboxSuggestionsOpen(false);
      setHighlightedMailboxIndex(-1);
      return;
    }
    if (!mailboxSuggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMailboxSuggestionsOpen(true);
      setHighlightedMailboxIndex((current) => {
        if (event.key === "ArrowDown") return current >= mailboxSuggestions.length - 1 ? 0 : current + 1;
        return current <= 0 ? mailboxSuggestions.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === "Enter" && mailboxSuggestionsOpen && highlightedMailboxIndex >= 0) {
      event.preventDefault();
      chooseMailbox(mailboxSuggestions[highlightedMailboxIndex]);
      return;
    }
    if (event.key === "Enter") setMailboxSuggestionsOpen(false);
  }

  async function receiveSelectedMailbox() {
    if (!selectedMailbox) {
      props.setToast({ tone: "info", text: "请先搜索并选择要收取的邮箱" });
      return;
    }
    if (!selectedMailbox.connected) {
      props.setToast({ tone: "info", text: "该邮箱已解绑，不能主动收取新邮件" });
      return;
    }
    if (!selectedMailbox.syncable) {
      props.setToast({ tone: "info", text: "该邮箱通过实时推送同步，无需手动收取" });
      return;
    }
    setReceiving(true);
    try {
      const result = await props.api.refreshEmailStatisticsMailbox(selectedMailbox.label, selectedMailbox.id);
      if (!result.synced) {
        props.setToast({ tone: "error", text: "该邮箱当前不可主动收取，请检查接入状态" });
        return;
      }
      await load(true);
      props.setToast({
        tone: "success",
        text: result.messagesCreated > 0
          ? `已收取 ${result.mailbox}：新增 ${result.messagesCreated} 封邮件`
          : `已收取 ${result.mailbox}，暂无新邮件`
      });
    } catch (reason) {
      props.setToast({ tone: "error", text: `收取新邮件失败：${errorText(reason)}` });
    } finally {
      setReceiving(false);
    }
  }

  async function openDetail(record: EmailStatisticsRecord) {
    setDetailLoading(true);
    setTagEditorOpen(false);
    setTagLabel("");
    setTagColor("blue");
    try {
      setDetail(await props.api.getEmailStatistics(record.conversationId, record.messageId));
    } catch (reason) {
      props.setToast({ tone: "error", text: `加载完整邮件失败：${errorText(reason)}` });
    } finally {
      setDetailLoading(false);
    }
  }

  function updateConversationRecords(conversationId: string, update: (record: EmailStatisticsRecord) => EmailStatisticsRecord) {
    setData((current) => ({
      ...current,
      items: current.items.map((record) => record.conversationId === conversationId ? update(record) : record)
    }));
    setDetail((current) => current && current.record.conversationId === conversationId
      ? { ...current, record: update(current.record) }
      : current);
  }

  async function saveTags(tags: EmailProcessingTag[]) {
    if (!detail) return null;
    setTagSaving(true);
    try {
      const saved = await props.api.updateEmailStatisticsTags(detail.record.conversationId, tags);
      updateConversationRecords(detail.record.conversationId, (record) => ({ ...record, tags: saved }));
      props.setToast({ tone: "success", text: "邮件标签已保存" });
      return saved;
    } catch (reason) {
      props.setToast({ tone: "error", text: `保存标签失败：${errorText(reason)}` });
      return null;
    } finally {
      setTagSaving(false);
    }
  }

  async function addOrUpdateTag() {
    if (!detail) return;
    const label = tagLabel.trim();
    if (!label) {
      props.setToast({ tone: "info", text: "请输入标签名称" });
      return;
    }
    if (Array.from(label).length > 12) {
      props.setToast({ tone: "info", text: "标签名称最多 12 个字符" });
      return;
    }
    const tags = detail.record.tags || [];
    const existingIndex = tags.findIndex((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    if (existingIndex < 0 && tags.length >= 5) {
      props.setToast({ tone: "info", text: "每封邮件最多添加 5 个标签" });
      return;
    }
    const next = tags.map((item) => ({ ...item }));
    if (existingIndex >= 0) next[existingIndex] = { label, color: tagColor };
    else next.push({ label, color: tagColor });
    if (await saveTags(next)) {
      setTagLabel("");
      setTagColor("blue");
      setTagEditorOpen(false);
    }
  }

  async function removeTag(label: string) {
    if (!detail) return;
    await saveTags((detail.record.tags || []).filter((item) => item.label !== label));
  }

  function editTag(tag: EmailProcessingTag) {
    setTagLabel(tag.label);
    setTagColor(tag.color);
    setTagEditorOpen(true);
  }

  async function changeStatus(nextStatus: "open" | "closed") {
    if (!detail) return;
    const conversationId = detail.record.conversationId;
    setActing(true);
    try {
      if (nextStatus === "closed") await props.api.markEmailStatisticsHandled(conversationId);
      else await props.api.reopenEmailStatistics(conversationId);
      updateConversationRecords(conversationId, (record) => ({ ...record, status: nextStatus }));
      props.setToast({
        tone: "success",
        text: nextStatus === "closed" ? "已在系统内标记处理；邮箱端已读状态未改变" : "已重新打开"
      });
    } catch (reason) {
      props.setToast({ tone: "error", text: `${nextStatus === "closed" ? "标记处理" : "重新打开"}失败：${errorText(reason)}` });
    } finally {
      setActing(false);
    }
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const job = await props.api.createEmailStatisticsExport({ ...filters, page: undefined, pageSize: undefined });
      exportJobId.current = job.id;
      storeEmailStatisticsExportJobID(job.id);
      props.setToast({ tone: "info", text: "导出已转入后台生成，完成后会自动下载" });
      setExportProgress(job.progressStage || "准备邮件数据");
      const current = job.status === "queued" || job.status === "running"
        ? await props.api.getEmailStatisticsExport(job.id)
        : job;
      await finishExport(current);
    } catch (reason) {
      exportJobId.current = "";
      storeEmailStatisticsExportJobID("");
      setExporting(false);
      setExportProgress("");
      props.setToast({ tone: "error", text: `导出失败：${errorText(reason)}` });
    }
  }

  return (
    <section className="email-statistics-page">
      <div className="email-statistics-toolbar" aria-label="邮件统计筛选">
        <div className="email-statistics-search-wrap">
          <div className="email-statistics-search">
            <Search size={15} aria-hidden="true" />
            {selectedMailbox ? (
              <span className="email-statistics-selected-mailbox">
                <span title={selectedMailbox.label}>已选邮箱：{selectedMailbox.label}</span>
                <i className={`mode-${mailboxConnectionTone(selectedMailbox)}`}>{mailboxConnectionLabel(selectedMailbox)}</i>
                <button type="button" aria-label={`取消选择 ${selectedMailbox.label}`} onClick={clearSelectedMailbox}><X size={13} /></button>
              </span>
            ) : (
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setMailboxSuggestionsOpen(Boolean(event.target.value.trim()));
                  setHighlightedMailboxIndex(-1);
                  resetPage();
                }}
                onFocus={() => setMailboxSuggestionsOpen(Boolean(search.trim()))}
                onBlur={() => setMailboxSuggestionsOpen(false)}
                onKeyDown={handleMailboxSearchKeyDown}
                placeholder="搜索邮件；输入邮箱账号可选择并收取"
                aria-label="搜索邮件统计或选择邮箱"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={mailboxSuggestionsOpen && mailboxSuggestions.length > 0}
                aria-controls="email-statistics-mailbox-suggestions"
                aria-activedescendant={highlightedMailboxIndex >= 0 ? `email-statistics-mailbox-option-${highlightedMailboxIndex}` : undefined}
              />
            )}
          </div>
          {mailboxSuggestionsOpen && mailboxSuggestions.length > 0 ? (
            <div className="email-statistics-mailbox-suggestions" id="email-statistics-mailbox-suggestions" role="listbox" aria-label="邮箱账号">
              {mailboxSuggestions.map((item, index) => (
                <button
                  type="button"
                  id={`email-statistics-mailbox-option-${index}`}
                  role="option"
                  aria-selected={index === highlightedMailboxIndex}
                  className={index === highlightedMailboxIndex ? "active" : ""}
                  key={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMailbox(item)}
                >
                  <span>{item.label}</span>
                  <small>{item.shopId ? shopLabels.get(item.shopId) || "未命名账号" : "未命名账号"} · {mailboxConnectionLabel(item)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <select value={provider} onChange={(event) => { setProvider(event.target.value); resetPage(); }} aria-label="筛选平台">
          <option value="">全部平台</option>
          {data.providers.map((item) => <option key={item} value={item}>{providerLabel(item)}</option>)}
        </select>
        <select value={category} onChange={(event) => { setCategory(event.target.value); resetPage(); }} aria-label="筛选邮件分类">
          <option value="">全部分类</option>
          {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }} aria-label="筛选处理状态">
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="closed">已处理</option>
        </select>
        <label className="email-statistics-date">
          <span>开始</span>
          <input type="date" value={startDate} max={endDate} onChange={(event) => { setStartDate(event.target.value); resetPage(); }} />
        </label>
        <label className="email-statistics-date">
          <span>结束</span>
          <input type="date" value={endDate} min={startDate} onChange={(event) => { setEndDate(event.target.value); resetPage(); }} />
        </label>
        <span
          className="email-statistics-receive-wrap"
          title={!selectedMailbox
            ? "先在搜索框中选择邮箱"
            : !selectedMailbox.connected
              ? "该邮箱已解绑，不能主动收取"
              : selectedMailbox.syncable
                ? `立即收取 ${selectedMailbox.label} 的新邮件`
                : "该邮箱通过实时推送同步，无需手动收取"}
        >
          <button
            type="button"
            className="secondary email-statistics-receive"
            onClick={() => void receiveSelectedMailbox()}
            disabled={loading || receiving || !selectedMailbox?.syncable}
            aria-label={!selectedMailbox?.syncable && selectedMailbox ? `${selectedMailbox.label} 无需或不能主动收取` : "收取新邮件"}
          >
            {receiving ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <MailCheck size={15} aria-hidden="true" />}
            {receiving ? "收取中" : "收取新邮件"}
          </button>
        </span>
        <button type="button" className="primary email-statistics-export" onClick={() => void exportExcel()} disabled={exporting || loading || !validDateRange || data.total === 0}>
          {exporting ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          {exporting ? exportProgress || "后台生成中" : "导出全部"}
        </button>
      </div>

      <section className="email-statistics-table-card" aria-busy={loading}>
        {error ? (
          <div className="email-statistics-error" role="alert">
            <FileText size={18} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="secondary" onClick={() => void load(true)}>重试</button>
          </div>
        ) : (
          <div className="email-statistics-table-scroll">
            <table className="email-statistics-table" style={{ minWidth: `${tableMinimumWidth}px` }}>
              <colgroup>
                {emailStatisticsColumns.map((column) => <col key={column.key} style={{ width: `${columnWidths[column.key]}px` }} />)}
              </colgroup>
              <thead>
                <tr>
                  {emailStatisticsColumns.map((column) => (
                    <th key={column.key}>
                      {column.label}
                      <span
                        className="email-statistics-column-resizer"
                        role="separator"
                        aria-label={`调整${column.label}列宽`}
                        aria-orientation="vertical"
                        aria-valuemin={column.minWidth}
                        aria-valuemax={maximumEmailStatisticsColumnWidth}
                        aria-valuenow={columnWidths[column.key]}
                        tabIndex={0}
                        title="拖动调整列宽；双击恢复默认宽度"
                        onDoubleClick={() => setColumnWidth(column.key, column.defaultWidth)}
                        onKeyDown={(event) => resizeColumnWithKeyboard(column.key, event)}
                        onPointerDown={(event) => startColumnResize(column.key, event)}
                        onPointerMove={continueColumnResize}
                        onPointerUp={stopColumnResize}
                        onPointerCancel={stopColumnResize}
                        onLostPointerCapture={stopColumnResize}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? Array.from({ length: 8 }, (_, index) => (
                  <tr key={`skeleton-${index}`} className="email-statistics-skeleton" aria-hidden="true">
                    {Array.from({ length: emailStatisticsColumns.length }, (__, cell) => <td key={cell}><span /></td>)}
                  </tr>
                )) : data.items.map((record) => (
                  <tr key={`${record.conversationId}-${record.messageId}`}>
                    <td
                      className="email-statistics-time"
                      title={record.originalReceivedAt || record.receivedAt}
                    >
                      {record.receivedAtDisplay || dateTime(record.receivedAt)}
                    </td>
                    <td><span className="email-statistics-id" title={record.uniqueId}>{record.uniqueId}</span></td>
                    <td>
                      {mailboxByAccount.has(`${record.shopId}\u0000${record.mailbox.trim().toLowerCase()}`) ? (
                        <button
                          type="button"
                          className="email-statistics-mailbox-button"
                          title={`选择 ${record.mailbox} 查看邮件`}
                          onClick={() => chooseMailbox(mailboxByAccount.get(`${record.shopId}\u0000${record.mailbox.trim().toLowerCase()}`)!)}
                        >
                          {record.mailbox}
                        </button>
                      ) : <span className="email-statistics-ellipsis" title={record.mailbox}>{record.mailbox}</span>}
                    </td>
                    <td>
                      <span className="email-statistics-stacked">
                        <strong title={senderLabel(record)}>{senderLabel(record)}</strong>
                        {record.senderEmail && record.senderEmail !== record.senderName ? <span title={record.senderEmail}>{record.senderEmail}</span> : null}
                      </span>
                    </td>
                    <td><span className="email-statistics-ellipsis" title={record.recipient}>{record.recipient}</span></td>
                    <td>
                      <span className="email-statistics-subject">
                        <strong title={record.subject}>{record.subject || "（无标题）"}</strong>
                        <span title={record.preview}>{record.preview || "暂无正文预览"}</span>
                        {record.tags?.length ? <span className="email-statistics-row-tags">{record.tags.slice(0, 2).map((item) => <i key={item.label} className={`email-manual-tag tag-${item.color}`}>{item.label}</i>)}{record.tags.length > 2 ? <i className="email-manual-tag-more">+{record.tags.length - 2}</i> : null}</span> : null}
                      </span>
                    </td>
                    <td><span className="email-statistics-provider">{providerLabel(record.provider)}</span></td>
                    <td><strong className="email-statistics-shop" title={record.shopName}>{record.shopName || "-"}</strong></td>
                    <td><span className="email-statistics-ellipsis" title={record.shopNote || "未添加备注"}>{record.shopNote || "—"}</span></td>
                    <td>
                      {record.hasAttachments ? (
                        <span className="email-statistics-attachment" title={record.attachmentNames?.join("、") || "含附件"}>
                          <Paperclip size={13} aria-hidden="true" /> 有
                        </span>
                      ) : <span className="email-statistics-muted">无</span>}
                    </td>
                    <td><span className={`email-statistics-badge category-${record.category}`}>{categoryLabels[record.category] || "其他通知"}</span></td>
                    <td><span className={`email-statistics-badge status-${record.status}`}>{statusLabel(record.status)}</span></td>
                    <td>
                      <button type="button" className="secondary email-statistics-view" onClick={() => void openDetail(record)} disabled={detailLoading}>
                        <Eye size={14} aria-hidden="true" /> 查看详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && data.items.length === 0 ? (
              <div className="email-statistics-empty">
                <Inbox size={28} aria-hidden="true" />
                <strong>当前筛选没有邮件</strong>
                <span>调整搜索条件、分类或日期范围后再查看。</span>
              </div>
            ) : null}
          </div>
        )}
        <footer className="email-statistics-pagination">
          <div className="email-statistics-pagination-summary">
            <span>共 {data.total} 封</span>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} aria-label="每页邮件数量">
              <option value={10}>10条/页</option>
              <option value={50}>50条/页</option>
              <option value={100}>100条/页</option>
            </select>
          </div>
          <nav className="email-statistics-page-numbers" aria-label="邮件统计分页">
            <button type="button" className="secondary" aria-label="上一页" disabled={loading || data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /></button>
            {pageTokens.map((token) => typeof token === "number" ? (
              <button
                type="button"
                key={token}
                className={token === data.page ? "active" : ""}
                aria-current={token === data.page ? "page" : undefined}
                aria-label={`第 ${token} 页`}
                disabled={loading}
                onClick={() => setPage(token)}
              >{token}</button>
            ) : <span key={token} aria-hidden="true">…</span>)}
            <button type="button" className="secondary" aria-label="下一页" disabled={loading || data.page >= data.totalPages} onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}><ChevronRight size={15} /></button>
          </nav>
          <label className="email-statistics-page-jump">
            <span>前往</span>
            <input
              value={jumpPage}
              inputMode="numeric"
              aria-label="前往页码"
              disabled={loading}
              onChange={(event) => setJumpPage(event.target.value.replace(/\D/g, ""))}
              onBlur={goToJumpPage}
              onKeyDown={(event) => { if (event.key === "Enter") goToJumpPage(); }}
            />
            <span>页</span>
          </label>
        </footer>
      </section>

      {detail ? (
        <div className="email-statistics-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
          <aside className="email-statistics-drawer" role="dialog" aria-modal="true" aria-labelledby="email-statistics-detail-title">
            <header>
              <div>
                <span className="email-statistics-detail-badges">
                  <i className={`email-statistics-badge category-${detail.record.category}`}>{categoryLabels[detail.record.category] || "其他通知"}</i>
                  <i className={`email-statistics-badge status-${detail.record.status}`}>{statusLabel(detail.record.status)}</i>
                  {(detail.record.tags || []).map((item) => <span className={`email-detail-tag tag-${item.color}`} key={item.label}><button type="button" onClick={() => editTag(item)}>{item.label}</button><button type="button" aria-label={`删除标签 ${item.label}`} disabled={tagSaving} onClick={() => void removeTag(item.label)}><X size={11} /></button></span>)}
                </span>
                <h3 id="email-statistics-detail-title">{detail.record.subject || "（无标题）"}</h3>
                <small>{senderLabel(detail.record)} · {detail.record.receivedAtDisplay || dateTime(detail.record.receivedAt)}</small>
              </div>
              <div className="email-statistics-detail-actions">
                <button type="button" className="secondary" aria-expanded={tagEditorOpen} onClick={() => setTagEditorOpen((current) => !current)}><Tag size={14} />标签</button>
                {detail.record.status === "closed"
                  ? <button type="button" className="secondary" disabled={acting} onClick={() => void changeStatus("open")}><RotateCcw size={14} />重新打开</button>
                  : <button type="button" className="primary" disabled={acting} onClick={() => void changeStatus("closed")}><Check size={14} />标记处理</button>}
                <button type="button" className="icon-button" aria-label="关闭邮件详情" onClick={() => setDetail(null)}><X size={18} /></button>
              </div>
            </header>
            <div className="email-statistics-detail-body">
              {tagEditorOpen ? <section className="email-processing-tag-editor email-statistics-tag-editor" aria-label="编辑邮件标签">
                <label><span>标签名称</span><input value={tagLabel} maxLength={12} onChange={(event) => setTagLabel(event.target.value)} placeholder="例如：财务跟进" /></label>
                <fieldset><legend>标签颜色</legend><div>{tagColors.map((color) => <button type="button" key={color.value} className={`email-tag-color-option tag-${color.value} ${tagColor === color.value ? "active" : ""}`} aria-pressed={tagColor === color.value} onClick={() => setTagColor(color.value)}><i />{color.label}</button>)}</div></fieldset>
                <span className="email-processing-tag-limit">{(detail.record.tags || []).length}/5</span>
                <button type="button" className="primary" disabled={tagSaving} onClick={() => void addOrUpdateTag()}><Plus size={14} />{(detail.record.tags || []).some((item) => item.label.toLocaleLowerCase() === tagLabel.trim().toLocaleLowerCase()) ? "更新标签" : "添加标签"}</button>
                <button type="button" disabled={tagSaving} onClick={() => { setTagEditorOpen(false); setTagLabel(""); }}>取消</button>
              </section> : null}
              <section className="email-statistics-detail-meta">
                <div><span>邮件唯一ID</span><strong>{detail.record.uniqueId}</strong></div>
                <div><span>店铺名称</span><strong>{detail.record.shopName || "-"}</strong></div>
                <div><span>邮箱账号</span><strong>{detail.record.mailbox}</strong></div>
                <div><span>平台</span><strong>{providerLabel(detail.record.provider)}</strong></div>
                <div><span>发件人</span><strong>{[detail.record.senderName, detail.record.senderEmail].filter(Boolean).join(" · ") || "未知发件人"}</strong></div>
                <div><span>收件人</span><strong>{detail.record.recipient}</strong></div>
                <div><span>原始时间和时区</span><strong>{detail.record.originalReceivedAt || detail.record.receivedAt}</strong></div>
                <div><span>附件</span><strong>{detail.record.hasAttachments ? detail.record.attachmentNames?.join("、") || "有附件" : "无"}</strong></div>
              </section>
              <section className="email-statistics-original">
                <header><strong>完整原始邮件</strong><span>处理状态和标签仅在系统内同步，不改变邮箱端状态</span></header>
                <pre>{detail.body || "（正文为空）"}</pre>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

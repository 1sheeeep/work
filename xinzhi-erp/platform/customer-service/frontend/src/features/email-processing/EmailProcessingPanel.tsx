import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Languages,
  MailCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  X,
  UserRoundCheck
} from "lucide-react";
import {
  type EmailProcessingCategory,
  type EmailProcessingDetail,
  type EmailProcessingItem,
  type EmailProcessingPage,
  type EmailProcessingTag,
  type EmailProcessingTagColor,
  PlatformAPI
} from "../../api";
import { errorText } from "../shared/helpers";
import { type ToastMessage } from "../shared/types";
import { readViewDataCache, writeViewDataCache } from "../shared/viewDataCache";
import { subscribePlatformEvents } from "../shared/platformEvents";

type Props = {
  api: PlatformAPI;
  setToast: (value: ToastMessage) => void;
};

const categoryCopy: Record<EmailProcessingCategory, { label: string; tone: string }> = {
  verification: { label: "验证码", tone: "verification" },
  security: { label: "安全通知", tone: "security" },
  payment: { label: "支付通知", tone: "payment" },
  logistics: { label: "物流通知", tone: "logistics" },
  platform: { label: "平台通知", tone: "platform" },
  other: { label: "其他通知", tone: "other" }
};

const emptyPage: EmailProcessingPage = {
  items: [], page: 1, pageSize: 30, total: 0, totalPages: 1,
  openCount: 0,
  shops: [], mailboxes: [], tagOptions: []
};
const emailProcessingCacheMs = 30_000;

function emailProcessingCacheKey(filters: { status: string; category: string; tag: string; search: string; page: number }) {
  return `email-processing:${JSON.stringify(filters)}`;
}

const tagColors: Array<{ value: EmailProcessingTagColor; label: string }> = [
  { value: "red", label: "红" },
  { value: "orange", label: "橙" },
  { value: "yellow", label: "黄" },
  { value: "green", label: "绿" },
  { value: "blue", label: "蓝" },
  { value: "purple", label: "紫" },
  { value: "gray", label: "灰" }
];

const suspectedMarketingReviewClassification = "suspected marketing email pending review";

function dateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function senderLabel(item: EmailProcessingItem) {
  return item.conversation.customerName || item.conversation.customerEmail || "未知发件人";
}

function visibleMessageTranslation(body: string, translation?: string) {
  const translated = translation?.trim() || "";
  if (!translated) return "";
  const comparable = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, "");
  return comparable(body) === comparable(translated) ? "" : translated;
}

export function EmailProcessingPanel({ api, setToast }: Props) {
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const initialCachedPage = readViewDataCache<EmailProcessingPage>(api, emailProcessingCacheKey({ status: "", category: "", tag: "", search: "", page: 1 }), emailProcessingCacheMs);
  const [data, setData] = useState<EmailProcessingPage>(initialCachedPage || emptyPage);
  const [selectedID, setSelectedID] = useState("");
  const [detail, setDetail] = useState<EmailProcessingDetail | null>(null);
  const [loading, setLoading] = useState(!initialCachedPage);
  const [detailLoading, setDetailLoading] = useState(false);
  const [translatedMessageIDs, setTranslatedMessageIDs] = useState<Set<string>>(() => new Set());
  const [translatingMessageIDs, setTranslatingMessageIDs] = useState<Set<string>>(() => new Set());
  const [acting, setActing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagLabel, setTagLabel] = useState("");
  const [tagColor, setTagColor] = useState<EmailProcessingTagColor>("blue");
  const [tagSaving, setTagSaving] = useState(false);

  const loadList = useCallback(async (quiet = false, force = false) => {
    const cacheKey = emailProcessingCacheKey({ status, category, tag: tagFilter, search: search.trim(), page });
    const cached = force ? null : readViewDataCache<EmailProcessingPage>(api, cacheKey, emailProcessingCacheMs);
    if (cached) {
      setData(cached);
      setLoadError("");
      setLoading(false);
      setSelectedID((current) => cached.items.some((item) => item.conversation.id === current)
        ? current
        : cached.items[0]?.conversation.id || "");
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const next = await api.listEmailProcessing({
        status: status || undefined,
        category: category || undefined,
        tag: tagFilter || undefined,
        search: search.trim() || undefined,
        page,
        pageSize: 30
      });
      setData(next);
      writeViewDataCache(api, cacheKey, next);
      setLoadError("");
      setSelectedID((current) => next.items.some((item) => item.conversation.id === current)
        ? current
        : next.items[0]?.conversation.id || "");
    } catch (error) {
      setLoadError(errorText(error));
      if (!quiet) setData((current) => ({ ...current, items: [], total: 0, totalPages: 1 }));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [api, category, page, search, status, tagFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    let refreshTimer: number | null = null;
    const unsubscribe = subscribePlatformEvents((event) => {
      if (!event.type.startsWith("message.") && !event.type.startsWith("conversation.")) return;
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadList(true, true);
      }, 500);
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [loadList]);

  useEffect(() => {
    if (tagFilter && !data.tagOptions.some((tag) => tag.label === tagFilter)) {
      setTagFilter("");
      setPage(1);
    }
  }, [data.tagOptions, tagFilter]);

  useEffect(() => {
    setTagEditorOpen(false);
    setTagLabel("");
    setTagColor("blue");
    if (!selectedID) {
      setDetail(null);
      setTranslatedMessageIDs(new Set());
      setTranslatingMessageIDs(new Set());
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setTranslatedMessageIDs(new Set());
    setTranslatingMessageIDs(new Set());
    void api.getEmailProcessing(selectedID)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setDetail(null);
          setToast({ tone: "error", text: `加载邮件详情失败：${errorText(error)}` });
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, selectedID, setToast]);

  async function saveTags(tags: EmailProcessingTag[]) {
    if (!selectedID) return;
    setTagSaving(true);
    try {
      const item = await api.updateEmailProcessingTags(selectedID, tags);
      setDetail((current) => current && current.item.conversation.id === selectedID ? { ...current, item } : current);
      setData((current) => ({ ...current, items: current.items.map((entry) => entry.conversation.id === selectedID ? item : entry) }));
      await loadList(true, true);
      return item;
    } catch (error) {
      setToast({ tone: "error", text: `保存标签失败：${errorText(error)}` });
      return null;
    } finally {
      setTagSaving(false);
    }
  }

  async function addOrUpdateTag() {
    if (!detail) return;
    const label = tagLabel.trim();
    if (!label) {
      setToast({ tone: "info", text: "请输入标签名称" });
      return;
    }
    if (Array.from(label).length > 12) {
      setToast({ tone: "info", text: "标签名称最多 12 个字符" });
      return;
    }
    const existingIndex = detail.item.tags.findIndex((tag) => tag.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    if (existingIndex < 0 && detail.item.tags.length >= 5) {
      setToast({ tone: "info", text: "每封邮件最多添加 5 个标签" });
      return;
    }
    const next = detail.item.tags.map((tag) => ({ ...tag }));
    if (existingIndex >= 0) next[existingIndex] = { label, color: tagColor };
    else next.push({ label, color: tagColor });
    const saved = await saveTags(next);
    if (saved) {
      setTagLabel("");
      setTagColor("blue");
      setTagEditorOpen(false);
    }
  }

  async function removeTag(label: string) {
    if (!detail) return;
    await saveTags(detail.item.tags.filter((tag) => tag.label !== label));
  }

  function editTag(tag: EmailProcessingTag) {
    setTagLabel(tag.label);
    setTagColor(tag.color);
    setTagEditorOpen(true);
  }

  async function markHandled() {
    if (!selectedID) return;
    setActing(true);
    try {
      const result = await api.markEmailProcessingHandled(selectedID);
      setToast({
        tone: result.emailReadPending ? "info" : "success",
        text: result.emailReadPending ? "已标记处理，邮箱已读状态将在后台同步" : "已标记处理并同步邮箱已读状态"
      });
      await loadList(false, true);
    } catch (error) {
      setToast({ tone: "error", text: `标记处理失败：${errorText(error)}` });
    } finally {
      setActing(false);
    }
  }

  async function reopen() {
    if (!selectedID) return;
    setActing(true);
    try {
      await api.reopenEmailProcessing(selectedID);
      setToast({ tone: "success", text: "邮件已重新打开" });
      await loadList(false, true);
    } catch (error) {
      setToast({ tone: "error", text: `重新打开失败：${errorText(error)}` });
    } finally {
      setActing(false);
    }
  }

  async function promoteToCustomer() {
    if (!selectedID || !detail) return;
    const confirmed = window.confirm("确认将这封邮件转为客户邮件？转换后会移出本模块，并进入客服工作台和客服统计。");
    if (!confirmed) return;
    setActing(true);
    try {
      await api.promoteEmailProcessing(selectedID);
      setToast({ tone: "success", text: "已转为客户邮件，请到客服工作台继续处理" });
      setDetail(null);
      setSelectedID("");
      await loadList(false, true);
    } catch (error) {
      setToast({ tone: "error", text: `转为客户邮件失败：${errorText(error)}` });
    } finally {
      setActing(false);
    }
  }

  async function toggleMessageTranslation(messageID: string, body: string, storedTranslation?: string) {
    const existingTranslation = visibleMessageTranslation(body, storedTranslation);
    if (translatedMessageIDs.has(messageID)) {
      setTranslatedMessageIDs((current) => {
        const next = new Set(current);
        next.delete(messageID);
        return next;
      });
      return;
    }
    if (existingTranslation) {
      setTranslatedMessageIDs((current) => new Set(current).add(messageID));
      return;
    }
    if (!selectedID || translatingMessageIDs.has(messageID)) return;

    const conversationID = selectedID;
    setTranslatingMessageIDs((current) => new Set(current).add(messageID));
    try {
      const translated = await api.translateEmailProcessingMessage(conversationID, messageID);
      const translatedText = visibleMessageTranslation(body, translated.metadata?.translationZh);
      if (!translatedText) {
        setToast({ tone: "info", text: "正文已经是中文，无需翻译" });
        return;
      }
      setDetail((current) => {
        if (!current || current.item.conversation.id !== conversationID) return current;
        return {
          ...current,
          messages: current.messages.map((message) => message.id === messageID
            ? { ...message, metadata: translated.metadata }
            : message)
        };
      });
      setTranslatedMessageIDs((current) => new Set(current).add(messageID));
    } catch (error) {
      setToast({ tone: "error", text: `翻译失败：${errorText(error)}` });
    } finally {
      setTranslatingMessageIDs((current) => {
        const next = new Set(current);
        next.delete(messageID);
        return next;
      });
    }
  }

  return <section className="email-processing-page" aria-busy={loading}>
    <section className="email-processing-filters" aria-label="邮件筛选">
      <label className="email-processing-search"><Search size={15} /><input aria-label="搜索邮件" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索发件人、收件邮箱、主题或店铺名称" /></label>
      <select aria-label="处理状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="open">待处理</option><option value="closed">已处理</option></select>
      <select aria-label="邮件分类" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">全部分类</option>{Object.entries(categoryCopy).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}</select>
      <select aria-label="邮件标签" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setPage(1); }}><option value="">全部标签</option>{data.tagOptions.map((tag) => <option key={tag.label} value={tag.label}>{tag.label}</option>)}</select>
      <div className="email-processing-compact-summary" aria-label="邮件处理摘要">
        <span>待处理 <b>{data.openCount}</b></span>
      </div>
      <button className="email-processing-refresh" type="button" onClick={() => void loadList(false, true)} disabled={loading} aria-label="刷新邮件列表">
        <RefreshCw size={15} className={loading ? "spin" : ""} />刷新
      </button>
    </section>

    {loadError ? <div className="email-processing-error" role="alert"><ShieldAlert size={17} /><span>加载失败：{loadError}</span><button type="button" onClick={() => void loadList(false, true)}>重试</button></div> : null}

    <section className="email-processing-workspace">
      <div className="email-processing-list">
        <header><strong>邮件列表</strong><span>共 {data.total} 封</span></header>
        <div className="email-processing-list-body">
          {loading ? Array.from({ length: 6 }, (_, index) => <div className="email-processing-skeleton" key={index}><i /><span /><small /></div>) : null}
          {!loading && data.items.map((item) => {
            const copy = categoryCopy[item.category];
            return <button type="button" key={item.conversation.id} className={`email-processing-row ${selectedID === item.conversation.id ? "active" : ""} ${item.conversation.unread ? "unread" : ""}`} onClick={() => setSelectedID(item.conversation.id)}>
              <span className="email-processing-row-top"><span className="email-processing-row-sender"><b>{senderLabel(item)}</b>{item.shopifyOfficial ? <i className="email-official-badge"><ShieldCheck size={10} />Shopify 官方</i> : null}</span><time>{dateTime(item.conversation.lastMessageAt || item.conversation.createdAt)}</time></span>
              <span className="email-processing-row-subject">{item.conversation.subject || "无主题"}</span>
              <span className="email-processing-row-preview">{item.preview || "暂无正文预览"}</span>
              <span className="email-processing-row-meta"><span className="email-processing-row-labels"><i className={`email-category ${copy.tone}`}>{copy.label}</i>{item.tags.slice(0, 2).map((tag) => <i key={tag.label} className={`email-manual-tag tag-${tag.color}`}>{tag.label}</i>)}{item.tags.length > 2 ? <i className="email-manual-tag-more">+{item.tags.length - 2}</i> : null}</span><small>{item.shopName} · {item.sourceAddress}</small></span>
            </button>;
          })}
          {!loading && !data.items.length && !loadError ? <div className="email-processing-empty"><Inbox size={30} /><strong>当前筛选没有邮件</strong><span>{status === "open" ? "新的待处理邮件会自动进入这里" : "可以切换状态或调整筛选条件"}</span></div> : null}
        </div>
        <footer className="email-processing-pagination">
          <button type="button" aria-label="上一页" disabled={loading || data.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /></button>
          <span>第 {data.page} / {data.totalPages} 页</span>
          <button type="button" aria-label="下一页" disabled={loading || data.page >= data.totalPages} onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}><ChevronRight size={15} /></button>
        </footer>
      </div>

      <div className="email-processing-detail">
        {detailLoading ? <div className="email-processing-detail-loading"><RefreshCw size={20} className="spin" /><span>正在加载邮件详情</span></div> : null}
        {!detailLoading && detail ? <>
          <header className="email-processing-detail-header">
            <div>
              <div className="email-processing-detail-badges">
                <span className={`email-category ${categoryCopy[detail.item.category].tone}`}>{categoryCopy[detail.item.category].label}</span>
                {detail.item.shopifyOfficial ? <span className="email-official-badge"><ShieldCheck size={11} />Shopify 官方</span> : null}
                {detail.item.tags.map((tag) => <span className={`email-detail-tag tag-${tag.color}`} key={tag.label}><button type="button" onClick={() => editTag(tag)}>{tag.label}</button><button type="button" aria-label={`删除标签 ${tag.label}`} disabled={tagSaving} onClick={() => void removeTag(tag.label)}><X size={11} /></button></span>)}
              </div>
              <h3>{detail.item.conversation.subject || "无主题"}</h3>
              <div className="email-processing-detail-context">
                <span>{senderLabel(detail.item)} &lt;{detail.item.conversation.customerEmail || "未知邮箱"}&gt;</span>
                <i>·</i><span>{detail.item.shopName}</span>
                <i>·</i><span>{detail.item.sourceAddress}</span>
                <i>·</i><time>{dateTime(detail.item.conversation.createdAt)}</time>
                <i>·</i><span>{detail.item.conversation.status === "closed" ? "已处理" : "待处理"}</span>
              </div>
            </div>
            <div className="email-processing-actions">
              <button type="button" aria-expanded={tagEditorOpen} onClick={() => setTagEditorOpen((current) => !current)}><Tag size={14} />标签</button>
              {detail.item.conversation.status === "closed" ? <button type="button" disabled={acting} onClick={() => void reopen()}><RotateCcw size={14} />重新打开</button> : <button type="button" className="primary" disabled={acting} onClick={() => void markHandled()}><Check size={14} />{detail.item.conversation.classificationReason === suspectedMarketingReviewClassification ? "确认非客户并完成" : "标记处理"}</button>}
              <button type="button" disabled={acting} onClick={() => void promoteToCustomer()}><UserRoundCheck size={14} />转为客户邮件</button>
            </div>
          </header>

          {tagEditorOpen ? <section className="email-processing-tag-editor" aria-label="编辑邮件标签">
            <label><span>标签名称</span><input value={tagLabel} maxLength={12} onChange={(event) => setTagLabel(event.target.value)} placeholder="例如：财务跟进" /></label>
            <fieldset><legend>标签颜色</legend><div>{tagColors.map((color) => <button type="button" key={color.value} className={`email-tag-color-option tag-${color.value} ${tagColor === color.value ? "active" : ""}`} aria-pressed={tagColor === color.value} onClick={() => setTagColor(color.value)}><i />{color.label}</button>)}</div></fieldset>
            <span className="email-processing-tag-limit">{detail.item.tags.length}/5</span>
            <button type="button" className="primary" disabled={tagSaving} onClick={() => void addOrUpdateTag()}><Plus size={14} />{detail.item.tags.some((tag) => tag.label.toLocaleLowerCase() === tagLabel.trim().toLocaleLowerCase()) ? "更新标签" : "添加标签"}</button>
            <button type="button" disabled={tagSaving} onClick={() => { setTagEditorOpen(false); setTagLabel(""); }}>取消</button>
          </section> : null}

          {detail.item.conversation.classificationReason === suspectedMarketingReviewClassification ? <div className="email-processing-review-warning">
            <ShieldAlert size={16} />
            <div><strong>疑似广告邮件，尚未自动过滤</strong><span>请确认是否属于真实客户咨询；客户邮件请转入客服工作台，确认非客户后再完成处理。</span></div>
          </div> : null}

          <section className="email-processing-messages">
            {detail.messages.map((message) => {
              const storedTranslation = message.metadata?.translationZh?.trim();
              const translatedText = visibleMessageTranslation(message.body || "", storedTranslation);
              const translating = translatingMessageIDs.has(message.id);
              const showingTranslation = translatedMessageIDs.has(message.id) && Boolean(translatedText);
              const translatableDirection = message.direction !== "system" || Boolean(message.metadata?.gmail_message_id || message.metadata?.outlook_message_id || message.metadata?.imap_smtp_message_id);
              const canTranslate = message.type === "text" && Boolean(message.body.trim()) &&
                message.metadata?.displayQuotedHistory !== "true" && translatableDirection;
              return <article key={message.id}>
                <header>
                  <div><strong>{message.senderName || detail.item.conversation.customerName || "发件人"}</strong><span>{message.senderEmail || detail.item.conversation.customerEmail}</span></div>
                  <div className="email-processing-message-tools">
                    <time>{dateTime(message.createdAt)}</time>
                    {canTranslate ? <button
                      className={`email-processing-translate-button ${showingTranslation ? "showing" : ""}`}
                      type="button"
                      disabled={translating}
                      aria-pressed={showingTranslation}
                      onClick={() => void toggleMessageTranslation(message.id, message.body, storedTranslation)}
                    >
                      {translating ? <RefreshCw size={12} className="spin" /> : <Languages size={12} />}
                      {translating ? "翻译中" : showingTranslation ? "查看原文" : "翻译成中文"}
                    </button> : null}
                  </div>
                </header>
                <div className="email-processing-message-content">
                  <pre lang={showingTranslation ? "zh-CN" : undefined}>{showingTranslation ? translatedText : message.body || "无正文内容"}</pre>
                </div>
              </article>;
            })}
          </section>
        </> : null}
        {!detailLoading && !detail ? <div className="email-processing-detail-empty"><MailCheck size={34} /><strong>选择一封邮件查看详情</strong><span>可查看正文与中文翻译，或将误分类邮件转为客户邮件</span></div> : null}
      </div>
    </section>
  </section>;
}

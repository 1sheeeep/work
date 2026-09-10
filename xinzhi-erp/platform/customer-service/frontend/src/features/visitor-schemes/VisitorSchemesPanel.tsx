import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Globe2,
  ListChecks,
  MessageSquareText,
  PackageSearch,
  Plus,
  Save,
  Search,
  Send,
  Store,
  Trash2,
  X
} from "lucide-react";
import {
  PlatformAPI,
  Shop,
  ShopSource,
  VisitorScheme,
  VisitorSchemeInput
} from "../../api";
import { errorText, normalizeInstantAnswerOrder } from "../shared/helpers";
import {
  DEFAULT_INSTANT_ANSWER,
  type InstantAnswerConfig,
  type ToastMessage
} from "../shared/types";

type SchemeDraft = VisitorSchemeInput & { shopIds: string[] };
type ShopScope = "all" | "selected" | "none";

function emptyDraft(): SchemeDraft {
  return {
    name: "",
    language: "auto",
    instantAnswersEnabled: true,
    instantAnswers: [{ ...DEFAULT_INSTANT_ANSWER }],
    shopIds: []
  };
}

function schemeDraft(scheme: VisitorScheme): SchemeDraft {
  return {
    name: scheme.name,
    language: scheme.language || "auto",
    instantAnswersEnabled: scheme.instantAnswersEnabled,
    instantAnswers: normalizeInstantAnswerOrder(scheme.instantAnswers || []).map((answer) => ({ ...answer })),
    shopIds: [...(scheme.shopIds || [])]
  };
}

export function VisitorSchemesPanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  sourcesByShopId: Record<string, ShopSource[]>;
  busy: boolean;
  onChanged: () => void;
  setBusy: (value: boolean) => void;
  setToast: (value: ToastMessage) => void;
}) {
  const [schemes, setSchemes] = useState<VisitorScheme[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SchemeDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [shopSearch, setShopSearch] = useState("");
  const [shopScope, setShopScope] = useState<ShopScope>("selected");
  const [selectedAnswerId, setSelectedAnswerId] = useState(DEFAULT_INSTANT_ANSWER.id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswerId, setPreviewAnswerId] = useState("");
  const initializedDraftKey = useRef("");

  const chatShops = useMemo(() => props.shops.filter((shop) =>
    (props.sourcesByShopId[shop.id] || []).some((source) => source.type === "shopify_chat")
  ), [props.shops, props.sourcesByShopId]);
  const chatShopKey = useMemo(() => chatShops.map((shop) => shop.id).sort().join(","), [chatShops]);

  const selectedScheme = schemes.find((scheme) => scheme.id === selectedId) || null;
  const defaultScheme = schemes.find((scheme) => scheme.isDefault) || null;
  const isNew = selectedId === "new";
  const selectedAnswer = draft.instantAnswers.find((answer) => answer.id === selectedAnswerId) || null;
  const enabledPreviewAnswers = draft.instantAnswers.filter((answer) => draft.instantAnswersEnabled && answer.enabled);

  const assignmentByShop = useMemo(() => {
    const assignments = new Map<string, VisitorScheme>();
    schemes.forEach((scheme) => scheme.shopIds.forEach((shopId) => assignments.set(shopId, scheme)));
    return assignments;
  }, [schemes]);

  const visibleShops = useMemo(() => {
    const query = shopSearch.trim().toLowerCase();
    return query
      ? chatShops.filter((shop) => shop.displayName.toLowerCase().includes(query))
      : chatShops;
  }, [chatShops, shopSearch]);

  const loadSchemes = useCallback(async (preferredId = "") => {
    setLoading(true);
    try {
      const items = (await props.api.listVisitorSchemes()).map((item) => ({
        ...item,
        instantAnswers: item.instantAnswers || [],
        shopIds: item.shopIds || []
      }));
      setSchemes(items);
      setSelectedId((current) => {
        if (preferredId && items.some((item) => item.id === preferredId)) return preferredId;
        if (current === "new") return current;
        if (items.some((item) => item.id === current)) return current;
        return items.find((item) => item.isDefault)?.id || items[0]?.id || "new";
      });
      return items;
    } catch (error) {
      props.setToast({ tone: "error", text: `加载访客方案失败：${errorText(error)}` });
      return [];
    } finally {
      setLoading(false);
    }
  }, [props.api, props.setToast]);

  useEffect(() => {
    void loadSchemes();
  }, [loadSchemes]);

  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewOpen]);

  useEffect(() => {
    const scheme = schemes.find((item) => item.id === selectedId);
    const nextInitializationKey = selectedId === "new"
      ? "new"
      : scheme
        ? `${scheme.id}:${scheme.updatedAt}:${chatShopKey}`
        : "";
    if (!nextInitializationKey || initializedDraftKey.current === nextInitializationKey) return;
    initializedDraftKey.current = nextInitializationKey;
    if (selectedId === "new") {
      setDraft(emptyDraft());
      setShopScope("selected");
      setSelectedAnswerId(DEFAULT_INSTANT_ANSWER.id);
      setPreviewAnswerId("");
      return;
    }
    if (!scheme) return;
    const next = schemeDraft(scheme);
    setDraft(next);
    setShopScope(
      scheme.isDefault
        ? "selected"
        : next.shopIds.length === 0
          ? "none"
          : chatShops.length > 0 && next.shopIds.length === chatShops.length
            ? "all"
            : "selected"
    );
    setSelectedAnswerId(next.instantAnswers[0]?.id || "");
    setPreviewAnswerId("");
  }, [chatShopKey, schemes, selectedId]);

  function updateAnswer(id: string, patch: Partial<InstantAnswerConfig>) {
    setDraft((current) => ({
      ...current,
      instantAnswers: current.instantAnswers.map((answer) => answer.id === id ? { ...answer, ...patch } : answer)
    }));
  }

  function addAnswer() {
    const answer: InstantAnswerConfig = {
      id: `answer_${Date.now().toString(36)}`,
      title: "",
      answer: "",
      mode: "text",
      enabled: true,
      sort: draft.instantAnswers.length
    };
    setDraft((current) => ({ ...current, instantAnswers: [...current.instantAnswers, answer] }));
    setSelectedAnswerId(answer.id);
  }

  function removeAnswer(id: string) {
    setDraft((current) => {
      const next = current.instantAnswers.filter((answer) => answer.id !== id);
      setSelectedAnswerId(next[0]?.id || "");
      return { ...current, instantAnswers: normalizeInstantAnswerOrder(next) };
    });
  }

  function moveAnswer(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.instantAnswers];
      const index = next.findIndex((answer) => answer.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, instantAnswers: normalizeInstantAnswerOrder(next) };
    });
  }

  function toggleShop(shopId: string) {
    setDraft((current) => ({
      ...current,
      shopIds: current.shopIds.includes(shopId)
        ? current.shopIds.filter((id) => id !== shopId)
        : [...current.shopIds, shopId]
    }));
  }

  function changeShopScope(scope: ShopScope) {
    setShopScope(scope);
    if (scope === "all") {
      setDraft((current) => ({ ...current, shopIds: chatShops.map((shop) => shop.id) }));
      return;
    }
    if (scope === "none") {
      setDraft((current) => ({ ...current, shopIds: [] }));
    }
  }

  function setVisibleShopsChecked(checked: boolean) {
    const visibleIDs = new Set(visibleShops.map((shop) => shop.id));
    setDraft((current) => ({
      ...current,
      shopIds: checked
        ? Array.from(new Set([...current.shopIds, ...visibleIDs]))
        : current.shopIds.filter((id) => !visibleIDs.has(id))
    }));
  }

  function normalizedInput(): VisitorSchemeInput | null {
    const name = draft.name.trim();
    const answers = normalizeInstantAnswerOrder(draft.instantAnswers).map((answer) => ({
      ...answer,
      title: answer.title.trim(),
      answer: answer.answer.trim()
    }));
    if (!name) {
      props.setToast({ tone: "error", text: "请填写方案名称" });
      return null;
    }
    if (answers.some((answer) => !answer.title || !answer.answer)) {
      props.setToast({ tone: "error", text: "请补全即时回答的标题和内容，或删除空白项" });
      return null;
    }
    return {
      name,
      language: draft.language || "auto",
      instantAnswersEnabled: draft.instantAnswersEnabled,
      instantAnswers: answers
    };
  }

  async function persist(apply: boolean) {
    const input = normalizedInput();
    if (!input) return;
    props.setBusy(true);
    try {
      const saved = isNew
        ? await props.api.createVisitorScheme(input)
        : await props.api.updateVisitorScheme(selectedId, input);
      if (apply) await props.api.applyVisitorScheme(saved.id, draft.shopIds);
      await loadSchemes(saved.id);
      if (apply) props.onChanged();
      props.setToast({
        tone: "success",
        text: apply ? `方案已保存并应用到 ${draft.shopIds.length} 家店铺` : "方案已保存，店铺当前配置未改变"
      });
    } catch (error) {
      props.setToast({ tone: "error", text: `${apply ? "保存并应用" : "保存"}访客方案失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function deleteScheme() {
    if (!selectedScheme || selectedScheme.isDefault) return;
    if (!window.confirm(`删除“${selectedScheme.name}”？已应用店铺将恢复为默认方案。`)) return;
    props.setBusy(true);
    try {
      await props.api.deleteVisitorScheme(selectedScheme.id);
      setSelectedId("");
      await loadSchemes();
      props.onChanged();
      props.setToast({ tone: "success", text: "方案已删除，相关店铺已恢复默认方案" });
    } catch (error) {
      props.setToast({ tone: "error", text: `删除访客方案失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void persist(true);
  }

  const publishSummary = selectedScheme?.isDefault
    ? `当前覆盖 ${draft.shopIds.length} 家未指定方案的店铺`
    : shopScope === "all"
      ? `将应用到全部 ${chatShops.length} 家店铺`
      : shopScope === "none"
        ? "只保存方案，不更新店铺"
        : `将应用到已选择的 ${draft.shopIds.length} 家店铺`;

  return (
    <section className="visitor-schemes-page">
      <aside className="visitor-scheme-list">
        <header>
          <div><strong>访客方案</strong><span>{schemes.length} 个方案</span></div>
          <button type="button" onClick={() => setSelectedId("new")}><Plus size={15} /> 新建</button>
        </header>
        <div className="visitor-scheme-items">
          {loading ? <div className="visitor-scheme-empty">正在加载...</div> : null}
          {!loading && !schemes.length ? <div className="visitor-scheme-empty">暂无方案</div> : null}
          {schemes.map((scheme) => (
            <button type="button" key={scheme.id} className={selectedId === scheme.id ? "active" : ""} onClick={() => setSelectedId(scheme.id)}>
              <span className="visitor-scheme-item-title"><strong>{scheme.name}</strong>{scheme.isDefault ? <em>兜底</em> : null}</span>
              <span>{scheme.shopIds.length} 家店铺 · {scheme.instantAnswersEnabled ? `${scheme.instantAnswers.filter((item) => item.enabled).length} 个即时回答` : "即时回答已关闭"}</span>
            </button>
          ))}
        </div>
      </aside>

      <form className="visitor-scheme-editor" onSubmit={submit}>
        <header className="visitor-scheme-editor-toolbar">
          <div>
            <h3>{isNew ? "新建访客方案" : draft.name || "访客方案"}</h3>
            <span>{selectedScheme?.isDefault ? "默认兜底方案" : isNew ? "尚未发布" : `已发布到 ${selectedScheme?.shopIds.length || 0} 家店铺`}</span>
          </div>
          <div className="visitor-scheme-editor-actions">
            <button type="button" onClick={() => { setPreviewAnswerId(""); setPreviewOpen(true); }}><Eye size={16} /> 展开预览</button>
            {selectedScheme && !selectedScheme.isDefault ? <button type="button" className="danger-action" title="删除方案" onClick={() => void deleteScheme()} disabled={props.busy}><Trash2 size={15} /></button> : null}
          </div>
        </header>

        <div className="visitor-scheme-editor-content">
          <section className="visitor-config-section">
            <div className="visitor-config-section-head">
              <span className="visitor-config-step">1</span>
              <div><strong>基础设置</strong><small>方案名称与默认语言</small></div>
            </div>
            <div className="visitor-scheme-basics">
              <label>方案名称<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：英文订单咨询" disabled={Boolean(selectedScheme?.isDefault)} required /></label>
              <label>访客语言<select value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))}><option value="auto">自动识别，无法识别时使用英文</option><option value="en">English</option></select></label>
            </div>
          </section>

          <section className="visitor-config-section visitor-scheme-shop-picker">
            <div className="visitor-config-section-head">
              <span className="visitor-config-step">2</span>
              <div><strong>应用店铺</strong><small>{publishSummary}</small></div>
            </div>
            {selectedScheme?.isDefault ? (
              <div className="visitor-default-scope"><Globe2 size={18} /><span><strong>自动覆盖未指定方案的店铺</strong><small>店铺退出其他方案后会自动回到此方案</small></span></div>
            ) : (
              <div className="visitor-scope-options" role="group" aria-label="发布范围">
                <button type="button" className={shopScope === "all" ? "active" : ""} onClick={() => changeShopScope("all")}><Globe2 size={17} /><span><strong>全部店铺</strong><small>{chatShops.length} 家</small></span></button>
                <button type="button" className={shopScope === "selected" ? "active" : ""} onClick={() => changeShopScope("selected")}><ListChecks size={17} /><span><strong>指定店铺</strong><small>{draft.shopIds.length} 家</small></span></button>
                <button type="button" className={shopScope === "none" ? "active" : ""} onClick={() => changeShopScope("none")}><Save size={17} /><span><strong>暂不应用</strong><small>仅保存</small></span></button>
              </div>
            )}
            {(shopScope === "selected" || Boolean(selectedScheme?.isDefault)) ? (
              <details className="visitor-shop-assignment-details">
                <summary><span><strong>选择店铺</strong><small>查看当前方案及发布后的变化</small></span><ChevronDown size={16} /></summary>
                <div className="visitor-scheme-shop-tools"><Search size={15} /><input value={shopSearch} onChange={(event) => setShopSearch(event.target.value)} placeholder="搜索店铺" />{!selectedScheme?.isDefault ? <div><button type="button" onClick={() => setVisibleShopsChecked(true)}>全选</button><button type="button" onClick={() => setVisibleShopsChecked(false)}>清空</button></div> : null}</div>
                <div className="visitor-scheme-shop-grid">
                  {visibleShops.map((shop) => {
                    const checked = draft.shopIds.includes(shop.id);
                    const assigned = assignmentByShop.get(shop.id) || defaultScheme;
                    const wasAssigned = Boolean(selectedScheme?.shopIds.includes(shop.id));
                    const nextName = selectedScheme?.isDefault ? assigned?.name : checked ? draft.name.trim() || "当前编辑方案" : wasAssigned ? defaultScheme?.name || "默认方案" : assigned?.name;
                    return <label className={checked ? "selected" : ""} key={shop.id}>
                      {!selectedScheme?.isDefault ? <input type="checkbox" checked={checked} onChange={() => toggleShop(shop.id)} disabled={props.busy} /> : <span className="visitor-shop-state-icon">{checked ? <CheckCircle2 size={16} /> : <Store size={16} />}</span>}
                      <span className="visitor-shop-assignment-copy"><strong>{shop.displayName}</strong><small>当前：{assigned?.name || "默认方案"}</small></span>
                      {!selectedScheme?.isDefault && nextName !== assigned?.name ? <em>发布后：{nextName}</em> : null}
                    </label>;
                  })}
                  {!visibleShops.length ? <div className="visitor-scheme-empty">没有匹配的 Xzdesk Chat 店铺</div> : null}
                </div>
              </details>
            ) : null}
          </section>

          <section className="visitor-config-section instant-answer-editor">
            <div className="visitor-config-section-head instant-answer-head">
              <span className="visitor-config-step">3</span>
              <div><strong>即时回答</strong><small>{draft.instantAnswers.filter((answer) => answer.enabled).length} 个已启用</small></div>
              <div className="instant-answer-head-actions"><button type="button" className={draft.instantAnswersEnabled ? "toggle-pill active" : "toggle-pill"} onClick={() => setDraft((current) => ({ ...current, instantAnswersEnabled: !current.instantAnswersEnabled }))}>{draft.instantAnswersEnabled ? "已开启" : "已关闭"}</button><button type="button" onClick={addAnswer}><Plus size={15} /> 新建</button></div>
            </div>
            <div className="instant-answer-list">
              {draft.instantAnswers.map((answer, index) => {
                const active = selectedAnswerId === answer.id;
                return <div className={active ? "instant-answer-item active" : "instant-answer-item"} key={answer.id}>
                  <button type="button" className="instant-answer-summary" onClick={() => setSelectedAnswerId(active ? "" : answer.id)}>
                    <span>{answer.mode === "order_tracking" ? <PackageSearch size={17} /> : <MessageSquareText size={17} />}</span>
                    <span><strong>{answer.title || "未命名即时回答"}</strong><small>{answer.mode === "order_tracking" ? "订单 / 物流查询" : "文字回复"}</small></span>
                    <em className={answer.enabled ? "enabled" : ""}>{answer.enabled ? "启用" : "停用"}</em>
                    {active ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {active ? <div className="instant-answer-detail">
                    <div className="instant-answer-detail-tools"><button type="button" className={answer.enabled ? "toggle-pill active" : "toggle-pill"} onClick={() => updateAnswer(answer.id, { enabled: !answer.enabled })}>{answer.enabled ? "启用" : "停用"}</button><span /><button type="button" title="上移" onClick={() => moveAnswer(answer.id, -1)} disabled={index === 0}><ChevronUp size={15} /></button><button type="button" title="下移" onClick={() => moveAnswer(answer.id, 1)} disabled={index === draft.instantAnswers.length - 1}><ChevronDown size={15} /></button><button type="button" className="danger-action" title="删除" onClick={() => removeAnswer(answer.id)}><Trash2 size={15} /></button></div>
                    <div className="instant-answer-fields"><label>交互类型<select value={answer.mode} onChange={(event) => updateAnswer(answer.id, { mode: event.target.value as InstantAnswerConfig["mode"] })}><option value="text">直接文字回复</option><option value="order_tracking">订单 / 物流查询</option></select></label><label>按钮文字<input value={answer.title} onChange={(event) => updateAnswer(answer.id, { title: event.target.value })} placeholder="例如：Track my order" /></label><label className="instant-answer-copy">回答内容<textarea value={answer.answer} onChange={(event) => updateAnswer(answer.id, { answer: event.target.value })} rows={4} /></label></div>
                  </div> : null}
                </div>;
              })}
              {!draft.instantAnswers.length ? <div className="visitor-scheme-empty">暂无即时回答</div> : null}
            </div>
          </section>
        </div>

        <footer className="visitor-scheme-savebar">
          <span>{publishSummary}</span>
          <div><button type="button" onClick={() => void persist(false)} disabled={props.busy}><Save size={15} /> 仅保存</button><button type="submit" className="primary" disabled={props.busy || (!selectedScheme?.isDefault && shopScope === "none")}><Send size={15} /> 保存并发布</button></div>
        </footer>
      </form>

      {previewOpen ? <div className="visitor-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
        <section className="visitor-preview-dialog" role="dialog" aria-modal="true" aria-label="访客方案预览">
          <header><div><Eye size={17} /><span><strong>方案预览</strong><small>当前编辑内容，不影响线上店铺</small></span></div><button type="button" title="关闭预览" onClick={() => setPreviewOpen(false)}><X size={18} /></button></header>
          <div className="visitor-preview-stage">
            <div className="visitor-preview-widget">
              <header><div><strong>Shop support</strong><span>We usually reply as soon as possible.</span></div><button type="button" tabIndex={-1}><X size={16} /></button></header>
              <main>
                <div className="visitor-preview-welcome"><MessageSquareText size={24} /><strong>Hi there!</strong><span>How can we help?</span></div>
                {previewAnswerId ? (() => {
                  const answer = enabledPreviewAnswers.find((item) => item.id === previewAnswerId);
                  if (!answer) return null;
                  if (answer.mode === "order_tracking") return <div className="visitor-preview-flow"><strong>{answer.title}</strong><span>{answer.answer}</span><input placeholder="Order number" readOnly /><input placeholder="Email" readOnly /><button type="button">Check order</button></div>;
                  return <div className="visitor-preview-message">{answer.answer}</div>;
                })() : null}
              </main>
              <div className="visitor-preview-answers">{enabledPreviewAnswers.map((answer) => <button type="button" key={answer.id} onClick={() => setPreviewAnswerId(answer.id)}>{answer.title}</button>)}</div>
              <footer><span>Write message</span><Send size={18} /></footer>
            </div>
          </div>
        </section>
      </div> : null}
    </section>
  );
}

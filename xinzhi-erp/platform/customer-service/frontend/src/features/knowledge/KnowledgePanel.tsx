import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, FileSpreadsheet, Plus, Trash2, Upload, X } from "lucide-react";
import { KnowledgeEntry, PlatformAPI, Shop, User } from "../../api";
import { Badge, Empty } from "../../components/ui";
import { hasPermission, PERMISSIONS } from "../../permissions";
import { errorText } from "../shared/helpers";
import { type ToastMessage } from "../shared/types";

type KnowledgeEditorMode = "manual" | "import";
type KnowledgeStatusFilter = "all" | "pending" | "published" | "rejected";

export function KnowledgePanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  currentUser: User;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setToast: (value: ToastMessage) => void;
}) {
  const canCreate = hasPermission(props.currentUser, PERMISSIONS.knowledgeCreate);
  const canEdit = hasPermission(props.currentUser, PERMISSIONS.knowledgeEdit);
  const canDelete = hasPermission(props.currentUser, PERMISSIONS.knowledgeDelete);
  const canReview = hasPermission(props.currentUser, PERMISSIONS.knowledgeReview);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<KnowledgeEditorMode>("manual");
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [status, setStatus] = useState<KnowledgeStatusFilter>(canReview ? "pending" : "published");
  const [listTarget, setListTarget] = useState("all");
  const [scope, setScope] = useState<"global" | "shop">("shop");
  const [shopId, setShopId] = useState("");
  const [title, setTitle] = useState("");
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState("");
  const [editingId, setEditingId] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importScope, setImportScope] = useState<"global" | "shop">("shop");
  const [importShopId, setImportShopId] = useState("");
  const [importTags, setImportTags] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 6;

  const load = useCallback(async () => {
    try {
      const targetFilter = listTarget === "global"
        ? { scope: "global" as const }
        : listTarget === "all"
          ? {}
          : { scope: "shop" as const, shopId: listTarget };
      const result = await props.api.listKnowledge({
        ...targetFilter,
        ...(status === "all" ? {} : { status }),
        page,
        pageSize
      });
      if (result.totalPages > 0 && page > result.totalPages) {
        setPage(result.totalPages);
        return;
      }
      setEntries(result.items);
      setTotalCount(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      props.setToast({ tone: "error", text: `加载知识库失败：${errorText(error)}` });
    }
  }, [listTarget, page, props.api, props.setToast, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!shopId && props.shops.length) setShopId(props.shops[0].id);
  }, [props.shops, shopId]);
  useEffect(() => {
    if (!importShopId && props.shops.length) setImportShopId(props.shops[0].id);
  }, [importShopId, props.shops]);
  useEffect(() => {
    if (listTarget !== "all" && listTarget !== "global" && !props.shops.some((shop) => shop.id === listTarget)) {
      setListTarget("all");
      setPage(1);
    }
  }, [listTarget, props.shops]);

  function resetForm() {
    setEditingId("");
    setScope("shop");
    setShopId(props.shops[0]?.id || "");
    setTitle("");
    setAnswer("");
    setTags("");
  }

  function resetImport() {
    setImportFile(null);
    setImportScope("shop");
    setImportShopId(props.shops[0]?.id || "");
    setImportTags("");
    setImportError("");
  }

  function openCreate() {
    resetForm();
    resetImport();
    setEditorMode("manual");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (props.busy || importBusy) return;
    resetForm();
    setEditorOpen(false);
  }

  async function saveEntry(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !answer.trim() || (scope === "shop" && !shopId)) return;
    props.setBusy(true);
    const input = {
      scope,
      shopId: scope === "shop" ? shopId : undefined,
      title: title.trim(),
      answer: answer.trim(),
      tags: tags.split(",").map((value) => value.trim()).filter(Boolean)
    } as const;
    try {
      const saved = editingId
        ? await props.api.updateKnowledge(editingId, input)
        : await props.api.createKnowledge(input);
      const published = saved.status === "published";
      props.setToast({
        tone: "success",
        text: editingId
          ? published ? "知识已更新并发布" : "修改已提交审核，原发布版本继续供 AI 使用"
          : published ? "知识已发布" : "知识已提交审核"
      });
      const target = scope === "global" ? "global" : shopId;
      setListTarget(target);
      setStatus(published ? "published" : "pending");
      setPage(1);
      resetForm();
      setEditorOpen(false);
      await load();
    } catch (error) {
      props.setToast({ tone: "error", text: `保存知识失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function review(entry: KnowledgeEntry, nextStatus: "published" | "rejected") {
    props.setBusy(true);
    try {
      await props.api.updateKnowledge(entry.id, { status: nextStatus });
      props.setToast({
        tone: "success",
        text: nextStatus === "published"
          ? entry.supersedesId ? "新版本已发布并替换原版本" : "知识已发布，可供 AI 使用"
          : "知识已驳回"
      });
      await load();
    } catch (error) {
      props.setToast({ tone: "error", text: `审核失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function edit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setScope(entry.scope);
    setShopId(entry.shopId || "");
    setTitle(entry.title);
    setAnswer(entry.answer);
    setTags(entry.tags.join(", "));
    setEditorMode("manual");
    setEditorOpen(true);
  }

  async function deleteEntry() {
    if (!deleteTarget) return;
    props.setBusy(true);
    try {
      await props.api.deleteKnowledge(deleteTarget.id);
      props.setToast({ tone: "success", text: "知识已永久删除" });
      setDeleteTarget(null);
      if (entries.length === 1 && page > 1) setPage((current) => current - 1);
      else await load();
    } catch (error) {
      props.setToast({ tone: "error", text: `删除知识失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function openImport() {
    resetImport();
    setEditorMode("import");
  }

  async function importWorkbook(event: FormEvent) {
    event.preventDefault();
    if (!importFile || (importScope === "shop" && !importShopId)) return;
    setImportBusy(true);
    setImportError("");
    try {
      const result = await props.api.importKnowledge(importFile, {
        scope: importScope,
        shopId: importScope === "shop" ? importShopId : undefined,
        tags: importTags
      });
      const summary = `成功导入 ${result.created} 条，跳过重复 ${result.skipped} 条，失败 ${result.failed} 条`;
      props.setToast({
        tone: result.failed ? "info" : "success",
        text: canReview ? `${summary}，已直接发布` : `${summary}，已进入待审核`
      });
      const target = importScope === "global" ? "global" : importShopId;
      setStatus(canReview ? "published" : "pending");
      setListTarget(target);
      setPage(1);
      setEditorOpen(false);
      resetImport();
      await load();
    } catch (error) {
      setImportError(`导入失败：${errorText(error)}`);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <>
      <section className="knowledge-page knowledge-page-manage">
        <section className="knowledge-list-panel knowledge-manage-panel">
          <header>
            <div>
              <strong>{canReview ? "知识审核与管理" : "知识库"}</strong>
              <span>所有人可查看已发布知识，操作权限按账号独立控制</span>
            </div>
            {canCreate ? <button className="primary" type="button" onClick={openCreate}><Plus size={15} /> 新增知识</button> : null}
          </header>
          <div className="knowledge-list-filters">
            <label>知识范围
              <select value={listTarget} onChange={(event) => { setListTarget(event.target.value); setPage(1); }}>
                <option value="all">所有知识</option>
                <option value="global">全局知识</option>
                {props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
              </select>
            </label>
            <label>发布状态
              <select value={status} onChange={(event) => { setStatus(event.target.value as KnowledgeStatusFilter); setPage(1); }}>
                {canReview ? <option value="pending">待审核</option> : null}
                <option value="published">已发布</option>
                {!canReview ? <option value="pending">我的待审核</option> : null}
                <option value="rejected">{canReview ? "已驳回" : "我的已驳回"}</option>
                {canReview ? <option value="all">全部状态</option> : null}
              </select>
            </label>
          </div>
          <div className="knowledge-list">
            {entries.map((entry) => (
              <article className="knowledge-entry" key={entry.id}>
                <div className="knowledge-entry-head">
                  <div>
                    <strong>{entry.title}</strong>
                    <span>{entry.scope === "global" ? "全局" : props.shops.find((shop) => shop.id === entry.shopId)?.displayName || "店铺专属"}</span>
                    {entry.tags.length ? <div className="knowledge-tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                  </div>
                  <div className="knowledge-entry-actions">
                    <Badge tone={entry.status === "published" ? "green" : entry.status === "pending" ? "warning" : "danger"}>
                      {entry.supersedesId && entry.status === "pending" ? "修改待审核" : entry.status === "published" ? "已发布" : entry.status === "pending" ? "待审核" : "已驳回"}
                    </Badge>
                    {canEdit ? <button type="button" onClick={() => edit(entry)}>编辑</button> : null}
                    {canReview && entry.status === "pending" ? <>
                      <button type="button" className="primary" disabled={props.busy} onClick={() => void review(entry, "published")}>发布</button>
                      <button type="button" className="danger-text" disabled={props.busy} onClick={() => void review(entry, "rejected")}>驳回</button>
                    </> : null}
                    {canDelete ? <button type="button" className="danger-text knowledge-delete-button" disabled={props.busy} onClick={() => setDeleteTarget(entry)} aria-label={`删除知识：${entry.title}`}><Trash2 size={14} /> 删除</button> : null}
                  </div>
                </div>
                <p>{entry.answer}</p>
                {entry.supersedesId && entry.status === "pending" ? <small>审核通过前，AI 继续使用原发布版本。</small> : null}
              </article>
            ))}
            {!entries.length ? <Empty text={status === "pending" ? "当前范围暂无待审核知识" : "当前范围暂无知识条目"} /> : null}
          </div>
          <footer className="paged-list-controls">
            <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
            <span>第 {page} / {Math.max(totalPages, 1)} 页 · 共 {totalCount} 条</span>
            <button type="button" disabled={totalPages === 0 || page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </footer>
        </section>
      </section>

      {deleteTarget ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.busy) setDeleteTarget(null); }}>
          <section className="knowledge-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-delete-title">
            <div className="knowledge-delete-dialog-icon"><Trash2 size={20} /></div>
            <div>
              <h3 id="knowledge-delete-title">永久删除知识</h3>
              <p>“{deleteTarget.title}”删除后无法恢复，也不会再参与 AI 回复。</p>
            </div>
            <footer>
              <button type="button" disabled={props.busy} onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="danger-action" disabled={props.busy} onClick={() => void deleteEntry()}>{props.busy ? "正在删除" : "确认删除"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <section className="knowledge-editor knowledge-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-editor-title">
            <header>
              <div><Bot size={18} /><strong id="knowledge-editor-title">{editingId ? "编辑知识" : "新增知识"}</strong></div>
              <button type="button" disabled={props.busy || importBusy} onClick={closeEditor} aria-label="关闭知识弹窗"><X size={18} /></button>
            </header>
            {!editingId ? (
              <nav className="knowledge-editor-mode-tabs" aria-label="新增知识方式">
                <button type="button" className={editorMode === "manual" ? "active" : ""} onClick={() => setEditorMode("manual")}><Plus size={15} /> 手动新增</button>
                <button type="button" className={editorMode === "import" ? "active" : ""} onClick={openImport}><FileSpreadsheet size={15} /> Excel 导入</button>
              </nav>
            ) : null}
            {editorMode === "manual" ? (
              <form onSubmit={saveEntry}>
                <div className="knowledge-form-row">
                  <label>范围<select value={scope} onChange={(event) => setScope(event.target.value as "global" | "shop")}><option value="shop">店铺专属</option><option value="global">全局</option></select></label>
                  {scope === "shop" ? <label>店铺<select value={shopId} onChange={(event) => setShopId(event.target.value)}><option value="">选择店铺</option>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label> : <span className="knowledge-global-note">全局知识对管理数据范围内的店铺可见</span>}
                </div>
                <label>问题或场景<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：客户询问物流延迟" /></label>
                <label>批准的话术<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="填写经过确认、可复用的客服回答" /></label>
                <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="物流, 延迟, 售后" /></label>
                {!canReview ? <p className="knowledge-global-note">{editingId ? "保存后进入待审核，原发布版本在审核通过前继续供 AI 使用。" : "新增内容保存后进入待审核。"}</p> : null}
                <div className="knowledge-form-actions">
                  <button type="button" onClick={closeEditor}>取消</button>
                  <button className="primary" type="submit" disabled={props.busy}>{canReview ? editingId ? "保存并发布" : "发布知识" : editingId ? "提交修改审核" : "提交审核"}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={importWorkbook}>
                <input ref={importInputRef} className="visually-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportError(""); }} />
                <button className="knowledge-import-file" type="button" disabled={importBusy} onClick={() => importInputRef.current?.click()}><Upload size={18} /><span>{importFile ? importFile.name : "选择 .xlsx 文件"}</span></button>
                <p>自动遍历所有工作表并识别标题行、问题、场景、回复、答案和标签列；无固定表头时，使用第一列作为场景，其余列合并为知识内容。</p>
                <div className="knowledge-form-row">
                  <label>范围<select value={importScope} onChange={(event) => setImportScope(event.target.value as "global" | "shop")}><option value="shop">店铺专属</option><option value="global">全局</option></select></label>
                  {importScope === "shop" ? <label>店铺<select value={importShopId} onChange={(event) => setImportShopId(event.target.value)}><option value="">选择店铺</option>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label> : <span className="knowledge-global-note">全局知识发布后可供所有店铺使用</span>}
                </div>
                <label>统一标签（可选）<input value={importTags} onChange={(event) => setImportTags(event.target.value)} placeholder="例如：物流, 售后" /></label>
                {importError ? <div className="product-picker-error" role="alert">{importError}</div> : null}
                <div className="knowledge-form-actions">
                  <button type="button" disabled={importBusy} onClick={closeEditor}>取消</button>
                  <button className="primary" type="submit" disabled={importBusy || !importFile || (importScope === "shop" && !importShopId)}><Upload size={15} /> {importBusy ? "导入中" : canReview ? "导入并发布" : "导入待审核"}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

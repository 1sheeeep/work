import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError } from "../api/client";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { DialogCloseButton } from "../components/DialogCloseButton";
import {
  type ProductBundle,
  type ProductBundleInput,
  productBundleApi,
} from "../modules/productBundleApi";
import {
  type Page,
  type ProductSku,
  productCenterApi,
} from "../modules/productCenterApi";
import "./WarehouseArchiveShells.css";

const PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 10_000;
const BUSINESS_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/;

type BundleState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Page<ProductBundle> };

type BundleEditor = { item?: ProductBundle };

function safeBundleMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 0) return error.message;
  if (error.status === 403) return "当前账号没有维护组合 SKU 的权限。";
  if (error.status === 404) return "该组合 SKU 已不存在，请刷新列表。";
  if (error.status === 409) {
    return "组合 SKU 编号已存在，或记录已被更新。请检查后重试。";
  }
  return fallback;
}

function statusLabel(status: ProductBundle["status"]) {
  if (status === "ACTIVE") return "启用";
  if (status === "INACTIVE") return "停用";
  return "已归档";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBundles(items: ProductBundle[]) {
  const header = [
    "组合SKU编号",
    "组合名称",
    "状态",
    "组成SKU",
    "组成SKU种数",
    "合计件数",
    "更新人",
    "更新时间",
  ];
  const rows = items.map((item) => [
    item.businessCode,
    item.name,
    statusLabel(item.status),
    item.components
      .map((component) => `${component.skuCode} × ${component.quantity}`)
      .join("；"),
    item.componentCount,
    item.totalUnits,
    item.updatedByDisplayName,
    item.updatedAt,
  ]);
  const content = `\uFEFF${[header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "组合SKU导出.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProductBundleSection({
  keyword,
  start,
  end,
  canWrite = false,
  onFilter,
}: {
  keyword: string;
  start?: string;
  end?: string;
  canWrite?: boolean;
  onFilter: (keyword: string, start?: string, end?: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<BundleState>({ status: "loading" });
  const [editor, setEditor] = useState<BundleEditor>();
  const [archiveTarget, setArchiveTarget] = useState<ProductBundle>();
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<string>();

  useEffect(() => setPage(0), [keyword, start, end]);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void productBundleApi.list({
      keyword: keyword || undefined,
      from: start,
      to: end,
      page,
      size: PAGE_SIZE,
    }).then((data) => {
      if (current) setState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (current) {
        setState({
          status: "error",
          message: safeBundleMessage(error, "暂时无法读取组合 SKU，请稍后重试。"),
        });
      }
    });
    return () => { current = false; };
  }, [end, keyword, page, refreshToken, start]);

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextKeyword = String(data.get("bundleKeyword") ?? "").trim().slice(0, 100);
    const nextStart = String(data.get("bundleStart") ?? "") || undefined;
    const nextEnd = String(data.get("bundleEnd") ?? "") || undefined;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      setFeedback("起始日期不能晚于截止日期。");
      return;
    }
    setFeedback(undefined);
    setPage(0);
    onFilter(nextKeyword, nextStart, nextEnd);
  };

  const exportFiltered = async () => {
    setExporting(true);
    setFeedback(undefined);
    try {
      const rows: ProductBundle[] = [];
      let exportPage = 0;
      let totalPages = 1;
      while (exportPage < totalPages && rows.length < MAX_EXPORT_ROWS) {
        const result = await productBundleApi.list({
          keyword: keyword || undefined,
          from: start,
          to: end,
          page: exportPage,
          size: EXPORT_PAGE_SIZE,
        });
        rows.push(...result.items);
        totalPages = result.totalPages;
        exportPage += 1;
      }
      if (rows.length === 0) {
        setFeedback("当前筛选条件下没有可导出的组合 SKU。")
        return;
      }
      downloadBundles(rows.slice(0, MAX_EXPORT_ROWS));
      setFeedback(
        rows.length >= MAX_EXPORT_ROWS && exportPage < totalPages
          ? `已导出前 ${MAX_EXPORT_ROWS} 条记录，请缩小筛选范围后导出其余记录。`
          : `已导出 ${rows.length} 条组合 SKU。`,
      );
    } catch (error) {
      setFeedback(safeBundleMessage(error, "导出失败，请稍后重试。"));
    } finally {
      setExporting(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    setArchiveError(undefined);
    try {
      await productBundleApi.archive(archiveTarget.id, archiveTarget.version);
      setArchiveTarget(undefined);
      setFeedback(`已归档 ${archiveTarget.businessCode}。`);
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setArchiveError(safeBundleMessage(error, "归档失败，请稍后重试。"));
    } finally {
      setArchiveBusy(false);
    }
  };

  const data = state.status === "ready" ? state.data : undefined;
  return <section
    className="detail-card product-section erp-data-workbench product-bundle-section"
    aria-labelledby="bundle-sku-title"
  >
    <div className="table-heading">
      <div>
        <h2 id="bundle-sku-title">组合 SKU</h2>
        <p>把多个库存 SKU 维护为一个销售或配货组合，不改变各组成 SKU 的库存。</p>
      </div>
    </div>

    <form
      className="toolbar-row"
      key={`${keyword}:${start ?? ""}:${end ?? ""}`}
      onSubmit={submitFilter}
    >
      <label>
        搜索内容
        <input
          aria-label="组合 SKU 搜索内容"
          name="bundleKeyword"
          defaultValue={keyword}
          maxLength={100}
          placeholder="组合编号或名称"
        />
      </label>
      <label>
        起始日期
        <input aria-label="组合 SKU 起始日期" name="bundleStart" type="date" defaultValue={start} />
      </label>
      <label>
        截止日期
        <input aria-label="组合 SKU 截止日期" name="bundleEnd" type="date" defaultValue={end} />
      </label>
      <button className="button button-primary" type="submit">查询</button>
    </form>

    <div className="erp-operation-bar" aria-label="组合 SKU 操作">
      <div className="erp-operation-start">
        <span>{data ? `共 ${data.totalElements} 条` : "正在读取数据"}</span>
      </div>
      <div className="erp-operation-end">
        <button
          className="button"
          type="button"
          disabled={exporting || !data || data.totalElements === 0}
          onClick={() => void exportFiltered()}
        >
          {exporting ? "正在导出…" : "导出筛选结果"}
        </button>
        {canWrite && <button
          className="button button-primary"
          type="button"
          onClick={() => setEditor({})}
        >新增组合 SKU</button>}
      </div>
    </div>

    {feedback && <div className="warehouse-export-feedback" role="status">{feedback}</div>}
    {state.status === "loading" && <div className="product-state" aria-busy="true">正在加载组合 SKU…</div>}
    {state.status === "error" && <div className="compact-empty-state" role="alert">
      <strong>无法读取组合 SKU</strong>
      <span>{state.message}</span>
      <button className="text-button" type="button" onClick={() => setRefreshToken((value) => value + 1)}>重试</button>
    </div>}
    {data && data.items.length === 0 && <div className="compact-empty-state" role="status">
      <strong>暂无组合 SKU</strong>
      <span>{keyword || start || end ? "请调整筛选条件后重试。" : "可新增组合 SKU 并选择组成商品。"}</span>
      {canWrite && !keyword && !start && !end && <button className="text-button" type="button" onClick={() => setEditor({})}>新增组合 SKU</button>}
    </div>}
    {data && data.items.length > 0 && <>
      <div className="shop-table-scroll">
        <table className="shop-table product-bundle-table">
          <caption className="sr-only">组合 SKU 列表</caption>
          <thead><tr>
            <th>组合 SKU</th>
            <th>组合名称</th>
            <th>组成商品</th>
            <th>合计件数</th>
            <th>状态</th>
            <th>更新信息</th>
            <th>操作</th>
          </tr></thead>
          <tbody>{data.items.map((item) => <tr key={item.id}>
            <td><strong>{item.businessCode}</strong></td>
            <td><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</td>
            <td>{item.components.slice(0, 2).map((component) => <span className="bundle-component-summary" key={component.skuId}>{component.skuCode} × {component.quantity}</span>)}{item.componentCount > 2 && <small>另有 {item.componentCount - 2} 种</small>}</td>
            <td>{item.totalUnits}</td>
            <td><span className={`status-badge status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td>
            <td><span>{item.updatedByDisplayName}</span><small>{formatDateTime(item.updatedAt)}</small></td>
            <td><span className="row-actions">{canWrite && item.status !== "ARCHIVED" ? <>
              <button className="text-button" type="button" onClick={() => setEditor({ item })}>编辑</button>
              <button className="text-button is-danger" type="button" onClick={() => { setArchiveError(undefined); setArchiveTarget(item); }}>归档</button>
            </> : <span className="muted-cell">只读</span>}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="pagination">
        <span>第 {data.page + 1} / {Math.max(1, data.totalPages)} 页</span>
        <button className="text-button" type="button" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>上一页</button>
        <button className="text-button" type="button" disabled={page + 1 >= data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
      </div>
    </>}

    {editor && <ProductBundleEditor
      item={editor.item}
      onClose={() => setEditor(undefined)}
      onSaved={(saved) => {
        setEditor(undefined);
        setFeedback(`已保存 ${saved.businessCode}。`);
        setRefreshToken((value) => value + 1);
      }}
    />}
    {archiveTarget && <ConfirmationDialog
      title="归档组合 SKU"
      description={`归档 ${archiveTarget.businessCode} 后，该记录将从日常列表中移除，历史记录仍会保留。`}
      confirmLabel="确认归档"
      busyLabel="正在归档…"
      busy={archiveBusy}
      destructive
      onClose={() => { if (!archiveBusy) setArchiveTarget(undefined); }}
      onConfirm={() => void confirmArchive()}
    >{archiveError && <div className="inline-alert" role="alert">{archiveError}</div>}</ConfirmationDialog>}
  </section>;
}

function ProductBundleEditor({
  item,
  onClose,
  onSaved,
}: {
  item?: ProductBundle;
  onClose: () => void;
  onSaved: (saved: ProductBundle) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(
    item?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  );
  const [components, setComponents] = useState(() => item?.components.map((component) => ({
    skuId: component.skuId,
    skuCode: component.skuCode,
    skuName: component.skuName,
    quantity: component.quantity,
  })) ?? []);
  const [skuQuery, setSkuQuery] = useState("");
  const [skuResults, setSkuResults] = useState<ProductSku[]>([]);
  const [skuSearching, setSkuSearching] = useState(false);
  const [skuSearchError, setSkuSearchError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const selectedIds = useMemo(
    () => new Set(components.map((component) => component.skuId)),
    [components],
  );

  const searchSkus = async () => {
    setSkuSearching(true);
    setSkuSearchError(undefined);
    try {
      const result = await productCenterApi.listSkus({
        status: "ACTIVE",
        keyword: skuQuery.trim() || undefined,
        searchField: "ALL",
        matchMode: "CONTAINS",
        sortBy: "BUSINESS_CODE",
        descending: false,
        page: 0,
        size: 25,
      });
      setSkuResults(result.items);
      if (result.items.length === 0) setSkuSearchError("没有找到可用的库存 SKU。可修改关键词后重试。");
    } catch (searchError) {
      setSkuSearchError(safeBundleMessage(searchError, "暂时无法搜索库存 SKU，请稍后重试。"));
    } finally {
      setSkuSearching(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const businessCode = String(form.get("businessCode") ?? "").trim().toUpperCase();
    if (!item && !BUSINESS_CODE_PATTERN.test(businessCode)) {
      setError("组合 SKU 编号需以字母开头，仅使用大写字母、数字、下划线或连字符，长度为 2 至 64 位。");
      return;
    }
    if (!name.trim()) {
      setError("请填写组合名称。");
      return;
    }
    if (components.length === 0) {
      setError("请至少添加 1 个库存 SKU。");
      return;
    }
    if (components.some((component) => !Number.isSafeInteger(component.quantity) || component.quantity < 1 || component.quantity > 1_000_000)) {
      setError("组成数量需填写 1 至 1000000 之间的整数。");
      return;
    }
    setSaving(true);
    setError(undefined);
    const input: ProductBundleInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      status,
      components: components.map((component) => ({
        skuId: component.skuId,
        quantity: component.quantity,
      })),
    };
    try {
      const saved = item
        ? await productBundleApi.update(item.id, item.version, input)
        : await productBundleApi.create({ ...input, businessCode });
      onSaved(saved);
    } catch (saveError) {
      setError(safeBundleMessage(saveError, "保存失败，请检查填写内容后重试。"));
    } finally {
      setSaving(false);
    }
  };

  return <section className="warehouse-dialog-backdrop" role="presentation">
    <section className="warehouse-dialog product-bundle-dialog" role="dialog" aria-modal="true" aria-labelledby="product-bundle-editor-title">
      <header className="table-heading">
        <div><h2 id="product-bundle-editor-title">{item ? "编辑组合 SKU" : "新增组合 SKU"}</h2><p>{item ? `${item.businessCode} · 维护组成商品与数量` : "建立组合编号，并选择需要包含的库存 SKU。"}</p></div>
        <DialogCloseButton disabled={saving} onClick={onClose} />
      </header>
      <form onSubmit={submit}>
        <div className="product-bundle-basic-grid">
          <label>组合 SKU 编号
            <input aria-label="组合 SKU 编号" name="businessCode" autoFocus={!item} required={!item} readOnly={Boolean(item)} maxLength={64} defaultValue={item?.businessCode ?? ""} placeholder="例如 KIT-SUMMER-01" />
            <small>{item ? "编号创建后不可修改。" : "字母开头，仅可使用大写字母、数字、下划线或连字符。"}</small>
          </label>
          <label>组合名称
            <input aria-label="组合名称" autoFocus={Boolean(item)} required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 夏季出行套装" />
          </label>
          {item && <label>状态
            <select value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}>
              <option value="ACTIVE">启用</option>
              <option value="INACTIVE">停用</option>
            </select>
          </label>}
        </div>
        <label>说明（可选）
          <textarea maxLength={1000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明组合的使用场景" />
        </label>

        <fieldset className="product-bundle-fieldset">
          <legend>选择组成商品</legend>
          <p>搜索已启用的库存 SKU，并将需要的商品加入组合。</p>
          <div className="product-bundle-search-row">
            <label>库存 SKU
              <input value={skuQuery} onChange={(event) => setSkuQuery(event.target.value)} maxLength={100} placeholder="输入 SKU 编号或名称" />
            </label>
            <button className="button" type="button" disabled={skuSearching} onClick={() => void searchSkus()}>{skuSearching ? "正在搜索…" : "搜索"}</button>
          </div>
          {skuSearchError && <div className="product-bundle-search-message" role="status">{skuSearchError}</div>}
          {skuResults.length > 0 && <div className="shop-table-scroll product-bundle-picker-results">
            <table className="shop-table"><caption className="sr-only">库存 SKU 搜索结果</caption><thead><tr><th>库存 SKU</th><th>商品名称</th><th>操作</th></tr></thead><tbody>
              {skuResults.map((sku) => <tr key={sku.id}><td>{sku.businessCode}</td><td>{sku.name}</td><td>{selectedIds.has(sku.id) ? <span className="muted-cell">已添加</span> : <button className="text-button" type="button" onClick={() => setComponents((current) => [...current, { skuId: sku.id, skuCode: sku.businessCode, skuName: sku.name, quantity: 1 }])}>添加</button>}</td></tr>)}
            </tbody></table>
          </div>}
        </fieldset>

        <fieldset className="product-bundle-fieldset">
          <legend>已选商品（{components.length}）</legend>
          {components.length === 0 ? <div className="product-bundle-search-message">尚未添加库存 SKU。</div> : <div className="shop-table-scroll product-bundle-selected-items">
            <table className="shop-table"><caption className="sr-only">已选组成商品</caption><thead><tr><th>库存 SKU</th><th>商品名称</th><th>组成数量</th><th>操作</th></tr></thead><tbody>
              {components.map((component) => <tr key={component.skuId}><td>{component.skuCode}</td><td>{component.skuName}</td><td><input aria-label={`${component.skuCode} 组成数量`} type="number" inputMode="numeric" min={1} max={1_000_000} step={1} value={component.quantity} onChange={(event) => { const quantity = Number(event.target.value); setComponents((current) => current.map((candidate) => candidate.skuId === component.skuId ? { ...candidate, quantity } : candidate)); }} /></td><td><button className="text-button is-danger" type="button" onClick={() => setComponents((current) => current.filter((candidate) => candidate.skuId !== component.skuId))}>移除</button></td></tr>)}
            </tbody></table>
          </div>}
        </fieldset>

        {error && <div className="inline-alert" role="alert">{error}</div>}
        <footer className="form-actions">
          <button type="button" disabled={saving} onClick={onClose}>取消</button>
          <button className="is-primary" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存"}</button>
        </footer>
      </form>
    </section>
  </section>;
}

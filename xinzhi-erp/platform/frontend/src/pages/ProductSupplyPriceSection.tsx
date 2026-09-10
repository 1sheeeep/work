import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { productBundleApi } from "../modules/productBundleApi";
import { productCenterApi } from "../modules/productCenterApi";
import {
  type ProductSupplyPrice,
  type ProductSupplyPriceInput,
  type SupplyPriceSkuType,
  productSupplyPriceApi,
} from "../modules/productSupplyPriceApi";
import "./WarehouseArchiveShells.css";
import "./ProductSupplyPriceSection.css";

const PAGE_SIZE = 25;
const MAX_EXPORT_ROWS = 10_000;
const COUNTRIES = [
  ["US", "美国"], ["CA", "加拿大"], ["GB", "英国"], ["DE", "德国"],
  ["FR", "法国"], ["IT", "意大利"], ["ES", "西班牙"], ["AU", "澳大利亚"],
  ["JP", "日本"], ["CN", "中国"],
] as const;
const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD", "JPY", "CNY"] as const;
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", CA: "CAD", GB: "GBP", DE: "EUR", FR: "EUR", IT: "EUR",
  ES: "EUR", AU: "AUD", JP: "JPY", CN: "CNY",
};

type ReferenceOption = { id: string; code: string; name: string };
type PriceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Awaited<ReturnType<typeof productSupplyPriceApi.list>> };

function message(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 403) return "当前账号没有维护商品供货价的权限。";
  if (error.status === 404) return "供货价记录或关联 SKU 不存在。";
  if (error.status === 409) return "相同 SKU、国家和生效期已有重叠的启用供货价，或记录已被其他人修改。";
  return error.message || fallback;
}

function statusLabel(status: ProductSupplyPrice["status"]) {
  return status === "ACTIVE" ? "启用" : status === "INACTIVE" ? "停用" : "已归档";
}

function typeLabel(type: SupplyPriceSkuType) {
  return type === "INVENTORY" ? "库存 SKU" : "组合 SKU";
}

function countryLabel(country: string) {
  return COUNTRIES.find(([code]) => code === country)?.[1] ?? country;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(rows: ProductSupplyPrice[]) {
  const header = ["SKU类型", "SKU编号", "商品名称", "销售国家", "币种", "供货单价", "最小供货量", "生效日期", "失效日期", "状态", "备注"];
  const body = rows.map((item) => [
    typeLabel(item.skuType), item.skuCode, item.skuName,
    item.salesCountry, item.currency, item.unitPrice,
    item.minimumQuantity, item.validFrom, item.validTo ?? "",
    statusLabel(item.status), item.note ?? "",
  ]);
  const blob = new Blob(["\uFEFF" + [header, ...body]
    .map((row) => row.map(csvCell).join(",")).join("\r\n")],
  { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `商品供货价_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProductSupplyPriceSection({
  keyword,
  skuType,
  country,
  canWrite,
  onFilter,
}: {
  keyword: string;
  skuType: string;
  country: string;
  canWrite: boolean;
  onFilter: (keyword: string, skuType: string, country: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState<PriceState>({ status: "loading" });
  const [editor, setEditor] = useState<{ item?: ProductSupplyPrice }>();
  const [archiveTarget, setArchiveTarget] = useState<ProductSupplyPrice>();
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [feedback, setFeedback] = useState<string>();

  const normalizedType = skuType === "INVENTORY" || skuType === "BUNDLE"
    ? skuType : undefined;

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    productSupplyPriceApi.list({
      keyword: keyword || undefined,
      skuType: normalizedType,
      country: country || undefined,
      page,
      size: PAGE_SIZE,
    }).then((data) => {
      if (active) setState({ status: "ready", data });
    }).catch((error) => {
      if (active) setState({ status: "error", message: message(error, "暂时无法读取商品供货价，请稍后重试。") });
    });
    return () => { active = false; };
  }, [keyword, normalizedType, country, page, refreshToken]);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [keyword, normalizedType, country]);

  const data = state.status === "ready" ? state.data : undefined;
  const allVisibleSelected = Boolean(data?.items.length)
    && data!.items.every((item) => selected.has(item.id));

  const submitFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onFilter(
      String(form.get("supplyPriceKeyword") ?? "").trim().slice(0, 100),
      String(form.get("supplyPriceSkuType") ?? ""),
      String(form.get("supplyPriceCountry") ?? ""),
    );
  };

  const runBatch = async (status: "ACTIVE" | "INACTIVE") => {
    if (!data || selected.size === 0) return;
    const items = data.items.filter((item) => selected.has(item.id));
    setBatchBusy(true);
    setFeedback(undefined);
    try {
      await productSupplyPriceApi.batchStatus(status,
        items.map((item) => ({ id: item.id, expectedVersion: item.version })));
      setSelected(new Set());
      setFeedback(`已${status === "ACTIVE" ? "启用" : "停用"} ${items.length} 条供货价。`);
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setFeedback(message(error, "批量操作失败，请刷新后重试。"));
    } finally {
      setBatchBusy(false);
    }
  };

  const exportRows = async () => {
    setExportBusy(true);
    setFeedback(undefined);
    try {
      const first = await productSupplyPriceApi.list({
        keyword: keyword || undefined, skuType: normalizedType,
        country: country || undefined, page: 0, size: 100,
      });
      if (first.totalElements > MAX_EXPORT_ROWS) {
        setFeedback("筛选结果超过 10000 条，请缩小范围后导出。");
        return;
      }
      const rows = [...first.items];
      for (let next = 1; next < first.totalPages; next += 1) {
        rows.push(...(await productSupplyPriceApi.list({
          keyword: keyword || undefined, skuType: normalizedType,
          country: country || undefined, page: next, size: 100,
        })).items);
      }
      downloadCsv(rows);
      setFeedback(`已导出 ${rows.length} 条供货价。`);
    } catch (error) {
      setFeedback(message(error, "导出失败，请稍后重试。"));
    } finally {
      setExportBusy(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    setArchiveError(undefined);
    try {
      await productSupplyPriceApi.archive(archiveTarget.id, archiveTarget.version);
      setArchiveTarget(undefined);
      setFeedback(`已归档 ${archiveTarget.skuCode} 的供货价。`);
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setArchiveError(message(error, "归档失败，请刷新后重试。"));
    } finally {
      setArchiveBusy(false);
    }
  };

  return <section className="detail-card product-section erp-data-workbench supply-price-section" aria-labelledby="supply-price-title">
    <div className="table-heading"><div>
      <h2 id="supply-price-title">商品供货价管理</h2>
      <p>按 SKU、销售国家和生效期维护可追溯的供货价格。</p>
    </div></div>
    <form className="toolbar-row supply-price-filters" key={`${keyword}:${skuType}:${country}`} onSubmit={submitFilter}>
      <label>搜索内容<input aria-label="供货价搜索内容" name="supplyPriceKeyword" defaultValue={keyword} maxLength={100} placeholder="SKU 编号或商品名称" /></label>
      <label>SKU 类型<select aria-label="供货价 SKU 类型" name="supplyPriceSkuType" defaultValue={skuType}><option value="">全部类型</option><option value="INVENTORY">库存 SKU</option><option value="BUNDLE">组合 SKU</option></select></label>
      <label>销售国家<select aria-label="供货价销售国家" name="supplyPriceCountry" defaultValue={country}><option value="">全部国家</option>{COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}（{code}）</option>)}</select></label>
      <button className="button button-primary" type="submit">查询</button>
    </form>
    <div className="erp-operation-bar" aria-label="商品供货价操作">
      <div className="erp-operation-start"><span>共 {data?.totalElements ?? 0} 条</span>{selected.size > 0 && <span>已选 {selected.size} 条</span>}</div>
      <div className="erp-operation-end">
        {canWrite && selected.size > 0 && <><button className="button" type="button" disabled={batchBusy} onClick={() => void runBatch("ACTIVE")}>批量启用</button><button className="button" type="button" disabled={batchBusy} onClick={() => void runBatch("INACTIVE")}>批量停用</button></>}
        <button className="button" type="button" disabled={exportBusy} onClick={() => void exportRows()}>{exportBusy ? "正在导出…" : "导出筛选结果"}</button>
        {canWrite && <button className="button button-primary" type="button" onClick={() => setEditor({})}>新增供货价</button>}
      </div>
    </div>
    {feedback && <div className="inline-alert" role="status">{feedback}</div>}
    {state.status === "loading" && <div className="compact-empty-state" role="status"><strong>正在加载供货价</strong><span>请稍候。</span></div>}
    {state.status === "error" && <div className="compact-empty-state" role="alert"><strong>供货价加载失败</strong><span>{state.message}</span><button className="button" type="button" onClick={() => setRefreshToken((value) => value + 1)}>重试</button></div>}
    {data && data.items.length === 0 && <div className="compact-empty-state" role="status"><strong>暂无商品供货价</strong><span>可调整筛选条件，或新增第一条供货价。</span></div>}
    {data && data.items.length > 0 && <><div className="shop-table-scroll"><table className="shop-table supply-price-table"><caption className="sr-only">商品供货价列表</caption><thead><tr>
      <th><input aria-label="选择当前页全部供货价" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set(data.items.map((item) => item.id)) : new Set())} /></th>
      <th>SKU</th><th>类型</th><th>销售国家</th><th>供货单价</th><th>最小供货量</th><th>生效期</th><th>状态</th><th>更新信息</th><th>操作</th>
    </tr></thead><tbody>{data.items.map((item) => <tr key={item.id}>
      <td><input aria-label={`选择 ${item.skuCode}`} type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /></td>
      <td><strong>{item.skuCode}</strong><small>{item.skuName}</small></td><td>{typeLabel(item.skuType)}</td><td>{countryLabel(item.salesCountry)}<small>{item.salesCountry}</small></td><td><strong>{item.currency} {item.unitPrice.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong></td><td>{item.minimumQuantity}</td><td>{item.validFrom}<small>{item.validTo ? `至 ${item.validTo}` : "长期有效"}</small></td><td><span className={`status-badge status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></td><td><span>{item.updatedByDisplayName}</span><small>{formatDateTime(item.updatedAt)}</small></td><td><span className="row-actions">{canWrite && item.status !== "ARCHIVED" ? <><button className="text-button" type="button" onClick={() => setEditor({ item })}>编辑</button><button className="text-button is-danger" type="button" onClick={() => { setArchiveError(undefined); setArchiveTarget(item); }}>归档</button></> : <span className="muted-cell">只读</span>}</span></td>
    </tr>)}</tbody></table></div><div className="pagination"><span>第 {data.page + 1} / {Math.max(1, data.totalPages)} 页</span><button className="text-button" type="button" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="text-button" type="button" disabled={page + 1 >= data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div></>}
    {editor && <SupplyPriceEditor item={editor.item} onClose={() => setEditor(undefined)} onSaved={(saved) => { setEditor(undefined); setFeedback(`已保存 ${saved.skuCode} 的供货价。`); setRefreshToken((value) => value + 1); }} />}
    {archiveTarget && <ConfirmationDialog title="归档商品供货价" description={`归档 ${archiveTarget.skuCode}（${archiveTarget.salesCountry}）的供货价后，该记录将从日常列表中移除，历史仍会保留。`} confirmLabel="确认归档" busyLabel="正在归档…" busy={archiveBusy} destructive onClose={() => { if (!archiveBusy) setArchiveTarget(undefined); }} onConfirm={() => void confirmArchive()}>{archiveError && <div className="inline-alert" role="alert">{archiveError}</div>}</ConfirmationDialog>}
  </section>;
}

function SupplyPriceEditor({ item, onClose, onSaved }: { item?: ProductSupplyPrice; onClose: () => void; onSaved: (saved: ProductSupplyPrice) => void }) {
  const [skuType, setSkuType] = useState<SupplyPriceSkuType>(item?.skuType ?? "INVENTORY");
  const [selectedReference, setSelectedReference] = useState<ReferenceOption | undefined>(item ? { id: item.referenceId, code: item.skuCode, name: item.skuName } : undefined);
  const [referenceQuery, setReferenceQuery] = useState("");
  const [referenceResults, setReferenceResults] = useState<ReferenceOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [country, setCountry] = useState(item?.salesCountry ?? "US");
  const [currency, setCurrency] = useState(item?.currency ?? "USD");
  const [unitPrice, setUnitPrice] = useState(item ? String(item.unitPrice) : "");
  const [minimumQuantity, setMinimumQuantity] = useState(item?.minimumQuantity ?? 1);
  const [validFrom, setValidFrom] = useState(item?.validFrom ?? new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState(item?.validTo ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(item?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE");
  const [note, setNote] = useState(item?.note ?? "");
  const [searchMessage, setSearchMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const searchReferences = async () => {
    setSearching(true); setSearchMessage(undefined);
    try {
      const rows = skuType === "INVENTORY"
        ? (await productCenterApi.listSkus({ status: "ACTIVE", keyword: referenceQuery.trim() || undefined, searchField: "ALL", matchMode: "CONTAINS", sortBy: "BUSINESS_CODE", descending: false, page: 0, size: 25 })).items.map((value) => ({ id: value.id, code: value.businessCode, name: value.name }))
        : (await productBundleApi.list({ status: "ACTIVE", keyword: referenceQuery.trim() || undefined, page: 0, size: 25 })).items.map((value) => ({ id: value.id, code: value.businessCode, name: value.name }));
      setReferenceResults(rows);
      if (rows.length === 0) setSearchMessage("没有找到可用的 SKU，请修改关键词后重试。");
    } catch (searchError) {
      setSearchMessage(message(searchError, "暂时无法搜索 SKU，请稍后重试。"));
    } finally { setSearching(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const price = Number(unitPrice);
    if (!selectedReference) { setError("请先选择一个 SKU。"); return; }
    if (!Number.isFinite(price) || price <= 0 || !/^\d{1,15}(\.\d{1,4})?$/.test(unitPrice)) { setError("供货单价须为大于 0、最多 4 位小数的金额。"); return; }
    if (!Number.isInteger(minimumQuantity) || minimumQuantity < 1 || minimumQuantity > 1_000_000) { setError("最小供货量须为 1 至 1000000 的整数。"); return; }
    if (!validFrom || (validTo && validTo < validFrom)) { setError("失效日期不能早于生效日期。"); return; }
    setSaving(true); setError(undefined);
    const input: ProductSupplyPriceInput = { currency, unitPrice: price, minimumQuantity, validFrom, validTo: validTo || undefined, status, note: note.trim() || undefined };
    try {
      const saved = item
        ? await productSupplyPriceApi.update(item.id, item.version, input)
        : await productSupplyPriceApi.create({ ...input, skuType, referenceId: selectedReference.id, salesCountry: country });
      onSaved(saved);
    } catch (saveError) { setError(message(saveError, "保存失败，请检查填写内容后重试。")); }
    finally { setSaving(false); }
  };

  return <section className="warehouse-dialog-backdrop" role="presentation"><section className="warehouse-dialog supply-price-dialog" role="dialog" aria-modal="true" aria-labelledby="supply-price-editor-title">
    <header className="table-heading"><div><h2 id="supply-price-editor-title">{item ? "编辑商品供货价" : "新增商品供货价"}</h2><p>{item ? `${item.skuCode} · ${countryLabel(item.salesCountry)}` : "选择 SKU 与销售国家，设置供货价格和生效期。"}</p></div><DialogCloseButton disabled={saving} onClick={onClose} /></header>
    <form onSubmit={submit}>
      <div className="supply-price-dialog-grid">
        <label>SKU 类型<select disabled={Boolean(item)} value={skuType} onChange={(event) => { setSkuType(event.target.value as SupplyPriceSkuType); setSelectedReference(undefined); setReferenceResults([]); }}><option value="INVENTORY">库存 SKU</option><option value="BUNDLE">组合 SKU</option></select></label>
        <label>销售国家<select disabled={Boolean(item)} value={country} onChange={(event) => { const value = event.target.value; setCountry(value); setCurrency(COUNTRY_CURRENCY[value] ?? "USD"); }}>{COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}（{code}）</option>)}</select></label>
      </div>
      {!item && <fieldset className="product-bundle-fieldset"><legend>选择 SKU</legend><div className="product-bundle-search-row"><label>SKU 编号或名称<input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} maxLength={100} placeholder="输入关键词搜索" /></label><button className="button" type="button" disabled={searching} onClick={() => void searchReferences()}>{searching ? "正在搜索…" : "搜索"}</button></div>{searchMessage && <div className="product-bundle-search-message" role="status">{searchMessage}</div>}{referenceResults.length > 0 && <div className="shop-table-scroll supply-price-picker"><table className="shop-table"><caption className="sr-only">SKU 搜索结果</caption><thead><tr><th>SKU</th><th>名称</th><th>操作</th></tr></thead><tbody>{referenceResults.map((result) => <tr key={result.id}><td>{result.code}</td><td>{result.name}</td><td>{selectedReference?.id === result.id ? <span className="muted-cell">已选择</span> : <button className="text-button" type="button" onClick={() => setSelectedReference(result)}>选择</button>}</td></tr>)}</tbody></table></div>}<p className="supply-price-selected">当前选择：{selectedReference ? <strong>{selectedReference.code} · {selectedReference.name}</strong> : "尚未选择"}</p></fieldset>}
      {item && <div className="supply-price-identity"><span>SKU</span><strong>{item.skuCode} · {item.skuName}</strong></div>}
      <div className="supply-price-dialog-grid">
        <label>供货单价<input aria-label="供货单价" required inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="例如 12.50" /></label>
        <label>币种<select aria-label="币种" value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>最小供货量<input aria-label="最小供货量" type="number" min={1} max={1_000_000} step={1} value={minimumQuantity} onChange={(event) => setMinimumQuantity(Number(event.target.value))} /></label>
        {item && <label>状态<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}
        <label>生效日期<input aria-label="生效日期" type="date" required value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
        <label>失效日期（可选）<input aria-label="失效日期（可选）" type="date" min={validFrom} value={validTo} onChange={(event) => setValidTo(event.target.value)} /></label>
      </div>
      <label>备注（可选）<textarea aria-label="备注（可选）" maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录价格适用条件或来源" /></label>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <footer className="warehouse-confirm-actions"><button type="button" disabled={saving} onClick={onClose}>取消</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存"}</button></footer>
    </form>
  </section></section>;
}

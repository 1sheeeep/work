import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { CurrencyCodeInput } from "../components/CurrencyCodeInput";
import { DialogCloseButton } from "../components/DialogCloseButton";
import {
  normalizeCurrencyCode,
  optionalAmountCurrencyError,
} from "../modules/currencyInput";
import {
  type MasterDataListRequest,
  type Page,
  type PackageMaterialInput,
  type ProductCategory,
  type ProductMasterDataStatus,
  type ProductPackageMaterial,
  productCenterApi,
} from "../modules/productCenterApi";

type LoadState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type ManagerKind = "category" | "package";

type CategoryValues = {
  name: string;
  sortOrder: string;
  status: ProductMasterDataStatus;
};

type PackageValues = {
  name: string;
  unitPrice: string;
  currencyCode: string;
  weightGrams: string;
  level: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  status: ProductMasterDataStatus;
};

type Editor =
  | { kind: "category"; item?: ProductCategory }
  | { kind: "package"; item?: ProductPackageMaterial };

const statuses: ProductMasterDataStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function statusLabel(status: ProductMasterDataStatus) {
  return status === "ACTIVE" ? "启用" : status === "INACTIVE" ? "停用" : "已归档";
}

function DateTime({ value }: { value: string }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return <>—</>;
  return <time dateTime={value}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(parsed)}</time>;
}

function valuesForCategory(item?: ProductCategory): CategoryValues {
  return {
    name: item?.name ?? "",
    sortOrder: String(item?.sortOrder ?? 0),
    status: item?.status ?? "ACTIVE",
  };
}

function valuesForPackage(item?: ProductPackageMaterial): PackageValues {
  return {
    name: item?.name ?? "",
    unitPrice: item?.unitPrice ?? "",
    currencyCode: item?.currencyCode ?? "",
    weightGrams: item?.weightGrams?.toString() ?? "",
    level: item?.level?.toString() ?? "",
    lengthMm: item?.lengthMm?.toString() ?? "",
    widthMm: item?.widthMm?.toString() ?? "",
    heightMm: item?.heightMm?.toString() ?? "",
    status: item?.status ?? "ACTIVE",
  };
}

function optionalPositiveInteger(value: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : null;
}

function masterDataError(error: unknown, subject: string) {
  if (error instanceof ApiError) {
    if (error.status === 400) return "填写内容不符合要求，请检查标记字段。";
    if (error.status === 401) return "登录状态已失效，请重新登录后重试。";
    if (error.status === 403) return `当前账号没有${subject}所需权限。`;
    if (error.status === 404) return "该记录不存在或当前账号无法访问。";
    if (error.status === 409) return "记录已发生变化或仍被商品引用，请刷新后重试。";
  }
  return `暂时无法${subject}，请稍后重试。`;
}

function packageInput(
  values: PackageValues,
): { input: PackageMaterialInput } | { error: string } {
  const numbers = {
    weightGrams: optionalPositiveInteger(values.weightGrams, 1_000_000_000),
    level: optionalPositiveInteger(values.level, 100),
    lengthMm: optionalPositiveInteger(values.lengthMm, 1_000_000),
    widthMm: optionalPositiveInteger(values.widthMm, 1_000_000),
    heightMm: optionalPositiveInteger(values.heightMm, 1_000_000),
  };
  const invalidNumber = [
    [numbers.weightGrams, "包装重量"],
    [numbers.level, "包装层级"],
    [numbers.lengthMm, "外尺寸长"],
    [numbers.widthMm, "外尺寸宽"],
    [numbers.heightMm, "外尺寸高"],
  ].find(([value]) => value === null)?.[1];
  if (invalidNumber) return { error: `请输入有效的${invalidNumber}。` };

  const dimensions = [
    numbers.lengthMm,
    numbers.widthMm,
    numbers.heightMm,
  ] as Array<number | undefined>;
  if (
    dimensions.some((value) => value !== undefined) &&
    dimensions.some((value) => value === undefined)
  ) {
    return { error: "填写外尺寸时，请同时填写长、宽、高。" };
  }

  const unitPrice = values.unitPrice.trim();
  const currencyCode = normalizeCurrencyCode(values.currencyCode);
  const priceCurrencyError = optionalAmountCurrencyError(
    unitPrice,
    currencyCode,
    "参考价格",
  );
  if (priceCurrencyError) return { error: priceCurrencyError };
  if (
    unitPrice &&
    !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,4})?$/.test(unitPrice)
  ) {
    return { error: "参考价格须为最多四位小数的非负金额。" };
  }
  const normalizedNumbers = Object.fromEntries(
    Object.entries(numbers).filter(([, value]) => value !== null),
  ) as Pick<PackageMaterialInput, "weightGrams" | "level" | "lengthMm" | "widthMm" | "heightMm">;
  const name = values.name.trim();
  if (!name) return { error: "请填写包装资料名称。" };
  return { input: {
    name,
    unitPrice: unitPrice || undefined,
    currencyCode: currencyCode || undefined,
    ...normalizedNumbers,
  } };
}

function CategoryEditor({
  item,
  onClose,
  onSaved,
}: {
  item?: ProductCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState(item);
  const [values, setValues] = useState(() => valuesForCategory(item));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof CategoryValues>(key: K, value: CategoryValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sortOrder = Number(values.sortOrder);
    if (!values.name.trim() || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
      setError("请填写类目名称和 0–1,000,000 的排序值。");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      if (current) {
        await productCenterApi.updateCategory(current.id, {
          name: values.name.trim(), sortOrder, status: values.status, version: current.version,
        });
      } else {
        await productCenterApi.createCategory({ name: values.name.trim(), sortOrder });
      }
      onSaved();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && current) {
        try {
          setCurrent(await productCenterApi.getCategory(current.id));
          setError("商品类目已更新。已保留本次输入，请确认后再次保存。");
        } catch (refreshError) {
          setError(masterDataError(refreshError, "刷新商品类目"));
        }
      } else {
        setError(masterDataError(reason, current ? "更新商品类目" : "新增商品类目"));
      }
    } finally {
      setSaving(false);
    }
  };
  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog" role="dialog" aria-modal="true" aria-labelledby="category-editor-title"><header className="table-heading"><h2 id="category-editor-title">{current ? "编辑商品类目" : "新增商品类目"}</h2><DialogCloseButton disabled={saving} onClick={onClose} /></header><form className="product-master-data-form" onSubmit={submit}><label>类目名称<input autoFocus required maxLength={200} value={values.name} onChange={(event) => update("name", event.target.value)} disabled={saving} /></label><label>排序<input required inputMode="numeric" value={values.sortOrder} onChange={(event) => update("sortOrder", event.target.value)} disabled={saving} /></label>{current && <label>状态<select value={values.status} onChange={(event) => update("status", event.target.value as ProductMasterDataStatus)} disabled={saving}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>}{error && <div className="inline-alert" role="alert">{error}</div>}<footer className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存"}</button></footer></form></section></div>;
}

function PackageEditor({
  item,
  onClose,
  onSaved,
}: {
  item?: ProductPackageMaterial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState(item);
  const [values, setValues] = useState(() => valuesForPackage(item));
  const [error, setError] = useState<string>();
  const [validationError, setValidationError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof PackageValues>(key: K, value: PackageValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = packageInput(values);
    if ("error" in result) {
      setValidationError(result.error);
      return;
    }
    const input = result.input;
    setSaving(true);
    setError(undefined);
    setValidationError(undefined);
    try {
      if (current) {
        await productCenterApi.updatePackageMaterial(current.id, {
          ...input, status: values.status, version: current.version,
        });
      } else {
        await productCenterApi.createPackageMaterial(input);
      }
      onSaved();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && current) {
        try {
          setCurrent(await productCenterApi.getPackageMaterial(current.id));
          setError("包装资料已更新。已保留本次输入，请确认后再次保存。");
        } catch (refreshError) {
          setError(masterDataError(refreshError, "刷新包装资料"));
        }
      } else {
        setError(masterDataError(reason, current ? "更新包装资料" : "新增包装资料"));
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="write-dialog product-package-editor" role="dialog" aria-modal="true" aria-labelledby="package-editor-title">
        <header className="table-heading">
          <div>
            <h2 id="package-editor-title">{current ? "编辑包装资料" : "新增包装资料"}</h2>
            <p>记录商品自身的包装资料。</p>
          </div>
          <DialogCloseButton disabled={saving} onClick={onClose} />
        </header>
        <form className="product-master-data-form product-package-editor-form dialog-scroll-region" onSubmit={submit}>
          <section className="product-package-editor-section">
            <div className="product-package-editor-heading">
              <h3>基本信息</h3>
              <p>填写包装资料名称。</p>
            </div>
            <label>包装资料名称<input autoFocus required maxLength={200} value={values.name} onChange={(event) => { setValidationError(undefined); update("name", event.target.value); }} disabled={saving} /></label>
          </section>

          <section className="product-package-editor-section">
            <div className="product-package-editor-heading">
              <h3>包装规格（可选）</h3>
              <p>填写包装本身的重量和外尺寸。</p>
            </div>
            <div className="product-package-spec-grid">
              <label>包装重量（克）<input inputMode="numeric" value={values.weightGrams} onChange={(event) => { setValidationError(undefined); update("weightGrams", event.target.value); }} disabled={saving} placeholder="例如 120" /></label>
              <fieldset className="product-package-dimensions">
                <legend>外尺寸（毫米）</legend>
                <div>
                  <label>长<input inputMode="numeric" value={values.lengthMm} onChange={(event) => { setValidationError(undefined); update("lengthMm", event.target.value); }} disabled={saving} placeholder="例如 300" /></label>
                  <label>宽<input inputMode="numeric" value={values.widthMm} onChange={(event) => { setValidationError(undefined); update("widthMm", event.target.value); }} disabled={saving} placeholder="例如 200" /></label>
                  <label>高<input inputMode="numeric" value={values.heightMm} onChange={(event) => { setValidationError(undefined); update("heightMm", event.target.value); }} disabled={saving} placeholder="例如 100" /></label>
                </div>
                <small>长、宽、高需同时填写，或全部留空。</small>
              </fieldset>
            </div>
          </section>

          <section className="product-package-editor-section">
            <div className="product-package-editor-heading">
              <h3>参考价格（可选）</h3>
              <p>用于商品资料维护，不用于结算。</p>
            </div>
            <div className="product-package-price-grid">
              <label>参考价格<input inputMode="decimal" value={values.unitPrice} onChange={(event) => { setValidationError(undefined); update("unitPrice", event.target.value); }} disabled={saving} placeholder="例如 2.50" /></label>
              <label>币种<CurrencyCodeInput listId="product-package-currency-options" value={values.currencyCode} onChange={(event) => { setValidationError(undefined); update("currencyCode", event.target.value.toUpperCase()); }} disabled={saving} /></label>
            </div>
            <small>填写价格后请选择币种；可选择常用币种，或输入三位币种代码。</small>
          </section>

          <details className="product-package-advanced-fields">
            <summary>更多信息（可选）</summary>
            <label>包装层级<input inputMode="numeric" value={values.level} onChange={(event) => { setValidationError(undefined); update("level", event.target.value); }} disabled={saving} placeholder="1–100" /></label>
            <small>用于商品资料维护。</small>
          </details>

          {current && <label>状态<select value={values.status} onChange={(event) => update("status", event.target.value as ProductMasterDataStatus)} disabled={saving}>{statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>}
          <small className="product-package-editor-history">未被商品使用的包装资料可删除；已使用的记录可停用或归档。</small>
          {validationError && <div className="field-error" role="alert">{validationError}</div>}
          {error && <div className="inline-alert" role="alert">{error}</div>}
          <footer className="form-actions"><button className="text-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存"}</button></footer>
        </form>
      </section>
    </div>
  );
}

export function ProductMasterDataManager({
  kind,
  canWrite,
  onClose,
  onChanged,
}: {
  kind: ManagerKind;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<LoadState<Page<ProductCategory | ProductPackageMaterial>>>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProductMasterDataStatus | undefined>();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [editor, setEditor] = useState<Editor>();
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<
    { kind: "success" | "error"; message: string } | undefined
  >();
  const [actionError, setActionError] = useState<
    { item: ProductCategory | ProductPackageMaterial; message: string } | undefined
  >();
  const request = useRef(0);
  const title = kind === "category" ? "商品目录管理" : "包装资料管理";
  const load = useCallback(async () => {
    const current = ++request.current;
    setState((previous) => ({ status: "loading", data: "data" in previous ? previous.data : undefined }));
    const requestValues: MasterDataListRequest = {
      query: query.trim() || undefined,
      status,
      page,
      size: pageSize,
    };
    try {
      const result = kind === "category"
        ? await productCenterApi.listCategories(requestValues)
        : await productCenterApi.listPackageMaterials(requestValues);
      if (current === request.current) setState({ status: "ready", data: result });
    } catch (reason) {
      if (current === request.current) setState({ status: "error", message: masterDataError(reason, `读取${title}`) });
    }
  }, [kind, page, pageSize, query, status, title]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  const saved = () => { setEditor(undefined); onChanged(); void load(); };
  const remove = async (
    item: ProductCategory | ProductPackageMaterial,
    skipConfirmation = false,
  ) => {
    if (
      !canWrite ||
      (!skipConfirmation &&
        !window.confirm(`确定彻底删除“${item.name}”吗？仅未被商品引用的记录可以删除。`))
    ) return;
    setActionError(undefined);
    try {
      if (kind === "category") await productCenterApi.deleteCategory(item.id, item.version);
      else await productCenterApi.deletePackageMaterial(item.id, item.version);
      onChanged();
      void load();
    } catch (reason) {
      setActionError({ item, message: masterDataError(reason, `删除${title}`) });
    }
  };
  const exportDirectory = async () => {
    if (exporting) return;
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const filters = { query: query.trim() || undefined, status };
      const result = kind === "category"
        ? await productCenterApi.exportCategoriesCsv(filters)
        : await productCenterApi.exportPackageMaterialsCsv(filters);
      const url = URL.createObjectURL(
        new Blob([result.content], { type: result.mediaType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportFeedback({
        kind: "success",
        message: `已导出 ${result.rowCount} 条${kind === "category" ? "商品类目" : "包装资料"}。`,
      });
    } catch (reason) {
      const message = reason instanceof ApiError && reason.status === 403
        ? `当前账号没有导出${kind === "category" ? "商品目录" : "包装资料目录"}所需权限。`
        : reason instanceof ApiError && reason.status === 409
          ? "筛选结果超过 10,000 条，请缩小筛选范围后重试。"
          : `暂时无法导出${kind === "category" ? "商品目录" : "包装资料目录"}，请稍后重试。`;
      setExportFeedback({ kind: "error", message });
    } finally {
      setExporting(false);
    }
  };
  const items = state.status === "ready" ? state.data.items : [];
  return <div className="dialog-backdrop" role="presentation"><section className="write-dialog product-master-data-manager" role="dialog" aria-modal="true" aria-labelledby="master-data-manager-title"><header className="table-heading"><div><h2 id="master-data-manager-title">{title}</h2><p>已被商品使用的记录将保留历史，只能停用或归档。</p></div><DialogCloseButton onClick={onClose} /></header><form className="toolbar-row" onSubmit={(event) => { event.preventDefault(); setPage(0); void load(); }}><input aria-label={`搜索${title}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称搜索" maxLength={100} /><select aria-label="状态筛选" value={status ?? ""} onChange={(event) => { setStatus(event.target.value ? event.target.value as ProductMasterDataStatus : undefined); setPage(0); }}><option value="">全部状态</option>{statuses.map((candidate) => <option key={candidate} value={candidate}>{statusLabel(candidate)}</option>)}</select><button className="button button-secondary" type="submit">查询</button><button className="button button-secondary" type="button" onClick={() => void exportDirectory()} disabled={exporting || state.status !== "ready" || state.data.totalElements === 0}>{exporting ? "正在导出…" : "导出 CSV"}</button>{canWrite && <button className="button button-primary" type="button" onClick={() => setEditor({ kind })}>新增{kind === "category" ? "类目" : "包装资料"}</button>}</form>{exportFeedback && <div className={exportFeedback.kind === "error" ? "inline-alert" : "warehouse-export-feedback"} role={exportFeedback.kind === "error" ? "alert" : "status"}>{exportFeedback.message}</div>}{actionError && <div className="inline-alert" role="alert"><span>{actionError.message}</span><button className="text-button" type="button" onClick={() => void remove(actionError.item, true)}>重试</button></div>}{state.status === "loading" && <p className="product-state" aria-busy="true">正在加载{title}…</p>}{state.status === "error" && <div className="compact-empty-state" role="alert"><strong>无法读取{title}</strong><span>{state.message}</span><button className="text-button" type="button" onClick={() => void load()}>重试</button></div>}{state.status === "ready" && (items.length === 0 ? <div className="compact-empty-state"><strong>暂无记录</strong><span>可通过“新增”维护{kind === "category" ? "商品类目" : "包装资料"}。</span></div> : <><div className="shop-table-scroll"><table className="shop-table"><caption className="sr-only">{title}</caption><thead><tr><th>名称</th>{kind === "category" ? <th>排序</th> : <><th>规格</th><th>参考价格</th></>}<th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.name}</td>{kind === "category" ? <td>{(item as ProductCategory).sortOrder}</td> : <><td>{[(item as ProductPackageMaterial).lengthMm, (item as ProductPackageMaterial).widthMm, (item as ProductPackageMaterial).heightMm].every((value) => value != null) ? `${(item as ProductPackageMaterial).lengthMm} × ${(item as ProductPackageMaterial).widthMm} × ${(item as ProductPackageMaterial).heightMm} mm` : "—"}</td><td>{(item as ProductPackageMaterial).unitPrice ? `${(item as ProductPackageMaterial).unitPrice} ${(item as ProductPackageMaterial).currencyCode}` : "—"}</td></>}<td>{statusLabel(item.status)}</td><td><DateTime value={item.updatedAt} /></td><td><span className="row-actions">{canWrite && item.status !== "ARCHIVED" && <><button className="text-button" type="button" onClick={() => setEditor({ kind, item } as Editor)}>编辑</button><button className="text-button" type="button" onClick={() => void remove(item)}>删除</button></>}{item.status === "ARCHIVED" && <span className="muted-cell">历史只读</span>}</span></td></tr>)}</tbody></table></div><div className="pagination"><span>共 {state.data.totalElements} 条</span><label>每页<select aria-label={`${title}分页每页条数`} value={pageSize} onChange={(event) => { setPage(0); setPageSize(Number(event.target.value)); }}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><button className="text-button" type="button" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {Math.max(1, state.data.totalPages)}</span><button className="text-button" type="button" disabled={page + 1 >= state.data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div></>)}</section>{editor?.kind === "category" && <CategoryEditor item={editor.item} onClose={() => setEditor(undefined)} onSaved={saved} />}{editor?.kind === "package" && <PackageEditor item={editor.item} onClose={() => setEditor(undefined)} onSaved={saved} />}</div>;
}

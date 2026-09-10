import { useBlocker, useRouter, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CurrencyCodeInput } from "../components/CurrencyCodeInput";
import { optionalAmountCurrencyError } from "../modules/currencyInput";
import {
  type Page,
  type ProductCategory,
  type ProductImage,
  type ProductPackageMaterial,
  type ProductSku,
  type ProductSpu,
  type ProductStatus,
  type SensitiveAttributeCode,
  productCenterApi,
  sensitiveAttributeCodes,
} from "../modules/productCenterApi";
import {
  type ProductEditor,
  ProductWriteDialog,
  SkuSection,
} from "./ProductCenterPage";
import {
  masterListPath,
  productMasterNewPath,
  productMasterPagePath,
} from "./productMasterPaths";
import { ProductMasterDataManager } from "./ProductMasterDataManager";
import { type Warehouse, warehouseCenterApi } from "../modules/warehouseCenterApi";

export { productMasterNewPath, productMasterPagePath } from "./productMasterPaths";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sensitiveAttributeLabels: Record<SensitiveAttributeCode, string> = {
  BATTERY: "含电池",
  INFRINGEMENT: "侵权风险",
  MAGNETIC: "含磁性物质",
  COSMETIC_NON_LIQUID: "非液体化妆品",
  COSMETIC_LIQUID: "液体化妆品",
  LIQUID_NON_COSMETIC: "非化妆品液体",
  POWDER: "粉末",
  PASTE: "膏状物",
  BLADED_ITEM: "刀具类",
  FLAMMABLE: "易燃品",
};

type FormValues = {
  businessCode: string;
  nameZh: string;
  nameEn: string;
  brandName: string;
  productNote: string;
  categoryId: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  actualWeightGrams: string;
  volumetricDivisor: "5000" | "6000";
  packageMaterialId: string;
  packageableCount: string;
  sensitiveAttributeCodes: SensitiveAttributeCode[];
  status: ProductStatus;
};

type FormField = Exclude<keyof FormValues, "status">;
type FieldErrors = Partial<Record<FormField, string>>;

type InitialSkuDraft = {
  clientId: number;
  businessCode: string;
  name: string;
  nameEn: string;
  variantSummary: string;
  unitCost: string;
  currencyCode: string;
  defaultWarehouseId: string;
};

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const DEFAULT_SKU_PAGE_SIZE = 25;
const LINK_SKU_PAGE_SIZE = 50;
const MAX_SKU_PAGE = 9_999;
const MAX_REFERENCE_ITEMS = 10_000;
const BUSINESS_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{1,63}$/;
const fieldErrorMessages: Record<FormField, string> = {
  businessCode: "主 SKU 需为 2–64 位字母、数字、下划线或连字符，并以字母开头。",
  nameZh: "请填写不超过 200 个字符的中文名称。",
  nameEn: "英文名称不能超过 200 个字符。",
  brandName: "品牌名称不能超过 160 个字符。",
  productNote: "商品备注不能超过 2000 个字符。",
  categoryId: "请选择当前可用的商品类目。",
  lengthMm: "长、宽、高需同时填写 1–1,000,000 毫米的整数。",
  widthMm: "长、宽、高需同时填写 1–1,000,000 毫米的整数。",
  heightMm: "长、宽、高需同时填写 1–1,000,000 毫米的整数。",
  actualWeightGrams: "实际重量需为 1–1,000,000,000 克的整数。",
  volumetricDivisor: "体积重系数只能选择 5000 或 6000。",
  packageMaterialId: "包装资料与每包装件数需同时填写。",
  packageableCount: "包装资料与每包装件数需同时填写，个数为 1–1,000,000。",
  sensitiveAttributeCodes: "敏感属性选择无效，请重新选择。",
};
const serverFieldMap: Record<string, FormField> = {
  businessCode: "businessCode",
  name: "nameZh",
  nameZh: "nameZh",
  nameEn: "nameEn",
  brandName: "brandName",
  productNote: "productNote",
  categoryId: "categoryId",
  lengthMm: "lengthMm",
  widthMm: "widthMm",
  heightMm: "heightMm",
  actualWeightGrams: "actualWeightGrams",
  volumetricDivisor: "volumetricDivisor",
  packageMaterialId: "packageMaterialId",
  packageableCount: "packageableCount",
  sensitiveAttributeCodes: "sensitiveAttributeCodes",
  chineseNameCompatible: "nameZh",
};

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function queryStatus(value: string | null): ProductStatus | undefined {
  return value === "ACTIVE" || value === "INACTIVE" || value === "ARCHIVED"
    ? value
    : undefined;
}

function boundedSkuValue(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function boundedSkuPage(value: string | null) {
  return boundedSkuValue(value, 0, 0, MAX_SKU_PAGE);
}

function boundedSkuSize(value: string | null) {
  return boundedSkuValue(value, DEFAULT_SKU_PAGE_SIZE, 1, 100);
}

function trimOptional(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
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

function selectedId(value: string) {
  const normalized = value.trim();
  return normalized && isUuid(normalized) ? normalized.toLowerCase() : undefined;
}

export async function loadAllMasterData<T extends { id: string }>(
  loadPage: (page: number) => Promise<Page<T>>,
) {
  const first = await loadPage(0);
  if (
    first.totalElements > MAX_REFERENCE_ITEMS ||
    first.totalPages >
      Math.ceil(MAX_REFERENCE_ITEMS / Math.max(first.size, 1))
  ) {
    throw new Error("目录超过 10,000 项，无法安全加载。");
  }
  const items = [...first.items];
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await loadPage(page);
    if (
      next.page !== page ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages
    ) {
      throw new Error("目录分页结果不一致，请刷新后重试。");
    }
    items.push(...next.items);
    if (items.length > MAX_REFERENCE_ITEMS) {
      throw new Error("目录超过 10,000 项，无法安全加载。");
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((item) => item.id)).size !== items.length
  ) {
    throw new Error("目录分页结果不一致，请刷新后重试。");
  }
  return items;
}

function validateForm(values: FormValues, isNew: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (isNew && !BUSINESS_CODE_PATTERN.test(values.businessCode.trim())) {
    errors.businessCode = fieldErrorMessages.businessCode;
  }
  if (!values.nameZh.trim() || values.nameZh.trim().length > 200) {
    errors.nameZh = fieldErrorMessages.nameZh;
  }
  for (const [field, maximum] of [
    ["nameEn", 200],
    ["brandName", 160],
    ["productNote", 2000],
  ] as const) {
    if (values[field].trim().length > maximum) {
      errors[field] = fieldErrorMessages[field];
    }
  }
  if (values.categoryId && !selectedId(values.categoryId)) {
    errors.categoryId = fieldErrorMessages.categoryId;
  }
  const dimensions = [values.lengthMm, values.widthMm, values.heightMm];
  const dimensionValues = dimensions.map((value) =>
    optionalPositiveInteger(value, 1_000_000),
  );
  if (
    dimensionValues.some((value) => value === null) ||
    (dimensionValues.some((value) => value !== undefined) &&
      dimensionValues.some((value) => value === undefined))
  ) {
    errors.lengthMm = fieldErrorMessages.lengthMm;
    errors.widthMm = fieldErrorMessages.widthMm;
    errors.heightMm = fieldErrorMessages.heightMm;
  }
  if (optionalPositiveInteger(values.actualWeightGrams, 1_000_000_000) === null) {
    errors.actualWeightGrams = fieldErrorMessages.actualWeightGrams;
  }
  if (values.volumetricDivisor !== "5000" && values.volumetricDivisor !== "6000") {
    errors.volumetricDivisor = fieldErrorMessages.volumetricDivisor;
  }
  const materialId = selectedId(values.packageMaterialId);
  const packageableCount = optionalPositiveInteger(values.packageableCount, 1_000_000);
  if (
    (values.packageMaterialId && !materialId) ||
    packageableCount === null ||
    (Boolean(materialId) !== Boolean(packageableCount))
  ) {
    errors.packageMaterialId = fieldErrorMessages.packageMaterialId;
    errors.packageableCount = fieldErrorMessages.packageableCount;
  }
  return errors;
}

function validationErrors(error: unknown): FieldErrors {
  if (
    !(error instanceof ApiError) ||
    error.status !== 400 ||
    typeof error.details !== "object" ||
    error.details === null ||
    Array.isArray(error.details)
  ) {
    return {};
  }
  const details = error.details as Record<string, unknown>;
  const errors: FieldErrors = {};
  for (const field of Object.keys(details)) {
    const formField = serverFieldMap[field];
    if (formField) errors[formField] = fieldErrorMessages[formField];
  }
  return errors;
}

function safeProductMessage(error: unknown, subject: string) {
  if (error instanceof ApiError && error.status === 400) {
    return "提交信息不符合要求，请检查标记字段后重试。";
  }
  if (error instanceof ApiError && error.status === 401) {
    return "登录状态已失效，请重新登录后再保存主商品。";
  }
  if (error instanceof ApiError && error.status === 403) {
    return `当前账号没有${subject}所需权限，登录状态保持不变。`;
  }
  if (error instanceof ApiError && error.status === 404) {
    return "请求的主商品不存在，或当前账号无法访问。";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "主商品资料已更新。已保留本次输入，请确认后再次保存。";
  }
  return `暂时无法${subject}，请稍后重试。`;
}

function saveProductMessage(
  error: unknown,
  isNew: boolean,
  hasFieldErrors: boolean,
) {
  if (error instanceof ApiError && error.status === 400) {
    return hasFieldErrors
      ? "提交信息不符合要求，请检查标记字段后重试。"
      : "提交格式无效，请检查主 SKU、中文名称和字段长度后重试。";
  }
  if (error instanceof ApiError
      && error.code === "product_image_storage_unavailable") {
    return "商品图片暂时无法保存，主商品尚未创建，请稍后重试。";
  }
  if (error instanceof ApiError
      && error.status === 409
      && error.code === "spu_business_code_conflict"
      && isNew) {
    return "主 SKU 已存在，请更换主 SKU 后重试。";
  }
  if (error instanceof ApiError && error.status === 409 && isNew) {
    return "当前商品资料与系统状态冲突，主商品尚未创建，请刷新后重试。";
  }
  return safeProductMessage(error, "保存主商品");
}

function formValues(spu?: ProductSpu): FormValues {
  return {
    businessCode: spu?.businessCode ?? "",
    nameZh: spu?.nameZh ?? spu?.name ?? "",
    nameEn: spu?.nameEn ?? "",
    brandName: spu?.brandName ?? "",
    productNote: spu?.productNote ?? "",
    categoryId: spu?.category?.id ?? "",
    lengthMm: spu?.lengthMm?.toString() ?? "",
    widthMm: spu?.widthMm?.toString() ?? "",
    heightMm: spu?.heightMm?.toString() ?? "",
    actualWeightGrams: spu?.actualWeightGrams?.toString() ?? "",
    volumetricDivisor: String(spu?.volumetricDivisor ?? 5000) as "5000" | "6000",
    packageMaterialId: spu?.packageMaterial?.id ?? "",
    packageableCount: spu?.packageableCount?.toString() ?? "",
    sensitiveAttributeCodes: spu?.sensitiveAttributeCodes ?? [],
    status: spu?.status ?? "ACTIVE",
  };
}

function ProductImagePanel({
  spu,
  canWrite,
}: {
  spu: ProductSpu;
  canWrite: boolean;
}) {
  const request = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<LoadState<ProductImage[]>>({ status: "loading" });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retryAction, setRetryAction] = useState<(() => void) | undefined>();

  const load = useCallback(async () => {
    const current = ++request.current;
    setState((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    setError(undefined);
    setRetryAction(undefined);
    try {
      const images = await productCenterApi.listSpuImages(spu.id);
      if (current === request.current) setState({ status: "ready", data: images });
    } catch (reason) {
      if (current === request.current) {
        setState({ status: "error", message: safeProductMessage(reason, "读取商品图片") });
      }
    }
  }, [spu.id]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (state.status !== "ready") return;
    let active = true;
    const urls: string[] = [];
    void Promise.all(
      state.data.map(async (image) => {
        const blob = await productCenterApi.getSpuImageBlob(spu.id, image.id);
        const url = URL.createObjectURL(blob);
        return [image.id, url] as const;
      }),
    ).then(
      (entries) => {
        if (active) {
          urls.push(...entries.map(([, url]) => url));
          setPreviews(Object.fromEntries(entries));
        } else {
          entries.forEach(([, url]) => URL.revokeObjectURL(url));
        }
      },
      () => {
        if (active) setError("部分商品图片暂时无法显示，请稍后重试。");
      },
    );
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      setPreviews({});
    };
  }, [spu.id, state]);

  const validateImageFile = (file: File) => {
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size < 1 ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("仅可上传不超过 5 MiB 的 JPEG 或 PNG 图片。");
      return false;
    }
    return true;
  };

  const upload = async (file: File) => {
    if (!canWrite || busy || !validateImageFile(file)) return;
    const images = state.status === "ready" ? state.data : [];
    setBusy(true);
    setError(undefined);
    setRetryAction(undefined);
    try {
      await productCenterApi.uploadSpuImage(
        spu.id,
        file,
        images.reduce((maximum, image) => Math.max(maximum, image.sortOrder), -1) + 1,
        !images.some((image) => image.primary),
      );
      await load();
    } catch (reason) {
      setError(safeProductMessage(reason, "上传商品图片"));
      setRetryAction(() => () => void upload(file));
    } finally {
      setBusy(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  const replace = async (image: ProductImage, file: File) => {
    if (!canWrite || busy || !validateImageFile(file)) return;
    setBusy(true);
    setError(undefined);
    setRetryAction(undefined);
    try {
      await productCenterApi.replaceSpuImage(spu.id, image.id, image.version, file);
      await load();
    } catch (reason) {
      setError(safeProductMessage(reason, "替换商品图片"));
      setRetryAction(() => () => void replace(image, file));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (image: ProductImage, skipConfirmation = false) => {
    if (
      !canWrite ||
      busy ||
      (!skipConfirmation && !window.confirm("确定删除这张商品图片吗？"))
    ) return;
    setBusy(true);
    setError(undefined);
    setRetryAction(undefined);
    try {
      await productCenterApi.deleteSpuImage(spu.id, image.id, image.version);
      await load();
    } catch (reason) {
      setError(safeProductMessage(reason, "删除商品图片"));
      setRetryAction(() => () => void remove(image, true));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="detail-card product-master-section" id="product-images" aria-labelledby="product-images-title">
      <div className="table-heading">
        <div><h2 id="product-images-title">商品图片</h2><p>仅支持直接上传 JPEG 或 PNG 文件，不使用外部图片链接。</p></div>
        {canWrite && spu.status !== "ARCHIVED" && <><input ref={uploadInput} className="sr-only" type="file" aria-label="选择商品图片文件" accept="image/jpeg,image/png" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} /><button className="button button-secondary" type="button" disabled={busy} onClick={() => uploadInput.current?.click()}>{busy ? "正在处理…" : "上传图片"}</button></>}
      </div>
      {state.status === "loading" && <p className="product-state" aria-busy="true">正在加载商品图片…</p>}
      {state.status === "error" && <div className="compact-empty-state" role="alert"><strong>无法读取商品图片</strong><span>{state.message}</span><button className="text-button" type="button" onClick={() => void load()}>重试</button></div>}
      {state.status === "ready" && state.data.length === 0 && <div className="compact-empty-state"><strong>暂无商品图片</strong><span>可上传 JPEG 或 PNG 文件，单张不超过 5 MiB。</span></div>}
      {state.status === "ready" && state.data.length > 0 && <div className="product-image-grid">{state.data.map((image) => <article key={image.id} className="product-image-card"><div className="product-image-preview">{previews[image.id] ? <img src={previews[image.id]} alt="商品图片预览" /> : <span>正在加载预览…</span>}</div><div><strong>{image.primary ? "主图" : "商品图片"}</strong><small>{image.widthPixels} × {image.heightPixels} 像素 · {Math.ceil(image.byteSize / 1024)} KiB</small>{canWrite && spu.status !== "ARCHIVED" && <span className="row-actions"><label className="text-button">替换<input className="sr-only" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void replace(image, file); event.currentTarget.value = ""; }} /></label><button className="text-button" type="button" disabled={busy} onClick={() => void remove(image)}>删除</button></span>}</div></article>)}</div>}
      {error && <div className="inline-alert" role="alert"><span>{error}</span>{retryAction && <button className="text-button" type="button" disabled={busy} onClick={retryAction}>重试</button>}</div>}
    </section>
  );
}

function NewProductImagePanel({
  files,
  disabled,
  error,
  onChange,
}: {
  files: File[];
  disabled: boolean;
  error?: string;
  onChange: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const [selectionError, setSelectionError] = useState<string>();
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [files]);
  const select = (next: FileList | null) => {
    if (!next) return;
    const additions = Array.from(next);
    if (files.length + additions.length > 10) {
      setSelectionError("主商品最多可上传 10 张图片。");
      return;
    }
    if (additions.some((file) => !["image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024)) {
      setSelectionError("仅可选择不超过 5 MiB 的 JPEG 或 PNG 图片。");
      return;
    }
    setSelectionError(undefined);
    onChange([...files, ...additions]);
  };
  useEffect(() => {
    if (error) selectButton.current?.focus();
  }, [error]);
  const displayedError = selectionError ?? error;
  return <section className="detail-card product-master-section" id="product-images" aria-labelledby="product-images-title">
    <div className="table-heading"><div><h2 id="product-images-title">商品图片（必填）</h2><p>至少选择 1 张清晰图片；第 1 张将作为主图。</p></div><input ref={input} className="sr-only" type="file" aria-label="选择主商品图片文件" accept="image/jpeg,image/png" multiple onChange={(event) => { select(event.currentTarget.files); event.currentTarget.value = ""; }} /><button ref={selectButton} className="button button-secondary" type="button" disabled={disabled} aria-invalid={Boolean(displayedError)} aria-describedby={displayedError ? "new-product-images-error" : previews.length === 0 ? "new-product-images-help" : undefined} onClick={() => input.current?.click()}>选择图片</button></div>
    {displayedError && <div className="inline-alert" id="new-product-images-error" role="alert">{displayedError}</div>}
    {previews.length === 0 ? <div className="compact-empty-state" id="new-product-images-help"><strong>尚未选择商品图片</strong><span>支持 JPEG 或 PNG，单张不超过 5 MiB，最多 10 张。</span></div> : <div className="product-image-grid">{previews.map(({ file, url }, index) => <article key={`${file.name}:${file.lastModified}:${index}`} className="product-image-card"><div className="product-image-preview"><img src={url} alt={`待上传商品图片 ${index + 1}`} /></div><div><strong>{index === 0 ? "主图" : "商品图片"}</strong><small>{file.name} · {Math.ceil(file.size / 1024)} KiB</small><button className="text-button" type="button" disabled={disabled} onClick={() => onChange(files.filter((_, candidate) => candidate !== index))}>移除</button></div></article>)}</div>}
  </section>;
}

function ProductSkuPanel({
  spu,
  canWrite,
  canReadWarehouses,
  search,
}: {
  spu: ProductSpu;
  canWrite: boolean;
  canReadWarehouses: boolean;
  search: string;
}) {
  const router = useRouter();
  const request = useRef(0);
  const linkRequest = useRef(0);
  const params = new URLSearchParams(search);
  const rawSelectedSkuId = params.get("skuId");
  const selectedSkuId =
    rawSelectedSkuId && isUuid(rawSelectedSkuId)
      ? rawSelectedSkuId.toLowerCase()
      : undefined;
  const status = queryStatus(params.get("skuStatus"));
  const keyword = (params.get("skuKeyword") ?? "").trim().slice(0, 100);
  const page = boundedSkuPage(params.get("skuPage"));
  const size = boundedSkuSize(params.get("skuSize"));
  const [state, setState] = useState<LoadState<Page<ProductSku>>>({
    status: "loading",
  });
  const [editor, setEditor] = useState<ProductEditor | null>(null);
  const [linkKeyword, setLinkKeyword] = useState("");
  const [linkPage, setLinkPage] = useState(0);
  const [linkCandidates, setLinkCandidates] = useState<LoadState<Page<ProductSku>> | { status: "idle" }>({ status: "idle" });
  const [linkBusy, setLinkBusy] = useState(false);
  const [parentThumbnailUrl, setParentThumbnailUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void productCenterApi.listSpuImages(spu.id).then(async (images) => {
      const image = images.find((candidate) => candidate.primary) ?? images[0];
      if (!image) return;
      objectUrl = URL.createObjectURL(await productCenterApi.getSpuImageBlob(spu.id, image.id));
      if (active) setParentThumbnailUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [spu.id]);

  const load = useCallback(async () => {
    const current = ++request.current;
    setState((previous) => ({
      status: "loading",
      data: "data" in previous ? previous.data : undefined,
    }));
    try {
      const result = await productCenterApi.listSkus({
        spuId: spu.id,
        status,
        keyword: keyword || undefined,
        page,
        size,
      });
      if (current === request.current) {
        setState({ status: "ready", data: result });
      }
    } catch (error) {
      if (current === request.current) {
        setState({
          status: "error",
          message: safeProductMessage(error, "读取子 SKU 列表"),
        });
      }
    }
  }, [keyword, page, size, spu.id, status]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (
      state.status !== "ready" ||
      !selectedSkuId ||
      !state.data.items.some((sku) => sku.id === selectedSkuId)
    ) {
      return;
    }
    const timer = window.setTimeout(
      () => document.getElementById(`product-sku-row-${selectedSkuId}`)?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [selectedSkuId, state]);

  const updateSkuQuery = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(masterListPath(search).split("?", 2)[1]);
    if (params.get("mode") === "edit") next.set("mode", "edit");
    if (selectedSkuId) next.set("skuId", selectedSkuId);
    if (status) next.set("skuStatus", status);
    if (keyword) next.set("skuKeyword", keyword);
    if (page > 0) next.set("skuPage", String(page));
    if (size !== DEFAULT_SKU_PAGE_SIZE) next.set("skuSize", String(size));
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    router.history.push(`/products/master/${encodeURIComponent(spu.id)}?${next.toString()}`);
  };

  useEffect(() => () => {
    linkRequest.current += 1;
  }, []);

  const findLinkCandidates = async (nextPage: number) => {
    const normalized = linkKeyword.trim();
    if (!normalized) return;
    const current = ++linkRequest.current;
    setLinkPage(nextPage);
    setLinkCandidates({ status: "loading" });
    try {
      const result = await productCenterApi.listSkus({
        keyword: normalized,
        status: "ACTIVE",
        page: nextPage,
        size: LINK_SKU_PAGE_SIZE,
      });
      if (current !== linkRequest.current) return;
      if (result.page !== nextPage || result.size !== LINK_SKU_PAGE_SIZE) {
        throw new Error("关联候选分页响应与请求不一致。");
      }
      setLinkCandidates({ status: "ready", data: {
        ...result,
        items: result.items.filter((sku) => sku.spuId !== spu.id),
      } });
    } catch (reason) {
      if (current === linkRequest.current) {
        setLinkCandidates({ status: "error", message: safeProductMessage(reason, "搜索可关联子 SKU") });
      }
    }
  };
  const linkSku = async (sku: ProductSku) => {
    if (linkBusy || !window.confirm(`将 ${sku.businessCode} 关联到当前主商品？该操作不会修改库存 SKU 身份或库存余额。`)) return;
    setLinkBusy(true);
    try {
      await productCenterApi.reassignSku(sku.id, spu.id, sku.version);
      linkRequest.current += 1;
      setLinkCandidates({ status: "idle" });
      setLinkKeyword("");
      setLinkPage(0);
      void load();
    } catch (reason) {
      setLinkCandidates({ status: "error", message: safeProductMessage(reason, "关联子 SKU") });
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <>
      {canWrite && spu.status === "ACTIVE" && <section className="detail-card product-master-section" aria-labelledby="link-sku-title"><div className="table-heading"><div><h2 id="link-sku-title">关联已有子 SKU</h2><p>按库存 SKU 编码或名称搜索并关联；仅可关联本企业的启用 SKU。</p></div></div><div className="product-filters"><label>库存 SKU<input value={linkKeyword} maxLength={100} onChange={(event) => { linkRequest.current += 1; setLinkKeyword(event.target.value); setLinkPage(0); setLinkCandidates({ status: "idle" }); }} /></label><button className="button button-secondary" type="button" disabled={!linkKeyword.trim() || linkBusy || linkCandidates.status === "loading"} onClick={() => void findLinkCandidates(0)}>搜索</button></div>{linkCandidates.status === "loading" && <p className="product-state" aria-busy="true">正在搜索库存 SKU…</p>}{linkCandidates.status === "error" && <div className="inline-alert" role="alert">{linkCandidates.message}<button type="button" disabled={linkBusy} onClick={() => void findLinkCandidates(linkPage)}>重试</button></div>}{linkCandidates.status === "ready" && <>{linkCandidates.data.items.length === 0 ? <div className="compact-empty-state"><span>当前页未找到可关联的启用库存 SKU。</span></div> : <div className="shop-table-scroll"><table className="shop-table"><thead><tr><th>库存 SKU</th><th>名称</th><th>规格</th><th>操作</th></tr></thead><tbody>{linkCandidates.data.items.map((sku) => <tr key={sku.id}><td><code>{sku.businessCode}</code></td><td>{sku.name}</td><td>{sku.variantSummary ?? "—"}</td><td><button className="text-button" type="button" disabled={linkBusy} onClick={() => void linkSku(sku)}>关联</button></td></tr>)}</tbody></table></div>}{linkCandidates.data.totalPages > 1 && <nav className="pagination" aria-label="可关联子 SKU 分页"><span>第 {linkPage + 1} / {linkCandidates.data.totalPages} 页</span><div><button type="button" disabled={linkBusy || linkPage === 0} onClick={() => void findLinkCandidates(linkPage - 1)}>上一页</button><button type="button" disabled={linkBusy || linkPage + 1 >= linkCandidates.data.totalPages} onClick={() => void findLinkCandidates(linkPage + 1)}>下一页</button></div></nav>}</>}</section>}
      <SkuSection
        state={state}
        sectionId="child-skus"
        selectedSpuId={spu.id}
        selectedSkuId={selectedSkuId}
        title="子 SKU"
        description={
          spu.status === "ACTIVE"
            ? "可在当前页面新增、编辑、启停或归档子 SKU。"
            : "当前主商品未启用，不能新增子 SKU。"
        }
        canWrite={canWrite}
        canCreate={canWrite && spu.status === "ACTIVE"}
        canWriteListings={false}
        canReadListingShops={false}
        status={status}
        keyword={keyword}
        onFilter={(nextStatus, nextKeyword) =>
          updateSkuQuery({ skuStatus: nextStatus, skuKeyword: nextKeyword, skuPage: 0 })
        }
        onEdit={(item, action) => {
          updateSkuQuery({ skuId: item.id });
          setEditor({ kind: "sku", action, item });
        }}
        onCreate={() => setEditor({ kind: "sku", action: "create" })}
        onMap={() => undefined}
        onRetry={() => void load()}
        onPageChange={(skuPage) => updateSkuQuery({ skuPage })}
        parentThumbnailUrl={parentThumbnailUrl}
      />
      {editor && (
        <ProductWriteDialog
          editor={editor}
          selectedSpuId={spu.id}
          availableSkus={state.status === "ready" ? state.data.items : []}
          canReadSkuWarehouses={canReadWarehouses}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            if ("spuId" in saved) updateSkuQuery({ skuId: saved.id });
            void load();
          }}
        />
      )}
    </>
  );
}

export function ProductMasterDataPage({
  spuId,
  initialMode,
}: {
  spuId?: string;
  initialMode?: "edit";
}) {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const isNew = !spuId;
  const canRead = hasPermission("products.read");
  const canWrite = hasPermission("products.write");
  const canReadMasterData = hasPermission("products.master_data.read");
  const canReadWarehouses = hasPermission("warehouses.read");
  const [editing, setEditing] = useState(isNew || initialMode === "edit");
  const [initialSkus, setInitialSkus] = useState<InitialSkuDraft[]>([]);
  const [draftImages, setDraftImages] = useState<File[]>([]);
  const draftThumbnailUrl = useMemo(
    () => draftImages[0] ? URL.createObjectURL(draftImages[0]) : undefined,
    [draftImages],
  );
  useEffect(
    () => () => { if (draftThumbnailUrl) URL.revokeObjectURL(draftThumbnailUrl); },
    [draftThumbnailUrl],
  );
  const nextInitialSkuId = useRef(1);
  const [state, setState] = useState<LoadState<ProductSpu> | { status: "new" }>(
    isNew ? { status: "new" } : { status: "loading" },
  );
  const [values, setValues] = useState<FormValues>(() => formValues());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [imageError, setImageError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [categories, setCategories] = useState<LoadState<ProductCategory[]>>({
    status: "loading",
  });
  const [packageMaterials, setPackageMaterials] = useState<
    LoadState<ProductPackageMaterial[]>
  >({ status: "loading" });
  const [warehouses, setWarehouses] = useState<LoadState<Warehouse[]>>({
    status: "loading",
  });
  const [masterDataManager, setMasterDataManager] = useState<
    "category" | "package" | undefined
  >();
  const [referenceVersion, setReferenceVersion] = useState(0);
  const [warehouseVersion, setWarehouseVersion] = useState(0);
  const request = useRef(0);
  const referenceRequest = useRef(0);
  const savingRef = useRef(false);
  const bypassBlock = useRef(false);
  const validSpuId = Boolean(spuId && isUuid(spuId));

  useBlocker({
    shouldBlockFn: () =>
      dirty && !bypassBlock.current && !window.confirm("当前修改尚未保存，确定离开吗？"),
    enableBeforeUnload: () => dirty,
  });

  const updateValue = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (key !== "status") {
      const field = key as FormField;
      setFieldErrors((previous) => {
        if (!previous[field]) return previous;
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
    setDirty(true);
  };

  const applySpu = useCallback((spu: ProductSpu) => {
    setState({ status: "ready", data: spu });
    setValues(formValues(spu));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    if (!spuId || !validSpuId || !canRead) return;
    const current = ++request.current;
    setState({ status: "loading" });
    setError(undefined);
    try {
      const spu = await productCenterApi.getSpu(spuId);
      if (current === request.current) applySpu(spu);
    } catch (reason) {
      if (current === request.current) {
        setState({ status: "error", message: safeProductMessage(reason, "读取主商品") });
      }
    }
  }, [applySpu, canRead, spuId, validSpuId]);

  useEffect(() => {
    if (isNew || !validSpuId || !canRead) return;
    void load();
    return () => {
      request.current += 1;
    };
  }, [canRead, isNew, load, validSpuId]);

  useEffect(() => {
    const current = ++referenceRequest.current;
    if (!canReadMasterData) {
      const message = "当前账号没有读取商品类目与包装资料目录的权限。";
      setCategories({ status: "error", message });
      setPackageMaterials({ status: "error", message });
      return;
    }
    setCategories({ status: "loading" });
    setPackageMaterials({ status: "loading" });
    void Promise.all([
      loadAllMasterData((page) => productCenterApi.listCategories({ page, size: 200 })),
      loadAllMasterData((page) => productCenterApi.listPackageMaterials({ page, size: 200 })),
    ]).then(
      ([categoryItems, materialItems]) => {
        if (current !== referenceRequest.current) return;
        setCategories({ status: "ready", data: categoryItems });
        setPackageMaterials({ status: "ready", data: materialItems });
      },
      () => {
        if (current !== referenceRequest.current) return;
        const message = "商品主数据目录暂时无法读取，请稍后重试。";
        setCategories({ status: "error", message });
        setPackageMaterials({ status: "error", message });
      },
    );
    return () => {
      referenceRequest.current += 1;
    };
  }, [canReadMasterData, referenceVersion]);

  useEffect(() => {
    if (!canReadWarehouses) {
      setWarehouses({ status: "error", message: "当前账号没有读取仓库目录的权限。" });
      return;
    }
    let active = true;
    setWarehouses({ status: "loading" });
    void loadAllMasterData((page) => warehouseCenterApi.listWarehouses({
      status: "ACTIVE", page, size: 200,
    })).then(
      (items) => { if (active) setWarehouses({ status: "ready", data: items }); },
      () => { if (active) setWarehouses({ status: "error", message: "仓库目录暂时无法读取，请稍后重试。" }); },
    );
    return () => { active = false; };
  }, [canReadWarehouses, warehouseVersion]);

  const navigate = useCallback((path: string) => {
    bypassBlock.current = true;
    router.history.push(path);
    window.setTimeout(() => {
      bypassBlock.current = false;
    }, 0);
  }, [router.history]);

  const returnToList = () => {
    if (dirty && !window.confirm("当前修改尚未保存，确定返回主商品列表吗？")) return;
    setDirty(false);
    navigate(masterListPath(search));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !editing || savingRef.current) return;
    const localErrors = validateForm(values, isNew);
    const initialCodes = new Set<string>();
    let initialSkuError: string | undefined;
    for (const [index, sku] of initialSkus.entries()) {
      const code = sku.businessCode.trim().toUpperCase();
      const rowLabel = `第 ${index + 1} 行子 SKU`;
      const costCurrencyError = optionalAmountCurrencyError(
        sku.unitCost,
        sku.currencyCode,
        "成本价",
      );
      if (costCurrencyError) {
        initialSkuError = `${rowLabel}：${costCurrencyError}`;
        break;
      }
      if (!BUSINESS_CODE_PATTERN.test(code) || !sku.name.trim()
        || sku.name.trim().length > 200 || sku.nameEn.trim().length > 200
        || sku.variantSummary.trim().length > 1000
        || (sku.unitCost.trim() !== "" && !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,4})?$/.test(sku.unitCost.trim()))
        || (sku.defaultWarehouseId !== "" && !isUuid(sku.defaultWarehouseId))) {
        initialSkuError = `${rowLabel}：请检查编码、名称、成本价和默认仓库。`;
        break;
      }
      if (initialCodes.has(code)) {
        initialSkuError = `${rowLabel}：库存 SKU 编码不可重复。`;
        break;
      }
      initialCodes.add(code);
    }
    if (initialSkuError) {
      setError(initialSkuError);
      return;
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setError("请检查标记字段后再保存主商品。");
      return;
    }
    if (isNew && draftImages.length === 0) {
      setImageError("请至少选择 1 张商品图片后再保存主商品。");
      setError(undefined);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    setImageError(undefined);
    setFieldErrors({});
    const input = {
      businessCode: values.businessCode.trim(),
      name: values.nameZh.trim(),
      nameZh: values.nameZh.trim(),
      nameEn: trimOptional(values.nameEn),
      brandName: trimOptional(values.brandName),
      productNote: trimOptional(values.productNote),
      categoryId: selectedId(values.categoryId),
      lengthMm: optionalPositiveInteger(values.lengthMm, 1_000_000) ?? undefined,
      widthMm: optionalPositiveInteger(values.widthMm, 1_000_000) ?? undefined,
      heightMm: optionalPositiveInteger(values.heightMm, 1_000_000) ?? undefined,
      actualWeightGrams:
        optionalPositiveInteger(values.actualWeightGrams, 1_000_000_000) ?? undefined,
      volumetricDivisor: Number(values.volumetricDivisor) as 5000 | 6000,
      packageMaterialId: selectedId(values.packageMaterialId),
      packageableCount:
        optionalPositiveInteger(values.packageableCount, 1_000_000) ?? undefined,
      sensitiveAttributeCodes: values.sensitiveAttributeCodes,
      initialSkus: isNew
        ? initialSkus.map((sku) => ({
            businessCode: sku.businessCode.trim().toUpperCase(),
            name: sku.name.trim(),
            nameEn: trimOptional(sku.nameEn),
            variantSummary: trimOptional(sku.variantSummary),
            unitCost: trimOptional(sku.unitCost),
            currencyCode: trimOptional(sku.currencyCode)?.toUpperCase(),
            defaultWarehouseId: selectedId(sku.defaultWarehouseId),
          }))
        : undefined,
    };
    try {
      if (isNew) {
        const created = await productCenterApi.createSpuWithImages(input, draftImages);
        setDirty(false);
        navigate(productMasterPagePath(created.id, search, true));
        return;
      }
      if (state.status !== "ready") return;
      const saved = await productCenterApi.updateSpu(state.data.id, {
        ...input,
        status: values.status,
        version: state.data.version,
      });
      applySpu(saved);
      setEditing(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && spuId) {
        try {
          const latest = await productCenterApi.getSpu(spuId);
          setState({ status: "ready", data: latest });
          setError(safeProductMessage(reason, "保存主商品"));
        } catch (refreshError) {
          setError(safeProductMessage(refreshError, "刷新冲突的主商品"));
        }
      } else {
        const errors = validationErrors(reason);
        setFieldErrors(errors);
        setError(saveProductMessage(reason, isNew, Object.keys(errors).length > 0));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!spu || !canWrite || savingRef.current || spu.status === "ARCHIVED") return;
    if (!window.confirm("归档主商品前必须先归档全部子 SKU，归档不会级联执行。确定继续吗？")) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const archived = await productCenterApi.archiveSpu(spu.id, spu.version);
      applySpu(archived);
      setEditing(false);
      navigate(productMasterPagePath(archived.id, search));
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        try {
          const latest = await productCenterApi.getSpu(spu.id);
          setState({ status: "ready", data: latest });
        } catch {
          // Preserve the existing local form values even when the conflict refresh cannot complete.
        }
      }
      setError(safeProductMessage(reason, "归档主商品"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!canRead) {
    return <section className="product-master-page"><div className="compact-empty-state" role="alert"><strong>暂无访问权限</strong><span>需要商品查看权限后才能查看主商品资料。</span></div></section>;
  }
  if (!isNew && !validSpuId) {
    return <section className="product-master-page"><div className="compact-empty-state" role="alert"><strong>主商品地址无效</strong><button className="text-button" type="button" onClick={returnToList}>返回主商品列表</button></div></section>;
  }
  if (!isNew && state.status === "loading") {
    return <section className="product-master-page"><p className="product-state" aria-busy="true">正在加载主商品资料…</p></section>;
  }
  if (!isNew && state.status === "error") {
    return <section className="product-master-page"><div className="compact-empty-state" role="alert"><strong>无法显示主商品资料</strong><span>{state.message}</span><button className="text-button" type="button" onClick={() => void load()}>重试</button><button className="text-button" type="button" onClick={returnToList}>返回主商品列表</button></div></section>;
  }

  const spu = state.status === "ready" ? state.data : undefined;
  const readOnly = !canWrite || !editing || spu?.status === "ARCHIVED";
  const canWriteMasterData = hasPermission("products.master_data.write");
  const dimensionalWeight = (() => {
    const dimensions = [values.lengthMm, values.widthMm, values.heightMm].map((value) =>
      optionalPositiveInteger(value, 1_000_000),
    );
    if (dimensions.some((value) => value === null || value === undefined)) return undefined;
    const [length, width, height] = dimensions as number[];
    const volumeCubicCentimeters = (length * width * height) / 1_000;
    const kilograms = volumeCubicCentimeters / Number(values.volumetricDivisor);
    return { volumeCubicCentimeters, kilograms };
  })();
  const toggleSensitiveAttribute = (code: SensitiveAttributeCode, checked: boolean) => {
    const selected = checked
      ? sensitiveAttributeCodes.filter((candidate) =>
          values.sensitiveAttributeCodes.includes(candidate) || candidate === code,
        )
      : values.sensitiveAttributeCodes.filter((candidate) => candidate !== code);
    updateValue("sensitiveAttributeCodes", selected);
  };
  const changeInitialSkus = (update: (items: InitialSkuDraft[]) => InitialSkuDraft[]) => {
    setDirty(true);
    setInitialSkus(update);
  };
  const warehouseOptions = warehouses.status === "ready" ? warehouses.data : [];

  return (
    <section className="product-master-page" aria-labelledby="product-master-title">
      <h1 className="sr-only" id="product-master-title">
        {isNew ? "新增主商品" : editing ? "编辑主商品" : "主商品详情"}
      </h1>
      {!isNew && canWrite && !editing && spu && spu.status !== "ARCHIVED" && (
        <header className="product-master-header">
          <button className="button button-primary" type="button" onClick={() => {
            setEditing(true);
            navigate(productMasterPagePath(spu.id, search, true));
          }}>编辑主商品</button>
        </header>
      )}

      <div className="product-master-layout">
        <nav className="product-master-sections" aria-label="主商品建档区段">
          <a href="#basic-information">基本信息</a>
          <a href="#additional-information">辅助信息</a>
          <a href="#product-images">商品图片</a>
          <a href="#child-skus">子 SKU</a>
        </nav>
        <div className="product-master-form">
          <form id="product-master-form" onSubmit={submit}>
          <section className="detail-card product-master-section" id="basic-information" aria-labelledby="basic-information-title">
            <h2 id="basic-information-title">基本信息</h2>
            <div className="product-master-grid">
              <div><label>主 SKU<input name="businessCode" required pattern="[A-Z][A-Z0-9_-]{1,63}" maxLength={64} value={values.businessCode} onChange={(event) => updateValue("businessCode", event.target.value.toUpperCase())} disabled={readOnly || !isNew} aria-invalid={Boolean(fieldErrors.businessCode)} aria-describedby={fieldErrors.businessCode ? "businessCode-error" : undefined} /></label><small>2–64 位大写字母、数字、_ 或 -；首位为字母。</small>{fieldErrors.businessCode && <small className="field-error" id="businessCode-error">{fieldErrors.businessCode}</small>}</div>
              <label>中文名称<input name="nameZh" required maxLength={200} value={values.nameZh} onChange={(event) => updateValue("nameZh", event.target.value)} disabled={readOnly} aria-invalid={Boolean(fieldErrors.nameZh)} aria-describedby={fieldErrors.nameZh ? "nameZh-error" : undefined} />{fieldErrors.nameZh && <small className="field-error" id="nameZh-error">{fieldErrors.nameZh}</small>}</label>
              <label>英文名称<input name="nameEn" maxLength={200} value={values.nameEn} onChange={(event) => updateValue("nameEn", event.target.value)} disabled={readOnly} aria-invalid={Boolean(fieldErrors.nameEn)} aria-describedby={fieldErrors.nameEn ? "nameEn-error" : undefined} />{fieldErrors.nameEn && <small className="field-error" id="nameEn-error">{fieldErrors.nameEn}</small>}</label>
              <label>品牌名称<input name="brandName" maxLength={160} value={values.brandName} onChange={(event) => updateValue("brandName", event.target.value)} disabled={readOnly} aria-invalid={Boolean(fieldErrors.brandName)} aria-describedby={fieldErrors.brandName ? "brandName-error" : undefined} />{fieldErrors.brandName && <small className="field-error" id="brandName-error">{fieldErrors.brandName}</small>}</label>
              <div><label>商品类目<select name="categoryId" value={values.categoryId} onChange={(event) => updateValue("categoryId", event.target.value)} disabled={readOnly || categories.status !== "ready"} aria-invalid={Boolean(fieldErrors.categoryId)} aria-describedby={fieldErrors.categoryId ? "categoryId-error" : undefined}><option value="">未选择</option>{categories.status === "ready" && categories.data.map((category) => <option key={category.id} value={category.id} disabled={category.status !== "ACTIVE" && category.id !== values.categoryId}>{category.name}{category.status === "ACTIVE" ? "" : `（${category.status === "INACTIVE" ? "已停用" : "已归档"}）`}</option>)}</select></label>{categories.status === "loading" && <small>正在加载类目目录…</small>}{categories.status === "error" && <small className="field-error">{categories.message}<button className="text-button" type="button" onClick={() => setReferenceVersion((version) => version + 1)}>重试</button></small>}{canReadMasterData && <button className="text-button" type="button" onClick={() => setMasterDataManager("category")}>管理商品目录</button>}{fieldErrors.categoryId && <small className="field-error" id="categoryId-error">{fieldErrors.categoryId}</small>}</div>
              {!isNew && spu?.status !== "ARCHIVED" && <label>状态<select name="status" value={values.status} onChange={(event) => updateValue("status", event.target.value as ProductStatus)} disabled={readOnly}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}
            </div>
            <label>商品备注<textarea name="productNote" maxLength={2000} value={values.productNote} onChange={(event) => updateValue("productNote", event.target.value)} disabled={readOnly} aria-invalid={Boolean(fieldErrors.productNote)} aria-describedby={fieldErrors.productNote ? "productNote-error" : undefined} />{fieldErrors.productNote && <small className="field-error" id="productNote-error">{fieldErrors.productNote}</small>}</label>
          </section>

          <section className="detail-card product-master-section" id="additional-information" aria-labelledby="additional-information-title">
            <h2 id="additional-information-title">辅助信息</h2>
            <fieldset disabled={readOnly}>
              <legend>尺寸与重量</legend>
              <div className="product-master-grid">
                <label>长（毫米）<input name="lengthMm" inputMode="numeric" value={values.lengthMm} onChange={(event) => updateValue("lengthMm", event.target.value)} aria-invalid={Boolean(fieldErrors.lengthMm)} /></label>
                <label>宽（毫米）<input name="widthMm" inputMode="numeric" value={values.widthMm} onChange={(event) => updateValue("widthMm", event.target.value)} aria-invalid={Boolean(fieldErrors.widthMm)} /></label>
                <label>高（毫米）<input name="heightMm" inputMode="numeric" value={values.heightMm} onChange={(event) => updateValue("heightMm", event.target.value)} aria-invalid={Boolean(fieldErrors.heightMm)} /></label>
                <label>实际重量（克）<input name="actualWeightGrams" inputMode="numeric" value={values.actualWeightGrams} onChange={(event) => updateValue("actualWeightGrams", event.target.value)} aria-invalid={Boolean(fieldErrors.actualWeightGrams)} /></label>
                <label>体积重系数<select name="volumetricDivisor" value={values.volumetricDivisor} onChange={(event) => updateValue("volumetricDivisor", event.target.value as "5000" | "6000")}><option value="5000">5000</option><option value="6000">6000</option></select></label>
              </div>
              <p className="product-dimensional-weight" aria-live="polite">{dimensionalWeight ? <>体积：{new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(dimensionalWeight.volumeCubicCentimeters)} cm³；体积重：{new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(dimensionalWeight.kilograms)} kg。</> : "完整填写长、宽、高后自动计算体积与体积重。"}</p>
              {(fieldErrors.lengthMm || fieldErrors.widthMm || fieldErrors.heightMm) && <small className="field-error">{fieldErrorMessages.lengthMm}</small>}
              {fieldErrors.actualWeightGrams && <small className="field-error">{fieldErrors.actualWeightGrams}</small>}
            </fieldset>
            <fieldset disabled={readOnly}>
              <legend>商品包装资料</legend>
              <p>用于维护商品包装信息；实际发货包装请在 SKU 发货包装规则中设置。</p>
              <div className="product-master-grid">
                <div><label>包装资料<select name="packageMaterialId" value={values.packageMaterialId} onChange={(event) => updateValue("packageMaterialId", event.target.value)} disabled={readOnly || packageMaterials.status !== "ready"} aria-invalid={Boolean(fieldErrors.packageMaterialId)}><option value="">未选择</option>{packageMaterials.status === "ready" && packageMaterials.data.map((material) => <option key={material.id} value={material.id} disabled={material.status !== "ACTIVE" && material.id !== values.packageMaterialId}>{material.name}{material.status === "ACTIVE" ? "" : `（${material.status === "INACTIVE" ? "已停用" : "已归档"}）`}</option>)}</select></label>{packageMaterials.status === "loading" && <small>正在加载包装资料目录…</small>}{packageMaterials.status === "error" && <small className="field-error">{packageMaterials.message}<button className="text-button" type="button" onClick={() => setReferenceVersion((version) => version + 1)}>重试</button></small>}{canReadMasterData && <button className="text-button" type="button" onClick={() => setMasterDataManager("package")}>管理包装资料</button>}</div>
                <label>每包装件数<input name="packageableCount" inputMode="numeric" value={values.packageableCount} onChange={(event) => updateValue("packageableCount", event.target.value)} aria-invalid={Boolean(fieldErrors.packageableCount)} /></label>
              </div>
              {(fieldErrors.packageMaterialId || fieldErrors.packageableCount) && <small className="field-error">{fieldErrorMessages.packageMaterialId}</small>}
            </fieldset>
            <fieldset disabled={readOnly}>
              <legend>敏感属性</legend>
              <p>选择适用的敏感属性，用于发货与合规检查。</p>
              <div className="product-master-checkboxes" aria-invalid={Boolean(fieldErrors.sensitiveAttributeCodes)} aria-describedby={fieldErrors.sensitiveAttributeCodes ? "sensitiveAttributeCodes-error" : undefined}>
                {sensitiveAttributeCodes.map((code) => (
                  <label key={code}><input type="checkbox" checked={values.sensitiveAttributeCodes.includes(code)} onChange={(event) => toggleSensitiveAttribute(code, event.target.checked)} />{sensitiveAttributeLabels[code]}</label>
                ))}
              </div>
              {fieldErrors.sensitiveAttributeCodes && <small className="field-error" id="sensitiveAttributeCodes-error">{fieldErrors.sensitiveAttributeCodes}</small>}
            </fieldset>
          </section>
          {error && <div className="inline-alert" role="alert">{error}</div>}
          </form>

          {isNew ? <NewProductImagePanel files={draftImages} disabled={saving || readOnly} error={imageError} onChange={(files) => { setDirty(true); setImageError(undefined); setDraftImages(files); }} /> : spu ? <ProductImagePanel spu={spu} canWrite={canWrite} /> : null}

          {isNew ? (
            <section className="detail-card product-master-section" id="child-skus" aria-labelledby="child-skus-title">
              <div className="table-heading">
                <div><h2 id="child-skus-title">子 SKU</h2><p>为主商品维护不同规格的子 SKU。</p></div>
                <button className="text-button" type="button" disabled={readOnly} onClick={() => changeInitialSkus((items) => [...items, { clientId: nextInitialSkuId.current++, businessCode: "", name: "", nameEn: "", variantSummary: "", unitCost: "", currencyCode: "", defaultWarehouseId: "" }])}>新增子 SKU</button>
              </div>
              {initialSkus.length === 0 ? (
                <div className="compact-empty-state"><span>尚未添加子 SKU。可先保存主商品，或在此直接新增子 SKU 行后一起保存。</span></div>
              ) : <>
                <div className="shop-table-scroll"><table className="shop-table"><caption className="sr-only">待创建子 SKU</caption><thead><tr><th>缩略图</th><th>库存 SKU</th><th>商品名称</th><th>商品英文名</th><th>成本价 / 币种</th><th>默认仓库</th><th>规格</th><th>操作</th></tr></thead><tbody>{initialSkus.map((sku) => <tr key={sku.clientId}><td>{draftThumbnailUrl ? <img className="product-list-thumbnail" src={draftThumbnailUrl} alt="主商品图片" /> : <span className="product-list-thumbnail product-list-thumbnail-empty">暂无主商品图片</span>}</td><td><input aria-label={`子 SKU 编码 ${sku.clientId}`} required pattern="[A-Z][A-Z0-9_-]{1,63}" maxLength={64} value={sku.businessCode} disabled={readOnly} onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, businessCode: event.target.value.toUpperCase() } : item))} /></td><td><input aria-label={`子 SKU 名称 ${sku.clientId}`} required maxLength={200} value={sku.name} disabled={readOnly} onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, name: event.target.value } : item))} /></td><td><input aria-label={`子 SKU 英文名 ${sku.clientId}`} maxLength={200} value={sku.nameEn} disabled={readOnly} onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, nameEn: event.target.value } : item))} /></td><td><span className="inline-field initial-sku-cost-fields"><input aria-label={`子 SKU 成本价 ${sku.clientId}`} inputMode="decimal" value={sku.unitCost} disabled={readOnly} placeholder="成本价" onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, unitCost: event.target.value } : item))} /><CurrencyCodeInput aria-label={`子 SKU 成本币种 ${sku.clientId}`} listId={`initial-sku-currency-options-${sku.clientId}`} value={sku.currencyCode} disabled={readOnly} placeholder="币种" onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, currencyCode: event.target.value.toUpperCase() } : item))} /></span></td><td><select aria-label={`子 SKU 默认仓库 ${sku.clientId}`} value={sku.defaultWarehouseId} disabled={readOnly || warehouses.status !== "ready"} onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, defaultWarehouseId: event.target.value } : item))}><option value="">未选择</option>{warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></td><td><input aria-label={`子 SKU 规格 ${sku.clientId}`} maxLength={1000} value={sku.variantSummary} disabled={readOnly} onChange={(event) => changeInitialSkus((items) => items.map((item) => item.clientId === sku.clientId ? { ...item, variantSummary: event.target.value } : item))} /></td><td><button className="text-button" type="button" disabled={readOnly} onClick={() => changeInitialSkus((items) => items.filter((item) => item.clientId !== sku.clientId))}>移除</button></td></tr>)}</tbody></table></div>
                <small className="product-master-table-help">成本价非必填；填写成本价后请选择币种。可选择常用币种，或输入 ISO 三位代码。</small>
                {warehouses.status === "error" && <div className="inline-alert" role="alert">{warehouses.message}<button className="text-button" type="button" onClick={() => setWarehouseVersion((value) => value + 1)}>重试</button></div>}
              </>}
            </section>
          ) : spu ? (
            <ProductSkuPanel
              spu={spu}
              canWrite={canWrite}
              canReadWarehouses={canReadWarehouses}
              search={search}
            />
          ) : null}

          <footer className="product-master-actions">
            <button className="text-button" type="button" onClick={returnToList} disabled={saving}>取消</button>
            {spu && canWrite && spu.status !== "ARCHIVED" && <button className="text-button" type="button" onClick={() => void archive()} disabled={saving}>归档主商品</button>}
            {canWrite && editing && spu?.status !== "ARCHIVED" && <button className="button button-primary" type="submit" form="product-master-form" disabled={saving}>{saving ? "正在保存…" : "保存主商品"}</button>}
          </footer>
        </div>
      </div>
      {masterDataManager && <ProductMasterDataManager kind={masterDataManager} canWrite={canWriteMasterData} onClose={() => setMasterDataManager(undefined)} onChanged={() => setReferenceVersion((version) => version + 1)} />}
    </section>
  );
}

type ArchiveView = "counts" | "transfers" | "documents";

type ArchiveQuery = {
  tab: string;
  searchField: string;
  keyword: string;
  status: string;
  warehouse: string;
  originWarehouse: string;
  targetWarehouse: string;
  transport: string;
  documentType: string;
  customType: string;
  creator: string;
  start?: string;
  end?: string;
  minimum: string;
  maximum: string;
  showDetails: boolean;
  page: number;
  size: number;
};

const paths: Record<ArchiveView, string> = {
  counts: "/warehouses/counts",
  transfers: "/warehouses/transfers",
  documents: "/warehouses/documents",
};

const tabValues: Record<ArchiveView, readonly string[]> = {
  counts: [],
  transfers: ["RECEIPT", "SHIPMENT", "APPROVAL"],
  documents: ["INBOUND", "OUTBOUND"],
};

const searchFieldValues: Record<ArchiveView, readonly string[]> = {
  counts: ["BATCH", "SKU", "LOCATION", "REMARK", "OPERATOR"],
  transfers: ["BATCH", "SKU", "REMARK"],
  documents: ["DOCUMENT_NO", "SKU", "LOGISTICS_NO"],
};

const statusValues: Record<ArchiveView, readonly string[]> = {
  counts: ["", "REJECTED", "APPROVAL", "COMPLETED", "PENDING", "CANCELLED"],
  transfers: [""],
  documents: [""],
};

function boundedText(value: string | null, maximum = 100) {
  return (value ?? "").trim().slice(0, maximum);
}

function boundedDate(value: string | null) {
  const text = boundedText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function boundedPage(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedPageSize(value: string | null) {
  const parsed = Number(value);
  return [20, 50, 100, 200].includes(parsed) ? parsed : 50;
}

function allowedValue(
  value: string | null,
  allowed: readonly string[],
  fallback = "",
) {
  const text = boundedText(value, 40).toUpperCase();
  return allowed.includes(text) ? text : fallback;
}

export function parseWarehouseArchiveQuery(
  search: string,
  view: ArchiveView,
): ArchiveQuery {
  const params = new URLSearchParams(search);
  const start = boundedDate(params.get("start"));
  const candidateEnd = boundedDate(params.get("end"));
  return {
    tab: allowedValue(params.get("tab"), tabValues[view], tabValues[view][0] ?? ""),
    searchField: allowedValue(
      params.get("searchField"),
      searchFieldValues[view],
      searchFieldValues[view][0],
    ),
    keyword: boundedText(params.get("keyword")),
    status:
      view === "counts"
        ? allowedValue(params.get("status"), statusValues.counts)
        : boundedText(params.get("status"), 40),
    warehouse: boundedText(params.get("warehouse")),
    originWarehouse: boundedText(params.get("originWarehouse")),
    targetWarehouse: boundedText(params.get("targetWarehouse")),
    transport: allowedValue(
      params.get("transport"),
      ["", "UNSET", "LAND", "AIR", "SEA"],
    ),
    documentType: boundedText(params.get("documentType")),
    customType: boundedText(params.get("customType")),
    creator: boundedText(params.get("creator")),
    start,
    end: candidateEnd && (!start || candidateEnd >= start) ? candidateEnd : undefined,
    minimum: boundedText(params.get("minimum"), 30),
    maximum: boundedText(params.get("maximum"), 30),
    showDetails: params.get("showDetails") === "true",
    page: boundedPage(params.get("page")),
    size: boundedPageSize(params.get("size")),
  };
}

export function toWarehouseArchiveUrl(
  view: ArchiveView,
  query: Partial<ArchiveQuery>,
) {
  const params = new URLSearchParams();
  const entries: [keyof ArchiveQuery, string | boolean | number | undefined][] = [
    ["tab", query.tab],
    ["searchField", query.searchField],
    ["keyword", query.keyword],
    ["status", query.status],
    ["warehouse", query.warehouse],
    ["originWarehouse", query.originWarehouse],
    ["targetWarehouse", query.targetWarehouse],
    ["transport", query.transport],
    ["documentType", query.documentType],
    ["customType", query.customType],
    ["creator", query.creator],
    ["start", query.start],
    ["end", query.end],
    ["minimum", query.minimum],
    ["maximum", query.maximum],
    ["showDetails", query.showDetails],
    ["page", query.page],
    ["size", query.size],
  ];
  entries.forEach(([key, value]) => {
    if (value === true) params.set(key, "true");
    else if (typeof value === "string" && value) params.set(key, value);
    else if (key === "page" && typeof value === "number" && value > 0) params.set(key, String(value));
    else if (key === "size" && typeof value === "number" && value !== 50) params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `${paths[view]}?${serialized}` : paths[view];
}

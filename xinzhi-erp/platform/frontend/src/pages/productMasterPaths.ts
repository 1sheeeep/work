import { type ProductStatus } from "../modules/productCenterApi";

const statuses: ProductStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

export function masterListPath(search: string) {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams({ view: "master" });
  const status = source.get("status");
  const keyword = source.get("keyword")?.trim();
  const page = source.get("page");
  const size = source.get("size");
  if (status && statuses.includes(status as ProductStatus)) params.set("status", status);
  if (keyword) params.set("keyword", keyword.slice(0, 100));
  if (page && /^\d+$/.test(page)) params.set("page", page);
  if (size && /^\d+$/.test(size)) params.set("size", size);
  // Keep only the master list's filter/sort context. Child-SKU filters, edit
  // mode and unrelated module parameters must not leak into the return URL.
  for (const key of ["searchField", "categoryId", "creatorId", "createdFrom", "createdTo", "sortBy", "descending"]) {
    const value = source.get(key)?.trim().slice(0, 100);
    if (value) params.set(key, value);
  }
  return `/products?${params.toString()}`;
}

export function productMasterPagePath(
  id: string,
  search: string,
  editing = false,
) {
  const context = masterListPath(search).split("?", 2)[1];
  const params = new URLSearchParams(context);
  if (editing) params.set("mode", "edit");
  return `/products/master/${encodeURIComponent(id)}?${params.toString()}`;
}

export function productMasterNewPath(search: string) {
  const context = masterListPath(search).split("?", 2)[1];
  return `/products/master/new?${context}`;
}

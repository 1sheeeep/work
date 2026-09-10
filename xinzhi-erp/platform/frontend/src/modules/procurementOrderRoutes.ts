const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function procurementOrderId(value: string | null | undefined) {
  const result = (value ?? '').trim().slice(0, 36)
  return UUID_PATTERN.test(result) ? result : ''
}

export function toProcurementOrderDetailUrl(purchaseOrderId: string) {
  const detailId = procurementOrderId(purchaseOrderId)
  return detailId ? `/procurement/orders?${new URLSearchParams({ detailId }).toString()}` : '/procurement/orders'
}

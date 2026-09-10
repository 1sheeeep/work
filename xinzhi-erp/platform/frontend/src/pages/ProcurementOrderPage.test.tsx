import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ProcurementOrderPage, parseProcurementOrderQuery, toProcurementOrderDetailUrl, toProcurementOrderLedgerUrl, toProcurementOrderReceivingUrl, toProcurementOrderUrl } from './ProcurementOrderPage'

const state = vi.hoisted(() => ({
  search: '', push: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), createDirect: vi.fn(), review: vi.fn(), receive: vi.fn(), exportCsv: vi.fn(),
  plans: vi.fn(), skus: vi.fn(), warehouses: vi.fn(), locations: vi.fn(), suppliersForSku: vi.fn(),
  receipts: vi.fn(), returns: vi.fn(), returnableOrders: vi.fn(), createReturn: vi.fn(),
}))

const order = {
  purchaseOrderId: '11111111-1111-4111-8111-111111111111', purchaseNo: 'PO-20260802-ABC', status: 'PARTIALLY_RECEIVED' as const,
  supplierId: '33333333-3333-4333-8333-333333333333', supplierCode: 'SUP-1', supplierName: '供应商', supplierSkuCode: 'FACTORY-SKU-1',
  skuId: '44444444-4444-4444-8444-444444444444', skuCode: 'SKU-1', skuName: '商品', warehouseId: '55555555-5555-4555-8555-555555555555', warehouseCode: 'WH-1', warehouseName: '主仓',
  locationId: '66666666-6666-4666-8666-666666666666', locationCode: 'A-01', locationName: 'A区', quantity: 12, receivedQuantity: 5, orderedByDisplayName: 'Operator', reviewDecision: 'APPROVED' as const, reviewedByDisplayName: 'Reviewer', reviewedAt: '2026-08-02T10:30:00Z', version: 2, lastReceivedAt: '2026-08-02T11:00:00Z', createdAt: '2026-08-02T10:00:00Z', updatedAt: '2026-08-02T11:00:00Z',
}
const sku = { id: order.skuId, businessCode: order.skuCode, name: order.skuName }
const warehouse = { id: order.warehouseId, businessCode: order.warehouseCode, name: order.warehouseName }
const location = { id: order.locationId, warehouseId: order.warehouseId, businessCode: order.locationCode, name: order.locationName }
const supplier = { supplierId: order.supplierId, supplierCode: order.supplierCode, supplierName: order.supplierName, supplierSkuCode: order.supplierSkuCode, preferred: true, leadTimeDays: 7 }

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: state.push } }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: { searchStr: state.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => permission === 'procurement.write' || permission === 'suppliers.write' }) }))
vi.mock('../modules/procurementOrderApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementOrderApi')>()
  return { ...actual, procurementOrderApi: { ...actual.procurementOrderApi, list: state.list, get: state.get, create: state.create, createDirect: state.createDirect, review: state.review, receive: state.receive, suppliersForSku: state.suppliersForSku, exportCsv: state.exportCsv } }
})
vi.mock('../modules/procurementPlanApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementPlanApi')>()
  return { ...actual, procurementPlanApi: { ...actual.procurementPlanApi, list: state.plans, skus: state.skus, warehouses: state.warehouses, locations: state.locations } }
})
vi.mock('../modules/procurementReceiptApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementReceiptApi')>()
  return { ...actual, procurementReceiptApi: { ...actual.procurementReceiptApi, forOrder: state.receipts } }
})
vi.mock('../modules/procurementReturnApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementReturnApi')>()
  return { ...actual, procurementReturnApi: { ...actual.procurementReturnApi, list: state.returns, returnableOrders: state.returnableOrders, create: state.createReturn } }
})

beforeEach(() => {
  state.search = ''
  for (const value of Object.values(state)) if (typeof value === 'function' && 'mockReset' in value) value.mockReset()
  state.list.mockResolvedValue({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })
  state.get.mockResolvedValue(order); state.create.mockResolvedValue(order); state.createDirect.mockResolvedValue(order); state.review.mockResolvedValue({ ...order, status: 'APPROVED', version: 3 }); state.receive.mockResolvedValue({ ...order, receivedQuantity: 12, status: 'RECEIVED', version: 3 })
  state.plans.mockResolvedValue({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })
  state.skus.mockResolvedValue({ items: [sku], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  state.warehouses.mockResolvedValue({ items: [warehouse], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  state.locations.mockResolvedValue({ items: [location], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  state.suppliersForSku.mockResolvedValue({ items: [supplier], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  state.receipts.mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
  state.returns.mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
  state.returnableOrders.mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
  state.createReturn.mockResolvedValue({})
  state.exportCsv.mockResolvedValue({ filename: 'procurement-orders.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, content: '\uFEFF采购单号,状态\r\nPO-1,部分收货\r\n' })
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('procurement order page', () => {
  it('bounds query values and keeps historical deep links compatible', () => {
    expect(parseProcurementOrderQuery(`?searchField=UNKNOWN&keyword=${'A'.repeat(140)}&createdFrom=2026-99-99&page=-1&size=999`)).toEqual({
      searchField: 'PURCHASE_NO', keyword: 'A'.repeat(120), createPlanNo: '', detailId: '', status: '', createdFrom: '', createdTo: '', page: 0, size: 25,
    })
    expect(toProcurementOrderUrl({ searchField: 'SUPPLIER_NAME', keyword: ' 供货商 ', status: 'PARTIALLY_RECEIVED', createdFrom: '2026-08-01', page: 2, size: 50 })).toBe('/procurement/orders?searchField=SUPPLIER_NAME&keyword=%E4%BE%9B%E8%B4%A7%E5%95%86&status=PARTIALLY_RECEIVED&createdFrom=2026-08-01&page=2&size=50')
    expect(toProcurementOrderReceivingUrl(' PO / 1 ', order.purchaseOrderId)).toBe(`/procurement/receiving?code=PO+%2F+1&orderId=${order.purchaseOrderId}`)
    expect(toProcurementOrderLedgerUrl(' PO / 1 ')).toBe('/procurement/statistics/ledger?dimension=PURCHASE_ORDER&purchaseKeyword=PO+%2F+1')
    expect(toProcurementOrderDetailUrl(order.purchaseOrderId)).toBe(`/procurement/orders?detailId=${order.purchaseOrderId}`)
  })

  it('renders one procurement entry with status views and direct creation', async () => {
    render(<ProcurementOrderPage />)
    expect(screen.getByRole('heading', { name: '采购单' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '采购单状态视图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增采购单' })).not.toHaveProperty('disabled', true)
    expect(await screen.findByText('无相关采购单')).toBeTruthy()
    expect(screen.getByText('可通过“新增采购单”直接创建第一张采购单。')).toBeTruthy()
  })

  it('forwards the selected status and marks its view current', async () => {
    state.search = '?status=PARTIALLY_RECEIVED'
    render(<ProcurementOrderPage />)
    expect(screen.getByRole('button', { name: '部分收货' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(state.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'PARTIALLY_RECEIVED' })))
  })

  it('creates a purchase order directly from active references', async () => {
    render(<ProcurementOrderPage />)
    fireEvent.click(screen.getByRole('button', { name: '新增采购单' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '商品' }), { target: { value: order.skuId } })
    await waitFor(() => expect(state.suppliersForSku).toHaveBeenCalledWith(order.skuId, undefined, 0, 200))
    fireEvent.change(screen.getByRole('combobox', { name: '目标仓库' }), { target: { value: order.warehouseId } })
    await waitFor(() => expect(state.locations).toHaveBeenCalledWith(order.warehouseId, undefined, 0, 200))
    fireEvent.change(screen.getByRole('combobox', { name: '目标库位' }), { target: { value: order.locationId } })
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '创建采购单' }))
    await waitFor(() => expect(state.createDirect).toHaveBeenCalledWith(expect.objectContaining({ supplierId: order.supplierId, skuId: order.skuId, warehouseId: order.warehouseId, locationId: order.locationId, quantity: 12 })))
    expect(state.create).not.toHaveBeenCalled()
  })

  it('offers atomic supplier creation when a SKU has no sourcing relationship', async () => {
    state.suppliersForSku.mockResolvedValue({ items: [], page: 0, size: 200, totalElements: 0, totalPages: 0 })
    render(<ProcurementOrderPage />)
    fireEvent.click(screen.getByRole('button', { name: '新增采购单' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '商品' }), { target: { value: order.skuId } })
    expect(await screen.findByRole('button', { name: '新增并绑定供应商' })).toBeTruthy()
    expect(screen.getByText(/可使用“新增并绑定供应商”立即补齐/)).toBeTruthy()
  })

  it('shows stale reference recovery without exposing server text', async () => {
    state.createDirect.mockRejectedValue(new ApiError('private', { status: 409, details: { reason: 'purchase_reference_unavailable' } }))
    render(<ProcurementOrderPage />)
    fireEvent.click(screen.getByRole('button', { name: '新增采购单' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '商品' }), { target: { value: order.skuId } })
    fireEvent.change(screen.getByRole('combobox', { name: '目标仓库' }), { target: { value: order.warehouseId } })
    await waitFor(() => expect(screen.getByRole('option', { name: /A-01/ })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox', { name: '目标库位' }), { target: { value: order.locationId } })
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '创建采购单' }))
    expect(await screen.findByText('商品、供应商、仓库或库位资料已变化，请重新选择后再试。')).toBeTruthy()
    expect(screen.queryByText('private')).toBeNull()
  })

  it('approves a new order inside its detail instead of navigating away', async () => {
    const pending = { ...order, status: 'NEW_ORDER' as const, receivedQuantity: 0, reviewDecision: undefined, reviewedByDisplayName: undefined, reviewedAt: undefined, version: 0 }
    state.list.mockResolvedValue({ items: [pending], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    render(<ProcurementOrderPage />)
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: order.purchaseOrderId, expectedVersion: 0, approved: true })))
    expect(state.push).not.toHaveBeenCalledWith(expect.stringContaining('/procurement/reviews'))
  })

  it('approves a pending order directly from the list with confirmation', async () => {
    const pending = { ...order, status: 'NEW_ORDER' as const, receivedQuantity: 0, reviewDecision: undefined, reviewedByDisplayName: undefined, reviewedAt: undefined, version: 0 }
    state.list.mockResolvedValue({ items: [pending], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    render(<ProcurementOrderPage />)
    fireEvent.click(await screen.findByRole('button', { name: '通过' }))
    expect(screen.getByRole('dialog', { name: '通过采购单' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(state.review).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: pending.purchaseOrderId, expectedVersion: 0, approved: true })))
    expect(await screen.findByText('采购单已通过。')).toBeTruthy()
  })

  it('shows only state-appropriate row actions and keeps returns under more for partial receipts', async () => {
    const approved = { ...order, purchaseOrderId: '11111111-1111-4111-8111-111111111112', purchaseNo: 'PO-APPROVED', status: 'APPROVED' as const, receivedQuantity: 0 }
    const received = { ...order, purchaseOrderId: '11111111-1111-4111-8111-111111111113', purchaseNo: 'PO-RECEIVED', status: 'RECEIVED' as const, receivedQuantity: 12 }
    const rejected = { ...order, purchaseOrderId: '11111111-1111-4111-8111-111111111114', purchaseNo: 'PO-REJECTED', status: 'REJECTED' as const, receivedQuantity: 0 }
    state.list.mockResolvedValue({ items: [approved, order, received, rejected], page: 0, size: 25, totalElements: 4, totalPages: 1 })
    state.returnableOrders.mockResolvedValue({ items: [{ ...order, returnedQuantity: 0, returnableQuantity: order.receivedQuantity }], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    render(<ProcurementOrderPage />)
    expect(await screen.findByRole('button', { name: '确认收货' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '继续收货' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '退货' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '详情' })).toHaveLength(4)
    fireEvent.click(screen.getByText('更多'))
    fireEvent.click(screen.getByRole('button', { name: '发起退货' }))
    expect(await screen.findByRole('dialog', { name: '发起采购退货' })).toBeTruthy()
    expect(await screen.findByRole('spinbutton', { name: '数量' })).toHaveProperty('value', '5')
  })

  it('receives a partially received order inside its detail', async () => {
    state.list.mockResolvedValue({ items: [order], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    render(<ProcurementOrderPage />)
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))
    fireEvent.click(screen.getByRole('button', { name: '确认收货' }))
    expect(screen.queryByRole('textbox', { name: '备注（可选）' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(state.receive).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: order.purchaseOrderId, expectedVersion: 2, quantity: 7 })))
  })

  it('loads a canonical order directly from a validated detail link', async () => {
    state.search = `?detailId=${order.purchaseOrderId}`
    render(<ProcurementOrderPage />)
    expect(await screen.findByRole('dialog', { name: `采购单 ${order.purchaseNo}` })).toBeTruthy()
    expect(state.get).toHaveBeenCalledWith(order.purchaseOrderId)
  })

  it('exports the complete filtered result and announces success', async () => {
    state.search = '?searchField=SUPPLIER_NAME&keyword=Supplier&status=PARTIALLY_RECEIVED&createdFrom=2026-08-01&createdTo=2026-08-02'
    state.list.mockResolvedValue({ items: [order], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:orders'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ProcurementOrderPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect(state.exportCsv).toHaveBeenCalledWith({ status: 'PARTIALLY_RECEIVED', searchField: 'SUPPLIER_NAME', keyword: 'Supplier', createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-08-02T23:59:59.999Z' })
    expect(await screen.findByText('已导出 1 条采购单。')).toBeTruthy()
  })

  it('rejects an inverted order date range before navigation', async () => {
    render(<ProcurementOrderPage />)
    fireEvent.change(screen.getByLabelText('下单起始日期'), { target: { value: '2026-08-02' } }); fireEvent.change(screen.getByLabelText('下单截止日期'), { target: { value: '2026-08-01' } }); fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('alert').textContent).toContain('下单起始日期不能晚于截止日期'); expect(state.push).not.toHaveBeenCalled()
  })

  it('returns an obsolete page link to the last available order page', async () => {
    state.search = '?page=9&size=50'; state.list.mockResolvedValue({ items: [], page: 9, size: 50, totalElements: 51, totalPages: 2 })
    render(<ProcurementOrderPage />)
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/procurement/orders?page=1&size=50'))
  })
})

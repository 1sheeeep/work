import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcurementReturnPage, parseProcurementReturnQuery, toProcurementReturnUrl } from './ProcurementReturnPage'

const state = vi.hoisted(() => ({ search: '', push: vi.fn(), list: vi.fn(), references: vi.fn(), create: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: state.push } }),
  useRouterState: ({ select }: { select: (value: unknown) => unknown }) => select({ location: { searchStr: state.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => permission === 'procurement.write' }) }))
vi.mock('../modules/procurementReturnApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/procurementReturnApi')>()
  return { ...actual, procurementReturnApi: { ...actual.procurementReturnApi, list: state.list, returnableOrders: state.references, create: state.create } }
})

const order = {
  purchaseOrderId: '11111111-1111-4111-8111-111111111111', purchaseNo: 'PO-UAT-1', supplierCode: 'SUP-UAT', supplierName: '测试供应商',
  skuId: '22222222-2222-4222-8222-222222222222', skuCode: 'SKU-UAT', skuName: '测试商品', warehouseId: '33333333-3333-4333-8333-333333333333',
  warehouseCode: 'WH-UAT', warehouseName: '测试仓', locationId: '44444444-4444-4444-8444-444444444444', locationCode: 'A-01', locationName: '测试库位',
  receivedQuantity: 5, returnedQuantity: 0, returnableQuantity: 5, version: 2,
}
const returned = {
  purchaseReturnId: '55555555-5555-4555-8555-555555555555', returnNo: 'PR-UAT-1', purchaseOrderId: order.purchaseOrderId, purchaseNo: order.purchaseNo, planNo: 'PP-UAT-1',
  supplierId: '66666666-6666-4666-8666-666666666666', supplierCode: order.supplierCode, supplierName: order.supplierName, skuId: order.skuId, skuCode: order.skuCode, skuName: order.skuName,
  warehouseId: order.warehouseId, warehouseCode: order.warehouseCode, warehouseName: order.warehouseName, locationId: order.locationId, locationCode: order.locationCode, locationName: order.locationName,
  quantity: 2, reason: '到货破损', inventoryEventId: '77777777-7777-4777-8777-777777777777', inventoryLedgerSequence: 3, inventoryBalanceAfter: 23, returnedByDisplayName: '仓库员甲', returnedAt: '2026-08-09T14:00:00Z',
}

beforeEach(() => {
  state.search = ''; state.push.mockReset(); state.list.mockReset().mockResolvedValue({ items: [returned], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  state.references.mockReset().mockResolvedValue({ items: [order], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  state.create.mockReset().mockResolvedValue(returned)
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('88888888-8888-4888-8888-888888888888')
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe('procurement return page', () => {
  it('bounds and serializes supported filters', () => {
    expect(parseProcurementReturnQuery(`?searchField=UNKNOWN&keyword=${'A'.repeat(140)}&startDate=2026-02-30&endDate=2026-08-01&page=-1&size=500`)).toEqual({ searchField: 'RETURN_NO', keyword: 'A'.repeat(120), startDate: '', endDate: '2026-08-01', page: 1, size: 25 })
    expect(toProcurementReturnUrl({ searchField: 'SKU_CODE', keyword: ' SKU-01 ', startDate: '2026-07-01' })).toBe('/procurement/returns?searchField=SKU_CODE&keyword=SKU-01&startDate=2026-07-01')
  })

  it('loads persisted returns and creates a bounded stock return', async () => {
    render(<ProcurementReturnPage />)
    expect(await screen.findByText('PR-UAT-1')).toBeTruthy()
    expect(screen.getByText('退货后库存 23')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增采购退货单' }))
    expect(await screen.findByRole('combobox', { name: '采购单' })).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: '本次退货数量' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('textbox', { name: '退货原因' }), { target: { value: ' 到货破损 ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认退货并扣减库存' }))
    await waitFor(() => expect(state.create).toHaveBeenCalledWith({ commandId: '88888888-8888-4888-8888-888888888888', purchaseOrderId: order.purchaseOrderId, expectedOrderVersion: 2, quantity: 2, reason: '到货破损' }))
  })
})

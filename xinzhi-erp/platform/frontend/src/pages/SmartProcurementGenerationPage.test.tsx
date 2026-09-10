import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SmartProcurementGenerationPage, parseSmartProcurementQuery, toSmartProcurementUrl } from './SmartProcurementGenerationPage'

const routerState = vi.hoisted(() => ({ search: '', push: vi.fn() }))
const api = vi.hoisted(() => ({ list: vi.fn(), exportCsv: vi.fn(), generate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: routerState.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/procurementRecommendationApi', () => ({ procurementRecommendationApi: api }))

const page = {
  items: [{
    skuId: '11111111-1111-4111-8111-111111111111', skuCode: 'SKU-A', skuName: '商品 A', skuVariant: '黑色',
    warehouseId: '22222222-2222-4222-8222-222222222222', warehouseCode: 'WH-A', warehouseName: '主仓',
    onHand: 4, reserved: 1, available: 3, last28DaysSalesQuantity: 28, openPurchaseQuantity: 2,
    supplierId: '33333333-3333-4333-8333-333333333333', supplierCode: 'SUP-A', supplierName: '供应商 A',
    supplierSkuCode: 'A-1', supplierLeadTimeDays: 14, planningLeadTimeDays: 14, safetyDays: 7,
    targetCoverageDays: 21, targetStockQuantity: 21, recommendedQuantity: 16, activeLocationCount: 1,
  }],
  locations: [{ id: '44444444-4444-4444-8444-444444444444', warehouseId: '22222222-2222-4222-8222-222222222222', businessCode: 'RECEIVE', name: '收货区' }],
  totalElements: 1, actionableCount: 1, totalRecommendedQuantity: 16,
  salesWindowDays: 28, defaultLeadTimeDays: 28, safetyDays: 7,
  observedAt: '2026-08-11T05:00:00Z', page: 0, size: 25, totalPages: 1,
}

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  api.list.mockReset().mockResolvedValue(page)
  api.exportCsv.mockReset()
  api.generate.mockReset().mockResolvedValue({
    commandId: '55555555-5555-4555-8555-555555555555', observedAt: page.observedAt,
    items: [{ purchaseOrderId: '66666666-6666-4666-8666-666666666666', purchaseNo: 'PO-1', planId: '77777777-7777-4777-8777-777777777777', planNo: 'PP-1', skuId: page.items[0].skuId, warehouseId: page.items[0].warehouseId, locationId: page.locations[0].id, supplierId: page.items[0].supplierId, quantity: 16 }],
  })
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('55555555-5555-4555-8555-555555555555')
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('smart procurement generation', () => {
  it('bounds and serializes filters and paging', () => {
    expect(parseSmartProcurementQuery(`?supplier=%20%E4%BE%9B%E5%BA%94%E5%95%86A%20&keyword=${'A'.repeat(140)}&hideWithoutSupplier=true&hideZeroRecommendation=1&page=2&size=50`)).toEqual({
      supplier: '供应商A', keyword: 'A'.repeat(120), hideWithoutSupplier: true,
      hideZeroRecommendation: false, page: 2, size: 50,
    })
    expect(toSmartProcurementUrl({ supplier: ' 供应商A ', hideZeroRecommendation: true })).toBe(
      '/procurement/smart-generation?supplier=%E4%BE%9B%E5%BA%94%E5%95%86A&hideZeroRecommendation=true',
    )
  })

  it('shows explainable real recommendations and generates a purchase order', async () => {
    render(<SmartProcurementGenerationPage />)
    expect(await screen.findByRole('heading', { name: '补货建议' })).toBeTruthy()
    expect(await screen.findByRole('table', { name: '补货建议列表' })).toBeTruthy()
    expect(screen.getByText(/目标库存 = 近 28 天日均销量/)).toBeTruthy()
    expect(screen.getByText('SUP-A · 供应商 A')).toBeTruthy()
    expect(screen.getByLabelText('SKU-A 收货库位')).toHaveProperty('value', page.locations[0].id)
    expect(screen.getByLabelText('SKU-A 采购数量')).toHaveProperty('value', '16')

    fireEvent.click(screen.getByLabelText('选择 SKU-A WH-A'))
    fireEvent.click(screen.getByRole('button', { name: '生成采购单（1）' }))
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith({
      commandId: '55555555-5555-4555-8555-555555555555',
      observedAt: page.observedAt,
      items: [{
        skuId: page.items[0].skuId, warehouseId: page.items[0].warehouseId,
        locationId: page.locations[0].id, expectedRecommendedQuantity: 16, quantity: 16,
      }],
    }))
    expect(await screen.findByText('已生成 1 张采购单，当前状态为待审核。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看待审核采购单' })).toBeTruthy()
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  })

  it('keeps filter navigation URL-backed', async () => {
    render(<SmartProcurementGenerationPage />)
    await screen.findByRole('table', { name: '补货建议列表' })
    fireEvent.change(screen.getByLabelText('首选供应商'), { target: { value: ' 供应商A ' } })
    fireEvent.click(screen.getByLabelText('隐藏建议量为 0 的商品'))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(routerState.push).toHaveBeenCalledWith(
      '/procurement/smart-generation?supplier=%E4%BE%9B%E5%BA%94%E5%95%86A&hideZeroRecommendation=true',
    )
  })
})

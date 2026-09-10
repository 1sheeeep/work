import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ProcurementPlanPage, parseProcurementPlanQuery, toProcurementOrderForPlanUrl, toProcurementPlanUrl } from './ProcurementPlanPage'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const SKU_ID = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333'
const LOCATION_ID = '44444444-4444-4444-8444-444444444444'

const runtime = vi.hoisted(() => ({
  search: '', push: vi.fn(), permissions: new Set<string>(),
  list: vi.fn(), get: vi.fn(), create: vi.fn(), voidPlan: vi.fn(),
  exportCsv: vi.fn(),
  skus: vi.fn(), warehouses: vi.fn(), locations: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => runtime.permissions.has(permission) }) }))
vi.mock('../modules/procurementPlanApi', () => ({ procurementPlanApi: {
  list: runtime.list, get: runtime.get, create: runtime.create, void: runtime.voidPlan,
  exportCsv: runtime.exportCsv,
  skus: runtime.skus, warehouses: runtime.warehouses, locations: runtime.locations,
} }))

const plan = {
  id: PLAN_ID, planNo: 'PP-20260801-11111111', status: 'UNPURCHASED' as const, source: 'MANUAL' as const,
  skuId: SKU_ID, skuCode: 'SKU-1', skuName: '测试 SKU', skuVariant: '黑色',
  warehouseId: WAREHOUSE_ID, warehouseCode: 'WH-1', warehouseName: '主仓',
  locationId: LOCATION_ID, locationCode: 'LOC-1', locationName: '一号位', quantity: 12,
  note: '补货', applicantDisplayName: '申请人', createdAt: '2026-08-01T10:00:00Z',
  version: 0, updatedAt: '2026-08-01T10:00:00Z',
}

beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset(); runtime.permissions.clear()
  runtime.list.mockReset().mockResolvedValue({ items: [plan], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  runtime.get.mockReset().mockResolvedValue(plan)
  runtime.create.mockReset().mockResolvedValue(plan)
  runtime.voidPlan.mockReset().mockResolvedValue({ ...plan, status: 'VOIDED', version: 1, voidReason: '无需采购', voidedByDisplayName: '申请人', voidedAt: '2026-08-01T11:00:00Z' })
  runtime.exportCsv.mockReset().mockResolvedValue({ filename: 'procurement-plans.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1, content: '\uFEFF计划编号,状态\r\nPP-1,未采购\r\n' })
  runtime.skus.mockReset().mockResolvedValue({ items: [{ id: SKU_ID, businessCode: 'SKU-1', name: '测试 SKU', variantSummary: '黑色' }], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  runtime.warehouses.mockReset().mockResolvedValue({ items: [{ id: WAREHOUSE_ID, businessCode: 'WH-1', name: '主仓' }], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  runtime.locations.mockReset().mockResolvedValue({ items: [{ id: LOCATION_ID, warehouseId: WAREHOUSE_ID, businessCode: 'LOC-1', name: '一号位' }], page: 0, size: 200, totalElements: 1, totalPages: 1 })
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('procurement plan page', () => {
  it('keeps only canonical list filters in the URL', () => {
    expect(parseProcurementPlanQuery('?searchField=BUYER&keyword=%20abc%20&warehouseId=bad&status=PURCHASING&page=-1&size=500')).toEqual({
      searchField: 'PLAN_NO', keyword: 'abc', warehouseId: '', locationId: '', status: '', createdFrom: '', createdTo: '', page: 0, size: 25, detailId: '',
    })
    expect(toProcurementPlanUrl({ searchField: 'SKU_CODE', keyword: ' SKU-1 ', warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, status: 'VOIDED', createdFrom: '2026-07-01', createdTo: '2026-08-01', page: 2, size: 50, detailId: PLAN_ID })).toBe(`/procurement/plans?searchField=SKU_CODE&keyword=SKU-1&warehouseId=${WAREHOUSE_ID}&locationId=${LOCATION_ID}&status=VOIDED&createdFrom=2026-07-01&createdTo=2026-08-01&page=2&size=50&detailId=${PLAN_ID}`)
    expect(toProcurementOrderForPlanUrl(' PP / 1 ', true)).toBe('/procurement/orders?searchField=PLAN_NO&keyword=PP+%2F+1&createPlanNo=PP+%2F+1')
  })

  it('loads real rows for read-only users without mutation controls', async () => {
    runtime.permissions.add('procurement.read')
    render(<ProcurementPlanPage />)
    expect(await screen.findByText('PP-20260801-11111111')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增采购计划' })).toBeNull()
    expect(screen.queryByRole('button', { name: '作废' })).toBeNull()
    expect(screen.queryByText(/采购员|供应商|付款|签收|物流/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    expect(runtime.push).toHaveBeenCalledWith(`/procurement/plans?detailId=${PLAN_ID}`)
  })

  it('rejects an inverted application date range before navigation', async () => {
    runtime.permissions.add('procurement.read')
    render(<ProcurementPlanPage />)
    await screen.findByText('PP-20260801-11111111')
    fireEvent.change(screen.getByLabelText('申请日期从'), { target: { value: '2026-08-02' } })
    fireEvent.change(screen.getByLabelText('申请日期至'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('alert').textContent).toContain('申请起始日期不能晚于截止日期')
    expect(runtime.push).not.toHaveBeenCalled()
  })

  it('exports the complete filtered result and announces success', async () => {
    runtime.permissions.add('procurement.read')
    runtime.search = `?searchField=SKU_NAME&keyword=Product&warehouseId=${WAREHOUSE_ID}&locationId=${LOCATION_ID}&status=VOIDED&createdFrom=2026-08-01&createdTo=2026-08-02`
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:plans')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ProcurementPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect(runtime.exportCsv).toHaveBeenCalledWith({
      warehouseId: WAREHOUSE_ID, locationId: LOCATION_ID, status: 'VOIDED',
      searchField: 'SKU_NAME', keyword: 'Product',
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T23:59:59.999Z',
    })
    expect(await screen.findByText('已导出 1 条采购计划。')).toBeTruthy()
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalledTimes(1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:plans')
  })

  it('explains how to recover when a plan export is too large', async () => {
    runtime.permissions.add('procurement.read')
    runtime.exportCsv.mockRejectedValue(new ApiError('too many', { status: 409 }))
    render(<ProcurementPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: '导出筛选结果' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请缩小筛选范围后重试')
    expect(screen.getByRole('button', { name: '导出筛选结果' })).not.toHaveProperty('disabled', true)
  })

  it('returns an obsolete page link to the last available plan page', async () => {
    runtime.permissions.add('procurement.read'); runtime.search = '?page=9&size=50'
    runtime.list.mockResolvedValue({ items: [], page: 9, size: 50, totalElements: 51, totalPages: 2 })
    render(<ProcurementPlanPage />)
    await waitFor(() => expect(runtime.push).toHaveBeenCalledWith('/procurement/plans?page=1&size=50'))
  })

  it('keeps historical plans read-only for creation even when write is allowed', async () => {
    runtime.permissions.add('procurement.write')
    render(<ProcurementPlanPage />)
    expect(await screen.findByRole('heading', { name: '历史采购计划' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增采购计划' })).toBeNull()
    expect(runtime.create).not.toHaveBeenCalled()
  })

  it('retries locations used by the warehouse filter', async () => {
    runtime.permissions.add('procurement.read')
    runtime.search = `?warehouseId=${WAREHOUSE_ID}`
    runtime.locations.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [{ id: LOCATION_ID, warehouseId: WAREHOUSE_ID, businessCode: 'LOC-1', name: '一号位' }], page: 0, size: 200, totalElements: 1, totalPages: 1 })
    render(<ProcurementPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: '重试筛选库位' }))
    await waitFor(() => expect(runtime.locations).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('option', { name: 'LOC-1 · 一号位' })).toBeTruthy()
  })

  it('deep-links detail and voids only an unpurchased plan with its current version', async () => {
    runtime.permissions.add('procurement.write'); runtime.search = `?detailId=${PLAN_ID}`
    render(<ProcurementPlanPage />)
    expect(await screen.findByRole('dialog', { name: `采购计划 ${plan.planNo}` })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('作废原因'), { target: { value: '无需采购' } })
    fireEvent.click(screen.getByRole('button', { name: '作废计划' }))
    await waitFor(() => expect(runtime.voidPlan).toHaveBeenCalledWith(PLAN_ID, expect.objectContaining({ expectedVersion: 0, reason: '无需采购' })))
  })

  it('opens order creation from an unpurchased plan with its plan number', async () => {
    runtime.permissions.add('procurement.write'); runtime.search = `?detailId=${PLAN_ID}`
    render(<ProcurementPlanPage />)
    await screen.findByRole('dialog', { name: `采购计划 ${plan.planNo}` })
    fireEvent.click(screen.getByRole('button', { name: '生成采购单' }))
    expect(runtime.push).toHaveBeenCalledWith(`/procurement/orders?searchField=PLAN_NO&keyword=${plan.planNo}&createPlanNo=${plan.planNo}`)
  })

  it('opens the matching order list from an ordered plan for read-only users', async () => {
    runtime.permissions.add('procurement.read'); runtime.search = `?detailId=${PLAN_ID}`
    runtime.get.mockResolvedValue({ ...plan, status: 'ORDERED' })
    render(<ProcurementPlanPage />)
    await screen.findByRole('dialog', { name: `采购计划 ${plan.planNo}` })
    fireEvent.click(screen.getByRole('button', { name: '查看采购单' }))
    expect(runtime.push).toHaveBeenCalledWith(`/procurement/orders?searchField=PLAN_NO&keyword=${plan.planNo}`)
  })

  it('refreshes canonical detail after a void conflict without exposing server text', async () => {
    runtime.permissions.add('procurement.write'); runtime.search = `?detailId=${PLAN_ID}`
    runtime.voidPlan.mockRejectedValueOnce(new ApiError('private conflict text', {
      status: 409, details: { reason: 'optimistic_lock_conflict' },
    }))
    render(<ProcurementPlanPage />)
    await screen.findByRole('dialog', { name: `采购计划 ${plan.planNo}` })
    fireEvent.change(screen.getByLabelText('作废原因'), { target: { value: '无需采购' } })
    fireEvent.click(screen.getByRole('button', { name: '作废计划' }))

    await waitFor(() => expect(runtime.get.mock.calls.length).toBeGreaterThan(1))
    expect(screen.queryByText('private conflict text')).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { inventoryCountApi } from './inventoryCountApi'

const countId = '91000000-0000-4000-8000-000000000001'
const warehouseId = '92000000-0000-4000-8000-000000000001'
const balanceId = '93000000-0000-4000-8000-000000000001'
const commandId = '94000000-0000-4000-8000-000000000001'
const summary = {
  id: countId, countNo: 'IC-20260801-91000000', warehouseId,
  warehouseCode: 'WH-1', warehouseName: '主仓', status: 'APPROVAL',
  countDate: '2026-08-01', note: null, lineCount: 1, totalDifference: 2,
  version: 1, operatorDisplayName: '操作员', approverDisplayName: null,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
}
const detail = { summary, lines: [{
  id: '95000000-0000-4000-8000-000000000001', balanceId,
  skuId: '96000000-0000-4000-8000-000000000001', skuCode: 'SKU-1',
  skuName: '商品一', expectedBalanceVersion: 3, snapshotOnHand: 10,
  snapshotReserved: 1, snapshotAvailable: 9, countedOnHand: 12,
  difference: 2, resultEventId: null,
}] }

afterEach(() => vi.restoreAllMocks())

describe('inventoryCountApi', () => {
  it('allowlists count pages and preserves signed differences', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items: [{ ...summary, internal: 'hidden' }], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    await expect(inventoryCountApi.list({ searchField: 'SKU', keyword: ' SKU-1 ', status: 'APPROVAL', differenceMin: -2, page: 0, size: 50 })).resolves.toEqual({ items: [{ ...summary, note: undefined, approverDisplayName: undefined }], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    expect(request).toHaveBeenCalledWith('/api/v1/inventory-center/counts?searchField=SKU&page=0&size=50&status=APPROVAL&keyword=SKU-1&differenceMin=-2')
  })

  it('sends traceable create and transition commands', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(detail)
    await inventoryCountApi.create({ commandId, warehouseId, countDate: '2026-08-01', submit: true, lines: [{ balanceId, countedOnHand: 12 }] })
    expect(request).toHaveBeenLastCalledWith('/api/v1/inventory-center/counts', { method: 'POST', headers: { 'X-Request-Id': `count.${commandId}` }, body: { commandId, warehouseId, countDate: '2026-08-01', submit: true, lines: [{ balanceId, countedOnHand: 12 }] } })
    await inventoryCountApi.transition(countId, 'approve', 1, commandId)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/inventory-center/counts/${countId}/approve`, { method: 'POST', headers: { 'X-Request-Id': `count.${commandId}` }, body: { commandId, expectedVersion: 1 } })
  })

  it('exports normalized filters through a bounded CSV contract', async () => {
    const exportWire = {
      filename: 'inventory-counts.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1,
      content: '\uFEFF盘点批次,仓库编码,仓库名称,状态,盘点日期,备注,SKU个数,总差值,操作人,审批人,创建时间,更新时间\r\nIC-1,WH-1,主仓,审批中,2026-08-01,,1,2,操作员,,2026-08-01T00:00:00Z,2026-08-01T00:00:00Z\r\n',
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(exportWire)

    await expect(inventoryCountApi.exportCsv({ searchField: 'SKU', keyword: ' SKU-1 ', status: 'APPROVAL', differenceMin: -2 })).resolves.toEqual(exportWire)
    expect(request).toHaveBeenCalledWith('/api/v1/inventory-center/counts/exports', {
      method: 'POST',
      body: { warehouseId: undefined, status: 'APPROVAL', searchField: 'SKU', keyword: 'SKU-1', from: undefined, to: undefined, differenceMin: -2, differenceMax: undefined },
    })
  })

  it('rejects an invalid inventory count export contract', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      filename: '../inventory-counts.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 0,
      content: '\uFEFF盘点批次,仓库编码,仓库名称,状态,盘点日期,备注,SKU个数,总差值,操作人,审批人,创建时间,更新时间\r\n',
    })
    await expect(inventoryCountApi.exportCsv({ searchField: 'BATCH' })).rejects.toThrow('export.contract')
  })

  it('fails closed when arithmetic identities are changed', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({ ...detail, lines: [{ ...detail.lines[0], difference: 3 }] })
    await expect(inventoryCountApi.get(countId)).rejects.toThrow('line.quantities')
  })
})

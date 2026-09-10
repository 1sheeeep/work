import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { inventoryTransferApi } from './inventoryTransferApi'

const transferId = 'a1000000-0000-4000-8000-000000000001'
const sourceWarehouseId = 'a2000000-0000-4000-8000-000000000001'
const targetWarehouseId = 'a3000000-0000-4000-8000-000000000001'
const balanceId = 'a4000000-0000-4000-8000-000000000001'
const commandId = 'a5000000-0000-4000-8000-000000000001'
const shipmentEventId = 'a6000000-0000-4000-8000-000000000001'
const receiptEventId = 'a9000000-0000-4000-8000-000000000001'
const summary = {
  id: transferId, transferNo: 'WT-20260801-A1000000', status: 'IN_TRANSIT', transferDate: '2026-08-01',
  sourceWarehouseId, sourceWarehouseCode: 'WH-1', sourceWarehouseName: '主仓',
  targetWarehouseId, targetWarehouseCode: 'WH-2', targetWarehouseName: '分仓',
  transportMode: 'LAND', freightAmountMinor: null, currencyCode: null,
  logisticsChannel: null, trackingNo: null, allocationMethod: 'WEIGHT',
  expectedShipAt: null, expectedArrivalAt: null, note: null,
  lineCount: 1, totalQuantity: 4, version: 3, operatorDisplayName: '操作员',
  approverDisplayName: '审核员', shipperDisplayName: '发货员', receiverDisplayName: null,
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T01:00:00Z',
}
const detail = { summary, lines: [{
  id: 'a7000000-0000-4000-8000-000000000001', sourceBalanceId: balanceId,
  skuId: 'a8000000-0000-4000-8000-000000000001', skuCode: 'SKU-1', skuName: '商品一',
  snapshotBalanceVersion: 3, snapshotOnHand: 10, snapshotReserved: 1,
  snapshotAvailable: 9, quantity: 4, receivedQuantity: 0, remainingQuantity: 4,
  shipmentEventId, receiptEventId: null,
}] }

afterEach(() => vi.restoreAllMocks())

describe('inventoryTransferApi', () => {
  it('allowlists transfer pages and sends archive filters', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ items: [{ ...summary, internal: 'hidden' }], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    await expect(inventoryTransferApi.list({ sourceWarehouseId, status: 'IN_TRANSIT', transportMode: 'LAND', searchField: 'SKU', keyword: ' SKU-1 ', page: 0, size: 50 })).resolves.toEqual({ items: [{ ...summary, freightAmountMinor: undefined, currencyCode: undefined, logisticsChannel: undefined, trackingNo: undefined, expectedShipAt: undefined, expectedArrivalAt: undefined, note: undefined, receiverDisplayName: undefined }], page: 0, size: 50, totalElements: 1, totalPages: 1 })
    expect(request).toHaveBeenCalledWith(`/api/v1/inventory-center/transfers?searchField=SKU&page=0&size=50&sourceWarehouseId=${sourceWarehouseId}&status=IN_TRANSIT&transportMode=LAND&keyword=SKU-1`)
  })

  it('requests a bounded multi-status transfer page', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [], page: 1, size: 20, totalElements: 35, totalPages: 2,
    })

    await expect(inventoryTransferApi.list({
      statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'IN_TRANSIT'],
      searchField: 'BATCH', page: 1, size: 20,
    })).resolves.toEqual({ items: [], page: 1, size: 20, totalElements: 35, totalPages: 2 })
    expect(request).toHaveBeenCalledWith(
      '/api/v1/inventory-center/transfers?searchField=BATCH&page=1&size=20&status=IN_TRANSIT&status=PARTIALLY_RECEIVED',
    )
  })

  it('sends traceable create and receive commands', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(detail)
    const input = { commandId, sourceWarehouseId, targetWarehouseId, transferDate: '2026-08-01', transportMode: 'LAND' as const, allocationMethod: 'WEIGHT' as const, submit: true, lines: [{ balanceId, quantity: 4 }] }
    await inventoryTransferApi.create(input)
    expect(request).toHaveBeenLastCalledWith('/api/v1/inventory-center/transfers', { method: 'POST', headers: { 'X-Request-Id': `transfer.${commandId}` }, body: input })
    await inventoryTransferApi.transition(transferId, 'receive', 3, commandId)
    expect(request).toHaveBeenLastCalledWith(`/api/v1/inventory-center/transfers/${transferId}/receive`, { method: 'POST', headers: { 'X-Request-Id': `transfer.${commandId}` }, body: { commandId, expectedVersion: 3 } })
  })

  it('exports normalized filters through a bounded CSV contract', async () => {
    const exportWire = {
      filename: 'warehouse-transfers.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 1,
      content: '\uFEFF调拨批次,状态,调拨日期,起始仓库编码,起始仓库名称,目标仓库编码,目标仓库名称,运输方式,SKU个数,调拨数量,物流渠道,跟踪号,运费金额(最小货币单位),货币,计费方式,预计发货时间,预计到货时间,备注,操作人,审批人,发货人,签收人,创建时间,更新时间\r\n',
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(exportWire)

    await expect(inventoryTransferApi.exportCsv({
      sourceWarehouseId, targetWarehouseId,
      statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'IN_TRANSIT'],
      transportMode: 'LAND', searchField: 'SKU', keyword: ' SKU-1 ',
      from: '2026-07-01', to: '2026-08-01',
    })).resolves.toEqual(exportWire)
    expect(request).toHaveBeenCalledWith('/api/v1/inventory-center/transfers/exports', {
      method: 'POST',
      body: {
        sourceWarehouseId, targetWarehouseId,
        statuses: ['IN_TRANSIT', 'PARTIALLY_RECEIVED'],
        transportMode: 'LAND', searchField: 'SKU', keyword: 'SKU-1',
        from: '2026-07-01', to: '2026-08-01',
      },
    })
  })

  it('rejects an invalid warehouse transfer export contract', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      filename: '../warehouse-transfers.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 0,
      content: '\uFEFF调拨批次,状态,调拨日期,起始仓库编码,起始仓库名称,目标仓库编码,目标仓库名称,运输方式,SKU个数,调拨数量,物流渠道,跟踪号,运费金额(最小货币单位),货币,计费方式,预计发货时间,预计到货时间,备注,操作人,审批人,发货人,签收人,创建时间,更新时间\r\n',
    })
    await expect(inventoryTransferApi.exportCsv({ searchField: 'BATCH' })).rejects.toThrow('export.contract')
  })

  it('fails closed when quantity or event identities are inconsistent', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({ ...detail, summary: { ...summary, totalQuantity: 5 } })
    await expect(inventoryTransferApi.get(transferId)).rejects.toThrow('detail.identity')
    vi.spyOn(apiClient, 'request').mockResolvedValue({ ...detail, lines: [{ ...detail.lines[0], shipmentEventId: null, receiptEventId: shipmentEventId }] })
    await expect(inventoryTransferApi.get(transferId)).rejects.toThrow('line.state')
  })

  it('sends an explicit partial receipt command and maps receipt progress', async () => {
    const lineId = detail.lines[0].id
    const partial = {
      summary: { ...summary, status: 'PARTIALLY_RECEIVED', version: 4, receiverDisplayName: 'Receiver' },
      lines: [{ ...detail.lines[0], receivedQuantity: 2, remainingQuantity: 2, receiptEventId }],
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(partial)

    await expect(inventoryTransferApi.receivePartial(
      transferId, 3, commandId, [{ lineId, quantity: 2 }],
    )).resolves.toMatchObject({
      summary: { status: 'PARTIALLY_RECEIVED' },
      lines: [{ receivedQuantity: 2, remainingQuantity: 2 }],
    })
    expect(request).toHaveBeenCalledWith(
      `/api/v1/inventory-center/transfers/${transferId}/receive-partial`,
      {
        method: 'POST',
        headers: { 'X-Request-Id': `transfer.${commandId}` },
        body: { commandId, expectedVersion: 3, lines: [{ lineId, quantity: 2 }] },
      },
    )
  })
})

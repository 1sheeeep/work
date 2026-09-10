import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { manualMovementApi } from './manualMovementApi'

const movementId = 'a4700000-0000-4000-8000-000000000001'
const warehouseId = 'a4700000-0000-4000-8000-000000000002'
const skuId = 'a4700000-0000-4000-8000-000000000003'
const locationId = 'a4700000-0000-4000-8000-000000000004'
const lineId = 'a4700000-0000-4000-8000-000000000005'
const eventId = 'a4700000-0000-4000-8000-000000000006'
const commandId = 'a4700000-0000-4000-8000-000000000007'
const boxId = 'a4700000-0000-4000-8000-000000000008'
const now = '2026-07-30T00:00:00Z'

const summary = {
  id: movementId,
  movementNo: 'MI-A470',
  direction: 'INBOUND',
  status: 'DRAFT',
  warehouseId,
  warehouseBusinessCode: 'WH-A',
  warehouseName: '北区仓',
  movementTypeId: null,
  movementTypeName: null,
  reasonCode: 'FOUND_STOCK',
  source: 'MANUAL',
  wmsStatus: 'NOT_CONFIGURED',
  approvalStatus: 'NOT_REQUIRED',
  entryMode: 'PRODUCT',
  note: null,
  sourceReference: null,
  extensionAttributes: {},
  lineCount: 1,
  totalQuantity: 3,
  totalActualQuantity: 0,
  totalAmount: 0,
  currency: null,
  version: 0,
  createdBy: '测试用户',
  reviewedBy: null,
  submittedAt: null,
  postedAt: null,
  reversedAt: null,
  cancelledAt: null,
  reviewedAt: null,
  createdAt: now,
  updatedAt: now,
}

const line = {
  id: lineId,
  lineNumber: 1,
  skuId,
  skuBusinessCode: 'SKU-A',
  skuName: '商品 A',
  locationId,
  locationBusinessCode: 'A-01',
  locationName: '拣货位 A-01',
  quantity: 3,
  actualQuantity: null,
  unitPrice: null,
  currency: null,
  amount: null,
  extensionAttributes: {},
  note: null,
  currentOnHand: -2,
  currentAvailable: -2,
}

afterEach(() => vi.restoreAllMocks())

describe('manualMovementApi', () => {
  it('projects an allowlisted page and serializes bounded filters', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [
        {
          ...summary,
          tenantId: 'hidden',
          rawPayload: { secret: true },
        },
      ],
      page: 2,
      size: 25,
      totalElements: 51,
      totalPages: 3,
      buyer: 'hidden',
    })

    await expect(
      manualMovementApi.list({
        warehouseId,
        direction: 'INBOUND',
        status: 'DRAFT',
        reasonCode: 'FOUND_STOCK',
        keyword: ' MI-A ',
        createdFrom: '2026-07-01T00:00:00Z',
        createdTo: '2026-07-31T23:59:59Z',
        page: 2,
        size: 25,
      }),
    ).resolves.toEqual({
      items: [
        {
          ...summary,
          movementTypeId: undefined,
          movementTypeName: undefined,
          note: undefined,
          sourceReference: undefined,
          currency: undefined,
          reviewedBy: undefined,
          reviewNote: undefined,
          submittedAt: undefined,
          postedAt: undefined,
          reversedAt: undefined,
          cancelledAt: undefined,
          reviewedAt: undefined,
        },
      ],
      page: 2,
      size: 25,
      totalElements: 51,
      totalPages: 3,
    })
    expect(request.mock.calls[0][0]).toContain(`warehouseId=${warehouseId}`)
    expect(request.mock.calls[0][0]).toContain('keyword=MI-A')
    expect(request.mock.calls[0][0]).toContain(
      'reasonCode=FOUND_STOCK',
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenant')
  })

  it('exports normalized filters through a bounded CSV contract', async () => {
    const exportWire = {
      filename: 'manual-movements-inbound.csv' as const,
      mediaType: 'text/csv;charset=utf-8' as const,
      rowCount: 1,
      content:
        '\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,WMS状态,审批状态,计划数量,实际数量,金额,币种,创建人,审核人,单据状态,创建时间\r\nMI-A470,手工入库,WH-A,北区仓,盘盈或发现库存,手工新增,未配置,无需审核,3,0,0,,测试用户,,草稿,2026-07-30T00:00:00Z\r\n',
    }
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(exportWire)

    await expect(
      manualMovementApi.exportCsv({
        warehouseId,
        direction: 'INBOUND',
        status: 'DRAFT',
        reasonCode: 'FOUND_STOCK',
        searchField: 'BATCH_NO',
        keyword: ' MI-A ',
        createdFrom: '2026-07-01T00:00:00Z',
        createdTo: '2026-07-31T23:59:59Z',
      }),
    ).resolves.toEqual(exportWire)
    expect(request).toHaveBeenCalledWith(
      '/api/v1/inventory-center/manual-movements/exports',
      {
        method: 'POST',
        body: expect.objectContaining({
          warehouseId,
          direction: 'INBOUND',
          status: 'DRAFT',
          reasonCode: 'FOUND_STOCK',
          searchField: 'BATCH_NO',
          keyword: 'MI-A',
          createdFrom: '2026-07-01T00:00:00Z',
          createdTo: '2026-07-31T23:59:59Z',
        }),
      },
    )
  })

  it.each([
    ['filename', { filename: '../manual-movements.csv' }],
    ['media type', { mediaType: 'text/html' }],
    ['row limit', { rowCount: 10_001 }],
    ['header', { content: '\uFEFFunexpected' }],
  ])('rejects an invalid movement export %s', async (_label, patch) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      filename: 'manual-movements-all.csv',
      mediaType: 'text/csv;charset=utf-8',
      rowCount: 0,
      content:
        '\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,WMS状态,审批状态,计划数量,实际数量,金额,币种,创建人,审核人,单据状态,创建时间\r\n',
      ...patch,
    })

    await expect(manualMovementApi.exportCsv({})).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('requires and projects the persisted rejection reason', async () => {
    const rejected = {
      ...summary,
      approvalStatus: 'REJECTED',
      reviewedBy: '审核员',
      reviewNote: '箱清单需要复核',
      reviewedAt: now,
    }
    const request = vi.spyOn(apiClient, 'request')
    request.mockResolvedValueOnce({
      items: [rejected],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(
      manualMovementApi.list({ page: 0, size: 25 }),
    ).resolves.toMatchObject({
      items: [
        {
          approvalStatus: 'REJECTED',
          reviewedBy: '审核员',
          reviewNote: '箱清单需要复核',
        },
      ],
    })

    request.mockResolvedValueOnce({
      items: [{ ...rejected, reviewNote: null }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(
      manualMovementApi.list({ page: 0, size: 25 }),
    ).rejects.toThrow('Invalid manual movement response')
  })

  it('projects detail lines while keeping signed warehouse facts', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      summary: { ...summary, internalNote: 'hidden' },
      lines: [{ ...line, credentialReference: 'hidden' }],
      boxes: [],
      contactInformation: {
        name: null,
        phone: null,
        address: null,
        tenantId: 'hidden',
      },
      tenantId: 'hidden',
    })

    await expect(manualMovementApi.get(movementId)).resolves.toEqual({
      summary: {
        ...summary,
        note: undefined,
        sourceReference: undefined,
        movementTypeId: undefined,
        movementTypeName: undefined,
        currency: undefined,
        reviewedBy: undefined,
        reviewNote: undefined,
        submittedAt: undefined,
        postedAt: undefined,
        reversedAt: undefined,
        cancelledAt: undefined,
        reviewedAt: undefined,
      },
      lines: [
        {
          ...line,
          actualQuantity: undefined,
          unitPrice: undefined,
          currency: undefined,
          amount: undefined,
          note: undefined,
        },
      ],
      boxes: [],
      contactInformation: {
        name: undefined,
        phone: undefined,
        address: undefined,
      },
    })
  })

  it.each([
    ['direction reason', { ...summary, direction: 'OUTBOUND' }],
    ['draft timestamp', { ...summary, postedAt: now }],
    ['posted timestamp', { ...summary, status: 'POSTED' }],
    [
      'reversed timestamp',
      { ...summary, status: 'REVERSED', postedAt: now },
    ],
    ['line count zero', { ...summary, lineCount: 0 }],
    ['line count over limit', { ...summary, lineCount: 501 }],
    ['optional object', { ...summary, note: { value: 'unsafe' } }],
  ])('rejects invalid summary %s', async (_label, invalidSummary) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [invalidSummary],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(
      manualMovementApi.list({ page: 0, size: 25 }),
    ).rejects.toThrow('Invalid manual movement response')
  })

  it.each([
    ['negative quantity', { ...line, quantity: -1 }],
    ['mismatched available', { ...line, currentAvailable: -1 }],
    ['line number over limit', { ...line, lineNumber: 501 }],
    ['wrong optional field', { ...line, note: 7 }],
  ])('rejects invalid detail line %s', async (_label, invalidLine) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      summary,
      lines: [invalidLine],
      boxes: [],
      contactInformation: { name: null, phone: null, address: null },
    })
    await expect(manualMovementApi.get(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('rejects duplicate SKU lines and inconsistent totals', async () => {
    vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        summary: { ...summary, lineCount: 2, totalQuantity: 6 },
        lines: [line, { ...line, id: eventId, lineNumber: 2 }],
        boxes: [],
        contactInformation: { name: null, phone: null, address: null },
      })
      .mockResolvedValueOnce({
        summary: { ...summary, totalQuantity: 4 },
        lines: [line],
        boxes: [],
        contactInformation: { name: null, phone: null, address: null },
      })
    await expect(manualMovementApi.get(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
    await expect(manualMovementApi.get(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('rejects malformed contact information instead of coercing it', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      summary,
      lines: [line],
      boxes: [],
      contactInformation: {
        name: { unsafe: true },
        phone: null,
        address: null,
      },
    })
    await expect(manualMovementApi.get(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('serializes only the approved create fields and no tenant header', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      movementId,
      status: 'DRAFT',
      version: 0,
      replayed: false,
      tenantId: 'hidden',
    })
    await manualMovementApi.create({
      warehouseId,
      direction: 'INBOUND',
      reasonCode: 'FOUND_STOCK',
      source: 'MANUAL',
      entryMode: 'PRODUCT',
      note: 'safe',
      sourceReference: 'SOURCE-1',
      contactName: '收货人',
      contactPhone: '010-12345678',
      contactAddress: '测试园区 1 号',
      lines: [{ skuId, locationId, quantity: 3, note: 'line' }],
      boxes: [],
      expectedVersion: 0,
      commandId,
    })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/inventory-center/manual-movements',
      {
        method: 'POST',
        headers: { 'X-Request-Id': `manual-${commandId}` },
        body: {
          warehouseId,
          direction: 'INBOUND',
          reasonCode: 'FOUND_STOCK',
          source: 'MANUAL',
          entryMode: 'PRODUCT',
          note: 'safe',
          sourceReference: 'SOURCE-1',
          contactName: '收货人',
          contactPhone: '010-12345678',
          contactAddress: '测试园区 1 号',
          extensionAttributes: {},
          lines: [
            {
              skuId,
              locationId,
              quantity: 3,
              unitPrice: undefined,
              currency: undefined,
              extensionAttributes: {},
              note: 'line',
            },
          ],
          boxes: [],
          expectedVersion: 0,
          commandId,
        },
      },
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('X-Tenant-Id')
  })

  it('serializes post and reversal with exact version and encoded UUID path', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      movementId,
      status: 'POSTED',
      version: 2,
      replayed: false,
    })
    await manualMovementApi.post(movementId, 1, commandId)
    await manualMovementApi.reverse(movementId, 2, commandId)
    expect(request.mock.calls[0][0]).toBe(
      `/api/v1/inventory-center/manual-movements/${movementId}/post`,
    )
    expect(request.mock.calls[0][1]?.body).toEqual({
      expectedVersion: 1,
      commandId,
    })
    expect(request.mock.calls[1][0]).toBe(
      `/api/v1/inventory-center/manual-movements/${movementId}/reverse`,
    )
  })

  it('validates document ledger source and reversal consistency', async () => {
    const postEvent = {
      id: eventId,
      ledgerSequence: 1,
      eventType: 'DOCUMENT_POST',
      skuId,
      warehouseId,
      signedDelta: -3,
      balanceAfter: -3,
      balanceVersionAfter: 1,
      reason: 'MANUAL_OUTBOUND_LOST_STOCK',
      reversalOfEventId: null,
      requestId: 'post-1',
      recordedAt: now,
    }
    vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        items: [{ event: postEvent, tenantId: 'hidden' }],
      })
      .mockResolvedValueOnce({
        items: [{ event: { ...postEvent, eventType: 'REVERSAL' } }],
      })
      .mockResolvedValueOnce({
        items: [{ event: { ...postEvent, eventType: 'CORRECTION' } }],
      })
    await expect(manualMovementApi.ledger(movementId)).resolves.toEqual([
      {
        ...postEvent,
        reversalOfEventId: undefined,
      },
    ])
    await expect(manualMovementApi.ledger(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
    await expect(manualMovementApi.ledger(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('projects the allowlisted timeline wrapper', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [
        {
          id: eventId,
          eventType: 'POSTED',
          fromStatus: 'DRAFT',
          toStatus: 'POSTED',
          movementVersion: 1,
          requestId: 'post-1',
          recordedAt: now,
          note: 'hidden',
        },
      ],
      tenantId: 'hidden',
    })

    await expect(manualMovementApi.timeline(movementId)).resolves.toEqual([
      {
        id: eventId,
        eventType: 'POSTED',
        fromStatus: 'DRAFT',
        toStatus: 'POSTED',
        movementVersion: 1,
        requestId: 'post-1',
        recordedAt: now,
      },
    ])
  })

  it('enforces location parents and rejects invalid paths before requests', async () => {
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        items: [
          {
            id: locationId,
            warehouseId: eventId,
            businessCode: 'A-01',
            name: 'A-01',
          },
        ],
        page: 0,
        size: 100,
        totalElements: 1,
        totalPages: 1,
      })
    await expect(
      manualMovementApi.locationOptions(warehouseId),
    ).rejects.toThrow('Invalid manual movement response')
    await expect(manualMovementApi.get('../tenant')).rejects.toThrow(
      'Invalid manual movement request',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('projects a scoped price snapshot and encodes the SKU path', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      unitPrice: 12.5,
      currency: 'CNY',
      version: 2,
      tenantId: 'hidden',
      sourceMovementId: 'hidden',
    })
    await expect(
      manualMovementApi.priceSnapshot(skuId, 'INBOUND'),
    ).resolves.toEqual({
      unitPrice: 12.5,
      currency: 'CNY',
      version: 2,
    })
    expect(request.mock.calls[0][0]).toBe(
      `/api/v1/inventory-center/manual-movements/references/skus/` +
        `${skuId}/price-snapshot?direction=INBOUND`,
    )
  })

  it('rejects unsafe pagination, text and write combinations', async () => {
    const request = vi.spyOn(apiClient, 'request')
    await expect(
      manualMovementApi.list({ page: -1, size: 0 }),
    ).rejects.toThrow('Invalid manual movement request')
    await expect(
      manualMovementApi.warehouseOptions('', 0, 0),
    ).rejects.toThrow('Invalid manual movement request')
    await expect(
      manualMovementApi.create({
        warehouseId,
        direction: 'OUTBOUND',
        reasonCode: 'FOUND_STOCK',
        source: 'MANUAL',
        entryMode: 'PRODUCT',
        lines: [{ skuId, locationId, quantity: 1 }],
        boxes: [],
        expectedVersion: 0,
        commandId,
      }),
    ).rejects.toThrow('Invalid manual movement request')
    expect(request).not.toHaveBeenCalled()
  })

  it('projects boxed detail and drops unknown box payload fields', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      summary: {
        ...summary,
        entryMode: 'BOX',
      },
      lines: [line],
      boxes: [
        {
          id: boxId,
          sourceBoxStockId: null,
          customBoxNo: 'BOX-1',
          boxCount: 1,
          boxNumberRule: 'SHARED_NUMBER',
          lengthCm: 10,
          widthCm: 20,
          heightCm: 30,
          grossWeightKg: 2.5,
          items: [
            {
              skuId,
              skuBusinessCode: 'SKU-A',
              skuName: '商品 A',
              quantityPerBox: 3,
              rawPlatformPayload: { secret: true },
            },
          ],
          credentialReference: 'hidden',
        },
      ],
      contactInformation: {
        name: '仓库联系人',
        phone: '010-12345678',
        address: '测试园区 1 号',
        internalOwnerId: 'hidden',
      },
    })

    const result = await manualMovementApi.get(movementId)
    expect(result.boxes).toEqual([
      {
        id: boxId,
        sourceBoxStockId: undefined,
        customBoxNo: 'BOX-1',
        boxCount: 1,
        boxNumberRule: 'SHARED_NUMBER',
        lengthCm: 10,
        widthCm: 20,
        heightCm: 30,
        grossWeightKg: 2.5,
        items: [
          {
            skuId,
            skuBusinessCode: 'SKU-A',
            skuName: '商品 A',
            quantityPerBox: 3,
          },
        ],
      },
    ])
    expect(JSON.stringify(result)).not.toContain('credential')
    expect(JSON.stringify(result)).not.toContain('rawPlatformPayload')
    expect(result.contactInformation).toEqual({
      name: '仓库联系人',
      phone: '010-12345678',
      address: '测试园区 1 号',
    })
    expect(JSON.stringify(result)).not.toContain('internalOwnerId')
  })

  it.each([
    ['missing boxes', { ...summary, entryMode: 'BOX' }, []],
    [
      'invalid box rule',
      { ...summary, entryMode: 'BOX' },
      [
        {
          id: boxId,
          sourceBoxStockId: null,
          customBoxNo: 'BOX-1',
          boxCount: 1,
          boxNumberRule: 'BAD',
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
          grossWeightKg: 1,
          items: [
            {
              skuId,
              skuBusinessCode: 'SKU-A',
              skuName: '商品 A',
              quantityPerBox: 3,
            },
          ],
        },
      ],
    ],
  ])('rejects invalid boxed response %s', async (_label, item, boxes) => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      summary: item,
      lines: [line],
      boxes,
      contactInformation: { name: null, phone: null, address: null },
    })
    await expect(manualMovementApi.get(movementId)).rejects.toThrow(
      'Invalid manual movement response',
    )
  })

  it('serializes approval batch and configuration commands exactly', async () => {
    const request = vi.spyOn(apiClient, 'request')
      .mockResolvedValueOnce({
        items: [
          {
            movementId,
            status: 'SUBMITTED',
            version: 2,
            replayed: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        direction: 'INBOUND',
        approvalRequired: true,
        unitPriceRequired: false,
        showCostPrice: true,
        costUpdatePolicy: 'NO_UPDATE',
        contactInformationRequired: false,
        version: 1,
      })
    await manualMovementApi.batchReview(
      [{ movementId, expectedVersion: 1 }],
      commandId,
      false,
      '箱清单需要复核',
    )
    await manualMovementApi.saveSettings(
      {
        approvalRequired: true,
        unitPriceRequired: false,
        showCostPrice: true,
        costUpdatePolicy: 'NO_UPDATE',
        contactInformationRequired: false,
        version: 0,
      },
      'INBOUND',
      commandId,
    )
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: {
        items: [{ movementId, expectedVersion: 1 }],
        commandId,
        note: '箱清单需要复核',
      },
    })
    expect(request.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: expect.objectContaining({
        approvalRequired: true,
        expectedVersion: 0,
        commandId,
      }),
    })
    expect(JSON.stringify(request.mock.calls)).not.toContain('tenant')
  })

  it('rejects box stock from a different warehouse parent', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [
        {
          id: boxId,
          sourceBoxStockId: null,
          warehouseId: eventId,
          customBoxNo: 'BOX-1',
          boxNumberRule: 'SHARED_NUMBER',
          lengthCm: 1,
          widthCm: 1,
          heightCm: 1,
          grossWeightKg: 1,
          availableCount: 1,
          version: 0,
          items: [
            {
              skuId,
              skuBusinessCode: 'SKU-A',
              skuName: '商品 A',
              quantityPerBox: 1,
            },
          ],
        },
      ],
      page: 0,
      size: 50,
      totalElements: 1,
      totalPages: 1,
    })
    await expect(
      manualMovementApi.boxStock(warehouseId),
    ).rejects.toThrow('Invalid manual movement response')
  })
})

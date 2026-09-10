import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { manualMovementApi } from '../modules/manualMovementApi'
import {
  ManualMovementPage,
  manualMovementCsvCell,
  parseManualMovementQuery,
  toManualMovementUrl,
} from './ManualMovementPage'

const routerState = vi.hoisted(() => {
  const push = vi.fn()
  const replace = vi.fn()
  return {
    search: '',
    push,
    replace,
    router: { history: { push, replace } },
  }
})
const authState = vi.hoisted(() => ({
  permissions: new Set<string>(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => routerState.router,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      authState.permissions.has(permission),
  }),
}))

const movementId = 'a4700000-0000-4000-8000-000000000001'
const warehouseId = 'a4700000-0000-4000-8000-000000000002'
const skuId = 'a4700000-0000-4000-8000-000000000003'
const locationId = 'a4700000-0000-4000-8000-000000000004'
const now = '2026-07-30T00:00:00Z'

const summary = {
  id: movementId,
  movementNo: 'MI-A470',
  direction: 'INBOUND' as const,
  status: 'DRAFT' as const,
  warehouseId,
  warehouseBusinessCode: 'WH-A',
  warehouseName: '北区仓',
  reasonCode: 'FOUND_STOCK' as const,
  source: 'MANUAL' as const,
  wmsStatus: 'NOT_CONFIGURED' as const,
  approvalStatus: 'NOT_REQUIRED' as const,
  entryMode: 'PRODUCT' as const,
  extensionAttributes: {},
  lineCount: 1,
  totalQuantity: 3,
  totalActualQuantity: 0,
  totalAmount: 0,
  version: 0,
  createdBy: '测试用户',
  createdAt: now,
  updatedAt: now,
}

const detail = {
  summary,
  lines: [
    {
      id: 'a4700000-0000-4000-8000-000000000005',
      lineNumber: 1,
      skuId,
      skuBusinessCode: 'SKU-A',
      skuName: '商品 A',
      locationId,
      locationBusinessCode: 'A-01',
      locationName: '拣货位 A-01',
      quantity: 3,
      extensionAttributes: {},
      currentOnHand: -2,
      currentAvailable: -2,
    },
  ],
  boxes: [],
  contactInformation: {
    name: undefined,
    phone: undefined,
    address: undefined,
  },
}

const oneItemPage = {
  items: [summary],
  page: 0,
  size: 25,
  totalElements: 1,
  totalPages: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function lastUrl(method: 'push' | 'replace' = 'push') {
  const mock = routerState[method]
  return String(mock.mock.calls.at(-1)?.[0] ?? '')
}

function renderPage() {
  return render(<ManualMovementPage />)
}

function applyNavigation(
  view: ReturnType<typeof renderPage>,
  method: 'push' | 'replace' = 'push',
) {
  const url = new URL(lastUrl(method), 'https://erp.test')
  routerState.search = url.search
  view.rerender(<ManualMovementPage />)
}

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  routerState.replace.mockReset()
  authState.permissions = new Set([
    'inventory.read',
    'inventory.manual.write',
    'inventory.manual.post',
    'inventory.reverse',
    'inventory.manual.approve',
    'inventory.manual.configure',
  ])
  vi.spyOn(manualMovementApi, 'list').mockResolvedValue(oneItemPage)
  vi.spyOn(manualMovementApi, 'exportCsv').mockResolvedValue({
    filename: 'manual-movements-inbound.csv',
    mediaType: 'text/csv;charset=utf-8',
    rowCount: 1,
    content:
      '\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,WMS状态,审批状态,计划数量,实际数量,金额,币种,创建人,审核人,单据状态,创建时间\r\nMI-A470,手工入库,WH-A,北区仓,盘盈或发现库存,手工新增,未配置,无需审核,3,0,0,,测试用户,,草稿,2026-07-30T00:00:00Z\r\n',
  })
  vi.spyOn(manualMovementApi, 'warehouseOptions').mockResolvedValue({
    items: [
      {
        id: warehouseId,
        businessCode: 'WH-A',
        name: '北区仓',
      },
    ],
    page: 0,
    size: 100,
    totalElements: 1,
    totalPages: 1,
  })
  vi.spyOn(manualMovementApi, 'locationOptions').mockResolvedValue({
    items: [
      {
        id: locationId,
        warehouseId,
        businessCode: 'A-01',
        name: '拣货位 A-01',
      },
    ],
    page: 0,
    size: 200,
    totalElements: 1,
    totalPages: 1,
  })
  vi.spyOn(manualMovementApi, 'skuOptions').mockResolvedValue({
    items: [
      {
        id: skuId,
        businessCode: 'SKU-A',
        name: '商品 A',
        variantSummary: '蓝色',
      },
    ],
    page: 0,
    size: 100,
    totalElements: 1,
    totalPages: 1,
  })
  vi.spyOn(manualMovementApi, 'priceSnapshot').mockRejectedValue(
    new ApiError('not found', { status: 404 }),
  )
  vi.spyOn(manualMovementApi, 'types').mockResolvedValue({
    items: [],
    page: 0,
    size: 100,
    totalElements: 0,
    totalPages: 0,
  })
  vi.spyOn(manualMovementApi, 'settings').mockImplementation(
    async (direction) => ({
      direction,
      approvalRequired: false,
      unitPriceRequired: false,
      showCostPrice: false,
      costUpdatePolicy: 'NO_UPDATE',
      contactInformationRequired: false,
      version: 0,
    }),
  )
  vi.spyOn(manualMovementApi, 'boxStock').mockResolvedValue({
    items: [],
    page: 0,
    size: 100,
    totalElements: 0,
    totalPages: 0,
  })
  vi.spyOn(manualMovementApi, 'get').mockResolvedValue(detail)
  vi.spyOn(manualMovementApi, 'timeline').mockResolvedValue([])
  vi.spyOn(manualMovementApi, 'ledger').mockResolvedValue([])
  vi.spyOn(manualMovementApi, 'create').mockResolvedValue({
    movementId,
    status: 'DRAFT',
    version: 0,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'update').mockResolvedValue({
    movementId,
    status: 'DRAFT',
    version: 1,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'post').mockResolvedValue({
    movementId,
    status: 'POSTED',
    version: 1,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'submit').mockResolvedValue({
    movementId,
    status: 'SUBMITTED',
    version: 1,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'review').mockResolvedValue({
    movementId,
    status: 'SUBMITTED',
    version: 2,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'cancel').mockResolvedValue({
    movementId,
    status: 'CANCELLED',
    version: 1,
    replayed: false,
  })
  vi.spyOn(manualMovementApi, 'batchReview').mockResolvedValue([])
  vi.spyOn(manualMovementApi, 'batchPost').mockResolvedValue([])
  vi.spyOn(manualMovementApi, 'batchCancel').mockResolvedValue([])
  vi.spyOn(manualMovementApi, 'saveSettings').mockResolvedValue({
    direction: 'INBOUND',
    approvalRequired: true,
    unitPriceRequired: false,
    showCostPrice: false,
    costUpdatePolicy: 'NO_UPDATE',
    contactInformationRequired: false,
    version: 1,
  })
  vi.spyOn(manualMovementApi, 'saveType').mockResolvedValue({
    id: 'a4700000-0000-4000-8000-000000000099',
    direction: 'INBOUND',
    code: 'RETURN',
    name: '退回入库',
    status: 'ACTIVE',
    version: 0,
  })
  vi.spyOn(manualMovementApi, 'reverse').mockResolvedValue({
    movementId,
    status: 'REVERSED',
    version: 2,
    replayed: false,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'prompt').mockReturnValue('箱清单需要复核')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ManualMovementPage query and list', () => {
  it('protects exported text formulas without converting signed quantities', () => {
    expect(manualMovementCsvCell('=HYPERLINK("unsafe")'))
      .toBe('"\'=HYPERLINK(""unsafe"")"')
    expect(manualMovementCsvCell('+SUM(1,1)')).toBe('"\'+SUM(1,1)"')
    expect(manualMovementCsvCell('-3')).toBe('"\'-3"')
    expect(manualMovementCsvCell('@unsafe')).toBe('"\'@unsafe"')
    expect(manualMovementCsvCell(-3)).toBe('"-3"')
  })

  it('bounds shareable URL fields and preserves a valid detail selection', () => {
    expect(
      parseManualMovementQuery(
        `?warehouseId=bad&direction=DELETE&status=BAD&keyword=${'x'.repeat(120)}` +
          `&page=-1&size=999&detailMovementId=${movementId}&editor=edit`,
      ),
    ).toEqual({
      warehouseId: undefined,
      view: 'INBOUND',
      approvalDirection: undefined,
      status: undefined,
      reasonCode: undefined,
      movementTypeId: undefined,
      source: undefined,
      wmsStatus: undefined,
      approvalStatus: undefined,
      searchField: 'BATCH_NO',
      timeBucket: undefined,
      keyword: 'x'.repeat(100),
      createdFrom: '',
      createdTo: '',
      page: 0,
      size: 25,
      detailMovementId: movementId,
      editor: 'edit',
    })
    expect(
      toManualMovementUrl({
        warehouseId,
        view: 'OUTBOUND',
        status: 'POSTED',
        reasonCode: 'LOST_STOCK',
        searchField: 'BATCH_NO',
        keyword: 'lost',
        createdFrom: '2026-07-01',
        createdTo: '2026-07-30',
        page: 2,
        size: 50,
        detailMovementId: movementId,
      }),
    ).toContain(`detailMovementId=${movementId}`)
  })

  it('renders loading, empty and safe list error states', async () => {
    const pending = deferred<typeof oneItemPage>()
    vi.mocked(manualMovementApi.list).mockReturnValueOnce(pending.promise)
    const view = renderPage()
    expect(screen.getByText('正在加载手工出入库单…')).toBeTruthy()
    pending.resolve({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    })
    expect(
      await screen.findByText('当前筛选下没有手工出入库单。'),
    ).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '批次编号' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '仓库' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '版本' })).toBeNull()

    vi.mocked(manualMovementApi.list).mockRejectedValueOnce(
      new Error('jdbc:postgresql://private'),
    )
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(
      await screen.findByText('暂时无法读取手工出入库单，请稍后重试。'),
    ).toBeTruthy()
    expect(view.container.textContent).not.toContain('postgresql')
  })

  it('writes filters and pagination to URL and disables boundaries', async () => {
    const view = renderPage()
    await screen.findByText('MI-A470')
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), {
      target: { value: 'source-7' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: '仓库' }), {
      target: { value: warehouseId },
    })
    fireEvent.change(screen.getByRole('combobox', { name: '状态' }), {
      target: { value: 'DRAFT' },
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: '出入库类型' }),
      { target: { value: 'FOUND_STOCK' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(lastUrl()).toContain('keyword=source-7')
    expect(lastUrl()).toContain(`warehouseId=${warehouseId}`)
    expect(lastUrl()).toContain('status=DRAFT')
    expect(lastUrl()).toContain('reasonCode=FOUND_STOCK')

    vi.mocked(manualMovementApi.list).mockResolvedValueOnce({
      ...oneItemPage,
      totalElements: 26,
      totalPages: 2,
    })
    routerState.search = '?page=0&size=25'
    view.rerender(<ManualMovementPage />)
    expect(await screen.findByText(/第 1/)).toBeTruthy()
    expect(
      (screen.getByRole('button', {
        name: '上一页',
      }) as HTMLButtonElement).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '每页单据数' }), {
      target: { value: '50' },
    })
    expect(lastUrl()).toContain('page=0')
    expect(lastUrl()).toContain('size=50')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(lastUrl()).toContain('page=1')
  })

  it('loads every bounded warehouse page into the document filter', async () => {
    vi.mocked(manualMovementApi.warehouseOptions)
      .mockResolvedValueOnce({
        items: [{
          id: warehouseId,
          businessCode: 'WH-A',
          name: '北区仓',
        }],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{
          id: 'a4700000-0000-4000-8000-000000000012',
          businessCode: 'WH-B',
          name: '南区仓',
        }],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })

    renderPage()

    expect(
      await screen.findByRole('option', { name: /WH-B/ }),
    ).toBeTruthy()
    expect(manualMovementApi.warehouseOptions).toHaveBeenNthCalledWith(
      2,
      '',
      1,
      200,
    )
  })

  it('loads every bounded movement-type page into the document filter', async () => {
    vi.mocked(manualMovementApi.types)
      .mockResolvedValueOnce({
        items: [{
          id: 'a4700000-0000-4000-8000-000000000021',
          direction: 'INBOUND',
          code: 'TYPE_A',
          name: '类型甲',
          status: 'ACTIVE',
          version: 0,
        }],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{
          id: 'a4700000-0000-4000-8000-000000000022',
          direction: 'INBOUND',
          code: 'TYPE_B',
          name: '类型乙',
          status: 'ACTIVE',
          version: 0,
        }],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })

    renderPage()

    expect(
      await screen.findByRole('option', { name: /类型乙/ }),
    ).toBeTruthy()
    expect(manualMovementApi.types).toHaveBeenNthCalledWith(
      2,
      undefined,
      true,
      1,
      200,
    )
  })

  it('groups secondary document actions into archive-aligned menus', async () => {
    renderPage()
    await screen.findByText('MI-A470')

    const batchSummary = screen.getByText('批量操作')
    const batchMenu = batchSummary.closest('details')
    const transferSummary = screen.getByText('导入 / 导出')
    const transferMenu = transferSummary.closest('details')
    expect(batchMenu?.open).toBe(false)
    expect(transferMenu?.open).toBe(false)

    fireEvent.click(batchSummary)
    expect(batchMenu?.open).toBe(true)
    expect(
      screen.getByRole('button', { name: '批量标记入库' }),
    ).toBeTruthy()
    fireEvent.click(transferSummary)
    expect(transferMenu?.open).toBe(true)
    expect(
      screen.getByRole('button', { name: '导出筛选结果' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '导出当前页' }),
    ).toBeTruthy()
  })

  it('downloads every filtered movement and announces success', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&status=DRAFT&searchField=BATCH_NO` +
      '&keyword=MI-A&createdFrom=2026-07-01&createdTo=2026-07-31&page=3&size=25'
    const createObjectURL = vi.fn(() => 'blob:manual-movements')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    renderPage()
    await screen.findByText('MI-A470')
    fireEvent.click(screen.getByText('导入 / 导出'))
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(
      await screen.findByText('已导出 1 条手工出入库单。'),
    ).toBeTruthy()
    expect(manualMovementApi.exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId,
        direction: 'INBOUND',
        status: 'DRAFT',
        searchField: 'BATCH_NO',
        keyword: 'MI-A',
        createdFrom: '2026-07-01T00:00:00.000Z',
        createdTo: '2026-07-31T23:59:59.999Z',
      }),
    )
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:manual-movements')
  })

  it('announces how to recover when a filtered export is too large', async () => {
    vi.mocked(manualMovementApi.exportCsv).mockRejectedValue(
      new ApiError('hidden detail', { status: 409 }),
    )

    renderPage()
    await screen.findByText('MI-A470')
    fireEvent.click(screen.getByText('导入 / 导出'))
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      '导出结果超过 10,000 条，请缩小筛选范围后重试。',
    )
  })

  it('ignores a stale list response after filters change', async () => {
    const oldRequest = deferred<typeof oneItemPage>()
    const newSummary = { ...summary, id: `${movementId.slice(0, -1)}9`, movementNo: 'MO-NEW' }
    vi.mocked(manualMovementApi.list)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({
        ...oneItemPage,
        items: [newSummary],
      })
    const view = renderPage()
    routerState.search = '?keyword=new&page=0&size=25'
    view.rerender(<ManualMovementPage />)
    expect(await screen.findByText('MO-NEW')).toBeTruthy()
    oldRequest.resolve(oneItemPage)
    await Promise.resolve()
    expect(screen.queryByText('MI-A470')).toBeNull()
  })
})

describe('ManualMovementPage detail, permissions and focus', () => {
  it('loads detail only after click and restores trapped focus on close', async () => {
    const view = renderPage()
    const trigger = await screen.findByRole('button', { name: 'MI-A470' })
    expect(manualMovementApi.get).not.toHaveBeenCalled()
    trigger.focus()
    fireEvent.click(trigger)
    applyNavigation(view)
    const dialog = await screen.findByRole('dialog', {
      name: '手工出入库详情',
    })
    expect(manualMovementApi.get).toHaveBeenCalledWith(
      movementId,
      expect.any(AbortSignal),
    )
    const close = screen.getByRole('button', {
      name: '关闭手工出入库详情',
    })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '返回' }),
    )
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Escape' })
    applyNavigation(view)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(dialog.isConnected).toBe(false)
  })

  it('shows detail error and retry without leaking backend text', async () => {
    vi.mocked(manualMovementApi.get).mockRejectedValueOnce(
      new ApiError('jdbc secret', { status: 404 }),
    )
    routerState.search = `?detailMovementId=${movementId}&page=0&size=25`
    renderPage()
    expect(
      await screen.findByText(
        '单据或关联数据不存在，或当前账号无权访问。',
      ),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain('jdbc secret')
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('keeps read-only users able to inspect but hides every mutation', async () => {
    authState.permissions = new Set(['inventory.read'])
    routerState.search = `?detailMovementId=${movementId}&page=0&size=25`
    renderPage()
    await screen.findByText('商品明细')
    expect(screen.queryByRole('button', { name: '新增手工单' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑草稿' })).toBeNull()
    expect(screen.queryByRole('button', { name: '确认过账' })).toBeNull()
    expect(manualMovementApi.post).not.toHaveBeenCalled()
    expect(manualMovementApi.reverse).not.toHaveBeenCalled()
  })

  it('refuses a direct editor URL without write permission', async () => {
    authState.permissions = new Set(['inventory.read'])
    routerState.search = '?editor=create&page=0&size=25'
    renderPage()
    expect(
      await screen.findByRole('dialog', { name: '没有编辑权限' }),
    ).toBeTruthy()
    expect(manualMovementApi.create).not.toHaveBeenCalled()
  })

  it('keeps detail context and shows safe 409 and 403 transition errors', async () => {
    vi.mocked(manualMovementApi.get).mockResolvedValue({
      ...detail,
      summary: {
        ...summary,
        status: 'SUBMITTED',
        approvalStatus: 'APPROVED',
        submittedAt: now,
        reviewedAt: now,
        reviewedBy: '审核员',
        version: 2,
      },
    })
    vi.mocked(manualMovementApi.post)
      .mockRejectedValueOnce(
        new ApiError('internal optimistic lock', {
          status: 409,
          details: { reason: 'stale_version' },
        }),
      )
      .mockRejectedValueOnce(
        new ApiError('private permission detail', { status: 403 }),
      )
    routerState.search = `?detailMovementId=${movementId}&page=0&size=25`
    renderPage()
    await screen.findByText('商品明细')
    fireEvent.click(screen.getByRole('button', { name: '确认过账' }))
    expect(
      await screen.findByText(
        '单据已被其他操作更新。当前输入已保留，请刷新详情后重试。',
      ),
    ).toBeTruthy()
    expect(screen.getAllByText('MI-A470').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '确认过账' }))
    expect(
      await screen.findByText(
        '当前账号没有过账权限，登录状态保持不变。',
      ),
    ).toBeTruthy()
    expect(document.body.textContent).not.toContain('private')
  })
})

describe('ManualMovementPage draft creation and posting', () => {
  it('loads every bounded location page for the selected warehouse', async () => {
    vi.mocked(manualMovementApi.locationOptions)
      .mockResolvedValueOnce({
        items: [{
          id: locationId,
          warehouseId,
          businessCode: 'A-01',
          name: '拣货位 A-01',
        }],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{
          id: 'a4700000-0000-4000-8000-000000000014',
          warehouseId,
          businessCode: 'B-02',
          name: '拣货位 B-02',
        }],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )

    expect(
      await within(editor).findByRole('option', { name: /B-02/ }),
    ).toBeTruthy()
    expect(manualMovementApi.locationOptions).toHaveBeenNthCalledWith(
      2,
      warehouseId,
      '',
      1,
      200,
    )
  })

  it('enforces configured contact information and saves only entered fields', async () => {
    vi.mocked(manualMovementApi.settings).mockImplementation(
      async (direction) => ({
        direction,
        approvalRequired: false,
        unitPriceRequired: false,
        showCostPrice: false,
        costUpdatePolicy: 'NO_UPDATE',
        contactInformationRequired: true,
        version: 1,
      }),
    )
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )
    await within(editor).findByRole('option', { name: /A-01/ })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '商品 SKU' }),
      { target: { value: skuId } },
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '库位' }),
      { target: { value: locationId } },
    )
    fireEvent.click(
      within(editor).getByRole('button', { name: '添加明细' }),
    )
    fireEvent.click(
      within(editor).getByRole('button', { name: '保存草稿' }),
    )
    expect(
      within(editor).getByText(
        '当前出入库设置要求填写联系人、联系电话和联系地址。',
      ),
    ).toBeTruthy()
    expect(manualMovementApi.create).not.toHaveBeenCalled()

    fireEvent.change(
      within(editor).getByRole('textbox', { name: '发件人（必填）' }),
      { target: { value: '测试发件人' } },
    )
    fireEvent.change(
      within(editor).getByRole('textbox', { name: '联系电话（必填）' }),
      { target: { value: '010-12345678' } },
    )
    fireEvent.change(
      within(editor).getByRole('textbox', { name: '联系地址（必填）' }),
      { target: { value: '测试园区 1 号' } },
    )
    fireEvent.click(
      within(editor).getByRole('button', { name: '保存草稿' }),
    )

    await waitFor(() => expect(manualMovementApi.create).toHaveBeenCalled())
    expect(vi.mocked(manualMovementApi.create).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        contactName: '测试发件人',
        contactPhone: '010-12345678',
        contactAddress: '测试园区 1 号',
      }),
    )
  })

  it('creates a real draft with selected SKU and auxiliary location', async () => {
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    fireEvent.change(within(editor).getByRole('combobox', { name: '仓库' }), {
      target: { value: warehouseId },
    })
    await waitFor(() =>
      expect(manualMovementApi.locationOptions).toHaveBeenCalledWith(
        warehouseId,
        '',
        0,
        200,
      ),
    )
    fireEvent.change(within(editor).getByRole('combobox', { name: '商品 SKU' }), {
      target: { value: skuId },
    })
    fireEvent.change(within(editor).getByRole('combobox', { name: '库位' }), {
      target: { value: locationId },
    })
    fireEvent.change(within(editor).getByRole('spinbutton', { name: '数量' }), {
      target: { value: '7' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '添加明细' }))
    fireEvent.click(within(editor).getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(manualMovementApi.create).toHaveBeenCalled())
    expect(vi.mocked(manualMovementApi.create).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        warehouseId,
        direction: 'INBOUND',
        reasonCode: 'FOUND_STOCK',
        expectedVersion: 0,
        lines: [
          expect.objectContaining({
            skuId,
            locationId,
            quantity: 7,
          }),
        ],
      }),
    )
    expect(
      JSON.stringify(vi.mocked(manualMovementApi.create).mock.calls[0][0]),
    ).not.toContain('tenant')
  })

  it('confirms save-and-post, prevents duplicates and reports partial failure', async () => {
    const post = deferred<{
      movementId: string
      status: 'POSTED'
      version: number
      replayed: boolean
    }>()
    vi.mocked(manualMovementApi.post).mockReturnValueOnce(post.promise)
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    await within(editor).findByRole('option', { name: /SKU-A/ })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )
    await within(editor).findByRole('option', { name: /SKU-A/ })
    await within(editor).findByRole('option', { name: /A-01/ })
    fireEvent.change(within(editor).getByRole('combobox', { name: '商品 SKU' }), {
      target: { value: skuId },
    })
    fireEvent.change(within(editor).getByRole('combobox', { name: '库位' }), {
      target: { value: locationId },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '添加明细' }))
    await within(editor).findByText(/明细行 1 条/)
    const submit = within(editor).getByRole('button', { name: '保存并过账' })
    fireEvent.click(submit)
    const confirmation = within(editor).getByRole('alertdialog', {
      name: '确认保存并过账',
    })
    expect(confirmation.textContent).toContain(
      '过账会立即按当前明细更新仓库级库存余额。',
    )
    const confirm = within(confirmation).getByRole('button', {
      name: '确认保存并过账',
    })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(manualMovementApi.post).toHaveBeenCalledTimes(1))
    expect(
      within(editor).queryByRole('alertdialog', {
        name: '确认保存并过账',
      }),
    ).toBeNull()
    expect(
      within(editor).getByRole('button', { name: '正在提交…' }),
    ).toHaveProperty('disabled', true)
    post.resolve({
      movementId,
      status: 'POSTED',
      version: 1,
      replayed: false,
    })

    await waitFor(() => expect(routerState.push).toHaveBeenCalled())
  })

  it('keeps the saved draft when the following post returns 409', async () => {
    vi.mocked(manualMovementApi.post).mockRejectedValue(
      new ApiError('private', {
        status: 409,
        details: { reason: 'stale_version' },
      }),
    )
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )
    await within(editor).findByRole('option', { name: /SKU-A/ })
    await within(editor).findByRole('option', { name: /A-01/ })
    fireEvent.change(within(editor).getByRole('combobox', { name: '商品 SKU' }), {
      target: { value: skuId },
    })
    fireEvent.change(within(editor).getByRole('combobox', { name: '库位' }), {
      target: { value: locationId },
    })
    fireEvent.click(within(editor).getByRole('button', { name: '添加明细' }))
    await within(editor).findByText(/明细行 1 条/)
    fireEvent.click(within(editor).getByRole('button', { name: '保存并过账' }))
    fireEvent.click(
      within(editor).getByRole('button', { name: '确认保存并过账' }),
    )
    await waitFor(() => expect(manualMovementApi.post).toHaveBeenCalled())
    expect(lastUrl()).toContain(`detailMovementId=${movementId}`)
    expect(manualMovementApi.create).toHaveBeenCalledTimes(1)
  })
})

describe('ManualMovementPage archived menu workflow', () => {
  it('serializes approval, source, WMS, time and search dimensions to URL', () => {
    const parsed = parseManualMovementQuery(
      '?view=APPROVAL&approvalDirection=OUTBOUND' +
        '&approvalStatus=REJECTED&source=WMS&wmsStatus=FAILED' +
        '&searchField=OPERATOR&timeBucket=OLDER_THAN_THREE_MONTHS' +
        '&keyword=reviewer&page=3&size=50',
    )
    expect(parsed).toMatchObject({
      view: 'APPROVAL',
      approvalDirection: 'OUTBOUND',
      approvalStatus: 'REJECTED',
      source: 'WMS',
      wmsStatus: 'FAILED',
      searchField: 'OPERATOR',
      timeBucket: 'OLDER_THAN_THREE_MONTHS',
      keyword: 'reviewer',
      page: 3,
      size: 50,
    })
    const url = toManualMovementUrl(parsed)
    expect(url).toContain('view=APPROVAL')
    expect(url).toContain('approvalStatus=REJECTED')
    expect(url).toContain('searchField=OPERATOR')
  })

  it('loads pending approval view and performs exact batch approval', async () => {
    const pending = {
      ...summary,
      status: 'SUBMITTED' as const,
      approvalStatus: 'PENDING' as const,
      submittedAt: now,
      version: 1,
    }
    vi.mocked(manualMovementApi.list).mockResolvedValue({
      ...oneItemPage,
      items: [pending],
    })
    const view = renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: '审核' }))
    applyNavigation(view)
    await waitFor(() =>
      expect(manualMovementApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          approvalStatus: 'PENDING',
          page: 0,
        }),
      ),
    )
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '选择 MI-A470' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '批量通过' }),
    )
    await waitFor(() =>
      expect(manualMovementApi.batchReview).toHaveBeenCalledWith(
        [{ movementId, expectedVersion: 1 }],
        expect.any(String),
        true,
        undefined,
      ),
    )
  })

  it('requires and persists a reason for batch rejection', async () => {
    const pending = {
      ...summary,
      status: 'SUBMITTED' as const,
      approvalStatus: 'PENDING' as const,
      submittedAt: now,
      version: 1,
    }
    vi.mocked(manualMovementApi.list).mockResolvedValue({
      ...oneItemPage,
      items: [pending],
    })
    routerState.search =
      '?view=APPROVAL&approvalStatus=PENDING&page=0&size=25'
    renderPage()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '选择 MI-A470' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '批量不通过' }),
    )
    await waitFor(() =>
      expect(manualMovementApi.batchReview).toHaveBeenCalledWith(
        [{ movementId, expectedVersion: 1 }],
        expect.any(String),
        false,
        '箱清单需要复核',
      ),
    )
  })

  it('submits a draft, then requires approval before posting', async () => {
    const pendingDetail = {
      ...detail,
      summary: {
        ...summary,
        status: 'SUBMITTED' as const,
        approvalStatus: 'PENDING' as const,
        submittedAt: now,
        version: 1,
      },
    }
    vi.mocked(manualMovementApi.get)
      .mockResolvedValueOnce(detail)
      .mockResolvedValue(pendingDetail)
    routerState.search = `?detailMovementId=${movementId}&page=0&size=25`
    renderPage()
    await screen.findByText('商品明细')
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() =>
      expect(manualMovementApi.submit).toHaveBeenCalledWith(
        movementId,
        0,
        expect.any(String),
      ),
    )

    await screen.findByRole('button', { name: '审核通过' })
    expect(
      screen.queryByRole('button', { name: '确认过账' }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '审核通过' }))
    await waitFor(() =>
      expect(manualMovementApi.review).toHaveBeenCalledWith(
        movementId,
        1,
        expect.any(String),
        true,
        undefined,
      ),
    )
  })

  it('does not expose removed WMS operations while retaining history filters', async () => {
    const view = renderPage()
    await screen.findByRole('checkbox', { name: '选择 MI-A470' })
    expect(screen.queryByRole('button', { name: '取消 WMS' })).toBeNull()
    expect(screen.getByLabelText('WMS 状态')).toBeTruthy()
    expect(screen.getAllByText('未配置').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '新增手工单' }))
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    expect(within(editor).queryByRole('option', { name: /WMS/ })).toBeNull()
  })

  it('loads selected details and prints real SKU labels', async () => {
    const popupDocument = document.implementation.createHTMLDocument()
    const print = vi.fn()
    const close = vi.fn()
    const popup = {
      document: popupDocument,
      opener: window,
      print,
      close,
    } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    renderPage()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: '选择 MI-A470' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: '打印 SKU 标签' }),
    )

    await waitFor(() =>
      expect(manualMovementApi.get).toHaveBeenCalledWith(movementId),
    )
    expect(popupDocument.body.textContent).toContain('SKU-A · 商品 A')
    expect(popupDocument.body.textContent).toContain(
      'MI-A470 | WH-A | 数量 3',
    )
    expect(print).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('persists approval settings and movement type classification', async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '出入库设置' }),
    )
    const dialog = screen.getByRole('dialog', { name: '出入库设置' })
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: '过账前必须审核',
      }),
    )
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: '收件 / 发件联系信息必填',
      }),
    )
    fireEvent.click(
      within(dialog).getByRole('button', { name: '保存设置' }),
    )
    await waitFor(() =>
      expect(manualMovementApi.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalRequired: true,
          contactInformationRequired: true,
          version: 0,
        }),
        'INBOUND',
        expect.any(String),
      ),
    )
  })

  it('prefills the configured latest CNY manual price snapshot', async () => {
    vi.mocked(manualMovementApi.settings).mockImplementation(
      async (direction) => ({
        direction,
        approvalRequired: false,
        unitPriceRequired: false,
        showCostPrice: true,
        costUpdatePolicy: 'UPDATE_SNAPSHOT',
        contactInformationRequired: false,
        version: 1,
      }),
    )
    vi.mocked(manualMovementApi.priceSnapshot).mockResolvedValue({
      unitPrice: 12.5,
      currency: 'CNY',
      version: 2,
    })
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    await within(editor).findByRole('option', { name: /SKU-A/ })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '商品 SKU' }),
      { target: { value: skuId } },
    )
    await waitFor(() =>
      expect(manualMovementApi.priceSnapshot).toHaveBeenCalledWith(
        skuId,
        'INBOUND',
        expect.any(AbortSignal),
      ),
    )
    expect(
      (
        within(editor).getByRole('spinbutton', {
          name: '单价（CNY）',
        }) as HTMLInputElement
      ).value,
    ).toBe('12.5')
  })

  it('creates a boxed inbound draft with dimensions and composition', async () => {
    const view = renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: '新增手工单' }),
    )
    applyNavigation(view)
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )
    await waitFor(() =>
      expect(manualMovementApi.locationOptions).toHaveBeenCalled(),
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '录入方式' }),
      { target: { value: 'BOX' } },
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '箱号规则' }),
      { target: { value: 'UNIQUE_NUMBER' } },
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '商品 SKU' }),
      { target: { value: skuId } },
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '库位' }),
      { target: { value: locationId } },
    )
    fireEvent.change(
      within(editor).getByRole('textbox', { name: '自定义箱号' }),
      { target: { value: 'BOX-100' } },
    )
    fireEvent.click(
      within(editor).getByRole('button', { name: '加入箱清单' }),
    )
    expect(await within(editor).findByText('BOX-100')).toBeTruthy()
    fireEvent.click(
      within(editor).getByRole('button', { name: '保存草稿' }),
    )
    await waitFor(() =>
      expect(manualMovementApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entryMode: 'BOX',
          boxes: [
            expect.objectContaining({
              customBoxNo: 'BOX-100',
              boxCount: 1,
              boxNumberRule: 'UNIQUE_NUMBER',
              items: [{ skuId, quantityPerBox: 1 }],
            }),
          ],
        }),
      ),
    )
  })

  it('opens outbound creation in the selected view and selects box quantity', async () => {
    const boxStockId = 'a4700000-0000-4000-8000-000000000080'
    vi.mocked(manualMovementApi.boxStock).mockResolvedValueOnce({
      items: [
        {
          id: boxStockId,
          customBoxNo: 'BOX-STOCK-A',
          boxNumberRule: 'SHARED_NUMBER',
          lengthCm: 10,
          widthCm: 20,
          heightCm: 30,
          grossWeightKg: 2,
          items: [
            {
              skuId,
              skuBusinessCode: 'SKU-A',
              skuName: '商品 A',
              quantityPerBox: 3,
            },
          ],
          warehouseId,
          availableCount: 4,
          version: 0,
        },
      ],
      page: 0,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    }).mockResolvedValueOnce({
      items: [
        {
          id: 'a4700000-0000-4000-8000-000000000081',
          customBoxNo: 'BOX-STOCK-B',
          boxNumberRule: 'SHARED_NUMBER',
          lengthCm: 12,
          widthCm: 22,
          heightCm: 32,
          grossWeightKg: 2.5,
          items: [
            {
              skuId,
              skuBusinessCode: 'SKU-A',
              skuName: '商品 A',
              quantityPerBox: 1,
            },
          ],
          warehouseId,
          availableCount: 1,
          version: 0,
        },
      ],
      page: 1,
      size: 200,
      totalElements: 2,
      totalPages: 2,
    })
    routerState.search = '?view=OUTBOUND&editor=create&page=0&size=25'
    renderPage()
    const editor = await screen.findByRole('dialog', {
      name: '新增手工出入库单',
    })
    expect(
      (
        within(editor).getByRole('combobox', {
          name: '方向',
        }) as HTMLSelectElement
      ).value,
    ).toBe('OUTBOUND')
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '仓库' }),
      { target: { value: warehouseId } },
    )
    await within(editor).findByRole('option', { name: /A-01/ })
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '录入方式' }),
      { target: { value: 'BOX' } },
    )
    fireEvent.change(
      within(editor).getByRole('combobox', { name: '库位' }),
      { target: { value: locationId } },
    )
    const stockCount = await within(editor).findByRole('spinbutton', {
      name: 'BOX-STOCK-A 本次出库箱数',
    })
    expect(await within(editor).findByRole('spinbutton', {
      name: 'BOX-STOCK-B 本次出库箱数',
    })).toBeTruthy()
    expect(manualMovementApi.boxStock).toHaveBeenNthCalledWith(
      2,
      warehouseId,
      '',
      1,
      200,
    )
    fireEvent.change(stockCount, { target: { value: '2' } })
    const stockRow = stockCount.closest('tr')
    expect(stockRow).not.toBeNull()
    fireEvent.click(within(stockRow!).getByRole('button', { name: '选择箱子' }))
    expect(await within(editor).findByText(/总数量 6/)).toBeTruthy()
    fireEvent.click(
      within(editor).getByRole('button', { name: '保存草稿' }),
    )
    await waitFor(() =>
      expect(manualMovementApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'OUTBOUND',
          reasonCode: 'DAMAGED_STOCK',
          entryMode: 'BOX',
          boxes: [
            expect.objectContaining({
              sourceBoxStockId: boxStockId,
              boxCount: 2,
            }),
          ],
          lines: [
            expect.objectContaining({
              skuId,
              quantity: 6,
            }),
          ],
        }),
      ),
    )
  })
})

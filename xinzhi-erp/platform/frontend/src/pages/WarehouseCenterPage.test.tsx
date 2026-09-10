import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { shippingConfigurationApi } from '../modules/shippingConfigurationApi'
import { warehouseCenterApi } from '../modules/warehouseCenterApi'
import {
  WarehouseCenterPage,
  parseWarehouseCenterQuery,
  safeWarehouseMessage,
  toWarehouseCenterUrl,
} from './WarehouseCenterPage'

const routerState = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
}))
const authState = vi.hoisted(() => ({
  canWrite: true,
  canWriteShipping: true,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
  }) => (
    <a href={to} onClick={(event) => event.preventDefault()} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      permission === 'warehouses.write'
        ? authState.canWrite
        : permission === 'warehouses.shipping_config.write'
          ? authState.canWriteShipping
          : true,
  }),
}))

const warehouseId = '96000000-0000-4000-8000-000000000010'
const locationId = '96000000-0000-4000-8000-000000000020'
const otherLocationId = '96000000-0000-4000-8000-000000000021'
const warehouse = {
  id: warehouseId,
  businessCode: 'WH_NORTH',
  name: '北区仓',
  status: 'ACTIVE' as const,
  version: 2,
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T00:00:00Z',
}
const secondWarehouse = {
  ...warehouse,
  id: '96000000-0000-4000-8000-000000000011',
  businessCode: 'WH_SOUTH',
  name: '南区仓',
}
const location = {
  id: locationId,
  warehouseId,
  businessCode: 'A_01',
  name: '拣货 A-01',
  status: 'ACTIVE' as const,
  version: 1,
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T00:00:00Z',
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

beforeEach(() => {
  routerState.search = ''
  routerState.push.mockReset()
  authState.canWrite = true
  authState.canWriteShipping = true
  vi.spyOn(warehouseCenterApi, 'listWarehouses').mockResolvedValue({
    items: [warehouse],
    page: 0,
    size: 25,
    totalElements: 1,
    totalPages: 1,
  })
  vi.spyOn(warehouseCenterApi, 'listLocations').mockResolvedValue({
    items: [],
    page: 0,
    size: 25,
    totalElements: 0,
    totalPages: 0,
  })
  vi.spyOn(warehouseCenterApi, 'getWarehouse').mockResolvedValue(warehouse)
  vi.spyOn(warehouseCenterApi, 'getLocation').mockResolvedValue(location)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('WarehouseCenterPage', () => {
  it('opens warehouse-scoped shipping configuration without adding a menu', async () => {
    vi.spyOn(
      shippingConfigurationApi,
      'listWarehousePackaging',
    ).mockResolvedValue([])
    vi.spyOn(shippingConfigurationApi, 'listScales').mockResolvedValue([])
    vi.spyOn(shippingConfigurationApi, 'getTolerance').mockResolvedValue({
      toleranceGrams: 30,
      toleranceBasisPoints: 300,
      warehouseOverride: false,
    })
    render(<WarehouseCenterPage />)

    fireEvent.click(await screen.findByRole('button', { name: '发货配置' }))
    expect(
      await screen.findByRole('dialog', { name: '发货配置' }),
    ).toBeTruthy()
    expect(
      shippingConfigurationApi.listWarehousePackaging,
    ).toHaveBeenCalledWith(warehouse.id)
  })

  it('bounds shareable filters and discards invalid selected ids', () => {
    expect(
      parseWarehouseCenterQuery(
        `?includeInactive=yes&keyword=${'x'.repeat(120)}&page=-1&size=999&warehouseId=bad&detailWarehouseId=bad&detailLocationId=${locationId}`,
      ),
    ).toEqual(
      expect.objectContaining({
        includeInactive: false,
        showArchived: false,
        keyword: 'x'.repeat(100),
        page: 0,
        size: 25,
        detailWarehouseId: undefined,
        warehouseId: undefined,
        detailLocationId: undefined,
      }),
    )
    expect(
      toWarehouseCenterUrl({
        includeInactive: true,
        showArchived: false,
        keyword: 'north',
        page: 1,
        size: 25,
        detailWarehouseId: warehouseId,
        warehouseId,
        detailLocationId: locationId,
        locationStatus: 'INACTIVE',
        locationKeyword: 'a',
        locationPage: 2,
        locationSize: 25,
      }),
    ).toContain(`warehouseId=${warehouseId}`)
    expect(
      toWarehouseCenterUrl(
        {
          includeInactive: true,
          showArchived: false,
          keyword: 'north',
          page: 1,
          size: 25,
          warehouseId,
          detailLocationId: locationId,
          locationStatus: 'INACTIVE',
          locationKeyword: 'a',
          locationPage: 2,
          locationSize: 25,
        },
        '/warehouses/locations',
      ),
    ).toContain(`detailLocationId=${locationId}`)
    expect(
      toWarehouseCenterUrl({
        includeInactive: true,
        showArchived: false,
        keyword: 'north',
        page: 1,
        size: 25,
        detailWarehouseId: warehouseId,
        warehouseId,
        locationStatus: 'INACTIVE',
        locationKeyword: 'a',
        locationPage: 2,
        locationSize: 25,
      }),
    ).toContain(`detailWarehouseId=${warehouseId}`)
    expect(
      toWarehouseCenterUrl(
        {
          includeInactive: false,
          showArchived: false,
          keyword: '',
          page: 0,
          size: 25,
          locationKeyword: '',
          locationPage: 0,
          locationSize: 25,
        },
        '/warehouses/locations',
      ),
    ).toMatch(/^\/warehouses\/locations\?/)
  })

  it('safely normalizes legacy warehouse status URLs', () => {
    const active = parseWarehouseCenterQuery('?status=ACTIVE')
    expect(active).toEqual(
      expect.objectContaining({
        includeInactive: false,
        showArchived: false,
      }),
    )
    const inactive = parseWarehouseCenterQuery('?status=INACTIVE')
    expect(inactive).toEqual(
      expect.objectContaining({
        includeInactive: true,
        showArchived: false,
      }),
    )
    expect(toWarehouseCenterUrl(inactive)).toContain('includeInactive=true')

    const archived = parseWarehouseCenterQuery('?status=ARCHIVED')
    expect(archived).toEqual(
      expect.objectContaining({
        includeInactive: false,
        showArchived: true,
      }),
    )
    expect(toWarehouseCenterUrl(archived)).toContain('status=ARCHIVED')
  })

  it('keeps warehouse and location lists as separate entries without preloading locations', async () => {
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    expect(screen.getByRole('heading', { name: '仓库列表' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '仓库数据列表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增仓库' })).toBeTruthy()
    expect(screen.queryByLabelText('仓库属性')).toBeNull()
    expect(screen.queryByRole('button', { name: '仓库设置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '批量负库存设置' })).toBeNull()
    expect(screen.getByRole('button', { name: '导出筛选结果' }))
      .toHaveProperty('disabled', false)
    expect(warehouseCenterApi.listLocations).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '查看库位' }))
    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^/warehouses/locations\\?.*warehouseId=${warehouseId}`),
      ),
    )
  })

  it('downloads the current filtered warehouse result and announces success', async () => {
    routerState.search = '?includeInactive=true&keyword=north&page=3&size=25'
    const exportWarehouses = vi
      .spyOn(warehouseCenterApi, 'exportWarehouses')
      .mockResolvedValue({
        filename: 'warehouses.csv',
        mediaType: 'text/csv;charset=utf-8',
        rowCount: 1,
        content:
          '\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n北区仓,WH_NORTH,启用,2026-07-29T00:00:00Z,2026-07-29T00:00:00Z\r\n',
      })
    const createObjectURL = vi.fn(() => 'blob:warehouses')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(await screen.findByText('已导出 1 条仓库数据。')).toBeTruthy()
    expect(exportWarehouses).toHaveBeenCalledWith({
      status: undefined,
      keyword: 'north',
    })
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:warehouses')
  })

  it('announces a bounded recovery message when warehouse export is too large', async () => {
    vi.spyOn(warehouseCenterApi, 'exportWarehouses').mockRejectedValue(
      new ApiError('hidden detail', { status: 409 }),
    )

    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      '导出结果超过 10,000 条，请缩小筛选范围后重试。',
    )
  })

  it('downloads the current filtered location result and announces success', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&locationStatus=INACTIVE&locationKeyword=pick` +
      '&locationPage=3&locationSize=25'
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [{ ...location, status: 'INACTIVE' }],
      page: 3,
      size: 25,
      totalElements: 1,
      totalPages: 4,
    })
    const exportLocations = vi
      .spyOn(warehouseCenterApi, 'exportLocations')
      .mockResolvedValue({
        filename: 'warehouse-locations.csv',
        mediaType: 'text/csv;charset=utf-8',
        rowCount: 1,
        content:
          '\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n北区仓,WH_NORTH,拣货 A-01,A_01,停用,2026-07-29T00:00:00Z,2026-07-29T00:00:00Z\r\n',
      })
    const createObjectURL = vi.fn(() => 'blob:warehouse-locations')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(<WarehouseCenterPage view="locations" />)
    await screen.findByText('A_01')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect(await screen.findByText('已导出 1 条仓位数据。')).toBeTruthy()
    expect(exportLocations).toHaveBeenCalledWith(warehouseId, {
      status: 'INACTIVE',
      keyword: 'pick',
    })
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:warehouse-locations')
  })

  it('announces a bounded recovery message when location export is too large', async () => {
    routerState.search = `?warehouseId=${warehouseId}`
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [location],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })
    vi.spyOn(warehouseCenterApi, 'exportLocations').mockRejectedValue(
      new ApiError('hidden detail', { status: 409 }),
    )

    render(<WarehouseCenterPage view="locations" />)
    await screen.findByText('A_01')
    fireEvent.click(screen.getByRole('button', { name: '导出筛选结果' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      '导出结果超过 10,000 条，请缩小筛选范围后重试。',
    )
  })

  it('loads every bounded warehouse page into the location filter', async () => {
    vi.mocked(warehouseCenterApi.listWarehouses)
      .mockResolvedValueOnce({
        items: [warehouse],
        page: 0,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [secondWarehouse],
        page: 1,
        size: 200,
        totalElements: 2,
        totalPages: 2,
      })

    render(<WarehouseCenterPage view="locations" />)

    expect(
      await screen.findByRole('option', { name: /WH_SOUTH/ }),
    ).toBeTruthy()
    expect(warehouseCenterApi.listWarehouses).toHaveBeenNthCalledWith(
      2,
      {
        status: 'ACTIVE',
        keyword: undefined,
        page: 1,
        size: 200,
      },
    )
  })

  it('changes warehouse page size through a shareable URL and preserves legal custom sizes', async () => {
    routerState.search = '?page=2&size=17'
    vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValue({
      items: [warehouse],
      page: 2,
      size: 17,
      totalElements: 40,
      totalPages: 3,
    })

    render(<WarehouseCenterPage />)

    const pageSize = await screen.findByLabelText('仓库分页每页条数')
    expect((pageSize as HTMLSelectElement).value).toBe('17')
    fireEvent.change(pageSize, { target: { value: '50' } })

    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/warehouses\?.*page=0.*size=50/),
    )
  })

  it('keeps warehouse columns visible when the current filter is empty', async () => {
    vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    })

    render(<WarehouseCenterPage />)

    expect(await screen.findByText('当前筛选条件下没有仓库。')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '仓库名称' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '业务编码' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '版本' })).toBeNull()
  })

  it('keeps the location entry idle until a valid tenant warehouse is selected', async () => {
    render(<WarehouseCenterPage view="locations" />)
    await screen.findByRole('option', { name: '北区仓（WH_NORTH）' })
    expect(
      screen.getByText('请选择仓库后查询库位。'),
    ).toBeTruthy()
    expect(
      screen.queryByRole('region', { name: '仓库数据列表' }),
    ).toBeNull()
    expect(screen.getByRole('form', { name: '库位筛选' })).toBeTruthy()
    expect(screen.queryByLabelText('归档仓位图结构')).toBeNull()
    expect(screen.queryByLabelText('货架规格跳转')).toBeNull()
    expect(warehouseCenterApi.listLocations).not.toHaveBeenCalled()
  })

  it('selects a warehouse from the location workbench through a shareable URL', async () => {
    render(<WarehouseCenterPage view="locations" />)
    await screen.findByRole('option', { name: '北区仓（WH_NORTH）' })
    const warehouseSelect = screen.getByLabelText('仓库')
    fireEvent.change(warehouseSelect, { target: { value: warehouseId } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^/warehouses/locations\\?.*warehouseId=${warehouseId}`),
      ),
    )
    expect(warehouseCenterApi.listLocations).not.toHaveBeenCalled()
  })

  it('loads direct-entry warehouse context and hides location creation for an archived parent', async () => {
    routerState.search = `?warehouseId=${warehouseId}`
    vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    })
    vi.mocked(warehouseCenterApi.getWarehouse).mockResolvedValue({
      ...warehouse,
      status: 'ARCHIVED',
    })

    render(<WarehouseCenterPage view="locations" />)

    expect(
      await screen.findByRole('heading', {
        name: '北区仓 · 库位列表',
      }),
    ).toBeTruthy()
    expect(screen.getByText('仓库状态：已归档')).toBeTruthy()
    expect(screen.getByLabelText('仓库')).toHaveProperty(
      'value',
      warehouseId,
    )
    expect(warehouseCenterApi.getWarehouse).toHaveBeenCalledWith(warehouseId)
    expect(screen.queryByRole('button', { name: '新增库位' })).toBeNull()
  })

  it('changes location page size without losing the selected warehouse', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&locationPage=2&locationSize=50`
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [location],
      page: 2,
      size: 50,
      totalElements: 120,
      totalPages: 3,
    })

    render(<WarehouseCenterPage view="locations" />)

    const pageSize = await screen.findByLabelText('库位分页每页条数')
    fireEvent.change(pageSize, { target: { value: '100' } })

    const target = String(routerState.push.mock.calls.at(-1)?.[0])
    expect(target).toContain(`warehouseId=${warehouseId}`)
    expect(target).toContain('locationPage=0')
    expect(target).toContain('locationSize=100')
  })

  it('resets the location workbench to an unselected shareable URL', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&locationStatus=ACTIVE&locationKeyword=pick`
    render(<WarehouseCenterPage view="locations" />)
    await screen.findByRole('button', { name: '重置' })

    fireEvent.click(screen.getByRole('button', { name: '重置' }))

    const resetUrl = routerState.push.mock.calls.at(-1)?.[0] as string
    expect(resetUrl).toMatch(/^\/warehouses\/locations\?/)
    expect(resetUrl).not.toContain('warehouseId=')
    expect(resetUrl).not.toContain('locationStatus=')
    expect(resetUrl).toContain('locationKeyword=')
  })

  it('loads location detail only after URL selection and preserves list state on close', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&locationStatus=ACTIVE` +
      '&locationKeyword=pick&locationPage=2&locationSize=25'
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [location],
      page: 2,
      size: 25,
      totalElements: 60,
      totalPages: 3,
    })
    const getLocation = vi.mocked(warehouseCenterApi.getLocation)

    const { rerender } = render(<WarehouseCenterPage view="locations" />)
    const trigger = await screen.findByRole('button', {
      name: '查看库位详情：拣货 A-01',
    })
    expect(getLocation).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    expect(getLocation).not.toHaveBeenCalled()
    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringContaining(`detailLocationId=${locationId}`),
    )

    routerState.search += `&detailLocationId=${locationId}`
    rerender(<WarehouseCenterPage view="locations" />)
    const dialog = await screen.findByRole('dialog', { name: '库位详情' })
    expect(getLocation).toHaveBeenCalledWith(warehouseId, locationId)
    expect(dialog.textContent).toContain('A_01')
    expect(dialog.textContent).toContain('拣货 A-01')
    expect(dialog.textContent).not.toContain('tenantId')

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    const closeUrl = routerState.push.mock.calls.at(-1)?.[0] as string
    expect(closeUrl).toContain(`warehouseId=${warehouseId}`)
    expect(closeUrl).toContain('locationStatus=ACTIVE')
    expect(closeUrl).toContain('locationKeyword=pick')
    expect(closeUrl).toContain('locationPage=2')
    expect(closeUrl).not.toContain('detailLocationId')

    routerState.search = closeUrl.split('?')[1]
      ? `?${closeUrl.split('?')[1]}`
      : ''
    rerender(<WarehouseCenterPage view="locations" />)
    expect(screen.queryByRole('dialog', { name: '库位详情' })).toBeNull()

    routerState.search += `&detailLocationId=${locationId}`
    rerender(<WarehouseCenterPage view="locations" />)
    expect(await screen.findByRole('dialog', { name: '库位详情' })).toBeTruthy()
    expect(getLocation).toHaveBeenCalledTimes(2)
  })

  it('shows location detail loading and a safe retryable 404', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&detailLocationId=${locationId}`
    const pending = deferred<typeof location>()
    vi.mocked(warehouseCenterApi.getLocation)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(location)

    render(<WarehouseCenterPage view="locations" />)
    expect(await screen.findByText('正在加载库位详情')).toBeTruthy()

    pending.reject(
      new ApiError('private location repository detail', { status: 404 }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('仓库或库位不存在')
    expect(alert.textContent).not.toContain('private location repository detail')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect(warehouseCenterApi.getLocation).toHaveBeenCalledTimes(2),
    )
    expect(await screen.findByText('A_01')).toBeTruthy()
  })

  it('ignores a stale location detail response after URL navigation', async () => {
    routerState.search =
      `?warehouseId=${warehouseId}&detailLocationId=${locationId}`
    const first = deferred<typeof location>()
    const second = deferred<typeof location>()
    vi.mocked(warehouseCenterApi.getLocation).mockImplementation(
      (_warehouseId, requestedLocationId) =>
        requestedLocationId === locationId ? first.promise : second.promise,
    )
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    })

    const { rerender } = render(<WarehouseCenterPage view="locations" />)
    expect(await screen.findByText('正在加载库位详情')).toBeTruthy()

    routerState.search =
      `?warehouseId=${warehouseId}&detailLocationId=${otherLocationId}`
    rerender(<WarehouseCenterPage view="locations" />)
    const otherLocation = {
      ...location,
      id: otherLocationId,
      businessCode: 'B_02',
      name: '复核 B-02',
    }
    second.resolve(otherLocation)
    expect(await screen.findByText('B_02')).toBeTruthy()

    first.resolve(location)
    await waitFor(() =>
      expect(screen.queryByText('A_01')).toBeNull(),
    )
    expect(screen.getByText('复核 B-02')).toBeTruthy()
  })

  it('traps location detail focus and restores the matching trigger', async () => {
    routerState.search = `?warehouseId=${warehouseId}`
    vi.mocked(warehouseCenterApi.listLocations).mockResolvedValue({
      items: [location],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const { rerender } = render(<WarehouseCenterPage view="locations" />)
    const trigger = await screen.findByRole('button', {
      name: '查看库位详情：拣货 A-01',
    })
    trigger.focus()
    fireEvent.click(trigger)

    routerState.search =
      `?warehouseId=${warehouseId}&detailLocationId=${locationId}`
    rerender(<WarehouseCenterPage view="locations" />)
    const close = await screen.findByRole('button', { name: '关闭' })
    await waitFor(() => expect(document.activeElement).toBe(close))

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(routerState.push).toHaveBeenCalledWith(
      expect.not.stringContaining('detailLocationId'),
    )
    routerState.search = `?warehouseId=${warehouseId}`
    rerender(<WarehouseCenterPage view="locations" />)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('applies warehouse filters through a shareable URL', async () => {
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    fireEvent.click(screen.getByLabelText('显示已停用仓库'))
    fireEvent.change(screen.getByLabelText('仓库名称'), {
      target: { value: ' west ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringContaining('includeInactive=true'),
    )
    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringContaining('keyword=west'),
    )
  })

  it('defaults to active warehouses and restores the inactive filter from URL', async () => {
    const { rerender } = render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    expect(warehouseCenterApi.listWarehouses).toHaveBeenLastCalledWith({
      status: 'ACTIVE',
      keyword: undefined,
      page: 0,
      size: 25,
    })

    routerState.search = '?includeInactive=true&page=2&size=25'
    rerender(<WarehouseCenterPage />)
    await waitFor(() =>
      expect(warehouseCenterApi.listWarehouses).toHaveBeenLastCalledWith({
        status: undefined,
        keyword: undefined,
        page: 2,
        size: 25,
      }),
    )
    expect(screen.getByLabelText('显示已停用仓库')).toHaveProperty(
      'checked',
      true,
    )
  })

  it('restores a discoverable read-only archived warehouse view', async () => {
    routerState.search = '?status=ARCHIVED&page=1&size=25'
    render(<WarehouseCenterPage />)

    await waitFor(() =>
      expect(warehouseCenterApi.listWarehouses).toHaveBeenLastCalledWith({
        status: 'ARCHIVED',
        keyword: undefined,
        page: 1,
        size: 25,
      }),
    )
    expect(screen.getByLabelText('仓库范围')).toHaveProperty(
      'value',
      'archived',
    )
    expect(screen.getByLabelText('显示已停用仓库')).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('writes the archived warehouse selection to a shareable URL', async () => {
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')

    fireEvent.change(screen.getByLabelText('仓库范围'), {
      target: { value: 'archived' },
    })
    expect(screen.getByLabelText('显示已停用仓库')).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringContaining('status=ARCHIVED'),
    )
  })

  it('loads warehouse detail only after a safe URL selection', async () => {
    const getWarehouse = vi.mocked(warehouseCenterApi.getWarehouse)
    const { rerender } = render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    expect(getWarehouse).not.toHaveBeenCalled()

    const trigger = screen.getByRole('button', {
      name: '查看仓库详情：北区仓',
    })
    fireEvent.click(trigger)
    expect(getWarehouse).not.toHaveBeenCalled()
    expect(routerState.push).toHaveBeenCalledWith(
      expect.stringContaining(`detailWarehouseId=${warehouseId}`),
    )

    routerState.search = `?detailWarehouseId=${warehouseId}`
    rerender(<WarehouseCenterPage />)
    const dialog = await screen.findByRole('dialog', { name: '仓库详情' })
    expect(getWarehouse).toHaveBeenCalledWith(warehouseId)
    expect(dialog.textContent).toContain('WH_NORTH')
    expect(dialog.textContent).toContain('北区仓')
    expect(dialog.textContent).not.toContain('tenantId')
  })

  it('does not request detail for an invalid URL id', async () => {
    routerState.search = '?detailWarehouseId=not-a-uuid'
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    expect(warehouseCenterApi.getWarehouse).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '仓库详情' })).toBeNull()
  })

  it('shows detail loading and a safe retryable error', async () => {
    routerState.search = `?detailWarehouseId=${warehouseId}`
    const getWarehouse = vi.mocked(warehouseCenterApi.getWarehouse)
    getWarehouse.mockReturnValueOnce(new Promise<typeof warehouse>(() => undefined))
    const { unmount } = render(<WarehouseCenterPage />)
    expect(await screen.findByText('正在加载仓库详情')).toBeTruthy()
    unmount()

    getWarehouse.mockRejectedValueOnce(
      new ApiError('private repository detail', { status: 404 }),
    )
    render(<WarehouseCenterPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('仓库或库位不存在')
    expect(alert.textContent).not.toContain('private repository detail')
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('traps detail focus, closes with Escape, and restores its trigger', async () => {
    const { rerender } = render(<WarehouseCenterPage />)
    const trigger = await screen.findByRole('button', {
      name: '查看仓库详情：北区仓',
    })
    trigger.focus()
    fireEvent.click(trigger)

    routerState.search = `?detailWarehouseId=${warehouseId}`
    rerender(<WarehouseCenterPage />)
    const close = await screen.findByRole('button', { name: '关闭' })
    await waitFor(() => expect(document.activeElement).toBe(close))

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(routerState.push).toHaveBeenCalledWith(
      expect.not.stringContaining('detailWarehouseId'),
    )
    routerState.search = ''
    rerender(<WarehouseCenterPage />)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('creates a location through the real dialog interaction', async () => {
    routerState.search = `?warehouseId=${warehouseId}`
    const createLocation = vi
      .spyOn(warehouseCenterApi, 'createLocation')
      .mockResolvedValue({
        id: '96000000-0000-4000-8000-000000000020',
        warehouseId,
        businessCode: 'A_01',
        name: '拣货 A-01',
        status: 'ACTIVE',
        version: 0,
        createdAt: '2026-07-29T00:00:00Z',
        updatedAt: '2026-07-29T00:00:00Z',
      })

    render(<WarehouseCenterPage view="locations" />)
    expect(screen.getByRole('heading', { name: '库位列表' })).toBeTruthy()
    expect(
      screen.getByText('此页面用于维护库位资料。'),
    ).toBeTruthy()
    await screen.findByText('当前筛选条件下没有库位。')
    fireEvent.click(screen.getByRole('button', { name: '新增库位' }))
    expect(screen.getByRole('dialog', { name: '新增库位' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('业务编码'), {
      target: { value: 'a_01' },
    })
    fireEvent.change(screen.getByLabelText('库位名称'), {
      target: { value: '拣货 A-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(createLocation).toHaveBeenCalledWith(warehouseId, {
        businessCode: 'a_01',
        name: '拣货 A-01',
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '新增库位' }),
      ).toBeNull(),
    )
  })

  it('confirms archive, preserves the dialog on conflict, and hides server detail', async () => {
    vi.spyOn(warehouseCenterApi, 'archiveWarehouse').mockRejectedValue(
      new ApiError('database version 99 secret', {
        status: 409,
        code: 'resource_conflict',
      }),
    )
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    fireEvent.click(screen.getByRole('button', { name: '归档' }))
    expect(
      screen.getByText('必须先归档该仓库下全部未归档库位。', {
        exact: false,
      }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('当前状态不允许')
    expect(alert.textContent).not.toContain('version 99')
    expect(screen.getByRole('dialog', { name: '确认归档仓库' })).toBeTruthy()
  })

  it('does not render mutation controls without warehouses.write', async () => {
    authState.canWrite = false
    render(<WarehouseCenterPage />)
    await screen.findByText('WH_NORTH')
    expect(screen.queryByRole('button', { name: '新增仓库' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '停用' })).toBeNull()
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull()
  })

  it('does not render location mutations without warehouses.write', async () => {
    authState.canWrite = false
    routerState.search = `?warehouseId=${warehouseId}`
    render(<WarehouseCenterPage view="locations" />)
    await screen.findByText('当前筛选条件下没有库位。')
    expect(screen.queryByRole('button', { name: '新增库位' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: '库位名称' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '库位编码' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: '版本' })).toBeNull()
  })

  it('keeps nested location errors generic at the direct entry', async () => {
    routerState.search = `?warehouseId=${warehouseId}`
    vi.spyOn(warehouseCenterApi, 'listLocations').mockRejectedValue(
      new ApiError('private tenant lookup detail', { status: 403 }),
    )

    render(<WarehouseCenterPage view="locations" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('没有读取库位所需权限')
    expect(alert.textContent).not.toContain('private tenant lookup detail')
  })

  it('keeps protocol errors generic for tenant and concurrency failures', () => {
    for (const status of [401, 403, 404, 409]) {
      expect(
        safeWarehouseMessage(
          new ApiError('private database detail', { status }),
          '读取仓库',
        ),
      ).not.toContain('private database detail')
    }
  })

  it('explains invalid warehouse business codes without exposing backend details', () => {
    const message = safeWarehouseMessage(
      new ApiError('private validation detail', { status: 400 }),
      '新增仓库',
    )

    expect(message).toContain('必须以字母开头')
    expect(message).not.toContain('private validation detail')
  })
})

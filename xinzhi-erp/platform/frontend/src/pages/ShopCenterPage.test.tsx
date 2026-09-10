import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  shopCenterApi,
  type Page,
  type PlatformCatalogEntry,
  type ShopSyncJob,
  type TenantShop,
} from '../modules/shopCenterApi'
import {
  isCreatablePlatform,
  loadPlatformDirectory,
  normalizeShopifyShopReference,
  parseShopCenterQuery,
  platformDisplayName,
  ShopDateTime,
  ShopCenterPage,
  ShopCenterActions,
  ShopTable,
  shopExportCsv,
  toShopDetailHref,
  toShopCenterUrl,
} from './ShopCenterPage'

const routerMocks = {
  search: '?page=3&size=25',
  push: vi.fn(),
  permissions: new Set(['shop:read', 'platform:read']),
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useRouter: () => ({ history: { push: routerMocks.push } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => string }) =>
    select({ location: { searchStr: routerMocks.search } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => routerMocks.permissions.has(permission) }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  routerMocks.push.mockReset()
  routerMocks.search = '?page=3&size=25'
  routerMocks.permissions = new Set(['shop:read', 'platform:read'])
})

const sampleShop: TenantShop = {
  id: 'shop-1',
  platformId: 'platform-1',
  externalShopRef: 'safe-reference',
  displayName: 'Example shop',
  status: 'ACTIVE',
  authorization: {
    status: 'AUTHORIZED',
    credentialConfigured: true,
    credentialReferenceType: 'vault',
    scopes: [],
    authorizedAt: '2026-07-28T08:00:00Z',
    expiresAt: '2026-08-28T08:00:00Z',
    lastVerifiedAt: '2026-07-28T09:00:00Z',
    safeErrorSummary: '已脱敏的授权错误摘要',
  },
  createdAt: '2026-07-28T08:00:00Z',
  updatedAt: '2026-07-28T10:00:00Z',
}

function page<T>(items: T[]): Page<T> {
  return { items, page: 0, size: 25, totalElements: items.length, totalPages: 2 }
}

function platformPage(items: PlatformCatalogEntry[]): Page<PlatformCatalogEntry> {
  return { items, page: 0, size: 200, totalElements: items.length, totalPages: items.length > 0 ? 1 : 0 }
}

describe('platform directory loading', () => {
  it('loads every platform page before exposing filter and onboarding options', async () => {
    const firstPlatforms: PlatformCatalogEntry[] = Array.from(
      { length: 200 },
      (_, index) => ({
        id: `platform-${index}`,
        code: `PLATFORM_${index}`,
        displayName: `Platform ${index}`,
        status: 'ACTIVE',
      }),
    )
    const secondPlatform: PlatformCatalogEntry = {
      id: 'platform-200', code: 'SHOPIFY', displayName: 'Shopify second', status: 'ACTIVE',
    }
    const listPlatforms = vi.spyOn(shopCenterApi, 'listPlatforms')
      .mockResolvedValueOnce({
        items: firstPlatforms, page: 0, size: 200, totalElements: 201, totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [secondPlatform], page: 1, size: 200, totalElements: 201, totalPages: 2,
      })
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue(page([]))

    render(<ShopCenterPage />)

    const platformFilter = await screen.findByLabelText('平台')
    expect(within(platformFilter).getByRole('option', { name: 'Shopify' })).toBeTruthy()
    expect(listPlatforms).toHaveBeenNthCalledWith(1, {
      includeArchived: false, page: 0, size: 200,
    })
    expect(listPlatforms).toHaveBeenNthCalledWith(2, {
      includeArchived: false, page: 1, size: 200,
    })
  })

  it('fails closed when platform pagination changes during loading', async () => {
    const platform: PlatformCatalogEntry = {
      id: 'platform-1', code: 'SHOPIFY', displayName: 'Shopify', status: 'ACTIVE',
    }
    vi.spyOn(shopCenterApi, 'listPlatforms')
      .mockResolvedValueOnce({
        items: [platform], page: 0, size: 200, totalElements: 201, totalPages: 2,
      })
      .mockResolvedValueOnce({
        items: [{ ...platform, id: 'platform-2' }],
        page: 1, size: 200, totalElements: 202, totalPages: 2,
      })

    await expect(loadPlatformDirectory(true)).rejects.toThrow(
      'Inconsistent platform directory pagination',
    )
  })
})

describe('ShopCenterPage presentation', () => {
  it('exports only safe shop fields and protects spreadsheet formulas', () => {
    const csv = shopExportCsv(
      [{
        ...sampleShop,
        displayName: '=unsafe shop',
        authorization: {
          ...sampleShop.authorization,
          credentialReference: 'vault://secret',
          safeErrorSummary: 'internal safe error',
        },
      } as TenantShop],
      new Map([['platform-1', 'Shopify']]),
    )

    expect(csv).toContain("'=unsafe shop,safe-reference,Shopify")
    expect(csv).toContain('店铺名称,平台店铺标识,平台,店铺状态,授权状态')
    expect(csv).not.toContain('vault://secret')
    expect(csv).not.toContain('internal safe error')
  })

  it('validates shareable filters and serializes only the allowlisted parameters', () => {
    expect(parseShopCenterQuery('?page=-1&size=999&includeArchived=yes')).toEqual({
      page: 0,
      size: 25,
      includeArchived: false,
      query: undefined,
      platformId: undefined,
      status: undefined,
      authorizationStatus: undefined,
    })
    expect(parseShopCenterQuery('?query=%20Example%20&platformId=10000000-0000-4000-8000-000000000001&status=ACTIVE&authorizationStatus=AUTHORIZED&page=2&size=25')).toEqual({
      includeArchived: false,
      page: 2,
      size: 25,
      query: 'Example',
      platformId: '10000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      authorizationStatus: 'AUTHORIZED',
    })
    expect(parseShopCenterQuery('?query=%20%20&platformId=not-a-uuid&status=UNKNOWN&authorizationStatus=UNKNOWN').query).toBeUndefined()
    expect(toShopCenterUrl({
      page: 2,
      size: 25,
      includeArchived: true,
      query: 'Example',
      platformId: '10000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      authorizationStatus: 'AUTHORIZED',
    })).toBe(
      '/shops?includeArchived=true&page=2&size=25&query=Example&platformId=10000000-0000-4000-8000-000000000001&status=ACTIVE&authorizationStatus=AUTHORIZED',
    )
  })

  it('keeps other filters usable when the platform directory fails and applies them from page one', async () => {
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue(page([]))
    vi.spyOn(shopCenterApi, 'listPlatforms').mockRejectedValue(new Error('directory unavailable'))

    render(<ShopCenterPage />)

    await screen.findByText('平台目录不可用，其他筛选仍可使用。')
    const keyword = screen.getByLabelText('搜索内容')
    fireEvent.change(keyword, { target: { value: '  Example  ' } })
    fireEvent.change(screen.getByLabelText('店铺状态'), { target: { value: 'ACTIVE' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith(
      '/shops?includeArchived=false&page=0&size=25&query=Example&status=ACTIVE',
    ))
    expect((screen.getByLabelText('平台') as HTMLSelectElement).disabled).toBe(true)
  })

  it('keeps a legal custom page size visible in the filter controls', async () => {
    routerMocks.search = '?page=0&size=17'
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue({
      ...page([]),
      size: 17,
    })
    vi.spyOn(shopCenterApi, 'listPlatforms').mockResolvedValue(platformPage([]))

    render(<ShopCenterPage />)

    expect(
      (await screen.findByLabelText('每页数量') as HTMLSelectElement).value,
    ).toBe('17')
  })

  it('offers only active supported platforms and revalidates a tampered submission', async () => {
    const activeShopifyPlatform: PlatformCatalogEntry = {
      id: 'platform-active',
      code: 'SHOPIFY',
      displayName: '可创建 Shopify 平台',
      status: 'ACTIVE',
    }
    const activeNonShopifyPlatform: PlatformCatalogEntry = {
      id: 'platform-active-non-shopify',
      code: 'WOOCOMMERCE',
      displayName: '未批准平台',
      status: 'ACTIVE',
    }
    const activeOtherPlatform: PlatformCatalogEntry = {
      id: 'platform-other',
      code: 'OTHER',
      displayName: '其他平台',
      status: 'ACTIVE',
    }
    const inactivePlatform: PlatformCatalogEntry = {
      id: 'platform-inactive',
      code: 'SHOPIFY',
      displayName: '停用 Shopify 平台',
      status: 'INACTIVE',
    }
    const archivedPlatform: PlatformCatalogEntry = {
      id: 'platform-archived',
      code: 'SHOPIFY',
      displayName: '归档 Shopify 平台',
      status: 'ARCHIVED',
    }
    routerMocks.permissions = new Set(['shop:read', 'shop:write', 'shop:authorization:write', 'platform:read'])
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue(page([]))
    vi.spyOn(shopCenterApi, 'listPlatforms').mockResolvedValue(platformPage([
      activeShopifyPlatform,
      activeOtherPlatform,
      activeNonShopifyPlatform,
      inactivePlatform,
      archivedPlatform,
    ]))
    const createShop = vi.spyOn(shopCenterApi, 'createShop').mockResolvedValue(sampleShop)
    const authorizeShopify = vi.spyOn(shopCenterApi, 'authorizeShopify').mockResolvedValue({
      snapshot: {
        mode: 'XZ_ERP_APP',
        shopify: { status: 'PENDING' },
        shopifyScopes: [],
        activity: [],
      },
      authorizationUrl: 'https://authorization.example/shopify/oauth/authorize?grant=safe',
    })
    const openWindow = vi.spyOn(window, 'open')

    render(<ShopCenterPage />)
    await screen.findByText('尚无店铺')
    fireEvent.click(screen.getByRole('button', { name: '新增店铺' }))

    const onboardingDialog = screen.getByRole('dialog', { name: '新增店铺' })
    const platformSelect = within(onboardingDialog).getByLabelText('平台')
    await within(platformSelect).findByRole('option', { name: 'Shopify' })
    expect(within(platformSelect).getByRole('option', { name: '其他平台' })).toBeTruthy()
    expect(within(platformSelect).queryByRole('option', { name: /WOOCOMMERCE/ })).toBeNull()
    expect(within(platformSelect).queryByRole('option', { name: /停用/ })).toBeNull()
    expect(within(platformSelect).queryByRole('option', { name: /归档/ })).toBeNull()
    expect(platformDisplayName(activeShopifyPlatform)).toBe('Shopify')
    expect(isCreatablePlatform(activeShopifyPlatform)).toBe(true)
    expect(isCreatablePlatform(activeOtherPlatform)).toBe(true)
    expect(isCreatablePlatform(activeNonShopifyPlatform)).toBe(false)
    expect(isCreatablePlatform(inactivePlatform)).toBe(false)
    expect(isCreatablePlatform(archivedPlatform)).toBe(false)

    fireEvent.change(screen.getByLabelText('Shopify 店铺 ID 或域名'), { target: { value: 'store-1' } })
    expect(screen.queryByLabelText('店铺名称')).toBeNull()
    expect(screen.getByText(/授权成功后会从 Shopify 自动读取店铺名称/)).toBeTruthy()
    const injectedOption = document.createElement('option')
    injectedOption.value = activeNonShopifyPlatform.id
    injectedOption.textContent = '被篡改的非 Shopify 平台'
    platformSelect.append(injectedOption)
    fireEvent.change(platformSelect, { target: { value: activeNonShopifyPlatform.id } })
    await waitFor(() => expect((platformSelect as HTMLSelectElement).value)
      .toBe(activeShopifyPlatform.id))
    expect(createShop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))

    await waitFor(() => expect(createShop).toHaveBeenCalledWith({
      platformId: activeShopifyPlatform.id,
      externalShopRef: 'store-1.myshopify.com',
    }))
    await screen.findByRole('button', { name: '复制安装链接' })
    expect(authorizeShopify).toHaveBeenCalledWith(sampleShop.id)
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('creates multiple named internal stores without Shopify authorization', async () => {
    const shopifyPlatform: PlatformCatalogEntry = {
      id: 'platform-shopify', code: 'SHOPIFY', displayName: 'Shopify', status: 'ACTIVE',
    }
    const otherPlatform: PlatformCatalogEntry = {
      id: 'platform-other', code: 'OTHER', displayName: '其他平台', status: 'ACTIVE',
    }
    const internalShop: TenantShop = {
      ...sampleShop,
      id: 'internal-shop-1',
      platformId: otherPlatform.id,
      externalShopRef: 'internal-10000000-0000-4000-8000-000000000001',
      displayName: '线下订单一店',
      authorization: {
        status: 'NOT_REQUIRED', credentialConfigured: false, scopes: [],
      },
    }
    routerMocks.permissions = new Set(['shop:read', 'shop:write', 'platform:read'])
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue(page([]))
    vi.spyOn(shopCenterApi, 'listPlatforms').mockResolvedValue(
      platformPage([shopifyPlatform, otherPlatform]),
    )
    const createShop = vi.spyOn(shopCenterApi, 'createShop').mockResolvedValue(internalShop)
    const authorizeShopify = vi.spyOn(shopCenterApi, 'authorizeShopify')

    render(<ShopCenterPage />)
    await screen.findByText('尚无店铺')
    fireEvent.click(screen.getByRole('button', { name: '新增店铺' }))
    const dialog = screen.getByRole('dialog', { name: '新增店铺' })
    fireEvent.change(within(dialog).getByLabelText('平台'), {
      target: { value: otherPlatform.id },
    })
    fireEvent.change(within(dialog).getByLabelText('内部店铺名称'), {
      target: { value: ' 线下订单一店 ' },
    })
    expect(within(dialog).queryByLabelText('Shopify 店铺 ID 或域名')).toBeNull()
    expect(within(dialog).getByText('内部店铺无需绑定或授权，可直接用于现有订单和审单流程。')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '创建店铺' }))

    await waitFor(() => expect(createShop).toHaveBeenCalledWith({
      platformId: otherPlatform.id,
      displayName: '线下订单一店',
    }))
    expect(authorizeShopify).not.toHaveBeenCalled()
    expect(await within(dialog).findByText('内部店铺创建成功')).toBeTruthy()
    expect(within(dialog).getByText('无需绑定外部平台')).toBeTruthy()
  })

  it('normalizes Shopify store IDs without accepting arbitrary domains', () => {
    expect(normalizeShopifyShopReference(' My-Store ')).toBe('my-store.myshopify.com')
    expect(normalizeShopifyShopReference('my-store.myshopify.com')).toBe('my-store.myshopify.com')
    expect(normalizeShopifyShopReference('admin.shopify.com/store/my-store')).toBeNull()
    expect(normalizeShopifyShopReference('example.com')).toBeNull()
  })

  it('marks retained rows busy and ignores stale results after URL filters change', async () => {
    let resolveSecond: (value: Page<TenantShop>) => void = () => undefined
    let resolveThird: (value: Page<TenantShop>) => void = () => undefined
    const second = new Promise<Page<TenantShop>>((resolve) => { resolveSecond = resolve })
    const third = new Promise<Page<TenantShop>>((resolve) => { resolveThird = resolve })
    routerMocks.permissions = new Set(['shop:read'])
    routerMocks.search = '?query=first&page=0&size=25'
    const listShops = vi.spyOn(shopCenterApi, 'listShops')
      .mockResolvedValueOnce(page([{ ...sampleShop, id: 'first', displayName: 'Retained result' }]))
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third)

    const view = render(<ShopCenterPage />)
    await screen.findByText('Retained result')

    routerMocks.search = '?query=second&page=0&size=25'
    view.rerender(<ShopCenterPage />)
    await waitFor(() => expect(listShops).toHaveBeenCalledTimes(2))
    expect(screen.getByText('正在刷新店铺列表')).toBeTruthy()
    expect(screen.getByText('Retained result')).toBeTruthy()
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true)

    routerMocks.search = '?query=third&page=0&size=25'
    view.rerender(<ShopCenterPage />)
    await waitFor(() => expect(listShops).toHaveBeenCalledTimes(3))

    resolveSecond(page([{ ...sampleShop, id: 'second', displayName: 'Stale result' }]))
    await waitFor(() => expect(screen.queryByText('Stale result')).toBeNull())
    resolveThird(page([{ ...sampleShop, id: 'third', displayName: 'Current result' }]))
    await screen.findByText('Current result')
    expect(screen.queryByText('Retained result')).toBeNull()
    expect(screen.queryByText('正在刷新店铺列表')).toBeNull()
  })

  it('shows a clear empty state and preserves pagination controls for populated results', () => {
    const onPageChange = vi.fn()
    const view = render(
      <ShopTable
        page={{ ...page([]), totalPages: 0 }}
        platforms={new Map()}
        platformDirectoryUnavailable={false}
        canReadPlatforms={false}
        canReadSync={false}
        listContext="/shops?includeArchived=false&page=0&size=25"
        syncStates={{}}
        onInspectSync={vi.fn()}
        onPageChange={onPageChange}
      />,
    )
    expect(screen.getByText('尚无店铺')).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: '店铺' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: '平台' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: '授权状态 / 验证' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('columnheader', { name: '操作' }),
    ).toBeTruthy()

    view.rerender(
      <ShopTable
        page={page([sampleShop])}
        platforms={new Map([['platform-1', '安全平台名称']])}
        platformDirectoryUnavailable={false}
        canReadPlatforms={true}
        canReadSync={false}
        listContext="/shops?includeArchived=false&page=0&size=25"
        syncStates={{}}
        onInspectSync={vi.fn()}
        onPageChange={onPageChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('selects one shop or the whole current page for bounded export', () => {
    const onSelectionChange = vi.fn()
    const secondShop = { ...sampleShop, id: 'shop-2', displayName: 'Second shop' }
    const { rerender } = render(
      <ShopTable
        page={page([sampleShop, secondShop])}
        platforms={new Map([['platform-1', 'Shopify']])}
        platformDirectoryUnavailable={false}
        canReadPlatforms
        canReadSync={false}
        listContext="/shops?includeArchived=false&page=0&size=25"
        syncStates={{}}
        selected={new Set()}
        onSelectionChange={onSelectionChange}
        onInspectSync={vi.fn()}
        onPageChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '选择店铺 Example shop' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['shop-1']))

    rerender(
      <ShopTable
        page={page([sampleShop, secondShop])}
        platforms={new Map([['platform-1', 'Shopify']])}
        platformDirectoryUnavailable={false}
        canReadPlatforms
        canReadSync={false}
        listContext="/shops?includeArchived=false&page=0&size=25"
        syncStates={{}}
        selected={new Set()}
        onSelectionChange={onSelectionChange}
        onInspectSync={vi.fn()}
        onPageChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页全部店铺' }))
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['shop-1', 'shop-2']))
  })

  it('uses context-preserving SPA detail links and renders safe semantic metadata', () => {
    const archivedShop = { ...sampleShop, status: 'ARCHIVED' as const }
    const view = render(
      <ShopTable
        page={page([archivedShop])}
        platforms={new Map([['platform-1', '安全平台名称']])}
        platformDirectoryUnavailable={false}
        canReadPlatforms
        canReadSync
        listContext="/shops?includeArchived=true&page=2&size=25&status=ARCHIVED"
        syncStates={{}}
        onInspectSync={vi.fn()}
        onPageChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: '查看详情' }).getAttribute('href')).toBe(
      toShopDetailHref('shop-1', '/shops?includeArchived=true&page=2&size=25&status=ARCHIVED'),
    )
    expect(screen.queryByRole('button', { name: '创建同步任务' })).toBeNull()
    expect(screen.getByText('已脱敏的授权错误摘要')).toBeTruthy()
    expect(
      Array.from(view.container.querySelectorAll('time'), (time) => time.getAttribute('dateTime')),
    ).toEqual(expect.arrayContaining([
      sampleShop.createdAt,
      sampleShop.updatedAt,
      sampleShop.authorization.authorizedAt,
      sampleShop.authorization.expiresAt,
      sampleShop.authorization.lastVerifiedAt,
    ]))
  })

  it('keeps sync history read-only and prevents duplicate history requests', async () => {
    let resolveRead: (value: Page<ShopSyncJob>) => void = () => undefined
    const read = new Promise<Page<ShopSyncJob>>((resolve) => { resolveRead = resolve })
    const queuedJob: ShopSyncJob = {
      id: 'queued-job', shopId: sampleShop.id, jobType: 'FULL', status: 'QUEUED',
      progressProcessed: 0, attemptCount: 0, requestedAt: sampleShop.updatedAt,
      updatedAt: sampleShop.updatedAt, safeErrorSummary: '历史任务安全摘要',
    }
    routerMocks.permissions = new Set(['shop:read', 'shop:sync:read', 'shop:sync:write'])
    vi.spyOn(shopCenterApi, 'listShops').mockResolvedValue(page([sampleShop]))
    const listSyncJobs = vi.spyOn(shopCenterApi, 'listSyncJobs').mockReturnValue(read)
    const createSyncJob = vi.spyOn(shopCenterApi, 'createSyncJob')

    render(<ShopCenterPage />)
    await screen.findByText('Example shop')
    fireEvent.click(screen.getByRole('button', { name: '查看同步' }))
    fireEvent.click(screen.getByRole('button', { name: '查看同步' }))
    await waitFor(() => expect(listSyncJobs).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: '创建同步任务' })).toBeNull()
    expect(createSyncJob).not.toHaveBeenCalled()

    resolveRead(page([queuedJob]))
    await screen.findByText('历史任务：已排队')
    expect(screen.getByText('暂无可创建的同步任务')).toBeTruthy()
    expect(screen.getByText('历史任务安全摘要')).toBeTruthy()
  })

  it('renders only valid shop times as semantic time elements', () => {
    const value = '2026-07-28T10:00:00Z'
    const { rerender } = render(<ShopDateTime value={value} />)
    expect(screen.getByText(new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(value))).closest('time')?.getAttribute('dateTime')).toBe(value)

    rerender(<ShopDateTime value="invalid" />)
    expect(screen.getByText('—').closest('time')).toBeNull()

    rerender(<ShopDateTime />)
    expect(screen.getByText('—').closest('time')).toBeNull()
  })

  it('hides write operations without write permissions and never renders a credential reference', () => {
    render(
      <>
        <ShopCenterActions
          canCreateShops={false}
          showCreateForm={false}
          totalElements={1}
          onRefresh={vi.fn()}
          onToggleCreate={vi.fn()}
        />
        <ShopTable
          page={page([{ ...sampleShop, authorization: { ...sampleShop.authorization, credentialReference: 'vault://secret' } } as TenantShop])}
          platforms={new Map([['platform-1', '安全平台名称']])}
          platformDirectoryUnavailable={false}
          canReadPlatforms={true}
          canReadSync={false}
          listContext="/shops?includeArchived=false&page=0&size=25"
          syncStates={{}}
          onInspectSync={vi.fn()}
          onPageChange={vi.fn()}
        />
      </>,
    )

    expect(screen.queryByRole('button', { name: '新增店铺' })).toBeNull()
    expect(screen.getByLabelText('店铺操作').textContent).toContain('共 1 条')
    expect(screen.queryByRole('button', { name: '创建完整同步' })).toBeNull()
    expect(screen.queryByText('vault://secret')).toBeNull()
  })

  it('shows only the supported selected-shop export action', () => {
    const onExport = vi.fn()
    render(
      <ShopCenterActions
        canCreateShops={false}
        showCreateForm={false}
        totalElements={3}
        selectedCount={1}
        canExport
        onRefresh={vi.fn()}
        onToggleCreate={vi.fn()}
        onExport={onExport}
      />,
    )

    expect(screen.queryByRole('button', { name: '导入海关平台名称' }))
      .toBeNull()
    expect(screen.queryByRole('button', { name: '导出全部' })).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: '导出勾选的店铺' }),
    )
    expect(onExport).toHaveBeenCalledOnce()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shopCenterApi, type Page, type ShopChannelSnapshot, type ShopDetail, type ShopSyncJob } from '../modules/shopCenterApi'
import {
  ArchiveConfirmation,
  ChannelAuthorizationPanel,
  DetailPagination,
  isValidShopId,
  parseSyncQuery,
  safeShopListReturnUrl,
  safeShopDetailMessage,
  shouldLoadSyncHistory,
  ShopDateTime,
  ShopDetailPage,
  ShopDetailActions,
  ShopifyUninstallConfirmation,
  ShopifyScopeChecklist,
  StatusConfirmation,
  SyncCapabilityNotice,
  SyncHistory,
  toShopDetailUrl,
} from './ShopDetailPage'
import { ApiError } from '../api/client'
import { storeAppReadPreparationApi } from '../modules/storeAppReadPreparationApi'

const detailRuntime = vi.hoisted(() => ({
  permissions: new Set<string>(),
  push: vi.fn(),
  search: '',
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useRouter: () => ({ history: { push: detailRuntime.push } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => string }) =>
    select({ location: { searchStr: detailRuntime.search } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => detailRuntime.permissions.has(permission),
  }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  detailRuntime.permissions = new Set()
  detailRuntime.push.mockReset()
  detailRuntime.search = ''
})

describe('ShopDetailPage controls', () => {
  it.each([
    { label: 'default off', flag: undefined, status: 'ACTIVE', internal: false, read: true, manage: true, visible: false },
    { label: 'explicitly off', flag: 'false', status: 'ACTIVE', internal: false, read: true, manage: true, visible: false },
    { label: 'enabled authorized shop', flag: 'true', status: 'ACTIVE', internal: false, read: true, manage: true, visible: true },
    { label: 'no read permission', flag: 'true', status: 'ACTIVE', internal: false, read: false, manage: true, visible: false },
    { label: 'no authorization permission', flag: 'true', status: 'ACTIVE', internal: false, read: true, manage: false, visible: false },
    { label: 'suspended shop', flag: 'true', status: 'SUSPENDED', internal: false, read: true, manage: true, visible: false },
    { label: 'archived shop', flag: 'true', status: 'ARCHIVED', internal: false, read: true, manage: true, visible: false },
    { label: 'internal shop', flag: 'true', status: 'ACTIVE', internal: true, read: true, manage: true, visible: false },
  ] as const)('gates preparation without automatic reads: $label', async (example) => {
    vi.stubEnv('VITE_STORE_APP_READ_PREPARATION', example.flag)
    const shopId = '10000000-0000-4000-8000-000000000001'
    detailRuntime.permissions = new Set([
      ...(example.read ? ['shop:read'] : []), ...(example.manage ? ['shop:authorization:write'] : []),
    ])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue({
      id: shopId, platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'synthetic-preparation.myshopify.com', displayName: '合成准备店铺', status: example.status,
      authorization: { status: example.internal ? 'NOT_REQUIRED' : 'NOT_AUTHORIZED', credentialConfigured: false, scopes: [], version: 0 },
      createdAt: '2026-09-06T01:00:00Z', updatedAt: '2026-09-06T01:00:00Z', version: 0,
    })
    vi.spyOn(shopCenterApi, 'getChannels').mockResolvedValue({
      mode: 'UNCONFIGURED', shopify: { status: 'NOT_CONNECTED' }, shopifyScopes: [], activity: [],
    })
    const check = vi.spyOn(storeAppReadPreparationApi, 'status')
    const orders = vi.spyOn(storeAppReadPreparationApi, 'orders')
    render(<ShopDetailPage shopId={shopId} />)
    await screen.findByText('合成准备店铺')
    expect(screen.queryByText('店铺应用接入准备') !== null).toBe(example.visible)
    expect(check).not.toHaveBeenCalled()
    expect(orders).not.toHaveBeenCalled()
  })

  it('validates shop IDs and bounded, shareable sync pagination', () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    expect(isValidShopId(shopId)).toBe(true)
    expect(isValidShopId('not-a-shop-id')).toBe(false)
    expect(parseSyncQuery('?syncPage=-1&syncSize=999')).toEqual({ page: 0, size: 25 })
    const returnTo = '/shops?includeArchived=true&page=3&size=25&status=ARCHIVED'
    expect(toShopDetailUrl(shopId, { page: 2, size: 25 }, returnTo)).toBe(
      `/shops/${shopId}?syncPage=2&syncSize=25&from=%2Fshops%3FincludeArchived%3Dtrue%26page%3D3%26size%3D25%26status%3DARCHIVED`,
    )
    expect(safeShopListReturnUrl(`?from=${encodeURIComponent(returnTo)}`)).toBe(returnTo)
    expect(safeShopListReturnUrl('?from=https%3A%2F%2Fevil.example%2Fshops')).toBe('/shops')
    expect(safeShopListReturnUrl('?from=%2Fshops%2Fother')).toBe('/shops')
    expect(safeShopListReturnUrl('')).toBe('/shops')
  })

  it('keeps sync execution read-only regardless of write authority', () => {
    expect(shouldLoadSyncHistory(true, false)).toBe(false)
    render(
      <>
        <ShopDetailActions
          canWrite={false}
          shopStatus="ACTIVE"
          authorizationStatus="AUTHORIZED"
          onEdit={vi.fn()}
          onChangeStatus={vi.fn()}
          onConfirmArchive={vi.fn()}
        />
        <SyncCapabilityNotice />
      </>,
    )
    expect(screen.queryByRole('button', { name: '创建同步任务' })).toBeNull()
    expect(screen.queryByLabelText('店铺详情操作')).toBeNull()
    expect(screen.queryByRole('button', { name: '删除店铺' })).toBeNull()
    expect(screen.getByText('暂无可创建的同步任务')).toBeTruthy()
    expect(screen.getByText('可查看历史同步记录。')).toBeTruthy()
  })

  it('renders safe connection metadata and preserves the list return context', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const returnTo = '/shops?includeArchived=true&page=3&size=25&status=ARCHIVED'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'safe-shop-ref',
      displayName: '上下文店铺',
      status: 'ACTIVE',
      authorization: {
        status: 'ERROR',
        credentialConfigured: true,
        credentialReferenceType: 'VAULT',
        providerAccountRef: 'safe-provider-ref',
        scopes: ['orders.read'],
        authorizedAt: '2026-07-28T08:00:00Z',
        expiresAt: '2026-08-28T08:00:00Z',
        lastVerifiedAt: '2026-07-28T09:00:00Z',
        safeErrorSummary: '已脱敏的连接错误摘要',
        version: 2,
      },
      createdAt: '2026-07-28T07:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
      version: 3,
    }
    detailRuntime.permissions = new Set(['shop:read', 'shop:sync:read', 'shop:sync:write'])
    detailRuntime.search = `?syncPage=0&syncSize=25&from=${encodeURIComponent(returnTo)}`
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    vi.spyOn(shopCenterApi, 'listSyncJobs').mockResolvedValue({
      items: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
    })
    const createSyncJob = vi.spyOn(shopCenterApi, 'createSyncJob')

    const view = render(<ShopDetailPage shopId={shopId} />)

    await screen.findByText('上下文店铺')
    expect(screen.getByText('店铺档案')).toBeTruthy()
    expect(screen.getByLabelText('店铺身份信息').textContent).toContain('safe-shop-ref')
    expect(screen.queryByText('已脱敏的连接错误摘要')).toBeNull()
    expect(screen.queryByText('授权状态 / 验证')).toBeNull()
    expect(screen.queryByText('暂无可创建的同步任务')).toBeNull()
    expect(screen.queryByText('VAULT')).toBeNull()
    expect(screen.queryByText('orders.read')).toBeNull()
    expect(screen.getByText('更多设置与记录')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '创建同步任务' })).toBeNull()
    expect(createSyncJob).not.toHaveBeenCalled()
    expect(
      Array.from(view.container.querySelectorAll('time'), (time) => time.getAttribute('dateTime')),
    ).toEqual(expect.arrayContaining([
      shop.createdAt,
      shop.updatedAt,
    ]))
  })

  it('shows internal stores as authorization-free and never loads Shopify channels', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000002',
      externalShopRef: 'internal-10000000-0000-4000-8000-000000000001',
      displayName: '线下订单一店',
      status: 'ACTIVE',
      authorization: {
        status: 'NOT_REQUIRED', credentialConfigured: false, scopes: [], version: 0,
      },
      createdAt: '2026-08-16T08:00:00Z',
      updatedAt: '2026-08-16T08:00:00Z',
      version: 0,
    }
    detailRuntime.permissions = new Set(['shop:read', 'shop:write', 'platform:read'])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    vi.spyOn(shopCenterApi, 'getPlatform').mockResolvedValue({
      id: shop.platformId, code: 'OTHER', displayName: '其他平台', status: 'ACTIVE',
    })
    const getChannels = vi.spyOn(shopCenterApi, 'getChannels')

    render(<ShopDetailPage shopId={shopId} />)

    await screen.findByText('线下订单一店')
    expect(screen.getByText('无需授权')).toBeTruthy()
    expect(screen.getByText('该店铺不绑定外部平台，可直接使用现有订单和审单流程。')).toBeTruthy()
    expect(screen.queryByText('Shopify 授权')).toBeNull()
    expect(screen.queryByText('Shopify 地点映射')).toBeNull()
    expect(screen.queryByText(shop.externalShopRef)).toBeNull()
    expect(getChannels).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.queryByLabelText('Shopify 店铺标识')).toBeNull()
    fireEvent.change(screen.getByLabelText('店铺显示名'), {
      target: { value: '线下订单新名称' },
    })
  })

  it('hides terminal actions for archived shops', () => {
    render(
      <ShopDetailActions
        canWrite
        shopStatus="ARCHIVED"
        authorizationStatus="REVOKED"
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
        onConfirmArchive={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '创建同步任务' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '停用店铺' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除店铺' })).toBeNull()
  })

  it('requires Shopify unbinding before soft deletion', () => {
    render(
      <ShopDetailActions
        canWrite
        shopStatus="ACTIVE"
        authorizationStatus="AUTHORIZED"
        onEdit={vi.fn()}
        onChangeStatus={vi.fn()}
        onConfirmArchive={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '删除店铺' })).toHaveProperty('disabled', true)
    expect(screen.getByText('请先解绑并卸载 Shopify 公开应用')).toBeTruthy()
  })

  it('paginates history and keeps an explicit archive confirmation with the shop name', () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    const onConfirm = vi.fn()
    const page: Page<unknown> = { items: [{}], page: 0, size: 37, totalElements: 38, totalPages: 2 }
    render(
      <>
        <DetailPagination
          page={page}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
        <ArchiveConfirmation shopName="待删除店铺" archiving={false} onCancel={vi.fn()} onConfirm={onConfirm} />
      </>,
    )

    expect(
      (screen.getByLabelText('同步历史分页每页条数') as HTMLSelectElement).value,
    ).toBe('37')
    fireEvent.change(screen.getByLabelText('同步历史分页每页条数'), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
    expect(onPageChange).toHaveBeenCalledWith(1)
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.getByText('确认删除“待删除店铺”')).toBeTruthy()
    expect(screen.getByText(/历史订单和审计记录继续保留/)).toBeTruthy()
  })

  it('explains cross-system effects before uninstalling the public app', () => {
    const onConfirm = vi.fn()
    render(
      <ShopifyUninstallConfirmation
        shopName="示例店铺"
        uninstalling={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText(/客服邮箱渠道与历史 ERP 数据不受影响/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认解绑并卸载' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('requires confirmation for reversible shop suspension', () => {
    const onConfirm = vi.fn()
    render(
      <StatusConfirmation
        shopName="待停用店铺"
        nextStatus="SUSPENDED"
        saving={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByText('确认停用“待停用店铺”')).toBeTruthy()
    expect(screen.getByText(/停用后，店铺仍可查看/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认停用' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('does not treat an empty Shopify scope checklist as complete', () => {
    render(<ShopifyScopeChecklist scopes={[]} />)

    expect(screen.getByText('权限状态不可用')).toBeTruthy()
    expect(screen.getByText(/不会默认视为权限完整/)).toBeTruthy()
    expect(screen.queryByText(/当前没有检测到缺失 scope/)).toBeNull()
  })

  it('shows business permission status without exposing technical scope names', () => {
    const scopes = [
      { scope: 'read_products', purpose: '商品目录读取', status: 'GRANTED' as const },
      { scope: 'write_orders', purpose: '订单读取与维护', status: 'GRANTED' as const },
      { scope: 'write_order_edits', purpose: '订单编辑待开放', status: 'REQUESTED' as const },
      { scope: 'read_customers', purpose: '客户资料读取', status: 'MISSING' as const },
      { scope: 'read_all_orders', purpose: '历史订单读取', status: 'MISSING' as const },
      { scope: 'read_fulfillments', purpose: '履约资料读取', status: 'MISSING' as const },
      { scope: 'write_products', purpose: '商品写入', status: 'MISSING' as const },
    ] as ShopChannelSnapshot['shopifyScopes'] & Array<{ accessToken?: string }>
    scopes[0]!.accessToken = 'shpat_sensitive_token'

    render(<ShopifyScopeChecklist scopes={scopes} />)

    expect(screen.getByRole('status').textContent).toMatch(/已授权\s*2\s*项，还需补充\s*8\s*项/)
    expect(screen.queryByText('待申请')).toBeNull()
    expect(document.body.textContent).not.toContain('write_order_edits')
    expect(document.body.textContent).not.toContain('read_customers')
    expect(document.body.textContent).not.toContain('read_all_orders')
    expect(document.body.textContent).not.toContain('read_fulfillments')
    expect(document.body.textContent).not.toContain('write_products')

    fireEvent.click(screen.getByRole('button', { name: '查看权限详情' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getAllByText('已授权')).toHaveLength(2)
    expect(screen.getAllByText('待授权')).toHaveLength(1)
    expect(screen.getAllByText('未授权')).toHaveLength(7)
    expect(screen.getByText('订单编辑待开放')).toBeTruthy()
    expect(document.body.textContent).not.toContain('write_order_edits')
    expect(document.body.textContent).not.toContain('read_all_orders')
    expect(document.body.textContent).not.toContain('shpat_sensitive_token')
    expect(document.body.textContent).not.toContain('accessToken')
  })

  it('mounts the compact permission summary and reauthorization on a connected Shopify store', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'review-store.myshopify.com',
      displayName: '审核店铺',
      status: 'ACTIVE',
      authorization: {
        status: 'AUTHORIZED', credentialConfigured: true, scopes: [], version: 1,
      },
      createdAt: '2026-08-16T08:00:00Z',
      updatedAt: '2026-08-16T08:00:00Z',
      version: 1,
    }
    detailRuntime.permissions = new Set(['shop:read'])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    vi.spyOn(shopCenterApi, 'getChannels').mockResolvedValue({
      mode: 'XZ_ERP_APP',
      shopify: { status: 'CONNECTED' },
      shopifyScopes: [
        { scope: 'read_products', purpose: '商品和变体拉取', status: 'GRANTED' },
      ],
      activity: [],
    })

    render(<ShopDetailPage shopId={shopId} />)

    await screen.findByText('连接与授权')
    expect(screen.getByText(/已授权\s*1\s*项，还需补充\s*9\s*项/)).toBeTruthy()
    expect(screen.getByText(/仅授予 1\/10/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '应用权限授权进度' }).getAttribute('value')).toBe('1')
    expect(document.querySelector('.shopify-connection-summary')?.className).toContain('is-warning')
    expect(screen.getByRole('button', { name: '重新授权' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('read_all_orders')
    expect(document.body.textContent).not.toContain('read_shopify_payments_disputes')
    fireEvent.click(screen.getByRole('button', { name: '查看权限详情' }))
    expect(screen.getByText('读取超过默认时间窗的历史订单')).toBeTruthy()
    expect(document.body.textContent).not.toContain('read_all_orders')
  })

  it('keeps authorization actions while hiding development-only channel fields', () => {
    const snapshot: ShopChannelSnapshot = {
      mode: 'DETERMINISTIC_FAKE',
      shopify: {
        status: 'FAILED',
      safeErrorCode: 'CONNECTION_TIMEOUT',
      safeErrorSummary: '授权请求超时，请稍后重试。',
        updatedAt: '2026-07-30T12:00:00Z',
      },
      shopifyScopes: [
        { scope: 'read_orders', purpose: '订单读取、售后定位、客服上下文', status: 'GRANTED' },
        { scope: 'write_order_edits', purpose: '修改订单地址、商品行、金额调整流程', status: 'MISSING' },
      ],
      activity: [{
        id: '40000000-0000-4000-8000-000000000001',
        action: 'shopify.authorize',
        target: 'SHOPIFY',
        result: 'FAILED',
        safeSummary: '授权请求暂时失败，请稍后重试。',
        createdAt: '2026-07-30T12:00:00Z',
      }],
    }
    const retryShopify = vi.fn()
    render(
      <ChannelAuthorizationPanel
        state={{ status: 'ready', snapshot }}
        canManage
        busy={false}
        message={null}
        onReload={vi.fn()}
        onAuthorizeShopify={vi.fn()}
        onRetryShopify={retryShopify}
        onRequestUninstall={vi.fn()}
      />,
    )

    expect(screen.getByText('连接与授权')).toBeTruthy()
    expect(screen.getAllByText('连接失败')).toHaveLength(2)
    expect(screen.getByText('应用权限')).toBeTruthy()
    expect(document.querySelector('.shopify-connection-summary')?.className).toContain('is-error')
    fireEvent.click(screen.getByRole('button', { name: '重试授权' }))
    expect(retryShopify).toHaveBeenCalledOnce()
    expect(screen.queryByText('CONNECTION_TIMEOUT')).toBeNull()
    expect(screen.queryByText('read_orders')).toBeNull()
    expect(screen.queryByText('write_order_edits')).toBeNull()
    expect(screen.queryByText('发起 Shopify 授权')).toBeNull()
  })

  it('keeps reauthorization visible and separates uninstall on a healthy connection', () => {
    const authorize = vi.fn()
    const requestUninstall = vi.fn()
    const grantedScopes = [
      'read_all_orders',
      'read_customers',
      'read_locations',
      'read_products',
      'read_shopify_payments_disputes',
      'write_inventory',
      'write_merchant_managed_fulfillment_orders',
      'write_order_edits',
      'write_orders',
      'write_returns',
    ].map((scope) => ({ scope, purpose: scope, status: 'GRANTED' as const }))

    render(
      <ChannelAuthorizationPanel
        state={{
          status: 'ready',
          snapshot: {
            mode: 'XZ_ERP_APP',
            shopify: { status: 'CONNECTED', updatedAt: '2026-08-22T12:00:00Z' },
            shopifyScopes: grantedScopes,
            activity: [],
          },
        }}
        canManage
        busy={false}
        message={null}
        onReload={vi.fn()}
        onAuthorizeShopify={authorize}
        onRetryShopify={vi.fn()}
        onRequestUninstall={requestUninstall}
      />,
    )

    expect(screen.getByText('应用权限完整')).toBeTruthy()
    expect(screen.queryByText(/待申请/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新授权' }))
    expect(authorize).toHaveBeenCalledOnce()
    const dangerZone = screen.getByText('解除店铺连接').closest('details')
    expect(dangerZone?.hasAttribute('open')).toBe(false)

    fireEvent.click(screen.getByText('解除店铺连接'))
    expect(dangerZone?.hasAttribute('open')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '解绑并卸载' }))
    expect(requestUninstall).toHaveBeenCalledOnce()
  })

  it('enables Shopify installation when the unified connector is available', () => {
    const authorize = vi.fn()
    render(
      <ChannelAuthorizationPanel
        state={{
          status: 'ready',
          snapshot: {
            mode: 'XZ_ERP_APP',
            shopify: { status: 'NOT_CONNECTED' },
            shopifyScopes: [],
            activity: [],
          },
        }}
        canManage
        busy={false}
        message={null}
        onReload={vi.fn()}
        onAuthorizeShopify={authorize}
        onRetryShopify={vi.fn()}
        onRequestUninstall={vi.fn()}
      />,
    )

    expect(screen.getByText(/尚未安装，请生成链接/)).toBeTruthy()
    expect(screen.queryByText(/Connector/)).toBeNull()
    const button = screen.getByRole('button', { name: '安装公开应用' })
    expect(button).not.toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(authorize).toHaveBeenCalledOnce()
  })

  it('generates a copy-only Shopify link without opening the ordinary browser', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'sample-store.myshopify.com',
      displayName: '示例店铺',
      status: 'ACTIVE',
      authorization: {
        status: 'NOT_AUTHORIZED',
        credentialConfigured: false,
        scopes: [],
        version: 0,
      },
      createdAt: '2026-08-02T00:00:00Z',
      updatedAt: '2026-08-02T00:00:00Z',
      version: 0,
    }
    const pendingSnapshot: ShopChannelSnapshot = {
      mode: 'XZ_ERP_APP',
      shopify: { status: 'PENDING' },
      shopifyScopes: [],
      activity: [],
    }
    detailRuntime.permissions = new Set(['shop:read', 'shop:authorization:write'])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    vi.spyOn(shopCenterApi, 'getChannels').mockResolvedValue({
      ...pendingSnapshot,
      shopify: { status: 'NOT_CONNECTED' },
    })
    const authorize = vi.spyOn(shopCenterApi, 'authorizeShopify').mockResolvedValue({
      snapshot: pendingSnapshot,
      authorizationUrl: 'https://authorization.example/shopify/oauth/authorize?grant=safe',
    })
    const openWindow = vi.spyOn(window, 'open')

    render(<ShopDetailPage shopId={shopId} />)
    fireEvent.click(await screen.findByRole('button', { name: '安装公开应用' }))

    await screen.findByRole('button', { name: '复制安装链接' })
    expect(authorize).toHaveBeenCalledWith(shopId)
    expect(screen.getAllByText(/对应店铺的浏览器/).length).toBeGreaterThan(0)
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('edits and suspends a shop through versioned write operations', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'original-ref',
      displayName: '原店铺',
      status: 'ACTIVE',
      authorization: {
        status: 'NOT_AUTHORIZED',
        credentialConfigured: false,
        scopes: [],
        version: 0,
      },
      createdAt: '2026-07-28T07:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
      version: 3,
    }
    const edited = {
      ...shop,
      externalShopRef: 'updated-ref',
      displayName: '新店铺',
      version: 4,
    }
    const suspended = { ...edited, status: 'SUSPENDED' as const, version: 5 }
    detailRuntime.permissions = new Set(['shop:read', 'shop:write', 'shop:authorization:write'])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    const updateShop = vi.spyOn(shopCenterApi, 'updateShop')
      .mockResolvedValueOnce(edited)
      .mockResolvedValueOnce(suspended)

    render(<ShopDetailPage shopId={shopId} />)
    await screen.findByText('原店铺')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('Shopify 店铺标识'), { target: { value: ' updated-ref ' } })
    fireEvent.change(screen.getByLabelText('店铺显示名'), { target: { value: ' 新店铺 ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(updateShop).toHaveBeenNthCalledWith(1, shopId, {
      version: 3,
      externalShopRef: 'updated-ref',
      displayName: '新店铺',
      status: 'ACTIVE',
    }))
    await screen.findByText('新店铺')

    fireEvent.click(screen.getByRole('button', { name: '停用店铺' }))
    fireEvent.click(screen.getByRole('button', { name: '确认停用' }))
    await waitFor(() => expect(updateShop).toHaveBeenNthCalledWith(2, shopId, {
      version: 4,
      externalShopRef: 'updated-ref',
      displayName: '新店铺',
      status: 'SUSPENDED',
    }))
    expect(await screen.findByText('已暂停')).toBeTruthy()
  })

  it('keeps an unavailable authorization service visibly disconnected', async () => {
    const shopId = '10000000-0000-4000-8000-000000000001'
    const shop: ShopDetail = {
      id: shopId,
      platformId: '20000000-0000-4000-8000-000000000001',
      externalShopRef: 'fake-shop',
      displayName: '示例店铺',
      status: 'ACTIVE',
      authorization: {
        status: 'NOT_AUTHORIZED',
        credentialConfigured: false,
        scopes: [],
        version: 0,
      },
      createdAt: '2026-07-28T07:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
      version: 0,
    }
    detailRuntime.permissions = new Set(['shop:read', 'shop:authorization:write'])
    vi.spyOn(shopCenterApi, 'getShop').mockResolvedValue(shop)
    vi.spyOn(shopCenterApi, 'getChannels').mockResolvedValue({
      mode: 'UNCONFIGURED',
      shopify: { status: 'NOT_CONNECTED' },
      shopifyScopes: [],
      activity: [],
    })

    render(<ShopDetailPage shopId={shopId} />)
    expect(await screen.findByText(/尚未安装，请生成链接/)).toBeTruthy()
    expect(screen.getByText('授权服务暂不可用，请稍后重试。')).toBeTruthy()
    expect(screen.queryByText(/Connector/)).toBeNull()
    expect(screen.queryByText('已授权')).toBeNull()
  })

  it('returns safe messages for conflict, forbidden, and not-found responses', () => {
    expect(safeShopDetailMessage(new ApiError('secret', { status: 409 }), '创建同步任务')).toContain('已有同类型')
    expect(safeShopDetailMessage(new ApiError('secret', { status: 409 }), '删除店铺')).not.toContain('同步任务')
    expect(safeShopDetailMessage(new ApiError('secret', { status: 409 }), '更新授权')).toContain('授权信息')
    expect(safeShopDetailMessage(new ApiError('secret', { status: 403 }), '读取同步历史')).toContain('登录状态仍保持不变')
    expect(safeShopDetailMessage(new ApiError('secret', { status: 404 }), '读取店铺详情')).toContain('店铺不存在')
  })

  it('renders sync times semantically and preserves a known zero total', () => {
    const value = '2026-07-28T10:00:00Z'
    const job: ShopSyncJob = {
      id: 'job-1', shopId: 'shop-1', jobType: 'FULL', status: 'RUNNING',
      progressProcessed: 0, progressTotal: 0, attemptCount: 1,
      requestedAt: value, updatedAt: value,
    }
    const page: Page<ShopSyncJob> = { items: [job], page: 0, size: 25, totalElements: 1, totalPages: 1 }
    const { rerender } = render(
      <SyncHistory
        state={{ status: 'ready', page }}
        onRetry={vi.fn()}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    )

    expect(screen.getByText('0 / 0')).toBeTruthy()
    expect(screen.getByText(new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(value))).closest('time')?.getAttribute('dateTime')).toBe(value)

    rerender(<ShopDateTime value="invalid" />)
    expect(screen.getByText('—').closest('time')).toBeNull()
  })
})

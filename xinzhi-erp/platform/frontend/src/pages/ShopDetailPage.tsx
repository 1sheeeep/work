import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleX,
  CloudCog,
  KeyRound,
  PauseCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Store,
  Trash2,
  Unplug,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { ShopifyAuthorizationLink } from '../components/ShopifyAuthorizationLink'
import { useI18n, type TranslationValues } from '../i18n/I18nContext'
import {
  type Page,
  type PlatformCatalogEntry,
  type ShopChannelSnapshot,
  type ShopDetail,
  type ShopSyncJob,
  shopDisplayName,
  shopCenterApi,
} from '../modules/shopCenterApi'
import { ShopifyLocationMappingPanel } from './ShopifyLocationMappingPanel'
import { StoreAppReadPreparationPanel } from './StoreAppReadPreparationPanel'

const DEFAULT_SYNC_PAGE_SIZE = 25
const SYNC_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const MAX_PAGE_INDEX = 9_999
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SyncQuery = { page: number; size: number }

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; shop: ShopDetail; platform?: PlatformCatalogEntry }
  | { status: 'error'; message: string }

type SyncHistoryState =
  | { status: 'not-permitted' }
  | { status: 'loading' }
  | { status: 'ready'; page: Page<ShopSyncJob> }
  | { status: 'error'; message: string }

type ChannelState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: ShopChannelSnapshot }
  | { status: 'error'; message: string }

const shopStatusLabels: Record<ShopDetail['status'], string> = {
  ACTIVE: '启用',
  SUSPENDED: '已暂停',
  ARCHIVED: '已删除',
}

const shopOperationStatusLabels: Record<ShopDetail['status'], string> = {
  ACTIVE: '店铺启用中',
  SUSPENDED: '店铺已暂停',
  ARCHIVED: '店铺已删除',
}

const syncLabels: Record<ShopSyncJob['status'], string> = {
  QUEUED: '已排队',
  RUNNING: '进行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
}

const syncScopeLabels: Record<ShopSyncJob['jobType'], string> = {
  FULL: '全部范围',
  ORDERS: '订单',
  PRODUCTS: '商品',
  INVENTORY: '库存',
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

export function isValidShopId(value: string) {
  return UUID_PATTERN.test(value)
}

export function shouldLoadSyncHistory(validShopId: boolean, canReadSync: boolean) {
  return validShopId && canReadSync
}

export function parseSyncQuery(search: string): SyncQuery {
  const query = new URLSearchParams(search)
  return {
    page: boundedInteger(query.get('syncPage'), 0, 0, MAX_PAGE_INDEX),
    size: boundedInteger(query.get('syncSize'), DEFAULT_SYNC_PAGE_SIZE, 1, 100),
  }
}

export function safeShopListReturnUrl(search: string) {
  const candidate = new URLSearchParams(search).get('from')
  if (!candidate) return '/shops'
  try {
    const base = new URL('https://erp.local')
    const target = new URL(candidate, base)
    if (target.origin !== base.origin || target.pathname !== '/shops') return '/shops'
    return `${target.pathname}${target.search}`
  } catch {
    return '/shops'
  }
}

export function toShopDetailUrl(shopId: string, query: SyncQuery, returnTo?: string) {
  const search = new URLSearchParams({
    syncPage: String(query.page),
    syncSize: String(query.size),
  })
  if (returnTo) search.set('from', returnTo)
  return `/shops/${encodeURIComponent(shopId)}?${search.toString()}`
}

type Translate = (source: string, values?: TranslationValues) => string

export function safeShopDetailMessage(error: unknown, subject: string, t: Translate = (source, values) => {
  if (!values) return source
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}) {
  if (error instanceof ApiError && error.status === 403) {
    return t('当前账号没有{subject}所需权限。登录状态仍保持不变。', { subject: t(subject) })
  }
  if (error instanceof ApiError && error.status === 404) {
    return t('店铺不存在，或当前账号无法访问该店铺。')
  }
  if (error instanceof ApiError && error.status === 409) {
    if (subject === '创建同步任务') {
      return t('已有同类型的开放同步任务，请等待其完成或取消后再试。')
    }
    if (subject === '删除店铺') {
      return t('请先完成 Shopify 解绑；若授权已失效，请重新检测或前往 Shopify 后台卸载后再试。')
    }
    if (subject === '更新授权') {
      return t('授权信息已变更，请刷新后再试。')
    }
    if (subject === '编辑店铺' || subject === '启用店铺' || subject === '停用店铺') {
      return t('店铺信息已被其他操作更新，请刷新后再试。')
    }
    return t('店铺数据已变更，请刷新后重试。')
  }
  return t('暂时无法{subject}，请稍后重试。', { subject: t(subject) })
}

export function ShopDateTime({ value }: { value?: string }) {
  const { formatDateTime } = useI18n()
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return <time dateTime={value}>{formatDateTime(date)}</time>
}

export function ShopDetailPage({ shopId }: { shopId: string }) {
  const { locale, t } = useI18n()
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const syncQuery = useMemo(() => parseSyncQuery(search), [search])
  const returnTo = useMemo(() => safeShopListReturnUrl(search), [search])
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' })
  const [syncHistory, setSyncHistory] = useState<SyncHistoryState>({ status: 'not-permitted' })
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<'ACTIVE' | 'SUSPENDED' | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationMessage, setMutationMessage] = useState<string | null>(null)
  const [refreshingAuthorization, setRefreshingAuthorization] = useState(false)
  const [authorizationMessage, setAuthorizationMessage] = useState<string | null>(null)
  const [channels, setChannels] = useState<ChannelState>({ status: 'loading' })
  const [channelMutation, setChannelMutation] = useState<string | null>(null)
  const [channelBusy, setChannelBusy] = useState(false)
  const [shopifyAuthorizationUrl, setShopifyAuthorizationUrl] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const detailVersion = useRef(0)
  const syncVersion = useRef(0)

  const canReadPlatforms = hasPermission('platform:read')
  const canReadSync = hasPermission('shop:sync:read')
  const canWriteShop = hasPermission('shop:write')
  const canManageAuthorization = hasPermission('shop:authorization:write')
  const canReadLocationMappings = hasPermission('shop:read')
    && hasPermission('warehouses.read')
  const canWriteLocationMappings = hasPermission('shop:write')
    && hasPermission('warehouses.write')
  const validShopId = isValidShopId(shopId)

  const loadDetail = useCallback(async () => {
    const version = detailVersion.current + 1
    detailVersion.current = version
    if (!validShopId) {
      setDetail({ status: 'error', message: t('店铺地址格式无效。') })
      return
    }
    setDetail({ status: 'loading' })
    try {
      const shop = await shopCenterApi.getShop(shopId)
      if (version !== detailVersion.current) return
      let platform: PlatformCatalogEntry | undefined
      if (canReadPlatforms) {
        try {
          platform = await shopCenterApi.getPlatform(shop.platformId)
        } catch {
          platform = undefined
        }
      }
      if (version !== detailVersion.current) return
      setDetail({ status: 'ready', shop, platform })
    } catch (error) {
      if (version !== detailVersion.current) return
      setDetail({ status: 'error', message: safeShopDetailMessage(error, '读取店铺详情', t) })
    }
  }, [canReadPlatforms, shopId, t, validShopId])

  const loadSyncHistory = useCallback(async () => {
    const version = syncVersion.current + 1
    syncVersion.current = version
    if (!shouldLoadSyncHistory(validShopId, canReadSync)) {
      setSyncHistory({ status: 'not-permitted' })
      return
    }
    setSyncHistory({ status: 'loading' })
    try {
      const page = await shopCenterApi.listSyncJobs(shopId, syncQuery)
      if (version !== syncVersion.current) return
      setSyncHistory({ status: 'ready', page })
    } catch (error) {
      if (version !== syncVersion.current) return
      setSyncHistory({ status: 'error', message: safeShopDetailMessage(error, '读取同步历史', t) })
    }
  }, [canReadSync, shopId, syncQuery, t, validShopId])

  const loadChannels = useCallback(async () => {
    if (!validShopId) return
    setChannels({ status: 'loading' })
    try {
      const snapshot = await shopCenterApi.getChannels(shopId)
      setChannels({ status: 'ready', snapshot })
      if (snapshot.shopify.status === 'CONNECTED') {
        setShopifyAuthorizationUrl(null)
      }
    } catch (error) {
      setChannels({ status: 'error', message: safeShopDetailMessage(error, '读取渠道连接状态', t) })
    }
  }, [shopId, t, validShopId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail, reloadKey])

  useEffect(() => {
    void loadSyncHistory()
  }, [loadSyncHistory, reloadKey])

  useEffect(() => {
    if (detail.status === 'ready'
        && detail.shop.authorization.status !== 'NOT_REQUIRED') {
      void loadChannels()
    }
  }, [detail, loadChannels, reloadKey])

  const updateSyncPage = useCallback(
    (page: number) => router.history.push(toShopDetailUrl(
      shopId,
      { ...syncQuery, page },
      returnTo === '/shops' ? undefined : returnTo,
    )),
    [returnTo, router.history, shopId, syncQuery],
  )

  const updateSyncPageSize = useCallback(
    (size: number) => router.history.push(toShopDetailUrl(
      shopId,
      { page: 0, size },
      returnTo === '/shops' ? undefined : returnTo,
    )),
    [returnTo, router.history, shopId],
  )

  const archiveShop = async () => {
    if (!validShopId) return
    if (detail.status !== 'ready' || detail.shop.status === 'ARCHIVED') {
      setConfirmArchive(false)
      return
    }
    setArchiving(true)
    setArchiveMessage(null)
    try {
      await shopCenterApi.archiveShop(shopId)
      router.history.push(returnTo)
    } catch (error) {
      setArchiveMessage(safeShopDetailMessage(error, '删除店铺', t))
    } finally {
      setArchiving(false)
    }
  }

  const replaceShop = (shop: ShopDetail) => {
    setDetail((current) => current.status === 'ready'
      ? { ...current, shop }
      : { status: 'ready', shop })
  }

  const saveShop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (detail.status !== 'ready' || detail.shop.status === 'ARCHIVED') return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setMutationMessage(null)
    try {
      const updated = await shopCenterApi.updateShop(shopId, {
        version: detail.shop.version,
        externalShopRef: String(form.get('externalShopRef') ?? '').trim(),
        displayName: String(form.get('displayName') ?? '').trim(),
        status: detail.shop.status,
      })
      replaceShop(updated)
      setShowEditor(false)
    } catch (error) {
      setMutationMessage(safeShopDetailMessage(error, '编辑店铺', t))
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async () => {
    if (detail.status !== 'ready' || !pendingStatus || detail.shop.status === 'ARCHIVED') return
    setSaving(true)
    setMutationMessage(null)
    try {
      const updated = await shopCenterApi.updateShop(shopId, {
        version: detail.shop.version,
        externalShopRef: detail.shop.externalShopRef,
        displayName: detail.shop.displayName,
        status: pendingStatus,
      })
      replaceShop(updated)
      setPendingStatus(null)
    } catch (error) {
      setMutationMessage(safeShopDetailMessage(error, pendingStatus === 'ACTIVE' ? '启用店铺' : '停用店铺', t))
    } finally {
      setSaving(false)
    }
  }

  const refreshAuthorization = async () => {
    if (detail.status !== 'ready') return
    setRefreshingAuthorization(true)
    setAuthorizationMessage(null)
    try {
      const updated = await shopCenterApi.getShop(shopId)
      replaceShop(updated)
      setAuthorizationMessage(
        updated.authorization.credentialConfigured
          ? t('授权信息已刷新，请以店铺授权状态为准。')
          : t('未配置店铺授权信息，请完成授权后重试。'),
      )
    } catch (error) {
      setAuthorizationMessage(safeShopDetailMessage(error, '刷新授权状态', t))
    } finally {
      setRefreshingAuthorization(false)
    }
  }

  const mutateChannel = async (
    subject: string,
    action: () => Promise<ShopChannelSnapshot>,
  ) => {
    setChannelBusy(true)
    setChannelMutation(null)
    try {
      const snapshot = await action()
      setChannels({ status: 'ready', snapshot })
      setChannelMutation(
        snapshot.mode === 'DETERMINISTIC_FAKE'
          ? t('当前服务未连接外部平台，操作未提交。')
          : t('{subject}已提交。', { subject: t(subject) }),
      )
    } catch (error) {
      setChannelMutation(safeShopDetailMessage(error, subject, t))
    } finally {
      setChannelBusy(false)
    }
  }

  const startShopifyAuthorization = async () => {
    setChannelBusy(true)
    setChannelMutation(null)
    try {
      const result = await shopCenterApi.authorizeShopify(shopId)
      setChannels({ status: 'ready', snapshot: result.snapshot })
      if (result.authorizationUrl) {
        setShopifyAuthorizationUrl(result.authorizationUrl)
        setChannelMutation(t('安装或重新授权链接已生成。请在对应店铺的浏览器中打开。'))
        return
      }
      setShopifyAuthorizationUrl(null)
      setChannelMutation(t('当前服务未连接 Shopify，无法发起授权。'))
    } catch (error) {
      setChannelMutation(safeShopDetailMessage(error, '生成 Shopify 安装链接', t))
    } finally {
      setChannelBusy(false)
    }
  }

  const uninstallShopify = async () => {
    setChannelBusy(true)
    setChannelMutation(null)
    try {
      const snapshot = await shopCenterApi.uninstallShopify(shopId)
      setChannels({ status: 'ready', snapshot })
      setShopifyAuthorizationUrl(null)
      setConfirmUninstall(false)
      setChannelMutation(t('Xinzhi ERP 公开应用已卸载并解绑；客服邮箱渠道未受影响。'))
      await loadDetail()
    } catch (error) {
      setChannelMutation(safeShopDetailMessage(error, '解绑 Shopify 店铺', t))
      setConfirmUninstall(false)
    } finally {
      setChannelBusy(false)
    }
  }

  if (detail.status === 'loading') {
    return <DetailStatePanel title={t('正在加载店铺详情')} message={t('正在读取店铺信息。')} loading />
  }

  if (detail.status === 'error') {
    return (
      <DetailStatePanel
        title={t('无法显示店铺详情')}
        message={detail.message}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    )
  }

  const { shop, platform } = detail
  const internalShop = shop.authorization.status === 'NOT_REQUIRED'
  const visibleShopName = locale === 'en' ? shop.displayName : shopDisplayName(shop)
  return (
    <section className="shop-detail-page" aria-labelledby="shop-detail-title">
      <header className="shop-connection-workbench-header">
        <div className="shop-connection-workbench-title">
          <span className="shop-connection-workbench-icon" aria-hidden="true"><Store size={20} /></span>
          <div>
            <p className="eyebrow">{t('设置 / 渠道授权 / 店铺详情')}</p>
            <h1 id="shop-detail-title">{visibleShopName}</h1>
            <p>{t(internalShop ? '内部店铺无需连接外部平台' : '管理店铺连接、应用权限与授权状态')}</p>
          </div>
        </div>
        <div className="shop-connection-workbench-meta" aria-label={t('店铺身份信息')}>
          <span className={`status-chip shop-status-${shop.status.toLowerCase()}`}>
            {t(shopStatusLabels[shop.status])}
          </span>
          <span>{platform ? platform.code === 'SHOPIFY' ? 'Shopify' : platform.displayName : '—'}</span>
          <code>{t(internalShop ? '系统内部店铺' : shop.externalShopRef)}</code>
        </div>
      </header>

      <ShopDetailActions
        canWrite={canWriteShop}
        shopStatus={shop.status}
        authorizationStatus={shop.authorization.status}
        onEdit={() => {
          setMutationMessage(null)
          setShowEditor((visible) => !visible)
        }}
        onChangeStatus={() => setPendingStatus(shop.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}
        onConfirmArchive={() => setConfirmArchive(true)}
      />

      {(archiveMessage || mutationMessage) && (
        <div className="inline-alert" role="alert">{archiveMessage ?? mutationMessage}</div>
      )}

      {confirmArchive && <ArchiveConfirmation shopName={visibleShopName} archiving={archiving} onCancel={() => setConfirmArchive(false)} onConfirm={() => void archiveShop()} />}

      {confirmUninstall && (
        <ShopifyUninstallConfirmation
          shopName={visibleShopName}
          uninstalling={channelBusy}
          onCancel={() => setConfirmUninstall(false)}
          onConfirm={() => void uninstallShopify()}
        />
      )}

      {pendingStatus && (
        <StatusConfirmation
          shopName={visibleShopName}
          nextStatus={pendingStatus}
          saving={saving}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => void changeStatus()}
        />
      )}

      {showEditor && (
        <section className="shop-create-panel" aria-labelledby="edit-shop-title">
          <div>
            <p className="eyebrow">{t(internalShop ? '内部店铺' : '店铺绑定')}</p>
            <h2 id="edit-shop-title">{t('编辑店铺')}</h2>
            <p>{t(internalShop ? '维护内部店铺名称；该店铺无需绑定外部平台。' : '维护店铺名称和 Shopify 店铺标识；授权信息由系统统一管理。')}</p>
          </div>
          <form className="shop-create-form" onSubmit={(event) => void saveShop(event)}>
            {internalShop ? (
              <input type="hidden" name="externalShopRef" value={shop.externalShopRef} />
            ) : (
              <>
                <label htmlFor="edit-shop-external-ref">{t('Shopify 店铺标识')}</label>
                <input
                  id="edit-shop-external-ref"
                  name="externalShopRef"
                  defaultValue={shop.externalShopRef}
                  maxLength={160}
                  required
                  disabled={saving}
                />
              </>
            )}
            <label htmlFor="edit-shop-display-name">{t('店铺显示名')}</label>
            <input
              id="edit-shop-display-name"
              name="displayName"
              defaultValue={shop.displayName}
              maxLength={160}
              required
              disabled={saving}
            />
            <p className="toolbar-note">
              {t(internalShop ? '名称修改后，现有订单和审单记录仍归属该店铺。' : '修改店铺标识不会影响其他店铺。')}
            </p>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={() => setShowEditor(false)} disabled={saving}>
                {t('取消')}
              </button>
              <button className="button button-primary" type="submit" disabled={saving}>
                {t(saving ? '正在保存' : '保存修改')}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="shop-detail-primary-grid">
        <section className="detail-card shop-overview-card" aria-labelledby="shop-overview-title">
          <div className="compact-card-heading">
            <div className="detail-card-heading">
              <Store size={18} aria-hidden="true" />
              <h2 id="shop-overview-title">{t('店铺档案')}</h2>
            </div>
            <span className="card-context-label">{t('基础信息')}</span>
          </div>
          <dl className="compact-detail-list">
            <div><dt>{t('平台')}</dt><dd>{platform ? platform.code === 'SHOPIFY' ? 'Shopify' : platform.displayName : canReadPlatforms ? t('暂不可用') : '—'}</dd></div>
            <div><dt>{t('店铺标识')}</dt><dd>{t(internalShop ? '系统内部店铺' : shop.externalShopRef)}</dd></div>
            <div><dt>{t('创建时间')}</dt><dd><ShopDateTime value={shop.createdAt} /></dd></div>
            <div><dt>{t('最近更新')}</dt><dd><ShopDateTime value={shop.updatedAt} /></dd></div>
          </dl>
        </section>

        {internalShop ? (
          <InternalShopConnectionCard />
        ) : (
          <ChannelAuthorizationPanel
            state={channels}
            canManage={canManageAuthorization && shop.status === 'ACTIVE'}
            busy={channelBusy || refreshingAuthorization}
            message={channelMutation ?? authorizationMessage}
            authorizationUrl={shopifyAuthorizationUrl ?? undefined}
            onReload={() => {
              void loadChannels()
              void refreshAuthorization()
            }}
            onAuthorizeShopify={() => void startShopifyAuthorization()}
            onRetryShopify={() => void mutateChannel('重试 Shopify 授权', () => shopCenterApi.retryShopify(shopId))}
            onRequestUninstall={() => setConfirmUninstall(true)}
          />
        )}
      </div>

      <details className="shop-detail-secondary">
        <summary>
          <span>{t('更多设置与记录')}</span>
          <small>{t('地点映射、同步记录')}</small>
        </summary>
        <div className="shop-detail-secondary-content">
          {import.meta.env.VITE_STORE_APP_READ_PREPARATION === 'true'
            && !internalShop && shop.status === 'ACTIVE' && canManageAuthorization
            && hasPermission('shop:read') && (
              <StoreAppReadPreparationPanel key={shopId} shopId={shopId} canReadOrders={hasPermission('orders.read')} />
            )}
          {!internalShop && (
            <ShopifyLocationMappingPanel
              shopId={shopId}
              canRead={canReadLocationMappings}
              canWrite={canWriteLocationMappings}
              shopActive={shop.status === 'ACTIVE'}
            />
          )}

          <SyncHistory
            state={syncHistory}
            onRetry={() => void loadSyncHistory()}
            onPageChange={updateSyncPage}
            onPageSizeChange={updateSyncPageSize}
          />
        </div>
      </details>
    </section>
  )
}

const channelStatusLabels: Record<ShopChannelSnapshot['shopify']['status'], string> = {
  NOT_CONNECTED: '未连接',
  PENDING: '等待完成',
  CONNECTED: '已连接',
  FAILED: '连接失败',
  REVOKED: '已解绑',
}

const shopifyScopeStatusLabels: Record<
  ShopChannelSnapshot['shopifyScopes'][number]['status'],
  string
> = {
  REQUESTED: '待授权',
  GRANTED: '已授权',
  MISSING: '未授权',
}

function InternalShopConnectionCard() {
  const { t } = useI18n()
  return (
    <section className="detail-card shopify-connection-card" aria-labelledby="internal-shop-connection-title">
      <div className="compact-card-heading">
        <div className="detail-card-heading">
          <Store size={18} aria-hidden="true" />
          <h2 id="internal-shop-connection-title">{t('内部店铺')}</h2>
        </div>
        <span className="status-chip authorization-not_required">{t('无需授权')}</span>
      </div>
      <div className="shopify-connection-summary" role="status">
        <p>{t('该店铺不绑定外部平台，可直接使用现有订单和审单流程。')}</p>
      </div>
    </section>
  )
}

export function ChannelAuthorizationPanel({
  state,
  canManage,
  busy,
  message,
  authorizationUrl,
  onReload,
  onAuthorizeShopify,
  onRetryShopify,
  onRequestUninstall,
}: {
  state: ChannelState
  canManage: boolean
  busy: boolean
  message: string | null
  authorizationUrl?: string
  onReload: () => void
  onAuthorizeShopify: () => void
  onRetryShopify: () => void
  onRequestUninstall: () => void
}) {
  const { t } = useI18n()
  if (state.status === 'loading') {
    return (
      <section className="detail-card shopify-connection-card compact-state-card" aria-busy="true" aria-live="polite">
        <CircleDashed className="spin" size={20} aria-hidden="true" />
        <h2>{t('正在读取授权状态')}</h2>
      </section>
    )
  }
  if (state.status === 'error') {
    return (
      <section className="detail-card shopify-connection-card compact-state-card" role="alert">
        <ShieldAlert size={20} aria-hidden="true" />
        <h2>{t('暂时无法读取授权状态')}</h2>
        <p>{state.message}</p>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={onReload}>{t('重新检测')}</button>
          <button className="button button-primary" type="button" disabled={!canManage || busy} onClick={onAuthorizeShopify}>{t('重新安装或授权')}</button>
        </div>
        <p className="toolbar-note">{t('检测失败不会删除店铺或清除授权；若令牌失效，可重新授权。')}</p>
      </section>
    )
  }

  const { snapshot } = state
  const simulation = snapshot.mode === 'DETERMINISTIC_FAKE'
  const connectedRuntime = snapshot.mode === 'XZ_ERP_APP'
  const canStartShopify = simulation || connectedRuntime
  const shopify = snapshot.shopify
  const scopeCoverage = getSubmittedScopeCoverage(snapshot.shopifyScopes)
  const grantedSubmittedScopeCount = scopeCoverage.grantedCount
  const submittedScopesComplete = scopeCoverage.complete
  const updatedAt = shopify.updatedAt
  const statusMessage = {
    NOT_CONNECTED: t('尚未安装，请生成链接后在 Shopify 完成公开应用安装。'),
    PENDING: t('安装链接已生成，等待在 Shopify 完成确认。'),
    CONNECTED: submittedScopesComplete
      ? t('店铺授权已完成，可以开始使用已开放的店铺功能。')
      : t('店铺连接已建立，但 Shopify 应用权限仅授予 {granted}/{total}。请重新授权以补齐缺失权限。', {
          granted: grantedSubmittedScopeCount,
          total: submittedAppScopes.length,
        }),
    FAILED: shopify.safeErrorSummary ?? t('安装或授权失败，请重新生成链接后再试。'),
    REVOKED: t('公开应用已解绑。需要重新安装并授权后才能继续使用。'),
  }[shopify.status]
  return (
    <section className="detail-card shopify-connection-card" aria-labelledby="channel-authorization-title">
      <div className="compact-card-heading">
        <div className="detail-card-heading">
          <KeyRound size={18} aria-hidden="true" />
          <h2 id="channel-authorization-title">{t('连接与授权')}</h2>
        </div>
        <span className={`status-chip authorization-${shopify.status.toLowerCase()}`}>
          {t(channelStatusLabels[shopify.status])}
        </span>
      </div>

      <div
        className={`shopify-connection-summary ${shopify.status === 'CONNECTED' && submittedScopesComplete
          ? 'is-ready'
          : shopify.status === 'FAILED' || shopify.status === 'REVOKED'
            ? 'is-error'
            : 'is-warning'}`}
        role="status"
      >
        <span className="shopify-connection-state-icon" aria-hidden="true">
          {shopify.status === 'CONNECTED' && submittedScopesComplete
            ? <CheckCircle2 size={21} />
            : shopify.status === 'FAILED' || shopify.status === 'REVOKED'
              ? <CircleX size={21} />
              : <CircleDashed size={21} />}
        </span>
        <div>
          <strong>{t(shopify.status === 'CONNECTED' && submittedScopesComplete ? '连接可用' : '需要处理')}</strong>
          <p>{statusMessage}</p>
        </div>
      </div>

      <dl className="shopify-connection-metrics">
        <div>
          <dt>{t('授权状态')}</dt>
          <dd>{t(channelStatusLabels[shopify.status])}</dd>
        </div>
        <div>
          <dt>{t('应用权限')}</dt>
          <dd>
            {submittedScopesComplete
              ? t('已授权 {granted} 项', { granted: grantedSubmittedScopeCount })
              : t('已授权 {granted} / {total} 项', { granted: grantedSubmittedScopeCount, total: submittedAppScopes.length })}
          </dd>
          <progress
            max={submittedAppScopes.length}
            value={grantedSubmittedScopeCount}
            aria-label={t('应用权限授权进度')}
          />
        </div>
        <div>
          <dt>{t('最近核验')}</dt>
          <dd>{updatedAt ? <ShopDateTime value={updatedAt} /> : t('暂无记录')}</dd>
        </div>
      </dl>

      <div className="form-actions shopify-connection-actions">
        {(shopify.status === 'NOT_CONNECTED' || shopify.status === 'REVOKED' || shopify.status === 'PENDING') && (
          <button className="button button-primary" type="button" disabled={!canManage || busy || !canStartShopify} onClick={onAuthorizeShopify}>
            {t(shopify.status === 'PENDING' ? '重新生成安装链接' : shopify.status === 'REVOKED' ? '重新安装' : '安装公开应用')}
          </button>
        )}
        {shopify.status === 'FAILED' && (
          <button className="button button-primary" type="button" disabled={!canManage || busy || !canStartShopify} onClick={connectedRuntime ? onAuthorizeShopify : onRetryShopify}>
            {t(connectedRuntime ? '重新安装或授权' : '重试授权')}
          </button>
        )}
        {shopify.status === 'CONNECTED' && (
          <button className="button button-primary" type="button" disabled={!canManage || busy || !canStartShopify} onClick={onAuthorizeShopify}>
            <KeyRound size={17} aria-hidden="true" />
            {t('重新授权')}
          </button>
        )}
        {shopify.status === 'CONNECTED' && (
          <button className="button button-secondary" type="button" disabled={busy} onClick={onReload}>
            <RefreshCw className={busy ? 'spin' : undefined} size={17} aria-hidden="true" />
            {t('刷新状态')}
          </button>
        )}
      </div>

      {authorizationUrl && (
        <ShopifyAuthorizationLink
          authorizationUrl={authorizationUrl}
          checking={busy}
          onCheck={onReload}
        />
      )}
      {message && <p className="toolbar-note" role="status" aria-live="polite">{message}</p>}
      {!canManage && <p className="toolbar-note">{t('当前账号仅可查看授权状态。')}</p>}
      {!canStartShopify && <p className="toolbar-note">{t('授权服务暂不可用，请稍后重试。')}</p>}

      <ShopifyScopeChecklist scopes={snapshot.shopifyScopes} />

      {(shopify.status === 'CONNECTED' || shopify.status === 'FAILED') && (
        <details className="shopify-danger-zone">
          <summary>
            <span>{t('解除店铺连接')}</span>
            <small>{t('仅在不再使用该店铺时操作')}</small>
          </summary>
          <div className="shopify-danger-zone-content">
            <p>{t('卸载公开应用并清除当前连接；以后仍可重新安装并授权。')}</p>
            <button className="button button-danger" type="button" disabled={!canManage || busy || !canStartShopify} onClick={onRequestUninstall}>
              <Unplug size={17} aria-hidden="true" />
              {t('解绑并卸载')}
            </button>
          </div>
        </details>
      )}
    </section>
  )
}

const submittedAppScopes = [
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
] as const

type SubmittedAppScope = typeof submittedAppScopes[number]

const submittedAppScopePurposes: Record<SubmittedAppScope, string> = {
  read_all_orders: '读取超过默认时间窗的历史订单',
  read_customers: '客户档案与订单售后识别',
  read_locations: '仓库/地点读取',
  read_products: '商品和变体拉取',
  read_shopify_payments_disputes: '拒付状态、金额、原因和截止时间读取',
  write_inventory: '库存调整和同步',
  write_merchant_managed_fulfillment_orders: '商家自管履约单处理',
  write_order_edits: '修改订单商品行、数量、折扣和金额',
  write_orders: '订单收货地址、备注和运营处理',
  write_returns: '退货处理',
}

function getSubmittedScopeCoverage(scopes: ShopChannelSnapshot['shopifyScopes']) {
  const scopesByName = new Map(scopes.map((item) => [item.scope, item]))
  const submittedScopes = submittedAppScopes.map((scope) => scopesByName.get(scope) ?? {
    scope,
    purpose: submittedAppScopePurposes[scope],
    status: 'MISSING' as const,
  })
  const grantedCount = submittedScopes.filter((item) => item.status === 'GRANTED').length
  return {
    submittedScopes,
    grantedCount,
    unresolvedCount: submittedScopes.length - grantedCount,
    complete: grantedCount === submittedAppScopes.length,
  }
}

export function ShopifyScopeChecklist({
  scopes,
}: {
  scopes: ShopChannelSnapshot['shopifyScopes']
}) {
  const { t, formatNumber } = useI18n()
  const [showDetails, setShowDetails] = useState(false)
  const detailsId = useId()
  if (scopes.length === 0) {
    return (
      <div className="shopify-scope-empty" role="status">
        <ShieldAlert size={22} aria-hidden="true" />
        <div>
          <strong>{t('权限状态不可用')}</strong>
          <p>{t('当前无法读取应用权限信息，系统不会默认视为权限完整。')}</p>
        </div>
      </div>
    )
  }
  const coverage = getSubmittedScopeCoverage(scopes)
  const { submittedScopes, grantedCount, unresolvedCount } = coverage
  return (
    <div className="shopify-permission-panel">
      <div className={`shopify-permission-summary ${coverage.complete ? 'is-complete' : 'is-incomplete'}`} role="status">
        <span className="shopify-permission-state-icon" aria-hidden="true">
          {coverage.complete
            ? <CheckCircle2 size={19} />
            : <ShieldAlert size={19} />}
        </span>
        <div>
          <strong>{t(coverage.complete ? '应用权限完整' : '应用权限需要更新')}</strong>
          <span>
            {coverage.complete
              ? t('已授权 {granted} 项，可正常使用已开放的店铺功能。', { granted: formatNumber(grantedCount) })
              : t('已授权 {granted} 项，还需补充 {remaining} 项。', {
                  granted: formatNumber(grantedCount),
                  remaining: formatNumber(unresolvedCount),
                })}
          </span>
        </div>
        <button
          className="button button-secondary shopify-permission-toggle"
          type="button"
          aria-expanded={showDetails}
          aria-controls={detailsId}
          onClick={() => setShowDetails((visible) => !visible)}
        >
          {t(showDetails ? '收起权限详情' : '查看权限详情')}
          <ChevronDown className={showDetails ? 'is-expanded' : undefined} size={16} aria-hidden="true" />
        </button>
      </div>
      {showDetails && (
        <div className="shopify-permission-details" id={detailsId}>
          <div className="shopify-permission-details-heading">
            <strong>{t('功能权限')}</strong>
            <span>{t('共 {total} 项', { total: formatNumber(submittedScopes.length) })}</span>
          </div>
          <ul aria-label={t('功能权限')}>
            {submittedScopes.map((item) => (
              <li key={item.scope}>
                <span className="shopify-scope-purpose">{t(item.purpose)}</span>
                <span className={`shopify-scope-status scope-status-${item.status.toLowerCase()}`}>
                  {item.status === 'GRANTED'
                    ? <CheckCircle2 size={15} aria-hidden="true" />
                    : item.status === 'MISSING'
                      ? <CircleX size={15} aria-hidden="true" />
                      : <CircleDashed size={15} aria-hidden="true" />}
                  {t(shopifyScopeStatusLabels[item.status])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SyncCapabilityNotice() {
  const { t } = useI18n()
  return (
    <div className="inline-alert" role="status">
      <CloudCog size={19} aria-hidden="true" />
      <div>
        <strong>{t('暂无可创建的同步任务')}</strong>
        <span>
          {t('可查看历史同步记录。')}
        </span>
      </div>
    </div>
  )
}

export function ShopDetailActions({
  canWrite,
  shopStatus,
  authorizationStatus,
  onEdit,
  onChangeStatus,
  onConfirmArchive,
}: {
  canWrite: boolean
  shopStatus: ShopDetail['status']
  authorizationStatus: ShopDetail['authorization']['status']
  onEdit: () => void
  onChangeStatus: () => void
  onConfirmArchive: () => void
}) {
  const { t } = useI18n()
  if (!canWrite || shopStatus === 'ARCHIVED') return null
  const canDelete = authorizationStatus === 'NOT_REQUIRED'
    || authorizationStatus === 'NOT_AUTHORIZED'
    || authorizationStatus === 'REVOKED'
  return (
    <div className="erp-operation-bar shop-detail-operation-bar" aria-label={t('店铺详情操作')}>
      <div className="erp-operation-start">
        <span className="erp-selection-count">{t('当前状态')}</span>
        <span className={`status-chip shop-status-${shopStatus.toLowerCase()}`}>
          {t(shopOperationStatusLabels[shopStatus])}
        </span>
      </div>
      <div className="erp-operation-end">
        <button className="button button-secondary" type="button" onClick={onEdit}>
          <Pencil size={17} aria-hidden="true" />
          {t('编辑')}
        </button>
        <button className="button button-secondary" type="button" onClick={onChangeStatus}>
          {shopStatus === 'ACTIVE'
            ? <PauseCircle size={17} aria-hidden="true" />
            : <PlayCircle size={17} aria-hidden="true" />}
          {t(shopStatus === 'ACTIVE' ? '停用店铺' : '启用店铺')}
        </button>
        {!canDelete && <span className="toolbar-note">{t('请先解绑并卸载 Shopify 公开应用')}</span>}
        <button
          className="button button-danger"
          type="button"
          onClick={onConfirmArchive}
          disabled={!canDelete}
          title={canDelete ? undefined : t('请先解绑并卸载 Shopify 公开应用')}
        >
          <Trash2 size={17} aria-hidden="true" />
          {t('删除店铺')}
        </button>
      </div>
    </div>
  )
}

export function StatusConfirmation({
  shopName,
  nextStatus,
  saving,
  onCancel,
  onConfirm,
}: {
  shopName: string
  nextStatus: 'ACTIVE' | 'SUSPENDED'
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const activating = nextStatus === 'ACTIVE'
  return (
    <section className="confirmation-panel" aria-labelledby="status-confirmation-title">
      {activating
        ? <PlayCircle size={24} aria-hidden="true" />
        : <PauseCircle size={24} aria-hidden="true" />}
      <div>
        <h2 id="status-confirmation-title">{t(activating ? '确认启用“{name}”' : '确认停用“{name}”', { name: shopName })}</h2>
        <p>
          {activating
            ? t('启用后，店铺可继续使用已授权功能。')
            : t('停用后，店铺仍可查看，但不能发起新的 ERP 同步或业务操作；外部应用安装和客服渠道不受影响。')}
        </p>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={saving}>{t('取消')}</button>
          <button className="button button-primary" type="button" onClick={onConfirm} disabled={saving}>
            {t(saving ? '正在保存' : activating ? '确认启用' : '确认停用')}
          </button>
        </div>
      </div>
    </section>
  )
}

export function ArchiveConfirmation({
  shopName,
  archiving,
  onCancel,
  onConfirm,
}: {
  shopName: string
  archiving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  return (
    <section className="confirmation-panel confirmation-danger" aria-labelledby="archive-confirmation-title">
      <Trash2 size={24} aria-hidden="true" />
      <div>
        <h2 id="archive-confirmation-title">{t('确认删除“{name}”', { name: shopName })}</h2>
        <p>
          {t('删除是软删除：店铺默认隐藏且不再参与 ERP 同步，历史订单和审计记录继续保留。')}
        </p>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={archiving}>{t('取消')}</button>
          <button className="button button-danger" type="button" onClick={onConfirm} disabled={archiving} autoFocus>
            {t(archiving ? '正在删除' : '确认删除')}
          </button>
        </div>
      </div>
    </section>
  )
}

export function ShopifyUninstallConfirmation({
  shopName,
  uninstalling,
  onCancel,
  onConfirm,
}: {
  shopName: string
  uninstalling: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  return (
    <section className="confirmation-panel confirmation-danger" aria-labelledby="shopify-uninstall-confirmation-title">
      <Unplug size={24} aria-hidden="true" />
      <div>
        <h2 id="shopify-uninstall-confirmation-title">{t('确认解绑“{name}”', { name: shopName })}</h2>
        <p>{t('系统将请求 Shopify 卸载 Xinzhi ERP 公开应用并清除 Connector 凭据。ERP 的 Shopify 业务能力和店面聊天会停止；客服邮箱渠道与历史 ERP 数据不受影响。')}</p>
        <p className="toolbar-note">{t('以后继续使用时，需要重新安装并授权同一店铺。')}</p>
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={uninstalling}>{t('取消')}</button>
          <button className="button button-danger" type="button" onClick={onConfirm} disabled={uninstalling} autoFocus>
            {t(uninstalling ? '正在解绑' : '确认解绑并卸载')}
          </button>
        </div>
      </div>
    </section>
  )
}

export function SyncHistory({
  state,
  onRetry,
  onPageChange,
  onPageSizeChange,
}: {
  state: SyncHistoryState
  onRetry: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const { t, formatNumber } = useI18n()
  if (state.status === 'not-permitted') {
    return <section className="detail-card sync-history-section"><h2>{t('同步历史')}</h2><p className="muted-cell">{t('当前账号没有读取同步历史的权限。')}</p></section>
  }
  if (state.status === 'loading') {
    return <section className="detail-card sync-history-section" aria-busy="true" aria-live="polite"><CircleDashed className="spin" size={20} aria-hidden="true" /><h2>{t('正在加载同步历史')}</h2></section>
  }
  if (state.status === 'error') {
    return <section className="detail-card sync-history-section" role="alert"><ShieldAlert size={20} aria-hidden="true" /><h2>{t('无法读取同步历史')}</h2><p>{state.message}</p><button className="button button-secondary" type="button" onClick={onRetry}>{t('重试')}</button></section>
  }
  if (state.page.items.length === 0) {
    return <section className="detail-card sync-history-section"><CloudCog size={20} aria-hidden="true" /><h2>{t('暂无历史同步任务')}</h2><p>{t('当前暂无同步记录。')}</p></section>
  }
  const { page } = state
  return (
    <section className="detail-card sync-history-section" aria-labelledby="sync-history-title">
      <div className="table-heading"><div><p className="eyebrow">{t('同步历史')}</p><h2 id="sync-history-title">{t('同步任务历史')}</h2></div><span>{t('{count} 条任务', { count: formatNumber(page.totalElements) })}</span></div>
      <div className="shop-table-scroll">
        <table className="shop-table sync-history-table">
          <caption className="sr-only">{t('店铺同步任务历史')}</caption>
          <thead><tr><th scope="col">{t('范围')}</th><th scope="col">{t('状态与进度')}</th><th scope="col">{t('尝试')}</th><th scope="col">{t('请求时间')}</th><th scope="col">{t('开始 / 完成')}</th><th scope="col">{t('安全摘要')}</th></tr></thead>
          <tbody>{page.items.map((job) => <tr key={job.id}><td>{t(syncScopeLabels[job.jobType])}</td><td><strong>{t(syncLabels[job.status])}</strong><small>{typeof job.progressTotal === 'number' ? `${formatNumber(job.progressProcessed)} / ${formatNumber(job.progressTotal)}` : t('{count} 已处理（总量未提供）', { count: formatNumber(job.progressProcessed) })}</small></td><td>{formatNumber(job.attemptCount)}</td><td><ShopDateTime value={job.requestedAt} /></td><td><ShopDateTime value={job.startedAt} /> / <ShopDateTime value={job.completedAt} /></td><td>{job.safeErrorSummary ?? '—'}</td></tr>)}</tbody>
        </table>
      </div>
      <DetailPagination
        page={page}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </section>
  )
}

export function DetailPagination({
  page,
  onPageChange,
  onPageSizeChange,
}: {
  page: Page<unknown>
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const { t, formatNumber } = useI18n()
  const pageSizes = [...new Set([...SYNC_PAGE_SIZE_OPTIONS, page.size])]
    .sort((left, right) => left - right)
  return (
    <nav className="pagination" aria-label={t('同步历史分页')}>
      <span>{t('第 {current} / {total} 页', { current: formatNumber(page.page + 1), total: formatNumber(Math.max(page.totalPages, 1)) })}</span>
      <div>
        <label>
          {t('每页')}
          <select
            aria-label={t('同步历史分页每页条数')}
            value={page.size}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>{t('{count} 条', { count: formatNumber(size) })}</option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" type="button" disabled={page.page === 0} onClick={() => onPageChange(page.page - 1)}>{t('上一页')}</button>
        <button className="button button-secondary" type="button" disabled={page.page + 1 >= page.totalPages} onClick={() => onPageChange(page.page + 1)}>{t('下一页')}</button>
      </div>
    </nav>
  )
}

function DetailStatePanel({ title, message, loading = false, onRetry }: { title: string; message: string; loading?: boolean; onRetry?: () => void }) {
  const { t } = useI18n()
  return <section className="empty-panel shop-state" role={loading ? undefined : 'alert'} aria-busy={loading || undefined}>{loading ? <CircleDashed className="spin" size={30} aria-hidden="true" /> : <ShieldAlert size={30} aria-hidden="true" />}<h1>{title}</h1><p>{message}</p>{onRetry && <button className="button button-primary" type="button" onClick={onRetry}><RefreshCw size={17} aria-hidden="true" />{t('重新加载')}</button>}</section>
}

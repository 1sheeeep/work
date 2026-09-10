import {
  CheckCircle2,
  CircleDashed,
  CloudCog,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { PageSelectionCheckbox } from '../components/PageSelectionCheckbox'
import { ShopifyAuthorizationLink } from '../components/ShopifyAuthorizationLink'
import { useI18n, type TranslationValues } from '../i18n/I18nContext'
import {
  type Page,
  type PlatformCatalogEntry,
  type ShopChannelSnapshot,
  type ShopSyncJob,
  type TenantShop,
  shopDisplayName,
  shopCenterApi,
} from '../modules/shopCenterApi'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_INDEX = 9_999
const PLATFORM_DIRECTORY_PAGE_SIZE = 200
const MAX_PLATFORM_DIRECTORY_PAGES = 100
const SHOPIFY_PLATFORM_CODE = 'SHOPIFY'
const OTHER_PLATFORM_CODE = 'OTHER'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ShopCenterQuery = {
  includeArchived: boolean
  page: number
  size: number
  query?: string
  platformId?: string
  status?: TenantShop['status']
  authorizationStatus?: TenantShop['authorization']['status']
}

type ShopFilterDraft = Pick<
  ShopCenterQuery,
  'includeArchived' | 'query' | 'platformId' | 'status' | 'authorizationStatus' | 'size'
>

type LoadState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; job?: ShopSyncJob }
  | { status: 'error'; message: string }

type ShopOnboardingState =
  | { step: 'details' }
  | {
      step: 'authorize'
      shop: TenantShop
      authorizationUrl?: string
      status: 'loading' | 'ready' | 'error'
      message?: string
    }
  | { step: 'complete'; shop: TenantShop }

export async function loadPlatformDirectory(
  includeArchived: boolean,
  isCurrent: () => boolean = () => true,
) {
  const first = await shopCenterApi.listPlatforms({
    includeArchived,
    page: 0,
    size: PLATFORM_DIRECTORY_PAGE_SIZE,
  })
  if (!isCurrent()) return undefined
  const expectedTotalPages = first.totalElements === 0
    ? 0
    : Math.ceil(first.totalElements / PLATFORM_DIRECTORY_PAGE_SIZE)
  if (
    first.page !== 0 ||
    first.size !== PLATFORM_DIRECTORY_PAGE_SIZE ||
    !Number.isSafeInteger(first.totalElements) ||
    first.totalElements < 0 ||
    !Number.isSafeInteger(first.totalPages) ||
    first.totalPages !== expectedTotalPages ||
    first.totalPages > MAX_PLATFORM_DIRECTORY_PAGES ||
    first.items.length > PLATFORM_DIRECTORY_PAGE_SIZE
  ) {
    throw new Error('Unexpected platform directory pagination')
  }

  const platforms = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await shopCenterApi.listPlatforms({
      includeArchived,
      page,
      size: PLATFORM_DIRECTORY_PAGE_SIZE,
    })
    if (!isCurrent()) return undefined
    if (
      next.page !== page ||
      next.size !== PLATFORM_DIRECTORY_PAGE_SIZE ||
      next.totalElements !== first.totalElements ||
      next.totalPages !== first.totalPages ||
      next.items.length > PLATFORM_DIRECTORY_PAGE_SIZE
    ) {
      throw new Error('Inconsistent platform directory pagination')
    }
    platforms.push(...next.items)
  }

  if (
    platforms.length !== first.totalElements ||
    new Set(platforms.map((platform) => platform.id)).size !== platforms.length
  ) {
    throw new Error('Incomplete platform directory pagination')
  }
  return platforms
}

const authorizationLabels: Record<TenantShop['authorization']['status'], string> = {
  NOT_REQUIRED: '无需授权',
  NOT_AUTHORIZED: '未授权',
  PENDING: '待验证',
  AUTHORIZED: '已授权',
  EXPIRED: '已过期',
  REVOKED: '已解绑',
  ERROR: '需处理',
}

const shopStatusLabels: Record<TenantShop['status'], string> = {
  ACTIVE: '启用',
  SUSPENDED: '已暂停',
  ARCHIVED: '已删除',
}

const syncStatusLabels: Record<ShopSyncJob['status'], string> = {
  QUEUED: '已排队',
  RUNNING: '进行中',
  SUCCEEDED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
}

function csvCell(value: string | number | undefined) {
  const text = value === undefined ? '' : String(value)
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe
}

export function shopExportCsv(
  shops: TenantShop[],
  platforms: Map<string, string>,
) {
  const columns = [
    '店铺名称',
    '平台店铺标识',
    '平台',
    '店铺状态',
    '授权状态',
    '授权时间',
    '验证时间',
    '到期时间',
    '创建时间',
    '更新时间',
  ]
  return `\uFEFF${[
    columns.join(','),
    ...shops.map((shop) =>
      [
        shopDisplayName(shop),
        shop.externalShopRef,
        platforms.get(shop.platformId),
        shopStatusLabels[shop.status],
        authorizationLabels[shop.authorization.status],
        shop.authorization.authorizedAt,
        shop.authorization.lastVerifiedAt,
        shop.authorization.expiresAt,
        shop.createdAt,
        shop.updatedAt,
      ].map(csvCell).join(','),
    ),
  ].join('\n')}\n`
}

export function isCreatablePlatform(platform: PlatformCatalogEntry) {
  return platform.status === 'ACTIVE'
    && [SHOPIFY_PLATFORM_CODE, OTHER_PLATFORM_CODE].includes(platform.code)
}

export function platformDisplayName(platform: PlatformCatalogEntry) {
  if (platform.code === SHOPIFY_PLATFORM_CODE) return 'Shopify'
  if (platform.code === OTHER_PLATFORM_CODE) return '其他平台'
  return platform.displayName
}

export function normalizeShopifyShopReference(value: string) {
  const normalized = value.trim().toLowerCase()
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(normalized)) {
    return `${normalized}.myshopify.com`
  }
  if (/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(normalized)) {
    return normalized
  }
  return null
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

export function parseShopCenterQuery(search: string): ShopCenterQuery {
  const query = new URLSearchParams(search)
  const queryText = query.get('query')?.trim()
  const platformId = query.get('platformId')
  const shopStatus = query.get('status')
  const authorizationStatus = query.get('authorizationStatus')
  return {
    includeArchived: query.get('includeArchived') === 'true',
    page: boundedInteger(query.get('page'), 0, 0, MAX_PAGE_INDEX),
    size: boundedInteger(query.get('size'), DEFAULT_PAGE_SIZE, 1, 100),
    query: queryText && queryText.length <= 100 ? queryText : undefined,
    platformId: platformId && UUID_PATTERN.test(platformId) ? platformId : undefined,
    status: shopStatus && Object.hasOwn(shopStatusLabels, shopStatus)
      ? shopStatus as TenantShop['status']
      : undefined,
    authorizationStatus: authorizationStatus && Object.hasOwn(authorizationLabels, authorizationStatus)
      ? authorizationStatus as TenantShop['authorization']['status']
      : undefined,
  }
}

export function toShopCenterUrl(query: ShopCenterQuery) {
  const search = new URLSearchParams({
    includeArchived: String(query.includeArchived),
    page: String(query.page),
    size: String(query.size),
  })
  if (query.query) search.set('query', query.query)
  if (query.platformId) search.set('platformId', query.platformId)
  if (query.status) search.set('status', query.status)
  if (query.authorizationStatus) search.set('authorizationStatus', query.authorizationStatus)
  return `/shops?${search.toString()}`
}

export function toShopDetailHref(shopId: string, listContext: string) {
  const search = new URLSearchParams({
    syncPage: '0',
    syncSize: '25',
    from: listContext,
  })
  return `/shops/${encodeURIComponent(shopId)}?${search.toString()}`
}

function filterDraft(query: ShopCenterQuery): ShopFilterDraft {
  return {
    includeArchived: query.includeArchived,
    query: query.query,
    platformId: query.platformId,
    status: query.status,
    authorizationStatus: query.authorizationStatus,
    size: query.size,
  }
}

type Translate = (source: string, values?: TranslationValues) => string

function safeErrorMessage(error: unknown, subject: string, t: Translate = (source, values) => {
  if (!values) return source
  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}) {
  if (error instanceof ApiError && error.status === 403) {
    return t('当前账号没有{subject}所需权限。登录状态仍保持不变。', { subject: t(subject) })
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

export function ShopCenterPage() {
  const { locale, t, formatNumber } = useI18n()
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseShopCenterQuery(search), [search])
  const shopifyInstallShop = useMemo(() => {
    const value = new URLSearchParams(search).get('shopifyInstallShop')?.trim().toLowerCase()
    return value && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value) ? value : undefined
  }, [search])
  const [draftFilters, setDraftFilters] = useState<ShopFilterDraft>(() => filterDraft(query))
  const [shops, setShops] = useState<LoadState<Page<TenantShop>>>({ status: 'loading' })
  const [platforms, setPlatforms] = useState<PlatformCatalogEntry[]>([])
  const [platformDirectoryUnavailable, setPlatformDirectoryUnavailable] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [onboarding, setOnboarding] = useState<ShopOnboardingState | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [checkingAuthorization, setCheckingAuthorization] = useState(false)
  const [syncStates, setSyncStates] = useState<Record<string, SyncState>>({})
  const [selectedShopIds, setSelectedShopIds] = useState<Set<string>>(
    () => new Set(),
  )
  const loadVersion = useRef(0)
  const syncRequestVersions = useRef<Record<string, number>>({})
  const syncReadsInFlight = useRef(new Set<string>())
  const currentPage = 'data' in shops ? shops.data : undefined
  const refreshing = shops.status === 'loading' && Boolean(shops.data)

  const canReadPlatforms = hasPermission('platform:read')
  const canCreateShops = hasPermission('shop:write')
  const canAuthorizeShops = hasPermission('shop:authorization:write')
  const canReadSync = hasPermission('shop:sync:read')

  const updateQuery = useCallback(
    (patch: Partial<ShopCenterQuery>) => {
      const next = { ...query, ...patch }
      router.history.push(toShopCenterUrl(next))
    },
    [query, router.history],
  )

  useEffect(() => {
    setDraftFilters(filterDraft(query))
  }, [query])

  const load = useCallback(async () => {
    const version = loadVersion.current + 1
    loadVersion.current = version
    setShops((current) => ({
      status: 'loading',
      data: 'data' in current ? current.data : undefined,
    }))
    setPlatformDirectoryUnavailable(false)
    try {
      const shopPage = await shopCenterApi.listShops(query)
      if (version !== loadVersion.current) return
      setShops({ status: 'ready', data: shopPage })
    } catch (error) {
      if (version !== loadVersion.current) return
      setShops({ status: 'error', message: safeErrorMessage(error, '读取店铺列表', t) })
      setPlatforms([])
      return
    }

    if (!canReadPlatforms) {
      setPlatforms([])
      return
    }

    try {
      const platformDirectory = await loadPlatformDirectory(
        query.includeArchived,
        () => version === loadVersion.current,
      )
      if (!platformDirectory) return
      setPlatforms(platformDirectory)
    } catch {
      if (version !== loadVersion.current) return
      setPlatforms([])
      setPlatformDirectoryUnavailable(true)
    }
  }, [canReadPlatforms, query, t])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const platformNames = useMemo(
    () => new Map(platforms.map((platform) => [platform.id, platformDisplayName(platform)])),
    [platforms],
  )
  const creatablePlatforms = useMemo(
    () => platforms.filter(isCreatablePlatform),
    [platforms],
  )

  useEffect(() => {
    if (shopifyInstallShop && canCreateShops && canAuthorizeShops && creatablePlatforms.length > 0) {
      setOnboarding((current) => current ?? { step: 'details' })
    }
  }, [canAuthorizeShops, canCreateShops, creatablePlatforms.length, shopifyInstallShop])
  const selectedShops = currentPage?.items.filter((shop) =>
    selectedShopIds.has(shop.id)
  ) ?? []

  useEffect(() => {
    const currentIds = new Set(currentPage?.items.map((shop) => shop.id) ?? [])
    setSelectedShopIds((selected) => {
      const next = new Set([...selected].filter((id) => currentIds.has(id)))
      return next.size === selected.size ? selected : next
    })
  }, [
    currentPage?.page,
    currentPage?.items.map((shop) => shop.id).join(','),
  ])

  const exportSelectedShops = () => {
    if (selectedShops.length === 0 || refreshing) return
    const url = URL.createObjectURL(
      new Blob([shopExportCsv(selectedShops, platformNames)], {
        type: 'text/csv;charset=utf-8',
      }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = locale === 'en'
      ? `store-list_selected-${selectedShops.length}.csv`
      : `店铺列表_选中${selectedShops.length}条.csv`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedQuery = draftFilters.query?.trim()
    updateQuery({
      includeArchived: draftFilters.includeArchived,
      query: normalizedQuery && normalizedQuery.length <= 100 ? normalizedQuery : undefined,
      platformId: draftFilters.platformId || undefined,
      status: draftFilters.status,
      authorizationStatus: draftFilters.authorizationStatus,
      size: draftFilters.size,
      page: 0,
    })
  }

  const clearFilters = () => {
    setDraftFilters({ includeArchived: false, size: query.size })
    updateQuery({
      includeArchived: false,
      query: undefined,
      platformId: undefined,
      status: undefined,
      authorizationStatus: undefined,
      size: query.size,
      page: 0,
    })
  }

  const completeOnboarding = useCallback(async (shop: TenantShop) => {
    let refreshedShop = shop
    try {
      refreshedShop = await shopCenterApi.getShop(shop.id)
    } catch {
      // The Connector snapshot is authoritative for completion. The list refresh
      // below will reconcile metadata if the detail read is temporarily delayed.
    }
    setOnboarding({ step: 'complete', shop: refreshedShop })
    setRefreshKey((value) => value + 1)
  }, [])

  const applyAuthorizationSnapshot = useCallback(async (
    shop: TenantShop,
    snapshot: ShopChannelSnapshot,
  ) => {
    if (snapshot.shopify.status === 'CONNECTED') {
      await completeOnboarding(shop)
      return true
    }
    return false
  }, [completeOnboarding])

  const prepareShopifyAuthorization = useCallback(async (shop: TenantShop) => {
    setOnboarding({ step: 'authorize', shop, status: 'loading' })
    if (!canAuthorizeShops) {
      setOnboarding({
        step: 'authorize',
        shop,
        status: 'error',
        message: t('当前账号没有生成 Shopify 公开应用安装链接所需权限。'),
      })
      return
    }
    try {
      const result = await shopCenterApi.authorizeShopify(shop.id)
      if (await applyAuthorizationSnapshot(shop, result.snapshot)) return
      if (!result.authorizationUrl) {
        throw new Error('Shopify authorization URL is unavailable')
      }
      setOnboarding({
        step: 'authorize',
        shop,
        status: 'ready',
        authorizationUrl: result.authorizationUrl,
      })
    } catch (error) {
      setOnboarding({
        step: 'authorize',
        shop,
        status: 'error',
        message: safeErrorMessage(error, '生成 Shopify 安装链接', t),
      })
    }
  }, [applyAuthorizationSnapshot, canAuthorizeShops, t])

  const checkShopifyAuthorization = useCallback(async (
    shop: TenantShop,
    showFeedback: boolean,
  ) => {
    if (showFeedback) setCheckingAuthorization(true)
    try {
      const snapshot = await shopCenterApi.getChannels(shop.id)
      if (await applyAuthorizationSnapshot(shop, snapshot)) return
      if (showFeedback) {
        setOnboarding((current) => current?.step === 'authorize' && current.shop.id === shop.id
          ? { ...current, message: t('暂未检测到授权完成。请确认已在对应浏览器中安装应用，然后再次检查。') }
          : current)
      }
    } catch (error) {
      if (showFeedback) {
        setOnboarding((current) => current?.step === 'authorize' && current.shop.id === shop.id
          ? { ...current, message: safeErrorMessage(error, '检查 Shopify 安装状态', t) }
          : current)
      }
    } finally {
      if (showFeedback) setCheckingAuthorization(false)
    }
  }, [applyAuthorizationSnapshot, t])

  useEffect(() => {
    if (onboarding?.step !== 'authorize' || onboarding.status !== 'ready') return
    const shop = onboarding.shop
    const interval = window.setInterval(() => {
      void checkShopifyAuthorization(shop, false)
    }, 3_000)
    return () => window.clearInterval(interval)
  }, [checkShopifyAuthorization, onboarding])

  const handleCreateShop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const platformId = String(form.get('platformId') ?? '')
    const platform = creatablePlatforms.find((item) => item.id === platformId)
    setCreateError(null)
    if (!platform) {
      setCreateError(t('仅支持选择当前启用的 Shopify 或其他平台，请刷新后重试。'))
      return
    }
    let input: Parameters<typeof shopCenterApi.createShop>[0]
    if (platform.code === SHOPIFY_PLATFORM_CODE) {
      const externalShopRef = normalizeShopifyShopReference(
        String(form.get('externalShopRef') ?? ''),
      )
      if (!externalShopRef) {
        setCreateError(t('请输入正确的 Shopify 店铺 ID 或 .myshopify.com 域名。'))
        return
      }
      input = { platformId, externalShopRef }
    } else {
      const displayName = String(form.get('displayName') ?? '').trim()
      if (!displayName || displayName.length > 160) {
        setCreateError(t('请输入内部店铺名称。'))
        return
      }
      input = { platformId, displayName }
    }
    setCreating(true)
    try {
      const created = await shopCenterApi.createShop(input)
      setRefreshKey((value) => value + 1)
      if (platform.code === OTHER_PLATFORM_CODE) {
        setOnboarding({ step: 'complete', shop: created })
      } else {
        await prepareShopifyAuthorization(created)
      }
    } catch (error) {
      setCreateError(safeErrorMessage(error, '创建店铺', t))
    } finally {
      setCreating(false)
    }
  }

  const beginSyncRequest = (shopId: string) => {
    const version = (syncRequestVersions.current[shopId] ?? 0) + 1
    syncRequestVersions.current[shopId] = version
    setSyncStates((current) => ({ ...current, [shopId]: { status: 'loading' } }))
    return version
  }

  const updateSyncState = (shopId: string, version: number, state: SyncState) => {
    if (version !== syncRequestVersions.current[shopId]) return
    setSyncStates((current) => ({ ...current, [shopId]: state }))
  }

  const inspectSync = async (shopId: string) => {
    if (syncReadsInFlight.current.has(shopId)) return
    syncReadsInFlight.current.add(shopId)
    const version = beginSyncRequest(shopId)
    try {
      const response = await shopCenterApi.listSyncJobs(shopId)
      updateSyncState(shopId, version, { status: 'ready', job: response.items[0] })
    } catch (error) {
      updateSyncState(shopId, version, {
        status: 'error',
        message: safeErrorMessage(error, '读取同步任务', t),
      })
    } finally {
      syncReadsInFlight.current.delete(shopId)
    }
  }

  return (
    <section className="shop-center-page" aria-labelledby="shops-page-title">
      <header className="page-heading shop-center-heading">
        <h1 id="shops-page-title">{t('店铺列表')}</h1>
      </header>

      {onboarding && (
        <ShopOnboardingDialog
          state={onboarding}
          canReadPlatforms={canReadPlatforms}
          canAuthorizeShops={canAuthorizeShops}
          platformDirectoryUnavailable={platformDirectoryUnavailable}
          platforms={creatablePlatforms}
          creating={creating}
          checkingAuthorization={checkingAuthorization}
          directInstall={Boolean(shopifyInstallShop)}
          initialShopDomain={shopifyInstallShop}
          error={createError}
          onClose={() => {
            setOnboarding(null)
            setCreateError(null)
          }}
          onSubmit={handleCreateShop}
          onRetryAuthorization={(shop) => void prepareShopifyAuthorization(shop)}
          onCheckAuthorization={(shop) => void checkShopifyAuthorization(shop, true)}
          onViewShop={(shop) => router.history.push(
            toShopDetailHref(shop.id, toShopCenterUrl(query)),
          )}
        />
      )}

      <form
        className="shop-toolbar shop-filter-panel erp-filter-panel erp-compact-filter-panel"
        aria-label={t('店铺列表筛选')}
        onSubmit={applyFilters}
      >
        <div className="erp-filter-row erp-filter-search-row">
          <span className="erp-filter-label">{t('搜索内容：')}</span>
          <input
            id="shop-filter-query"
            aria-label={t('搜索内容')}
            value={draftFilters.query ?? ''}
            maxLength={100}
            onChange={(event) => setDraftFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder={t('请输入店铺名称或平台店铺标识')}
          />
          <button className="button button-primary" type="submit">
            <Search size={17} aria-hidden="true" />
            {t('搜索')}
          </button>
        </div>
        <label className="erp-filter-row erp-filter-short-row" htmlFor="shop-filter-platform">
          <span className="erp-filter-label">{t('平台：')}</span>
          <select
            id="shop-filter-platform"
            aria-label={t('平台')}
            value={draftFilters.platformId ?? ''}
            disabled={!canReadPlatforms || platformDirectoryUnavailable}
            onChange={(event) => setDraftFilters((current) => ({ ...current, platformId: event.target.value || undefined }))}
          >
            <option value="">{t('全部平台')}</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>{platformDisplayName(platform)}</option>
            ))}
          </select>
        </label>
        <label className="erp-filter-row erp-filter-short-row" htmlFor="shop-filter-status">
          <span className="erp-filter-label">{t('店铺状态：')}</span>
          <select
            id="shop-filter-status"
            aria-label={t('店铺状态')}
            value={draftFilters.status ?? ''}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              status: (event.target.value || undefined) as ShopFilterDraft['status'],
            }))}
          >
            <option value="">{t('全部状态')}</option>
            {Object.entries(shopStatusLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
        </label>
        <label className="erp-filter-row erp-filter-short-row" htmlFor="shop-filter-authorization">
          <span className="erp-filter-label">{t('授权状态：')}</span>
          <select
            id="shop-filter-authorization"
            aria-label={t('授权状态')}
            value={draftFilters.authorizationStatus ?? ''}
            onChange={(event) => setDraftFilters((current) => ({
              ...current,
              authorizationStatus: (event.target.value || undefined) as ShopFilterDraft['authorizationStatus'],
            }))}
          >
            <option value="">{t('全部授权状态')}</option>
            {Object.entries(authorizationLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
        </label>
        <div className="erp-filter-row shop-filter-options-row">
          <span className="erp-filter-label">{t('其他：')}</span>
          <div className="erp-filter-options">
            <label className="checkbox-label" htmlFor="include-archived">
              <input
                id="include-archived"
                type="checkbox"
                checked={draftFilters.includeArchived}
                onChange={(event) => setDraftFilters((current) => ({ ...current, includeArchived: event.target.checked }))}
              />
              {t('包含已删除店铺')}
            </label>
            <label className="shop-page-size" htmlFor="shop-filter-size">
              {t('每页')}
              <select
                id="shop-filter-size"
                aria-label={t('每页数量')}
                value={draftFilters.size}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  size: Number(event.target.value),
                }))}
              >
                {[...new Set([10, 25, 50, 100, draftFilters.size])]
                  .sort((left, right) => left - right)
                  .map((size) => <option key={size} value={size}>{t('{count} 条', { count: formatNumber(size) })}</option>)}
              </select>
            </label>
            <button className="button button-secondary" type="button" onClick={clearFilters}>{t('重置')}</button>
          </div>
        </div>
        {(!canReadPlatforms || platformDirectoryUnavailable) && (
          <span className="toolbar-note" role="status">{t('平台目录不可用，其他筛选仍可使用。')}</span>
        )}
      </form>

      <ShopCenterActions
        canCreateShops={canCreateShops}
        showCreateForm={Boolean(onboarding)}
        totalElements={currentPage?.totalElements}
        selectedCount={selectedShops.length}
        canExport={selectedShops.length > 0 && !refreshing}
        onRefresh={() => setRefreshKey((value) => value + 1)}
        onToggleCreate={() => {
          setCreateError(null)
          setOnboarding((current) => current ? null : { step: 'details' })
        }}
        onExport={exportSelectedShops}
      />

      {shops.status === 'loading' && !shops.data && (
        <div className="empty-panel shop-state" aria-busy="true" aria-live="polite">
          <CircleDashed className="spin" size={30} aria-hidden="true" />
          <h2>{t('正在加载店铺')}</h2>
          <p>{t('正在读取可访问的店铺。')}</p>
        </div>
      )}

      {refreshing && (
        <div className="inline-alert" role="status" aria-live="polite">
          <CircleDashed className="spin" size={19} aria-hidden="true" />
          <div>
            <strong>{t('正在刷新店铺列表')}</strong>
            <span>{t('筛选或页码已经变化；表格暂时显示上一次结果，请等待新结果返回。')}</span>
          </div>
        </div>
      )}

      {shops.status === 'error' && (
        <div className="empty-panel shop-state" role="alert">
          <ShieldAlert size={30} aria-hidden="true" />
          <h2>{t('暂时无法读取店铺列表')}</h2>
          <p>{shops.message}</p>
          <button className="button button-primary" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            {t('重新加载')}
          </button>
        </div>
      )}

      {currentPage && (
        <ShopTable
          page={currentPage}
          platforms={platformNames}
          platformDirectoryUnavailable={platformDirectoryUnavailable}
          canReadPlatforms={canReadPlatforms}
          canReadSync={canReadSync}
          listContext={toShopCenterUrl(query)}
          refreshing={refreshing}
          syncStates={syncStates}
          selected={selectedShopIds}
          onSelectionChange={setSelectedShopIds}
          onInspectSync={inspectSync}
          onPageChange={(page) => updateQuery({ page })}
        />
      )}
    </section>
  )
}

function ShopOnboardingDialog({
  state,
  canReadPlatforms,
  canAuthorizeShops,
  platformDirectoryUnavailable,
  platforms,
  creating,
  checkingAuthorization,
  directInstall,
  initialShopDomain,
  error,
  onClose,
  onSubmit,
  onRetryAuthorization,
  onCheckAuthorization,
  onViewShop,
}: {
  state: ShopOnboardingState
  canReadPlatforms: boolean
  canAuthorizeShops: boolean
  platformDirectoryUnavailable: boolean
  platforms: PlatformCatalogEntry[]
  creating: boolean
  checkingAuthorization: boolean
  directInstall: boolean
  initialShopDomain?: string
  error: string | null
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onRetryAuthorization: (shop: TenantShop) => void
  onCheckAuthorization: (shop: TenantShop) => void
  onViewShop: (shop: TenantShop) => void
}) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const preferredPlatformId = platforms.find((platform) =>
    platform.code === SHOPIFY_PLATFORM_CODE)?.id ?? platforms[0]?.id ?? ''
  const [selectedPlatformId, setSelectedPlatformId] = useState(preferredPlatformId)
  const selectedPlatform = platforms.find((platform) =>
    platform.id === selectedPlatformId)
  const internalShop = selectedPlatform?.code === OTHER_PLATFORM_CODE
    || state.step === 'complete'
      && state.shop.authorization.status === 'NOT_REQUIRED'
  const progressLabels = internalShop
    ? ['店铺信息', '完成']
    : ['店铺信息', '店铺授权', '完成']
  const step = state.step === 'details'
    ? 1
    : state.step === 'authorize'
      ? 2
      : progressLabels.length

  useEffect(() => {
    if (!platforms.some((platform) => platform.id === selectedPlatformId)) {
      setSelectedPlatformId(preferredPlatformId)
    }
  }, [platforms, preferredPlatformId, selectedPlatformId])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [state.step])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [creating, onClose])

  return (
    <div
      className="dialog-backdrop shop-onboarding-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !creating) onClose()
      }}
    >
      <section
        className="write-dialog shop-onboarding-dialog"
        id="shop-onboarding-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-onboarding-title"
        tabIndex={-1}
      >
        <header className="shop-onboarding-heading">
          <div>
            <p className="eyebrow">{t('店铺接入')}</p>
            <h2 id="shop-onboarding-title">{t('新增店铺')}</h2>
          </div>
          <DialogCloseButton label={t('关闭新增店铺')} onClick={onClose} disabled={creating} />
        </header>

        <ol className="shop-onboarding-progress" aria-label={t('新增店铺进度，第 {step} 步，共 {total} 步', { step, total: progressLabels.length })}>
          {progressLabels.map((label, index) => {
            const position = index + 1
            return (
              <li
                key={label}
                className={position < step ? 'complete' : position === step ? 'current' : undefined}
                aria-current={position === step ? 'step' : undefined}
              >
                <span>{position < step ? <CheckCircle2 size={16} aria-hidden="true" /> : position}</span>
                {t(label)}
              </li>
            )
          })}
        </ol>

        {state.step === 'details' && (
          <div className="shop-onboarding-body">
            {!canReadPlatforms ? (
              <div className="inline-alert" role="alert">
                <ShieldAlert size={19} aria-hidden="true" />
                <div><strong>{t('无法读取平台目录')}</strong><span>{t('创建店铺需要平台目录读取权限。')}</span></div>
              </div>
            ) : platformDirectoryUnavailable ? (
              <div className="inline-alert" role="alert">
                <ShieldAlert size={19} aria-hidden="true" />
                <div><strong>{t('平台目录暂不可用')}</strong><span>{t('请关闭弹窗并刷新店铺列表后重试。')}</span></div>
              </div>
            ) : (
              <form className="shop-create-form shop-onboarding-form" onSubmit={(event) => void onSubmit(event)}>
                <label htmlFor="shop-platform">{t('平台')}</label>
                <select
                  id="shop-platform"
                  name="platformId"
                  value={selectedPlatformId}
                  onChange={(event) => setSelectedPlatformId(event.target.value)}
                  required
                  disabled={creating || platforms.length === 0}
                >
                  <option value="">{t('请选择平台')}</option>
                  {platforms.map((platform) => (
                    <option value={platform.id} key={platform.id}>{platformDisplayName(platform)}</option>
                  ))}
                </select>
                {platforms.length === 0 && (
                  <p className="toolbar-note" role="status">{t('当前没有可用于新增店铺的平台。')}</p>
                )}
                {!internalShop && !canAuthorizeShops && (
                  <p className="form-error" role="alert">{t('当前账号没有店铺授权权限，无法完成接入流程。')}</p>
                )}

                {internalShop ? (
                  <>
                    <label htmlFor="shop-display-name">{t('内部店铺名称')}</label>
                    <input
                      id="shop-display-name"
                      name="displayName"
                      maxLength={160}
                      required
                      disabled={creating}
                      placeholder={t('例如：线下订单一店')}
                      autoComplete="off"
                    />
                    <p className="field-help">{t('内部店铺无需绑定或授权，可直接用于现有订单和审单流程。')}</p>
                  </>
                ) : (
                  <>
                    <label htmlFor="shop-external-ref">{t('Shopify 店铺 ID 或域名')}</label>
                    <input
                      id="shop-external-ref"
                      name="externalShopRef"
                      maxLength={160}
                      required
                      disabled={creating}
                      placeholder={t('例如：my-store 或 my-store.myshopify.com')}
                      autoComplete="off"
                      defaultValue={initialShopDomain ?? ''}
                    />
                    <p className="field-help">{t('输入店铺 ID 时，系统会自动补全域名；授权成功后会从 Shopify 自动读取店铺名称。')}</p>
                  </>
                )}

                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="form-actions">
                  <button className="button button-secondary" type="button" onClick={onClose} disabled={creating}>{t('取消')}</button>
                  <button className="button button-primary" type="submit" disabled={creating || platforms.length === 0 || (!internalShop && !canAuthorizeShops)}>
                    {creating ? <CircleDashed className="spin" size={15} aria-hidden="true" /> : null}
                    {t(creating ? '正在创建' : internalShop ? '创建店铺' : '下一步')}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {state.step === 'authorize' && (
          <div className="shop-onboarding-body">
            <div className="shop-onboarding-shop-summary">
              <span>{t('待安装店铺')}</span>
              <strong>{state.shop.externalShopRef}</strong>
              <small>{t('授权成功后自动识别店铺名称')}</small>
            </div>
            {state.status === 'loading' && (
              <div className="shop-onboarding-wait" role="status" aria-live="polite">
                <CircleDashed className="spin" size={24} aria-hidden="true" />
                <strong>{t('正在生成一次性安装链接')}</strong>
                <span>{t('不会打开或控制任何浏览器。')}</span>
              </div>
            )}
            {state.status === 'error' && (
              <div className="shop-onboarding-wait" role="alert">
                <ShieldAlert size={24} aria-hidden="true" />
                <strong>{t('暂时无法生成安装链接')}</strong>
                <span>{state.message}</span>
                <button className="button button-primary" type="button" onClick={() => onRetryAuthorization(state.shop)}>{t('重新生成')}</button>
              </div>
            )}
            {state.status === 'ready' && state.authorizationUrl && (
              <>
                <ShopifyAuthorizationLink
                  authorizationUrl={state.authorizationUrl}
                  directInstall={directInstall}
                  checking={checkingAuthorization}
                  onCheck={() => onCheckAuthorization(state.shop)}
                />
                {state.message && <p className="inline-alert" role="status" aria-live="polite">{state.message}</p>}
              </>
            )}
            <div className="form-actions shop-onboarding-footer">
              <button className="button button-secondary" type="button" onClick={onClose}>{t('稍后完成')}</button>
            </div>
          </div>
        )}

        {state.step === 'complete' && (
          <div className="shop-onboarding-body shop-onboarding-complete" role="status" aria-live="polite">
            <CheckCircle2 size={42} aria-hidden="true" />
            <h3>{t(internalShop ? '内部店铺创建成功' : 'Shopify 店铺接入成功')}</h3>
            <p>{shopDisplayName(state.shop)}</p>
            <small>{t(internalShop ? '无需绑定外部平台' : state.shop.externalShopRef)}</small>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={onClose}>{t('完成')}</button>
              <button className="button button-primary" type="button" onClick={() => onViewShop(state.shop)}>{t('查看店铺')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export function ShopCenterActions({
  canCreateShops,
  showCreateForm,
  totalElements,
  selectedCount = 0,
  canExport = false,
  onRefresh,
  onToggleCreate,
  onExport,
}: {
  canCreateShops: boolean
  showCreateForm: boolean
  totalElements?: number
  selectedCount?: number
  canExport?: boolean
  onRefresh: () => void
  onToggleCreate: () => void
  onExport?: () => void
}) {
  const { t, formatNumber } = useI18n()
  return (
    <div className="erp-operation-bar" aria-label={t('店铺操作')}>
      <div className="erp-operation-start">
        <span className="erp-selection-count">
          {totalElements === undefined
            ? t('店铺列表')
            : t('共 {total} 条，已选 {selected} 条', { total: formatNumber(totalElements), selected: formatNumber(selectedCount) })}
        </span>
      </div>
      <div className="erp-operation-end">
        {onExport && (
          <button
            className="button"
            type="button"
            disabled={!canExport}
            onClick={onExport}
          >
            {t('导出勾选的店铺')}
          </button>
        )}
        <button className="button" type="button" onClick={onRefresh}>
          <RefreshCw size={17} aria-hidden="true" />
          {t('刷新')}
        </button>
        {canCreateShops && (
          <button
            className="button button-primary"
            type="button"
            onClick={onToggleCreate}
            aria-expanded={showCreateForm}
            aria-controls="shop-onboarding-dialog"
          >
            <Plus size={18} aria-hidden="true" />
            {t('新增店铺')}
          </button>
        )}
      </div>
    </div>
  )
}

type ShopTableProps = {
  page: Page<TenantShop>
  platforms: Map<string, string>
  platformDirectoryUnavailable: boolean
  canReadPlatforms: boolean
  canReadSync: boolean
  listContext: string
  refreshing?: boolean
  syncStates: Record<string, SyncState>
  selected?: Set<string>
  onSelectionChange?: (selected: Set<string>) => void
  onInspectSync: (shopId: string) => void
  onPageChange: (page: number) => void
}

export function ShopTable({
  page,
  platforms,
  platformDirectoryUnavailable,
  canReadPlatforms,
  canReadSync,
  listContext,
  refreshing = false,
  syncStates,
  selected = new Set(),
  onSelectionChange,
  onInspectSync,
  onPageChange,
}: ShopTableProps) {
  const { t } = useI18n()
  return (
    <section
      className="shop-list-section"
      aria-busy={refreshing || undefined}
      aria-labelledby="shop-list-title"
    >
      <h2 className="sr-only" id="shop-list-title">{t('店铺列表')}</h2>
      {platformDirectoryUnavailable && (
        <div className="inline-alert" role="status">
          <ShieldAlert size={19} aria-hidden="true" />
          <div>
            <strong>{t('平台显示名暂不可用')}</strong>
            <span>{t('店铺列表仍可使用；请确认 platform:read 权限后刷新。')}</span>
          </div>
        </div>
      )}
      <div className="shop-table-scroll">
        <table className="shop-table erp-pinned-actions">
          <caption className="sr-only">{t('店铺列表')}</caption>
          <thead>
            <tr>
              {onSelectionChange && (
                <th scope="col">
                  <PageSelectionCheckbox
                    aria-label={t('选择当前页全部店铺')}
                    disabled={refreshing}
                    selectedCount={page.items.filter(shop => selected.has(shop.id)).length}
                    totalCount={page.items.length}
                    onChange={(event) =>
                      onSelectionChange(
                        event.target.checked
                          ? new Set(page.items.map((shop) => shop.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
              )}
              <th scope="col">{t('店铺')}</th>
              <th scope="col">{t('平台')}</th>
              <th scope="col">{t('授权状态 / 验证')}</th>
              <th scope="col">{t('同步执行能力')}</th>
              <th scope="col">{t('创建 / 更新')}</th>
              <th scope="col"><span className="sr-only">{t('操作')}</span></th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((shop) => {
              const sync = syncStates[shop.id] ?? { status: 'idle' }
              return (
                <tr key={shop.id}>
                  {onSelectionChange && (
                    <td>
                      <input
                        aria-label={t('选择店铺 {name}', { name: shopDisplayName(shop) })}
                        type="checkbox"
                        disabled={refreshing}
                        checked={selected.has(shop.id)}
                        onChange={(event) => {
                          const next = new Set(selected)
                          if (event.target.checked) next.add(shop.id)
                          else next.delete(shop.id)
                          onSelectionChange(next)
                        }}
                      />
                    </td>
                  )}
                  <td>
                    <strong>{shopDisplayName(shop)}</strong>
                    <small>{t(shop.authorization.status === 'NOT_REQUIRED' ? '内部店铺' : shop.externalShopRef)}</small>
                    <span className={`status-chip shop-status-${shop.status.toLowerCase()}`}>
                      {t(shopStatusLabels[shop.status])}
                    </span>
                  </td>
                  <td>
                    {platforms.get(shop.platformId) ?? (
                      canReadPlatforms ? t('平台目录暂不可用') : t('无平台目录读取权限')
                    )}
                  </td>
                  <td>
                    <span className={`status-chip authorization-${shop.authorization.status.toLowerCase()}`}>
                      {t(authorizationLabels[shop.authorization.status])}
                    </span>
                    {shop.authorization.status === 'NOT_REQUIRED' ? (
                      <small>{t('无需绑定外部平台')}</small>
                    ) : (
                      <>
                        <small>{t(shop.authorization.credentialConfigured ? '已配置安全凭据' : '未配置安全凭据')}</small>
                        <small>{t('授权')} <ShopDateTime value={shop.authorization.authorizedAt} /></small>
                        <small>{t('验证')} <ShopDateTime value={shop.authorization.lastVerifiedAt} /></small>
                        <small>{t('到期')} <ShopDateTime value={shop.authorization.expiresAt} /></small>
                        {shop.authorization.safeErrorSummary && (
                          <small className="error-text">{shop.authorization.safeErrorSummary}</small>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <SyncSummary state={sync} />
                  </td>
                  <td>
                    <small>{t('创建')} <ShopDateTime value={shop.createdAt} /></small>
                    <small>{t('更新')} <ShopDateTime value={shop.updatedAt} /></small>
                  </td>
                  <td>
                    <div className="row-actions">
                      {refreshing ? (
                        <span className="text-button" aria-disabled="true">{t('查看详情')}</span>
                      ) : (
                        <Link
                          className="text-button"
                          to={toShopDetailHref(shop.id, listContext) as never}
                        >
                          {t('查看详情')}
                        </Link>
                      )}
                      {canReadSync && (
                        <button className="text-button" type="button" onClick={() => void onInspectSync(shop.id)} disabled={refreshing || sync.status === 'loading'}>
                          {t('查看同步')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {page.items.length === 0 ? (
        <div className="empty-panel shop-state">
          <Store size={30} aria-hidden="true" />
          <h2>{t('尚无店铺')}</h2>
          <p>{t('当前筛选条件下没有店铺。拥有写入权限的管理员可以新增店铺。')}</p>
        </div>
      ) : (
        <Pagination page={page} onPageChange={onPageChange} disabled={refreshing} />
      )}
    </section>
  )
}

function SyncSummary({ state }: { state: SyncState }) {
  const { t } = useI18n()
  if (state.status === 'idle') {
    return (
      <span className="muted-cell">
        {t('暂无可创建的同步任务')}
        <small>{t('可查看历史同步记录。')}</small>
      </span>
    )
  }
  if (state.status === 'loading') return <span className="muted-cell">{t('正在读取历史任务…')}</span>
  if (state.status === 'error') return <span className="error-text">{state.message}</span>
  if (!state.job) {
    return (
      <span className="muted-cell">
        {t('暂无历史同步记录')}
        <small>{t('可查看历史同步记录。')}</small>
      </span>
    )
  }
  return (
    <span>
      <span className={`sync-state sync-${state.job.status.toLowerCase()}`}>
        <CloudCog size={15} aria-hidden="true" />
        {t('历史任务：')}{t(syncStatusLabels[state.job.status])}
      </span>
      <small><ShopDateTime value={state.job.completedAt ?? state.job.requestedAt} /></small>
      <small>{t('暂无可创建的同步任务')}</small>
      {state.job.safeErrorSummary && (
        <small className="error-text">{state.job.safeErrorSummary}</small>
      )}
    </span>
  )
}

export function Pagination({
  page,
  onPageChange,
  disabled = false,
}: {
  page: Page<unknown>
  onPageChange: (page: number) => void
  disabled?: boolean
}) {
  const { t, formatNumber } = useI18n()
  const hasPrevious = page.page > 0
  const hasNext = page.page + 1 < page.totalPages
  return (
    <nav className="pagination" aria-label={t('店铺列表分页')}>
      <span>{t('第 {current} / {total} 页', { current: formatNumber(page.page + 1), total: formatNumber(Math.max(page.totalPages, 1)) })}</span>
      <div>
        <button className="button button-secondary" type="button" disabled={disabled || !hasPrevious} onClick={() => onPageChange(page.page - 1)}>
          {t('上一页')}
        </button>
        <button className="button button-secondary" type="button" disabled={disabled || !hasNext} onClick={() => onPageChange(page.page + 1)}>
          {t('下一页')}
        </button>
      </div>
    </nav>
  )
}

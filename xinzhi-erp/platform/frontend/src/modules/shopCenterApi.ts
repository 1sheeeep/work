import { apiClient } from '../api/client'

const API_BASE = '/api/v1/platform-center'

export type Page<T> = {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type PageRequest = {
  includeArchived?: boolean
  page: number
  size: number
}

export type ShopListRequest = PageRequest & {
  query?: string
  platformId?: string
  status?: TenantShop['status']
  authorizationStatus?: ShopAuthorizationSummary['status']
}

export type PlatformCatalogEntry = {
  id: string
  code: string
  displayName: string
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
}

export type ShopAuthorizationSummary = {
  status: 'NOT_REQUIRED' | 'NOT_AUTHORIZED' | 'PENDING' | 'AUTHORIZED' | 'EXPIRED' | 'REVOKED' | 'ERROR'
  credentialConfigured: boolean
  credentialReferenceType?: string
  providerAccountRef?: string
  scopes: string[]
  authorizedAt?: string
  expiresAt?: string
  lastVerifiedAt?: string
  revokedAt?: string
  safeErrorSummary?: string
}

export type ShopAuthorizationDetail = ShopAuthorizationSummary & {
  version: number
}

export type TenantShop = {
  id: string
  platformId: string
  externalShopRef: string
  displayName: string
  localizedDisplayName?: string
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'
  authorization: ShopAuthorizationSummary
  createdAt?: string
  updatedAt: string
}

export type ShopDetail = Omit<TenantShop, 'authorization' | 'createdAt'> & {
  authorization: ShopAuthorizationDetail
  createdAt: string
  version: number
}

export type ShopSyncJob = {
  id: string
  shopId: string
  jobType: 'FULL' | 'ORDERS' | 'PRODUCTS' | 'INVENTORY'
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  progressProcessed: number
  progressTotal?: number
  attemptCount: number
  safeErrorSummary?: string
  requestedAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
}

export type CreateShopInput = {
  platformId: string
  externalShopRef?: string
  displayName?: string
}

export type UpdateShopInput = {
  version: number
  externalShopRef: string
  displayName: string
  status: Exclude<TenantShop['status'], 'ARCHIVED'>
}

export type ChannelConnectionStatus =
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'CONNECTED'
  | 'FAILED'
  | 'REVOKED'

export type ChannelConnection = {
  status: ChannelConnectionStatus
  safeErrorCode?: string
  safeErrorSummary?: string
  updatedAt?: string
  shopName?: string
  shopDomain?: string
}

export type ChannelActivity = {
  id: string
  action: string
  target: string
  result: ChannelConnectionStatus
  safeSummary?: string
  createdAt: string
}

export type ShopifyScopeCoverageStatus = 'REQUESTED' | 'GRANTED' | 'MISSING'

export type ShopifyPermissionScope = {
  scope: string
  purpose: string
  status: ShopifyScopeCoverageStatus
}

export type ShopChannelSnapshot = {
  mode: 'UNCONFIGURED' | 'DETERMINISTIC_FAKE' | 'XZ_ERP_APP'
  shopify: ChannelConnection
  shopifyScopes: ShopifyPermissionScope[]
  activity: ChannelActivity[]
}

export type ShopifyAuthorizationStart = {
  snapshot: ShopChannelSnapshot
  authorizationUrl?: string
}

type WireShopifyAuthorizationStart = {
  snapshot: ShopChannelSnapshot
  authorizationUrl?: string | null
}

export type ShopifyLocationMappedWarehouse = {
  mappingId: string
  warehouseId: string
  businessCode: string
  name: string
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
  version: number
}

export type ShopifyLocationMappingItem = {
  externalLocationRef: string
  name: string
  active: boolean
  fulfillsOnlineOrders: boolean
  hasActiveInventory: boolean
  fulfillmentService: boolean
  address1?: string
  address2?: string
  city?: string
  province?: string
  provinceCode?: string
  country?: string
  countryCode?: string
  zip?: string
  providerPresent: boolean
  mapping?: ShopifyLocationMappedWarehouse
}

export type ShopifyLocationWarehouseOption = {
  id: string
  businessCode: string
  name: string
}

export type ShopifyLocationMappingCatalog = {
  locations: ShopifyLocationMappingItem[]
  warehouses: ShopifyLocationWarehouseOption[]
}

type WirePage<T> = Page<T>

type WireAuthorization = ShopAuthorizationSummary & {
  // Deliberately ignored if a backend response accidentally includes sensitive diagnostics.
  credentialReference?: string
  errorSummary?: string
}

type WireShop = Omit<TenantShop, 'authorization'> & {
  authorization: WireAuthorization
}

type WireAuthorizationDetail = WireAuthorization & {
  authorizedAt?: string
  revokedAt?: string
  version: number
}

type WireShopDetail = Omit<ShopDetail, 'authorization'> & {
  authorization: WireAuthorizationDetail
}

type WireSyncJob = {
  id: string
  shopId: string
  jobType: ShopSyncJob['jobType']
  status: ShopSyncJob['status']
  progressProcessed: number
  progressTotal?: number | null
  attemptCount: number
  requestedAt: string
  startedAt?: string
  completedAt?: string
  updatedAt: string
  errorCode?: string
  errorSummary?: string
  version?: number
}

function queryPath(path: string, request: PageRequest) {
  const query = new URLSearchParams({
    page: String(request.page),
    size: String(request.size),
    includeArchived: String(request.includeArchived ?? false),
  })
  return `${path}?${query.toString()}`
}

function shopQueryPath(request: ShopListRequest) {
  const query = new URLSearchParams({
    page: String(request.page),
    size: String(request.size),
    includeArchived: String(request.includeArchived ?? false),
  })
  const normalizedQuery = request.query?.trim()
  if (normalizedQuery) query.set('query', normalizedQuery)
  if (request.platformId) query.set('platformId', request.platformId)
  if (request.status) query.set('status', request.status)
  if (request.authorizationStatus) query.set('authorizationStatus', request.authorizationStatus)
  return `${API_BASE}/shops?${query.toString()}`
}

function mapPage<TWire, TDomain>(
  page: WirePage<TWire>,
  mapper: (item: TWire) => TDomain,
): Page<TDomain> {
  return {
    items: page.items.map((item) => mapper(item)),
    page: page.page,
    size: page.size,
    totalElements: page.totalElements,
    totalPages: page.totalPages,
  }
}

function mapAuthorization(value: WireAuthorization): ShopAuthorizationSummary {
  return {
    status: value.status,
    credentialConfigured: value.credentialConfigured,
    credentialReferenceType: value.credentialReferenceType,
    providerAccountRef: value.providerAccountRef,
    scopes: value.scopes,
    authorizedAt: value.authorizedAt,
    expiresAt: value.expiresAt,
    lastVerifiedAt: value.lastVerifiedAt,
    revokedAt: value.revokedAt,
    safeErrorSummary: value.errorSummary,
  }
}

function mapShop(value: WireShop): TenantShop {
  return {
    id: value.id,
    platformId: value.platformId,
    externalShopRef: value.externalShopRef,
    displayName: value.displayName,
    localizedDisplayName: value.localizedDisplayName ?? undefined,
    status: value.status,
    authorization: mapAuthorization(value.authorization),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function shopDisplayName(shop: Pick<TenantShop, 'displayName' | 'localizedDisplayName'>) {
  return shop.localizedDisplayName || shop.displayName
}

function mapAuthorizationDetail(value: WireAuthorizationDetail): ShopAuthorizationDetail {
  return {
    ...mapAuthorization(value),
    authorizedAt: value.authorizedAt,
    revokedAt: value.revokedAt,
    version: value.version,
  }
}

function mapShopDetail(value: WireShopDetail): ShopDetail {
  return {
    ...mapShop(value),
    authorization: mapAuthorizationDetail(value.authorization),
    createdAt: value.createdAt,
    version: value.version,
  }
}

function mapSyncJob(value: WireSyncJob): ShopSyncJob {
  return {
    id: value.id,
    shopId: value.shopId,
    jobType: value.jobType,
    status: value.status,
    progressProcessed: value.progressProcessed,
    progressTotal: typeof value.progressTotal === 'number' ? value.progressTotal : undefined,
    attemptCount: value.attemptCount,
    safeErrorSummary: value.errorSummary,
    requestedAt: value.requestedAt,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    updatedAt: value.updatedAt,
  }
}

export function normalizeShopifyAuthorizationUrl(value: string): string {
  const authorizationUrl = new URL(value)
  const keys = [...authorizationUrl.searchParams.keys()]
  const grant = authorizationUrl.searchParams.get('grant')
  if (
    authorizationUrl.protocol !== 'https:'
    || authorizationUrl.username
    || authorizationUrl.password
    || authorizationUrl.hash
    || authorizationUrl.pathname !== '/shopify/oauth/authorize'
    || keys.length !== 1
    || keys[0] !== 'grant'
    || !grant
    || !/^[A-Za-z0-9_-]{43}$/.test(grant)
  ) {
    throw new Error('Invalid Shopify authorization response')
  }
  return authorizationUrl.toString()
}

export const shopCenterApi = {
  async listPlatforms(request: PageRequest): Promise<Page<PlatformCatalogEntry>> {
    const response = await apiClient.request<WirePage<PlatformCatalogEntry>>(
      queryPath(`${API_BASE}/platforms`, request),
    )
    return mapPage(response, (platform) => ({
      id: platform.id,
      code: platform.code,
      displayName: platform.displayName,
      status: platform.status,
    }))
  },

  async listShops(request: ShopListRequest): Promise<Page<TenantShop>> {
    const response = await apiClient.request<WirePage<WireShop>>(
      shopQueryPath(request),
    )
    return mapPage(response, mapShop)
  },

  async getShop(shopId: string): Promise<ShopDetail> {
    const response = await apiClient.request<WireShopDetail>(`${API_BASE}/shops/${shopId}`)
    return mapShopDetail(response)
  },

  async getPlatform(platformId: string): Promise<PlatformCatalogEntry> {
    const response = await apiClient.request<PlatformCatalogEntry>(`${API_BASE}/platforms/${platformId}`)
    return {
      id: response.id,
      code: response.code,
      displayName: response.displayName,
      status: response.status,
    }
  },

  async createShop(input: CreateShopInput): Promise<TenantShop> {
    const response = await apiClient.request<WireShop>(`${API_BASE}/shops`, {
      method: 'POST',
      body: {
        platformId: input.platformId,
        ...(input.externalShopRef ? { externalShopRef: input.externalShopRef } : {}),
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
    })
    return mapShop(response)
  },

  async updateShop(shopId: string, input: UpdateShopInput): Promise<ShopDetail> {
    const response = await apiClient.request<WireShopDetail>(`${API_BASE}/shops/${shopId}`, {
      method: 'PUT',
      body: {
        version: input.version,
        externalShopRef: input.externalShopRef,
        displayName: input.displayName,
        status: input.status,
      },
    })
    return mapShopDetail(response)
  },

  async createSyncJob(
    shopId: string,
    jobType: ShopSyncJob['jobType'],
  ): Promise<ShopSyncJob> {
    const response = await apiClient.request<WireSyncJob>(`${API_BASE}/shops/${shopId}/sync-jobs`, {
      method: 'POST',
      body: { jobType },
    })
    return mapSyncJob(response)
  },

  async listSyncJobs(
    shopId: string,
    request: Pick<PageRequest, 'page' | 'size'> = { page: 0, size: 1 },
  ): Promise<Page<ShopSyncJob>> {
    const response = await apiClient.request<Page<WireSyncJob>>(
      `${API_BASE}/shops/${shopId}/sync-jobs?page=${request.page}&size=${request.size}`,
    )
    return mapPage(response, mapSyncJob)
  },

  async archiveShop(shopId: string): Promise<ShopDetail> {
    const response = await apiClient.request<WireShopDetail>(`${API_BASE}/shops/${shopId}/archive`, {
      method: 'POST',
    })
    return mapShopDetail(response)
  },

  getChannels(shopId: string) {
    return apiClient.request<ShopChannelSnapshot>(
      `${API_BASE}/shops/${shopId}/channels`,
    )
  },

  async authorizeShopify(shopId: string): Promise<ShopifyAuthorizationStart> {
    const response = await apiClient.request<WireShopifyAuthorizationStart>(
      `${API_BASE}/shops/${shopId}/channels/shopify/authorize`,
      { method: 'POST' },
    )
    const authorizationUrl = response.authorizationUrl
      ? normalizeShopifyAuthorizationUrl(response.authorizationUrl)
      : undefined
    if (response.snapshot.mode === 'XZ_ERP_APP' && !authorizationUrl) {
      throw new Error('Invalid Shopify authorization response')
    }
    return { snapshot: response.snapshot, authorizationUrl }
  },

  retryShopify(shopId: string) {
    return apiClient.request<ShopChannelSnapshot>(
      `${API_BASE}/shops/${shopId}/channels/shopify/retry`,
      { method: 'POST' },
    )
  },

  uninstallShopify(shopId: string) {
    return apiClient.request<ShopChannelSnapshot>(
      `${API_BASE}/shops/${shopId}/channels/shopify/uninstall`,
      { method: 'POST' },
    )
  },

  getShopifyLocationMappings(shopId: string) {
    return apiClient.request<ShopifyLocationMappingCatalog>(
      `${API_BASE}/shops/${shopId}/channels/shopify/location-mappings`,
    )
  },

  upsertShopifyLocationMapping(
    shopId: string,
    externalLocationRef: string,
    warehouseId: string,
  ) {
    return apiClient.request<ShopifyLocationMappingItem>(
      `${API_BASE}/shops/${shopId}/channels/shopify/location-mappings`,
      {
        method: 'PUT',
        body: { externalLocationRef, warehouseId },
      },
    )
  },

  deleteShopifyLocationMapping(shopId: string, mappingId: string) {
    return apiClient.request<void>(
      `${API_BASE}/shops/${shopId}/channels/shopify/location-mappings/${mappingId}`,
      { method: 'DELETE' },
    )
  },
}

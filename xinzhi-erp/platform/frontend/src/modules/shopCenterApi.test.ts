import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { normalizeShopifyAuthorizationUrl, shopCenterApi, shopDisplayName } from './shopCenterApi'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shopCenterApi', () => {
  it('uses the localized alias for display without replacing the canonical name', () => {
    expect(shopDisplayName({ displayName: 'Canonical', localizedDisplayName: '中文别名' }))
      .toBe('中文别名')
    expect(shopDisplayName({ displayName: 'Canonical' })).toBe('Canonical')
  })
  it('uses an allowlisted read-only filter query without tenant or credential selectors', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    })

    await shopCenterApi.listShops({
      page: 0,
      size: 25,
      includeArchived: true,
      query: '  Example Shop  ',
      platformId: '10000000-0000-4000-8000-000000000001',
      status: 'ACTIVE',
      authorizationStatus: 'AUTHORIZED',
    })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/platform-center/shops?page=0&size=25&includeArchived=true&query=Example+Shop&platformId=10000000-0000-4000-8000-000000000001&status=ACTIVE&authorizationStatus=AUTHORIZED',
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('credential')
  })

  it('creates a shop without any tenant selector in its payload or headers', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      id: 'shop-1',
      platformId: 'platform-1',
      externalShopRef: 'ref-1',
      displayName: 'Shop',
      status: 'ACTIVE',
      authorization: { status: 'NOT_AUTHORIZED', credentialConfigured: false, scopes: [] },
      createdAt: '2026-07-28T08:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
    })

    await shopCenterApi.createShop({
      platformId: 'platform-1',
      externalShopRef: 'ref-1',
    })

    expect(request).toHaveBeenCalledWith('/api/v1/platform-center/shops', {
      method: 'POST',
      body: {
        platformId: 'platform-1',
        externalShopRef: 'ref-1',
      },
    })
    const [, options] = request.mock.calls[0]!
    expect(JSON.stringify(options)).not.toContain('tenantId')
    expect(JSON.stringify(options)).not.toContain('X-Tenant-Id')
  })

  it('creates an internal shop with a name and no external binding reference', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      id: 'shop-internal',
      platformId: 'platform-other',
      externalShopRef: 'internal-generated',
      displayName: '线下订单一店',
      status: 'ACTIVE',
      authorization: { status: 'NOT_REQUIRED', credentialConfigured: false, scopes: [] },
      createdAt: '2026-08-16T08:00:00Z',
      updatedAt: '2026-08-16T08:00:00Z',
    })

    await shopCenterApi.createShop({
      platformId: 'platform-other',
      displayName: '线下订单一店',
    })

    expect(request).toHaveBeenCalledWith('/api/v1/platform-center/shops', {
      method: 'POST',
      body: {
        platformId: 'platform-other',
        displayName: '线下订单一店',
      },
    })
  })

  it('updates only editable shop binding fields with an optimistic version', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      platformId: 'platform-1',
      externalShopRef: 'updated-shop',
      displayName: 'Updated shop',
      status: 'SUSPENDED',
      authorization: {
        status: 'NOT_AUTHORIZED',
        credentialConfigured: false,
        scopes: [],
        version: 0,
      },
      createdAt: '2026-07-28T08:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
      version: 4,
    })

    await shopCenterApi.updateShop('10000000-0000-4000-8000-000000000001', {
      version: 3,
      externalShopRef: 'updated-shop',
      displayName: 'Updated shop',
      status: 'SUSPENDED',
    })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/platform-center/shops/10000000-0000-4000-8000-000000000001',
      {
        method: 'PUT',
        body: {
          version: 3,
          externalShopRef: 'updated-shop',
          displayName: 'Updated shop',
          status: 'SUSPENDED',
        },
      },
    )
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('tenantId')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('credential')
  })

  it('maps only the safe authorization DTO fields and discards credential references', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [{
        id: 'shop-1',
        platformId: 'platform-1',
        externalShopRef: 'ref-1',
        displayName: 'Shop',
        status: 'ACTIVE',
        authorization: {
          status: 'AUTHORIZED',
          credentialConfigured: true,
          credentialReference: 'vault://do-not-render',
          credentialReferenceType: 'vault',
          scopes: ['orders.read'],
          authorizedAt: '2026-07-28T08:00:00Z',
          expiresAt: '2026-08-28T08:00:00Z',
          lastVerifiedAt: '2026-07-28T09:00:00Z',
          errorSummary: 'Safe redacted authorization summary.',
        },
        createdAt: '2026-07-28T07:00:00Z',
        updatedAt: '2026-07-28T10:00:00Z',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await shopCenterApi.listShops({ page: 0, size: 25 })

    expect(result.items[0]?.authorization).toEqual({
      status: 'AUTHORIZED',
      credentialConfigured: true,
      credentialReferenceType: 'vault',
      providerAccountRef: undefined,
      scopes: ['orders.read'],
      authorizedAt: '2026-07-28T08:00:00Z',
      expiresAt: '2026-08-28T08:00:00Z',
      lastVerifiedAt: '2026-07-28T09:00:00Z',
      revokedAt: undefined,
      safeErrorSummary: 'Safe redacted authorization summary.',
    })
    expect(result.items[0]?.createdAt).toBe('2026-07-28T07:00:00Z')
    expect(result.items[0]?.authorization).not.toHaveProperty('credentialReference')
    expect(result.items[0]?.authorization).not.toHaveProperty('errorSummary')
  })

  it('maps detail authorization metadata and renames the proven-safe error summary', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      platformId: 'platform-1',
      externalShopRef: 'ref-1',
      displayName: 'Shop',
      status: 'ACTIVE',
      createdAt: '2026-07-28T08:00:00Z',
      updatedAt: '2026-07-28T10:00:00Z',
      version: 4,
      authorization: {
        status: 'AUTHORIZED',
        credentialConfigured: true,
        credentialReference: 'vault://do-not-retain',
        credentialReferenceType: 'vault',
        providerAccountRef: 'safe-account-reference',
        scopes: ['orders.read'],
        authorizedAt: '2026-07-28T08:00:00Z',
        lastVerifiedAt: '2026-07-28T09:00:00Z',
        errorSummary: 'Safe redacted authorization summary.',
        version: 3,
      },
    })

    const result = await shopCenterApi.getShop('10000000-0000-4000-8000-000000000001')

    expect(result.authorization).toMatchObject({
      credentialConfigured: true,
      credentialReferenceType: 'vault',
      providerAccountRef: 'safe-account-reference',
      authorizedAt: '2026-07-28T08:00:00Z',
      lastVerifiedAt: '2026-07-28T09:00:00Z',
      safeErrorSummary: 'Safe redacted authorization summary.',
      version: 3,
    })
    expect(result.authorization).not.toHaveProperty('credentialReference')
    expect(result.authorization).not.toHaveProperty('errorSummary')
  })

  it.each(['FULL', 'ORDERS', 'PRODUCTS', 'INVENTORY'] as const)(
    'creates %s sync jobs without a tenant selector',
    async (jobType) => {
      const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
        id: 'job-1',
        shopId: '10000000-0000-4000-8000-000000000001',
        jobType,
        status: 'QUEUED',
        progressProcessed: 0,
        progressTotal: null,
        attemptCount: 0,
        requestedAt: '2026-07-28T10:00:00Z',
        updatedAt: '2026-07-28T10:00:00Z',
      })

      await shopCenterApi.createSyncJob('10000000-0000-4000-8000-000000000001', jobType)

      expect(request).toHaveBeenCalledWith(
        '/api/v1/platform-center/shops/10000000-0000-4000-8000-000000000001/sync-jobs',
        { method: 'POST', body: { jobType } },
      )
      expect(JSON.stringify(request.mock.calls[0]?.[1])).not.toContain('tenantId')
    },
  )

  it('uses bounded caller pagination for sync history', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [], page: 2, size: 25, totalElements: 50, totalPages: 2,
    })

    await shopCenterApi.listSyncJobs('10000000-0000-4000-8000-000000000001', { page: 2, size: 25 })

    expect(request).toHaveBeenCalledWith(
      '/api/v1/platform-center/shops/10000000-0000-4000-8000-000000000001/sync-jobs?page=2&size=25',
    )
  })

  it('keeps only the safe sync error summary and omits internal error codes', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({
      items: [{
        id: 'job-1',
        shopId: '10000000-0000-4000-8000-000000000001',
        jobType: 'ORDERS',
        status: 'FAILED',
        progressProcessed: 3,
        progressTotal: 8,
        attemptCount: 2,
        requestedAt: '2026-07-28T10:00:00Z',
        updatedAt: '2026-07-28T10:01:00Z',
        errorCode: 'connector.private_failure',
        errorSummary: 'A safe, redacted diagnostic.',
      }],
      page: 0,
      size: 25,
      totalElements: 1,
      totalPages: 1,
    })

    const result = await shopCenterApi.listSyncJobs('10000000-0000-4000-8000-000000000001', {
      page: 0,
      size: 25,
    })

    expect(result.items[0]).toMatchObject({ safeErrorSummary: 'A safe, redacted diagnostic.' })
    expect(result.items[0]).not.toHaveProperty('errorCode')
  })

  it('routes channel actions through tenant-authenticated ERP APIs without credentials', async () => {
    const snapshot = {
      mode: 'DETERMINISTIC_FAKE',
      shopify: { status: 'NOT_CONNECTED' },
      shopifyScopes: [],
      activity: [],
    }
    const request = vi.spyOn(apiClient, 'request').mockImplementation(
      async (path) => path.endsWith('/channels/shopify/authorize')
        ? { snapshot }
        : snapshot,
    )
    const shopId = '10000000-0000-4000-8000-000000000001'

    await shopCenterApi.getChannels(shopId)
    await shopCenterApi.authorizeShopify(shopId)
    await shopCenterApi.retryShopify(shopId)
    await shopCenterApi.uninstallShopify(shopId)

    expect(request.mock.calls).toEqual([
      [`/api/v1/platform-center/shops/${shopId}/channels`],
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/authorize`, { method: 'POST' }],
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/retry`, { method: 'POST' }],
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/uninstall`, { method: 'POST' }],
    ])
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/token|credential|tenantId/i)
  })

  it('accepts only the connector OAuth grant URL contract', async () => {
    const authorizationUrl = `https://connector.example/shopify/oauth/authorize?grant=${'A'.repeat(43)}`
    expect(normalizeShopifyAuthorizationUrl(authorizationUrl)).toBe(authorizationUrl)

    for (const invalid of [
      `http://connector.example/shopify/oauth/authorize?grant=${'A'.repeat(43)}`,
      `https://connector.example/other?grant=${'A'.repeat(43)}`,
      'https://connector.example/shopify/oauth/authorize?grant=short',
      `https://user@connector.example/shopify/oauth/authorize?grant=${'A'.repeat(43)}`,
      `https://connector.example/shopify/oauth/authorize?grant=${'A'.repeat(43)}&next=https://evil.example`,
    ]) {
      expect(() => normalizeShopifyAuthorizationUrl(invalid)).toThrow(
        'Invalid Shopify authorization response',
      )
    }
  })

  it('routes Shopify location mappings without tenant or credential fields', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({
      locations: [],
      warehouses: [],
    })
    const shopId = '10000000-0000-4000-8000-000000000001'
    const warehouseId = '20000000-0000-4000-8000-000000000002'
    const mappingId = '30000000-0000-4000-8000-000000000003'
    const locationRef = 'gid://shopify/Location/100'

    await shopCenterApi.getShopifyLocationMappings(shopId)
    await shopCenterApi.upsertShopifyLocationMapping(
      shopId, locationRef, warehouseId,
    )
    await shopCenterApi.deleteShopifyLocationMapping(shopId, mappingId)

    expect(request.mock.calls).toEqual([
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/location-mappings`],
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/location-mappings`, {
        method: 'PUT',
        body: { externalLocationRef: locationRef, warehouseId },
      }],
      [`/api/v1/platform-center/shops/${shopId}/channels/shopify/location-mappings/${mappingId}`, {
        method: 'DELETE',
      }],
    ])
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/token|credential|tenantId/i)
  })
})

import { apiClient } from '../api/client'

const API_BASE = '/api/v1/settings/shop-aliases'

export type ShopAlias = {
  shopId: string
  shopDisplayName: string
  platformCode: string
  aliasEn?: string
  aliasZhCn?: string
  aliasEs?: string
  aliasId?: string
  aliasTh?: string
  aliasRu?: string
  aliasPt?: string
  aliasVi?: string
  aliasMs?: string
  configured: boolean
  version: number
  updatedByDisplayName?: string
  updatedAt?: string
}

export type ShopAliasInput = Pick<ShopAlias,
  'aliasEn' | 'aliasZhCn' | 'aliasEs' | 'aliasId' | 'aliasTh' |
  'aliasRu' | 'aliasPt' | 'aliasVi' | 'aliasMs'>

export type ShopAliasPage = {
  items: ShopAlias[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type ShopAliasQuery = {
  keyword?: string
  page?: number
  size?: 25 | 50 | 100
}

function listPath(query: ShopAliasQuery) {
  const params = new URLSearchParams({
    page: String(query.page ?? 0),
    size: String(query.size ?? 25),
  })
  if (query.keyword) params.set('keyword', query.keyword)
  return `${API_BASE}?${params.toString()}`
}

export const shopAliasApi = {
  list(query: ShopAliasQuery, signal?: AbortSignal) {
    return apiClient.request<ShopAliasPage>(listPath(query), { signal })
  },

  save(shopId: string, expectedVersion: number, input: ShopAliasInput) {
    return apiClient.request<ShopAlias>(`${API_BASE}/${shopId}`, {
      method: 'PUT',
      body: { expectedVersion, ...input },
    })
  },
}

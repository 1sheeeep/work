import { CircleDashed, MapPin, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  type ShopifyLocationMappingCatalog,
  type ShopifyLocationMappingItem,
  shopCenterApi,
} from '../modules/shopCenterApi'

type MappingState =
  | { status: 'not-permitted' }
  | { status: 'loading' }
  | { status: 'ready'; catalog: ShopifyLocationMappingCatalog }
  | { status: 'error'; message: string }

function safeMappingMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号缺少店铺或仓库权限，无法读取地点映射。'
  }
  const details =
    error instanceof ApiError &&
    error.details &&
    typeof error.details === 'object' &&
    !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : {}
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.code === 'shopify_authorization_conflict' ||
      details.reason === 'shopify_scope_missing')
  ) {
    return 'Shopify 店铺授权未连接或地点读取权限不可用，暂时无法读取地点。请在店铺详情重新授权后再试。'
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    details.reason === 'shopify_connection_not_connected'
  ) {
    return 'Shopify 店铺授权未连接，无法读取地点。请先在店铺详情重新连接。'
  }
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    details.reason === 'shopify_scope_unavailable'
  ) {
    return 'ERP 暂时无法确认 Shopify 地点权限，请刷新授权状态后重试。'
  }
  if (error instanceof ApiError && error.status === 409) {
    return '无法读取 Shopify 地点。请刷新店铺授权状态，并检查 Shopify 地点或 ERP 仓库是否可用。'
  }
  return '暂时无法处理地点映射，请稍后重试。'
}

function locationAddress(location: ShopifyLocationMappingItem) {
  return [
    location.address1,
    location.address2,
    location.city,
    location.provinceCode ?? location.province,
    location.countryCode ?? location.country,
    location.zip,
  ].filter(Boolean).join('，') || '—'
}

export function ShopifyLocationMappingPanel({
  shopId,
  canRead,
  canWrite,
  shopActive,
}: {
  shopId: string
  canRead: boolean
  canWrite: boolean
  shopActive: boolean
}) {
  const [state, setState] = useState<MappingState>(
    canRead ? { status: 'loading' } : { status: 'not-permitted' },
  )
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const requestVersion = useRef(0)

  const load = useCallback(async (preserveMessage = false) => {
    const version = requestVersion.current + 1
    requestVersion.current = version
    if (!canRead) {
      setState({ status: 'not-permitted' })
      return
    }
    setState({ status: 'loading' })
    if (!preserveMessage) setMessage(null)
    try {
      const catalog = await shopCenterApi.getShopifyLocationMappings(shopId)
      if (requestVersion.current !== version) return
      setState({ status: 'ready', catalog })
    } catch (error) {
      if (requestVersion.current !== version) return
      setState({ status: 'error', message: safeMappingMessage(error) })
    }
  }, [canRead, shopId])

  useEffect(() => {
    void load()
    return () => {
      requestVersion.current += 1
    }
  }, [load])

  const usedWarehouses = useMemo(() => {
    if (state.status !== 'ready') return new Set<string>()
    return new Set(state.catalog.locations
      .map((location) => location.mapping?.warehouseId)
      .filter((warehouseId): warehouseId is string => Boolean(warehouseId)))
  }, [state])

  const save = async (location: ShopifyLocationMappingItem, warehouseId: string) => {
    if (!warehouseId || !canWrite || !shopActive || !location.active || !location.providerPresent) {
      return
    }
    setBusyRef(location.externalLocationRef)
    setMessage(null)
    try {
      await shopCenterApi.upsertShopifyLocationMapping(
        shopId, location.externalLocationRef, warehouseId,
      )
      setMessage('地点映射已保存。')
      await load(true)
    } catch (error) {
      setMessage(safeMappingMessage(error))
    } finally {
      setBusyRef(null)
    }
  }

  const remove = async (location: ShopifyLocationMappingItem) => {
    if (!location.mapping || !canWrite || !shopActive) return
    setBusyRef(location.externalLocationRef)
    setMessage(null)
    try {
      await shopCenterApi.deleteShopifyLocationMapping(
        shopId, location.mapping.mappingId,
      )
      setConfirmDelete(null)
      setMessage('地点映射已解除。')
      await load(true)
    } catch (error) {
      setMessage(safeMappingMessage(error))
    } finally {
      setBusyRef(null)
    }
  }

  if (state.status === 'not-permitted') {
    return (
      <section className="detail-card shopify-location-mapping-panel">
        <h2>Shopify 地点与 ERP 仓库映射</h2>
        <p className="muted-cell">当前账号需要同时具备店铺读取和仓库读取权限。</p>
      </section>
    )
  }

  if (state.status === 'loading') {
    return (
      <section className="detail-card sync-history-section" aria-busy="true" aria-live="polite">
        <CircleDashed className="spin" size={20} aria-hidden="true" />
        <h2>正在读取 Shopify 地点</h2>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="detail-card sync-history-section" role="alert">
        <ShieldAlert size={20} aria-hidden="true" />
        <h2>无法读取地点映射</h2>
        <p>{state.message}</p>
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden="true" />重试
        </button>
      </section>
    )
  }

  const { catalog } = state
  return (
    <section
      className="detail-card shopify-location-mapping-panel"
      aria-labelledby="shopify-location-mapping-title"
    >
      <div className="table-heading">
        <div>
          <p className="eyebrow">库存同步前置配置</p>
          <h2 id="shopify-location-mapping-title">
            <MapPin size={18} aria-hidden="true" />
            Shopify 地点与 ERP 仓库映射
          </h2>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load()}
          disabled={busyRef !== null}
        >
          <RefreshCw size={16} aria-hidden="true" />刷新地点
        </button>
      </div>

      <div className="inline-alert" role="status">
        <ShieldAlert size={18} aria-hidden="true" />
        <div>
          <strong>库存写入必须先完成一对一映射</strong>
          <span>系统不会按名称自动匹配；同一店铺内，一个 Shopify 地点和一个 ERP 仓库都只能使用一次。</span>
        </div>
      </div>

      {message && <p className="toolbar-note" role="status" aria-live="polite">{message}</p>}
      {!canWrite && <p className="toolbar-note">当前账号只能查看映射，修改需要店铺写入和仓库写入权限。</p>}
      {!shopActive && <p className="toolbar-note">店铺已停用或归档，地点映射暂时只读。</p>}

      {catalog.locations.length === 0 ? (
        <p className="muted-cell">Shopify 当前没有返回可配置地点。</p>
      ) : (
        <div className="shop-table-scroll">
          <table className="shop-table shopify-location-table">
            <thead>
              <tr>
                <th>Shopify 地点</th>
                <th>状态</th>
                <th>地址</th>
                <th>ERP 仓库</th>
                <th>能力</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {catalog.locations.map((location) => {
                const busy = busyRef === location.externalLocationRef
                const editable = canWrite && shopActive && location.active
                  && location.providerPresent && !busy
                return (
                  <tr key={location.externalLocationRef}>
                    <td>
                      <strong>{location.name}</strong>
                      <small className="mapping-reference">{location.externalLocationRef}</small>
                    </td>
                    <td>
                      {location.providerPresent
                        ? location.active ? '启用' : '停用'
                        : 'Shopify 已移除'}
                    </td>
                    <td>{locationAddress(location)}</td>
                    <td>
                      <label className="sr-only" htmlFor={`warehouse-${location.externalLocationRef}`}>
                        为 {location.name} 选择 ERP 仓库
                      </label>
                      <select
                        id={`warehouse-${location.externalLocationRef}`}
                        value={location.mapping?.warehouseId ?? ''}
                        disabled={!editable}
                        onChange={(event) => void save(location, event.target.value)}
                      >
                        <option value="">未映射</option>
                        {catalog.warehouses.map((warehouse) => (
                          <option
                            key={warehouse.id}
                            value={warehouse.id}
                            disabled={usedWarehouses.has(warehouse.id)
                              && warehouse.id !== location.mapping?.warehouseId}
                          >
                            {warehouse.businessCode} · {warehouse.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {location.hasActiveInventory ? '有库存' : '暂无库存'} / {' '}
                      {location.fulfillsOnlineOrders ? '可履约' : '不履约'}
                      {location.fulfillmentService ? ' / 履约服务地点' : ''}
                    </td>
                    <td>
                      {busy ? (
                        <span>处理中…</span>
                      ) : location.mapping && confirmDelete === location.mapping.mappingId ? (
                        <div className="mapping-row-actions">
                          <button className="button button-danger" type="button" onClick={() => void remove(location)}>
                            确认解除
                          </button>
                          <button className="button button-secondary" type="button" onClick={() => setConfirmDelete(null)}>
                            取消
                          </button>
                        </div>
                      ) : location.mapping ? (
                        <button
                          className="button button-link-danger"
                          type="button"
                          disabled={!canWrite || !shopActive}
                          onClick={() => setConfirmDelete(location.mapping?.mappingId ?? null)}
                        >
                          解除映射
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

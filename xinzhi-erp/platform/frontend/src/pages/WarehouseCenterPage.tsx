import {
  Archive,
  CircleDashed,
  Download,
  MapPin,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import { ErpIconButton } from '../components/ErpVisualPrimitives'
import {
  type Page,
  type Warehouse,
  type WarehouseLocation,
  type WarehouseStatus,
  warehouseCenterApi,
} from '../modules/warehouseCenterApi'
import { ShippingConfigurationDialog } from './ShippingConfigurationDialog'

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100] as const
const MAX_PAGE = 9_999
const WAREHOUSE_DIRECTORY_PAGE_SIZE = 200
const MAX_WAREHOUSE_DIRECTORY_ITEMS = 10_000
const MAX_WAREHOUSE_DIRECTORY_PAGES =
  MAX_WAREHOUSE_DIRECTORY_ITEMS / WAREHOUSE_DIRECTORY_PAGE_SIZE
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statuses: WarehouseStatus[] = ['ACTIVE', 'INACTIVE', 'ARCHIVED']

export type WarehouseCenterQuery = {
  includeInactive: boolean
  showArchived: boolean
  keyword: string
  page: number
  size: number
  detailWarehouseId?: string
  warehouseId?: string
  detailLocationId?: string
  locationStatus?: WarehouseStatus
  locationKeyword: string
  locationPage: number
  locationSize: number
}

type LoadState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

type Editor = {
  resource: 'warehouse' | 'location'
  action: 'create' | 'edit' | 'toggle' | 'archive'
  warehouseId?: string
  item?: Warehouse | WarehouseLocation
}

type WarehouseExportFeedback = {
  kind: 'success' | 'error'
  message: string
  queryKey: string
}

function bounded(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback
}

function validStatus(value: string | null) {
  return statuses.includes(value as WarehouseStatus)
    ? (value as WarehouseStatus)
    : undefined
}

export function parseWarehouseCenterQuery(search: string): WarehouseCenterQuery {
  const params = new URLSearchParams(search)
  const legacyStatus = validStatus(params.get('status'))
  const detailWarehouseId = params.get('detailWarehouseId') ?? undefined
  const warehouseId = params.get('warehouseId') ?? undefined
  const validWarehouseId =
    warehouseId && UUID_PATTERN.test(warehouseId) ? warehouseId : undefined
  const detailLocationId = params.get('detailLocationId') ?? undefined
  const showArchived = legacyStatus === 'ARCHIVED'
  return {
    includeInactive:
      !showArchived &&
      (params.get('includeInactive') === 'true' ||
        legacyStatus === 'INACTIVE'),
    showArchived,
    keyword: (params.get('keyword') ?? '').trim().slice(0, 100),
    page: bounded(params.get('page'), 0, 0, MAX_PAGE),
    size: bounded(params.get('size'), DEFAULT_PAGE_SIZE, 1, 100),
    detailWarehouseId:
      detailWarehouseId && UUID_PATTERN.test(detailWarehouseId)
        ? detailWarehouseId
        : undefined,
    warehouseId: validWarehouseId,
    detailLocationId:
      validWarehouseId &&
      detailLocationId &&
      UUID_PATTERN.test(detailLocationId)
        ? detailLocationId
        : undefined,
    locationStatus: validStatus(params.get('locationStatus')),
    locationKeyword: (params.get('locationKeyword') ?? '')
      .trim()
      .slice(0, 100),
    locationPage: bounded(params.get('locationPage'), 0, 0, MAX_PAGE),
    locationSize: bounded(
      params.get('locationSize'),
      DEFAULT_PAGE_SIZE,
      1,
      100,
    ),
  }
}

export function toWarehouseCenterUrl(
  query: WarehouseCenterQuery,
  path = '/warehouses',
) {
  const params = new URLSearchParams({
    keyword: query.keyword,
    page: String(query.page),
    size: String(query.size),
    locationKeyword: query.locationKeyword,
    locationPage: String(query.locationPage),
    locationSize: String(query.locationSize),
  })
  if (query.showArchived) {
    params.set('status', 'ARCHIVED')
  } else if (query.includeInactive) {
    params.set('includeInactive', 'true')
  }
  if (
    query.detailWarehouseId &&
    UUID_PATTERN.test(query.detailWarehouseId)
  ) {
    params.set('detailWarehouseId', query.detailWarehouseId)
  }
  if (query.warehouseId && UUID_PATTERN.test(query.warehouseId)) {
    params.set('warehouseId', query.warehouseId)
    if (
      path === '/warehouses/locations' &&
      query.detailLocationId &&
      UUID_PATTERN.test(query.detailLocationId)
    ) {
      params.set('detailLocationId', query.detailLocationId)
    }
  }
  if (query.locationStatus) {
    params.set('locationStatus', query.locationStatus)
  }
  return `${path}?${params.toString()}`
}

export function safeWarehouseMessage(error: unknown, action: string) {
  if (error instanceof ApiError && error.status === 400) {
    if (action.includes('新增仓库')) {
      return '请检查业务编码和仓库名称：业务编码必须以字母开头，共 2–64 位，可使用字母、数字、下划线或连字符。'
    }
    return '填写内容格式不正确，请检查后重试。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return `当前账号没有${action}所需权限。登录状态仍保持不变。`
  }
  if (error instanceof ApiError && error.status === 404) {
    return '请求的仓库或库位不存在，或当前账号无法访问。'
  }
  if (error instanceof ApiError && error.status === 409) {
    return '数据已被更新，或当前状态不允许此操作。请刷新后重试。'
  }
  return `暂时无法${action}，请稍后重试。`
}

function safeWarehouseExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  }
  return safeWarehouseMessage(error, '导出仓库')
}

function safeLocationExportMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '导出结果超过 10,000 条，请缩小筛选范围后重试。'
  }
  return safeWarehouseMessage(error, '导出仓位')
}

function statusLabel(status: WarehouseStatus) {
  if (status === 'ACTIVE') return '启用'
  if (status === 'INACTIVE') return '停用'
  return '已归档'
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}

async function loadWarehouseDirectory(
  status: WarehouseStatus | undefined,
  keyword: string | undefined,
) {
  const first = await warehouseCenterApi.listWarehouses({
    status,
    keyword,
    page: 0,
    size: WAREHOUSE_DIRECTORY_PAGE_SIZE,
  })
  if (
    first.totalElements > MAX_WAREHOUSE_DIRECTORY_ITEMS ||
    first.totalPages > MAX_WAREHOUSE_DIRECTORY_PAGES
  ) {
    throw new Error('仓库目录超过 10,000 项，无法安全加载。')
  }
  const items = [...first.items]
  for (let page = 1; page < first.totalPages; page += 1) {
    items.push(...(await warehouseCenterApi.listWarehouses({
      status,
      keyword,
      page,
      size: WAREHOUSE_DIRECTORY_PAGE_SIZE,
    })).items)
    if (items.length > MAX_WAREHOUSE_DIRECTORY_ITEMS) {
      throw new Error('仓库目录超过 10,000 项，无法安全加载。')
    }
  }
  if (
    items.length !== first.totalElements ||
    new Set(items.map((warehouse) => warehouse.id)).size !== items.length
  ) {
    throw new Error('仓库目录分页结果不一致。')
  }
  return {
    ...first,
    items,
    page: 0,
    size: WAREHOUSE_DIRECTORY_PAGE_SIZE,
    totalElements: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  }
}

type WarehouseCenterView = 'warehouses' | 'locations'

export function WarehouseCenterPage({
  view = 'warehouses',
}: {
  view?: WarehouseCenterView
}) {
  const { hasPermission } = useAuth()
  const router = useRouter()
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const query = useMemo(() => parseWarehouseCenterQuery(search), [search])
  const [warehouses, setWarehouses] = useState<LoadState<Page<Warehouse>>>({
    status: 'loading',
  })
  const [locations, setLocations] = useState<
    LoadState<Page<WarehouseLocation>> | { status: 'idle' }
  >({ status: 'idle' })
  const [warehouseDetail, setWarehouseDetail] = useState<
    LoadState<Warehouse> | { status: 'idle' }
  >({ status: 'idle' })
  const [selectedWarehouseState, setSelectedWarehouseState] = useState<
    LoadState<Warehouse> | { status: 'idle' }
  >({ status: 'idle' })
  const [locationDetail, setLocationDetail] = useState<
    LoadState<WarehouseLocation> | { status: 'idle' }
  >({ status: 'idle' })
  const [editor, setEditor] = useState<Editor | null>(null)
  const [shippingConfigurationWarehouse, setShippingConfigurationWarehouse] =
    useState<Warehouse | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [selectedWarehouseRefreshKey, setSelectedWarehouseRefreshKey] =
    useState(0)
  const [locationDetailRefreshKey, setLocationDetailRefreshKey] = useState(0)
  const [successMessage, setSuccessMessage] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] =
    useState<WarehouseExportFeedback | null>(null)
  const [locationExporting, setLocationExporting] = useState(false)
  const [locationExportFeedback, setLocationExportFeedback] =
    useState<WarehouseExportFeedback | null>(null)
  const warehouseRequest = useRef(0)
  const locationRequest = useRef(0)
  const detailRequest = useRef(0)
  const selectedWarehouseRequest = useRef(0)
  const locationDetailRequest = useRef(0)
  const canWrite = hasPermission('warehouses.write')
  const canWriteShippingConfiguration = hasPermission(
    'warehouses.shipping_config.write',
  )
  const isLocationView = view === 'locations'
  const currentPath = isLocationView ? '/warehouses/locations' : '/warehouses'
  const warehouseExportStatus = query.showArchived
    ? 'ARCHIVED'
    : query.includeInactive
      ? undefined
      : 'ACTIVE'
  const warehouseExportQueryKey = `${warehouseExportStatus ?? 'CURRENT'}:${query.keyword}`
  const locationExportQueryKey = `${query.warehouseId ?? ''}:${query.locationStatus ?? 'CURRENT'}:${query.locationKeyword}`

  const updateQuery = useCallback(
    (patch: Partial<WarehouseCenterQuery>) => {
      router.history.push(
        toWarehouseCenterUrl({ ...query, ...patch }, currentPath),
      )
    },
    [currentPath, query, router.history],
  )

  const loadWarehouses = useCallback(async () => {
    const request = ++warehouseRequest.current
    setWarehouses((previous) => ({
      status: 'loading',
      data: 'data' in previous ? previous.data : undefined,
    }))
    try {
      const status = query.showArchived
          ? 'ARCHIVED'
          : query.includeInactive
            ? undefined
            : 'ACTIVE'
      const keyword = query.keyword || undefined
      const page = isLocationView
        ? await loadWarehouseDirectory(status, keyword)
        : await warehouseCenterApi.listWarehouses({
            status,
            keyword,
            page: query.page,
            size: query.size,
          })
      if (request === warehouseRequest.current) {
        setWarehouses({ status: 'ready', data: page })
      }
    } catch (error) {
      if (request === warehouseRequest.current) {
        setWarehouses({
          status: 'error',
          message: safeWarehouseMessage(error, '读取仓库'),
        })
      }
    }
  }, [
    isLocationView,
    query.includeInactive,
    query.keyword,
    query.page,
    query.showArchived,
    query.size,
  ])

  useEffect(() => {
    const warehouseId = query.detailWarehouseId
    if (!warehouseId) {
      detailRequest.current += 1
      setWarehouseDetail({ status: 'idle' })
      return
    }

    const request = ++detailRequest.current
    setWarehouseDetail({ status: 'loading' })
    void warehouseCenterApi
      .getWarehouse(warehouseId)
      .then((warehouse) => {
        if (request === detailRequest.current) {
          setWarehouseDetail({ status: 'ready', data: warehouse })
        }
      })
      .catch((error: unknown) => {
        if (request === detailRequest.current) {
          setWarehouseDetail({
            status: 'error',
            message: safeWarehouseMessage(error, '读取仓库详情'),
          })
        }
      })

    return () => {
      if (request === detailRequest.current) {
        detailRequest.current += 1
      }
    }
  }, [detailRefreshKey, query.detailWarehouseId])

  useEffect(() => {
    const warehouseId = query.warehouseId
    if (!isLocationView || !warehouseId) {
      selectedWarehouseRequest.current += 1
      setSelectedWarehouseState({ status: 'idle' })
      return
    }

    const request = ++selectedWarehouseRequest.current
    setSelectedWarehouseState({ status: 'loading' })
    void warehouseCenterApi
      .getWarehouse(warehouseId)
      .then((warehouse) => {
        if (request === selectedWarehouseRequest.current) {
          setSelectedWarehouseState({ status: 'ready', data: warehouse })
        }
      })
      .catch((error: unknown) => {
        if (request === selectedWarehouseRequest.current) {
          setSelectedWarehouseState({
            status: 'error',
            message: safeWarehouseMessage(error, '读取所选仓库'),
          })
        }
      })

    return () => {
      if (request === selectedWarehouseRequest.current) {
        selectedWarehouseRequest.current += 1
      }
    }
  }, [
    isLocationView,
    query.warehouseId,
    selectedWarehouseRefreshKey,
  ])

  useEffect(() => {
    const warehouseId = query.warehouseId
    const locationId = query.detailLocationId
    if (!isLocationView || !warehouseId || !locationId) {
      locationDetailRequest.current += 1
      setLocationDetail({ status: 'idle' })
      return
    }

    const request = ++locationDetailRequest.current
    setLocationDetail({ status: 'loading' })
    void warehouseCenterApi
      .getLocation(warehouseId, locationId)
      .then((location) => {
        if (request === locationDetailRequest.current) {
          setLocationDetail({ status: 'ready', data: location })
        }
      })
      .catch((error: unknown) => {
        if (request === locationDetailRequest.current) {
          setLocationDetail({
            status: 'error',
            message: safeWarehouseMessage(error, '读取库位详情'),
          })
        }
      })

    return () => {
      if (request === locationDetailRequest.current) {
        locationDetailRequest.current += 1
      }
    }
  }, [
    isLocationView,
    locationDetailRefreshKey,
    query.detailLocationId,
    query.warehouseId,
  ])

  const loadLocations = useCallback(async () => {
    const request = ++locationRequest.current
    if (!query.warehouseId) {
      setLocations({ status: 'idle' })
      return
    }
    setLocations((previous) => ({
      status: 'loading',
      data: 'data' in previous ? previous.data : undefined,
    }))
    try {
      const page = await warehouseCenterApi.listLocations(query.warehouseId, {
        status: query.locationStatus,
        keyword: query.locationKeyword || undefined,
        page: query.locationPage,
        size: query.locationSize,
      })
      if (request === locationRequest.current) {
        setLocations({ status: 'ready', data: page })
      }
    } catch (error) {
      if (request === locationRequest.current) {
        setLocations({
          status: 'error',
          message: safeWarehouseMessage(error, '读取库位'),
        })
      }
    }
  }, [
    query.locationKeyword,
    query.locationPage,
    query.locationSize,
    query.locationStatus,
    query.warehouseId,
  ])

  useEffect(() => {
    void loadWarehouses()
  }, [loadWarehouses, refreshKey])

  useEffect(() => {
    if (isLocationView) {
      void loadLocations()
    }
  }, [isLocationView, loadLocations, refreshKey])

  const saved = (
    value: Warehouse | WarehouseLocation,
    completedEditor: Editor,
  ) => {
    setEditor(null)
    setSuccessMessage(
      `${completedEditor.resource === 'warehouse' ? '仓库' : '库位'}操作已完成。`,
    )
    setRefreshKey((current) => current + 1)
    if (completedEditor.resource === 'warehouse') {
      if (completedEditor.action === 'archive') {
        updateQuery({ warehouseId: undefined, locationPage: 0 })
      }
    }
  }

  const exportWarehouses = async () => {
    if (
      exporting ||
      warehouses.status !== 'ready' ||
      warehouses.data.totalElements === 0
    ) {
      return
    }
    const queryKey = warehouseExportQueryKey
    setExporting(true)
    setExportFeedback(null)
    try {
      const result = await warehouseCenterApi.exportWarehouses({
        status: warehouseExportStatus,
        keyword: query.keyword || undefined,
      })
      const url = URL.createObjectURL(
        new Blob([result.content], { type: result.mediaType }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      setExportFeedback({
        kind: 'success',
        message: `已导出 ${result.rowCount} 条仓库数据。`,
        queryKey,
      })
    } catch (error) {
      setExportFeedback({
        kind: 'error',
        message: safeWarehouseExportMessage(error),
        queryKey,
      })
    } finally {
      setExporting(false)
    }
  }

  const exportLocations = async () => {
    if (
      locationExporting ||
      !query.warehouseId ||
      locations.status !== 'ready' ||
      locations.data.totalElements === 0
    ) {
      return
    }
    const queryKey = locationExportQueryKey
    setLocationExporting(true)
    setLocationExportFeedback(null)
    try {
      const result = await warehouseCenterApi.exportLocations(
        query.warehouseId,
        {
          status: query.locationStatus,
          keyword: query.locationKeyword || undefined,
        },
      )
      const url = URL.createObjectURL(
        new Blob([result.content], { type: result.mediaType }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      setLocationExportFeedback({
        kind: 'success',
        message: `已导出 ${result.rowCount} 条仓位数据。`,
        queryKey,
      })
    } catch (error) {
      setLocationExportFeedback({
        kind: 'error',
        message: safeLocationExportMessage(error),
        queryKey,
      })
    } finally {
      setLocationExporting(false)
    }
  }

  return (
    <section className="warehouse-center-page" aria-labelledby="warehouse-title">
      <header className="page-heading warehouse-center-heading">
        <h1 id="warehouse-title">
          {isLocationView ? '库位列表' : '仓库列表'}
        </h1>
      </header>

      {successMessage && (
        <div className="warehouse-success" role="status">
          {successMessage}
        </div>
      )}

      {!isLocationView && (
        <>
          <WarehouseFilters
            key={`${query.showArchived}:${query.includeInactive}:${query.keyword}`}
            query={query}
            onApply={(patch) =>
              updateQuery({
                ...patch,
                page: 0,
                warehouseId: undefined,
                detailLocationId: undefined,
                locationPage: 0,
              })
            }
          />
          <WarehouseTable
            state={warehouses}
            selectedId={query.warehouseId}
            canWrite={canWrite}
            onConfigure={setShippingConfigurationWarehouse}
            onDetail={(detailWarehouseId) =>
              updateQuery({ detailWarehouseId })
            }
            onSelect={(warehouseId) =>
              router.history.push(
                toWarehouseCenterUrl(
                  {
                    ...query,
                    warehouseId,
                    detailLocationId: undefined,
                    locationPage: 0,
                  },
                  '/warehouses/locations',
                ),
              )
            }
            onAction={(item, action) =>
              setEditor({ resource: 'warehouse', action, item })
            }
            onRetry={() => setRefreshKey((current) => current + 1)}
            onRefresh={() => setRefreshKey((current) => current + 1)}
            onExport={() => void exportWarehouses()}
            exporting={exporting}
            exportFeedback={
              exportFeedback?.queryKey === warehouseExportQueryKey
                ? exportFeedback
                : null
            }
            onCreate={
              canWrite
                ? () => setEditor({ resource: 'warehouse', action: 'create' })
                : undefined
            }
            onPageChange={(page) =>
              updateQuery({ page, warehouseId: undefined, locationPage: 0 })
            }
            onPageSizeChange={(size) =>
              updateQuery({
                page: 0,
                size,
                warehouseId: undefined,
                locationPage: 0,
              })
            }
          />
        </>
      )}

      {isLocationView && (
        <LocationPanel
          state={locations}
          warehouseDirectory={warehouses}
          warehouseId={query.warehouseId}
          warehouseState={selectedWarehouseState}
          query={query}
          canWrite={canWrite}
          onApplyFilter={(patch) =>
            updateQuery({
              ...patch,
              detailLocationId: undefined,
              locationPage: 0,
            })
          }
          onCreate={() =>
            setEditor({
              resource: 'location',
              action: 'create',
              warehouseId: query.warehouseId,
            })
          }
          onAction={(item, action) =>
            setEditor({
              resource: 'location',
              action,
              warehouseId: query.warehouseId,
              item,
            })
          }
          onDetail={(detailLocationId) =>
            updateQuery({ detailLocationId })
          }
          onRetry={loadLocations}
          onRetryWarehouse={() =>
            setSelectedWarehouseRefreshKey((current) => current + 1)
          }
          onRetryDirectory={() =>
            setRefreshKey((current) => current + 1)
          }
          onExport={() => void exportLocations()}
          exporting={locationExporting}
          exportFeedback={
            locationExportFeedback?.queryKey === locationExportQueryKey
              ? locationExportFeedback
              : null
          }
          onPageChange={(locationPage) => updateQuery({ locationPage })}
          onPageSizeChange={(locationSize) =>
            updateQuery({ locationPage: 0, locationSize })
          }
        />
      )}

      {editor && (
        <WarehouseWriteDialog
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {shippingConfigurationWarehouse && (
        <ShippingConfigurationDialog
          warehouse={shippingConfigurationWarehouse}
          canWrite={canWriteShippingConfiguration}
          onClose={() => setShippingConfigurationWarehouse(null)}
        />
      )}
      {query.detailWarehouseId && (
        <WarehouseDetailDialog
          state={warehouseDetail}
          onClose={() => updateQuery({ detailWarehouseId: undefined })}
          onRetry={() => setDetailRefreshKey((current) => current + 1)}
        />
      )}
      {isLocationView && query.warehouseId && query.detailLocationId && (
        <LocationDetailDialog
          state={locationDetail}
          warehouseState={selectedWarehouseState}
          onClose={() => updateQuery({ detailLocationId: undefined })}
          onRetry={() =>
            setLocationDetailRefreshKey((current) => current + 1)
          }
        />
      )}
    </section>
  )
}

function WarehouseFilters({
  query,
  onApply,
}: {
  query: WarehouseCenterQuery
  onApply: (
    patch: Pick<
      WarehouseCenterQuery,
      'includeInactive' | 'showArchived' | 'keyword'
    >,
  ) => void
}) {
  const [showArchived, setShowArchived] = useState(query.showArchived)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onApply({
      includeInactive:
        !showArchived && form.get('includeInactive') === 'on',
      showArchived,
      keyword: String(form.get('keyword') ?? '').trim().slice(0, 100),
    })
  }
  return (
    <form
      className="warehouse-filters erp-filter-panel erp-compact-filter-panel"
      aria-label="仓库筛选"
      onSubmit={submit}
    >
      <div className="erp-filter-row erp-filter-search-row">
        <span className="erp-filter-label">仓库名称：</span>
        <input
          aria-label="仓库名称"
          name="keyword"
          defaultValue={query.keyword}
          maxLength={100}
          placeholder="请输入仓库名称或业务编码"
        />
        <button className="button button-primary" type="submit">
          <Search size={17} aria-hidden="true" />
          搜索
        </button>
      </div>
      <label className="erp-filter-row erp-filter-short-row">
        <span className="erp-filter-label">仓库范围：</span>
        <select
          aria-label="仓库范围"
          name="warehouseView"
          defaultValue={query.showArchived ? 'archived' : 'current'}
          onChange={(event) =>
            setShowArchived(event.currentTarget.value === 'archived')
          }
        >
          <option value="current">当前仓库</option>
          <option value="archived">已归档仓库（只读）</option>
        </select>
      </label>
      <div className="erp-filter-row">
        <span className="erp-filter-label">停用仓库：</span>
        <label className="checkbox-label">
          <input
            name="includeInactive"
            type="checkbox"
            defaultChecked={query.includeInactive}
            disabled={showArchived}
          />
          显示已停用仓库
        </label>
      </div>
    </form>
  )
}

function WarehouseTable({
  state,
  selectedId,
  canWrite,
  onConfigure,
  onDetail,
  onSelect,
  onAction,
  onRetry,
  onRefresh,
  onExport,
  exporting,
  exportFeedback,
  onCreate,
  onPageChange,
  onPageSizeChange,
}: {
  state: LoadState<Page<Warehouse>>
  selectedId?: string
  canWrite: boolean
  onConfigure: (warehouse: Warehouse) => void
  onDetail: (id: string) => void
  onSelect: (id: string) => void
  onAction: (
    item: Warehouse,
    action: 'edit' | 'toggle' | 'archive',
  ) => void
  onRetry: () => void
  onRefresh: () => void
  onExport: () => void
  exporting: boolean
  exportFeedback: WarehouseExportFeedback | null
  onCreate?: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  return (
    <section className="warehouse-card" aria-labelledby="warehouse-list-title">
      <h2 className="sr-only" id="warehouse-list-title">
        仓库数据列表
      </h2>
      <div className="erp-operation-bar" aria-label="仓库操作">
        <div className="erp-operation-start">
          <span className="erp-selection-count">
            {state.status === 'ready'
              ? `共 ${state.data.totalElements} 条`
              : '仓库列表'}
          </span>
        </div>
        <div className="erp-operation-end">
          <button
            className="button"
            type="button"
            onClick={onExport}
            disabled={
              exporting ||
              state.status !== 'ready' ||
              state.data.totalElements === 0
            }
          >
            <Download size={16} aria-hidden="true" />
            {exporting ? '正在导出…' : '导出筛选结果'}
          </button>
          <button
            className="button"
            type="button"
            onClick={onRefresh}
            disabled={exporting}
          >
            <RefreshCw size={17} aria-hidden="true" />
            刷新
          </button>
          {onCreate && (
            <button
              className="button button-primary"
              type="button"
              onClick={onCreate}
            >
              <Plus size={17} aria-hidden="true" />
              新增仓库
            </button>
          )}
        </div>
      </div>
      {exportFeedback && (
        <p
          className={`warehouse-export-feedback is-${exportFeedback.kind}`}
          role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {exportFeedback.message}
        </p>
      )}
      {state.status === 'loading' && <Loading label="正在加载仓库" />}
      {state.status === 'error' && (
        <ErrorState message={state.message} onRetry={onRetry} />
      )}
      {state.status === 'ready' && (
        <>
          <div className="warehouse-table-scroll">
            <table className="shop-table warehouse-table">
              <caption className="sr-only">仓库列表</caption>
              <thead>
                <tr>
                  <th>仓库名称</th>
                  <th>业务编码</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((warehouse) => (
                  <tr
                    key={warehouse.id}
                    className={
                      warehouse.id === selectedId ? 'selected-row' : undefined
                    }
                  >
                    <td>
                      <button
                        className="text-button"
                        type="button"
                        aria-label={`查看仓库详情：${warehouse.name}`}
                        onClick={() => onDetail(warehouse.id)}
                      >
                        {warehouse.name}
                      </button>
                    </td>
                    <td>
                      <code>{warehouse.businessCode}</code>
                    </td>
                    <td>
                      <StatusChip status={warehouse.status} />
                    </td>
                    <td>{formatTime(warehouse.updatedAt)}</td>
                    <td>
                      <div className="warehouse-row-actions">
                        <ErpIconButton
                          icon={Scale}
                          label="发货配置"
                          type="button"
                          onClick={() => onConfigure(warehouse)}
                        />
                        <ErpIconButton
                          icon={MapPin}
                          label={warehouse.id === selectedId ? '正在查看库位' : '查看库位'}
                          type="button"
                          aria-pressed={warehouse.id === selectedId}
                          onClick={() => onSelect(warehouse.id)}
                        />
                        {canWrite &&
                          warehouse.status !== 'ARCHIVED' && (
                            <>
                              <ErpIconButton
                                icon={Pencil}
                                label="编辑"
                                type="button"
                                onClick={() => onAction(warehouse, 'edit')}
                              />
                              <ErpIconButton
                                icon={Power}
                                label={warehouse.status === 'ACTIVE' ? '停用' : '启用'}
                                type="button"
                                onClick={() => onAction(warehouse, 'toggle')}
                              />
                              <ErpIconButton
                                icon={Archive}
                                label="归档"
                                tone="danger"
                                type="button"
                                onClick={() => onAction(warehouse, 'archive')}
                              />
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.items.length === 0 ? (
            <EmptyState
              icon={<WarehouseIcon size={22} aria-hidden="true" />}
              label="当前筛选条件下没有仓库。"
            />
          ) : (
            <Pagination
              page={state.data}
              label="仓库分页"
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          )}
        </>
      )}
    </section>
  )
}

function LocationPanel({
  state,
  warehouseDirectory,
  warehouseId,
  warehouseState,
  query,
  canWrite,
  onApplyFilter,
  onCreate,
  onAction,
  onDetail,
  onRetry,
  onRetryWarehouse,
  onRetryDirectory,
  onExport,
  exporting,
  exportFeedback,
  onPageChange,
  onPageSizeChange,
}: {
  state: LoadState<Page<WarehouseLocation>> | { status: 'idle' }
  warehouseDirectory: LoadState<Page<Warehouse>>
  warehouseId?: string
  warehouseState: LoadState<Warehouse> | { status: 'idle' }
  query: WarehouseCenterQuery
  canWrite: boolean
  onApplyFilter: (
    patch: Pick<
      WarehouseCenterQuery,
      'warehouseId' | 'locationStatus' | 'locationKeyword'
    >,
  ) => void
  onCreate: () => void
  onAction: (
    item: WarehouseLocation,
    action: 'edit' | 'toggle' | 'archive',
  ) => void
  onDetail: (id: string) => void
  onRetry: () => void
  onRetryWarehouse: () => void
  onRetryDirectory: () => void
  onExport: () => void
  exporting: boolean
  exportFeedback: WarehouseExportFeedback | null
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const selectedWarehouse =
    warehouseState.status === 'ready' ? warehouseState.data : undefined

  return (
    <section
      className="warehouse-card location-card"
      aria-labelledby="location-title"
    >
      <h2 className="sr-only" id="location-title">
        {selectedWarehouse
          ? `${selectedWarehouse.name} · 库位列表`
          : '库位数据列表'}
      </h2>
      <LocationFilters
        key={[
          warehouseId ?? '',
          query.locationStatus ?? '',
          query.locationKeyword,
          warehouseDirectory.status,
          selectedWarehouse?.id ?? '',
        ].join(':')}
        query={query}
        warehouseDirectory={warehouseDirectory}
        selectedWarehouse={selectedWarehouse}
        onApply={onApplyFilter}
      />
      <p className="toolbar-note location-scope-note">
        此页面用于维护库位资料。
      </p>
      {warehouseDirectory.status === 'error' && (
        <ErrorState
          message={warehouseDirectory.message}
          onRetry={onRetryDirectory}
        />
      )}

      {!warehouseId ? (
        <EmptyState
          icon={<MapPin size={22} aria-hidden="true" />}
          label="请选择仓库后查询库位。"
        />
      ) : (
        <>
          {warehouseState.status === 'loading' && (
            <Loading label="正在加载所选仓库" />
          )}
          {warehouseState.status === 'error' && (
            <ErrorState
              message={warehouseState.message}
              onRetry={onRetryWarehouse}
            />
          )}
          <div className="erp-operation-bar" aria-label="库位操作">
            <div className="erp-operation-start">
              <span className="erp-selection-count">
                {state.status === 'ready'
                  ? `共 ${state.data.totalElements} 条`
                  : selectedWarehouse?.name ?? '库位列表'}
              </span>
              {selectedWarehouse && (
                <span className="warehouse-context-status">
                  仓库状态：{statusLabel(selectedWarehouse.status)}
                </span>
              )}
            </div>
            <div className="erp-operation-end">
              <button
                className="button"
                type="button"
                disabled={
                  exporting ||
                  state.status !== 'ready' ||
                  state.data.totalElements === 0
                }
                onClick={onExport}
              >
                <Download size={17} aria-hidden="true" />
                {exporting ? '正在导出…' : '导出筛选结果'}
              </button>
              <button className="button" type="button" onClick={onRetry}>
                <RefreshCw size={17} aria-hidden="true" />
                刷新
              </button>
              {canWrite &&
                selectedWarehouse &&
                selectedWarehouse.status !== 'ARCHIVED' && (
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={exporting}
                    onClick={onCreate}
                  >
                    <Plus size={17} aria-hidden="true" />
                    新增库位
                  </button>
                )}
            </div>
          </div>
          {exportFeedback && (
            <div
              className={`warehouse-export-feedback is-${exportFeedback.kind}`}
              role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
            >
              {exportFeedback.message}
            </div>
          )}
          {state.status === 'loading' && <Loading label="正在加载库位" />}
          {state.status === 'error' && (
            <ErrorState message={state.message} onRetry={onRetry} />
          )}
          {state.status === 'ready' && (
            <>
              <div className="warehouse-table-scroll">
                <table className="shop-table warehouse-table">
                  <caption className="sr-only">所选仓库的库位列表</caption>
                  <thead>
                    <tr>
                      <th>库位名称</th>
                      <th>库位编码</th>
                      <th>状态</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((location) => (
                      <tr key={location.id}>
                        <td>
                          <button
                            className="text-button"
                            type="button"
                            aria-label={`查看库位详情：${location.name}`}
                            onClick={() => onDetail(location.id)}
                          >
                            {location.name}
                          </button>
                        </td>
                        <td>
                          <code>{location.businessCode}</code>
                        </td>
                        <td>
                          <StatusChip status={location.status} />
                        </td>
                        <td>{formatTime(location.updatedAt)}</td>
                        <td>
                          {canWrite && location.status !== 'ARCHIVED' ? (
                            <div className="warehouse-row-actions">
                              <button
                                className="icon-text-button"
                                type="button"
                                onClick={() => onAction(location, 'edit')}
                              >
                                <Pencil size={15} aria-hidden="true" />
                                编辑
                              </button>
                              <button
                                className="icon-text-button"
                                type="button"
                                onClick={() => onAction(location, 'toggle')}
                              >
                                <Power size={15} aria-hidden="true" />
                                {location.status === 'ACTIVE'
                                  ? '停用'
                                  : '启用'}
                              </button>
                              <button
                                className="icon-text-button danger-text"
                                type="button"
                                onClick={() => onAction(location, 'archive')}
                              >
                                <Archive size={15} aria-hidden="true" />
                                归档
                              </button>
                            </div>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {state.data.items.length === 0 ? (
                <EmptyState
                  icon={<MapPin size={22} aria-hidden="true" />}
                  label="当前筛选条件下没有库位。"
                />
              ) : (
                <Pagination
                  page={state.data}
                  label="库位分页"
                  onPageChange={onPageChange}
                  onPageSizeChange={onPageSizeChange}
                />
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function LocationFilters({
  query,
  warehouseDirectory,
  selectedWarehouse,
  onApply,
}: {
  query: WarehouseCenterQuery
  warehouseDirectory: LoadState<Page<Warehouse>>
  selectedWarehouse?: Warehouse
  onApply: (
    patch: Pick<
      WarehouseCenterQuery,
      'warehouseId' | 'locationStatus' | 'locationKeyword'
    >,
  ) => void
}) {
  const warehouseOptions =
    warehouseDirectory.status === 'ready'
      ? [...warehouseDirectory.data.items]
      : []
  if (
    selectedWarehouse &&
    !warehouseOptions.some((warehouse) => warehouse.id === selectedWarehouse.id)
  ) {
    warehouseOptions.unshift(selectedWarehouse)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onApply({
      warehouseId:
        String(form.get('warehouseId') ?? '') || undefined,
      locationStatus: validStatus(String(form.get('locationStatus') ?? '')),
      locationKeyword: String(form.get('locationKeyword') ?? '')
        .trim()
        .slice(0, 100),
    })
  }
  return (
    <form
      className="location-filters erp-filter-panel erp-compact-filter-panel"
      aria-label="库位筛选"
      onSubmit={submit}
    >
      <label className="erp-filter-row erp-filter-short-row">
        <span className="erp-filter-label">仓库：</span>
        <select
          aria-label="仓库"
          name="warehouseId"
          defaultValue={query.warehouseId ?? ''}
          disabled={
            warehouseDirectory.status === 'loading' &&
            warehouseOptions.length === 0
          }
        >
          <option value="">请选择仓库</option>
          {warehouseOptions.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}（{warehouse.businessCode}）
            </option>
          ))}
        </select>
      </label>
      <div className="erp-filter-row erp-filter-search-row">
        <span className="erp-filter-label">库位：</span>
        <input
          aria-label="搜索库位名称或编码"
          name="locationKeyword"
          defaultValue={query.locationKeyword}
          maxLength={100}
          placeholder="请输入库位名称或编码"
        />
        <button className="button button-primary" type="submit">
          <Search size={17} aria-hidden="true" />
          搜索
        </button>
      </div>
      <label className="erp-filter-row erp-filter-short-row">
        <span className="erp-filter-label">库位状态：</span>
        <select
          aria-label="库位状态"
          name="locationStatus"
          defaultValue={query.locationStatus ?? ''}
        >
          <option value="">未归档（默认）</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
          </option>
          ))}
        </select>
      </label>
      <button
        className="button button-secondary"
        type="button"
        onClick={() =>
          onApply({
            warehouseId: undefined,
            locationStatus: undefined,
            locationKeyword: '',
          })
        }
      >
        重置
      </button>
    </form>
  )
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function useDialogFocus(
  dialogRef: { current: HTMLElement | null },
  initialFocusRef: { current: HTMLElement | null },
  onClose: () => void,
  closeAllowed = true,
) {
  const onCloseRef = useRef(onClose)
  const closeAllowedRef = useRef(closeAllowed)
  onCloseRef.current = onClose
  closeAllowedRef.current = closeAllowed

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const dialog = dialogRef.current
    const initialTarget = initialFocusRef.current ?? dialog
    initialTarget?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeAllowedRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.tabIndex >= 0)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus()
      }
    }
  }, [dialogRef, initialFocusRef])
}

function WarehouseDetailDialog({
  state,
  onClose,
  onRetry,
}: {
  state: LoadState<Warehouse> | { status: 'idle' }
  onClose: () => void
  onRetry: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(dialogRef, closeButtonRef, onClose)

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="write-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warehouse-detail-title"
        tabIndex={-1}
      >
        <div className="table-heading">
          <div>
            <p className="eyebrow">只读详情</p>
            <h2 id="warehouse-detail-title">仓库详情</h2>
          </div>
          <DialogCloseButton ref={closeButtonRef} onClick={onClose} />
        </div>

        {(state.status === 'idle' || state.status === 'loading') && (
          <Loading label="正在加载仓库详情" />
        )}
        {state.status === 'error' && (
          <ErrorState message={state.message} onRetry={onRetry} />
        )}
        {state.status === 'ready' && (
          <dl className="detail-list">
            <div>
              <dt>仓库标识</dt>
              <dd>
                <code>{state.data.id}</code>
              </dd>
            </div>
            <div>
              <dt>业务编码</dt>
              <dd>{state.data.businessCode}</dd>
            </div>
            <div>
              <dt>仓库名称</dt>
              <dd>{state.data.name}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{statusLabel(state.data.status)}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatTime(state.data.createdAt)}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatTime(state.data.updatedAt)}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  )
}

function LocationDetailDialog({
  state,
  warehouseState,
  onClose,
  onRetry,
}: {
  state: LoadState<WarehouseLocation> | { status: 'idle' }
  warehouseState: LoadState<Warehouse> | { status: 'idle' }
  onClose: () => void
  onRetry: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(dialogRef, closeButtonRef, onClose)

  const warehouse =
    warehouseState.status === 'ready' ? warehouseState.data : undefined

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="write-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-detail-title"
        tabIndex={-1}
      >
        <div className="table-heading">
          <div>
            <p className="eyebrow">只读详情</p>
            <h2 id="location-detail-title">库位详情</h2>
          </div>
          <DialogCloseButton ref={closeButtonRef} onClick={onClose} />
        </div>

        {(state.status === 'idle' || state.status === 'loading') && (
          <Loading label="正在加载库位详情" />
        )}
        {state.status === 'error' && (
          <ErrorState message={state.message} onRetry={onRetry} />
        )}
        {state.status === 'ready' && (
          <dl className="detail-list">
            <div>
              <dt>库位标识</dt>
              <dd>
                <code>{state.data.id}</code>
              </dd>
            </div>
            <div>
              <dt>所属仓库</dt>
              <dd>{warehouse?.name ?? state.data.warehouseId}</dd>
            </div>
            <div>
              <dt>仓库状态</dt>
              <dd>{warehouse ? statusLabel(warehouse.status) : '—'}</dd>
            </div>
            <div>
              <dt>业务编码</dt>
              <dd>{state.data.businessCode}</dd>
            </div>
            <div>
              <dt>库位名称</dt>
              <dd>{state.data.name}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{statusLabel(state.data.status)}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatTime(state.data.createdAt)}</dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>{formatTime(state.data.updatedAt)}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  )
}

function WarehouseWriteDialog({
  editor,
  onClose,
  onSaved,
}: {
  editor: Editor
  onClose: () => void
  onSaved: (
    value: Warehouse | WarehouseLocation,
    completedEditor: Editor,
  ) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const initialFocus = useRef<HTMLInputElement | HTMLButtonElement>(null)
  const captureInitialFocus = (node: HTMLInputElement | HTMLButtonElement | null) => {
    initialFocus.current = node
  }
  const item = editor.item
  const itemStatus = item?.status
  const nextStatus = itemStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  const resourceLabel = editor.resource === 'warehouse' ? '仓库' : '库位'
  const title =
    editor.action === 'create'
      ? `新增${resourceLabel}`
      : editor.action === 'edit'
        ? `编辑${resourceLabel}`
        : editor.action === 'archive'
          ? `确认归档${resourceLabel}`
          : `确认${nextStatus === 'ACTIVE' ? '启用' : '停用'}${resourceLabel}`

  useDialogFocus(dialogRef, initialFocus, onClose, !submitting)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      let saved: Warehouse | WarehouseLocation
      if (editor.resource === 'warehouse') {
        if (editor.action === 'create') {
          saved = await warehouseCenterApi.createWarehouse({
            businessCode: String(form.get('businessCode') ?? '').trim(),
            name: String(form.get('name') ?? '').trim(),
          })
        } else if (editor.action === 'archive') {
          saved = await warehouseCenterApi.archiveWarehouse(
            item!.id,
            item!.version,
          )
        } else {
          saved = await warehouseCenterApi.updateWarehouse(item!.id, {
            name:
              editor.action === 'edit'
                ? String(form.get('name') ?? '').trim()
                : item!.name,
            status:
              editor.action === 'toggle'
                ? nextStatus
                : (item!.status as 'ACTIVE' | 'INACTIVE'),
            version: item!.version,
          })
        }
      } else {
        const warehouseId = editor.warehouseId!
        if (editor.action === 'create') {
          saved = await warehouseCenterApi.createLocation(warehouseId, {
            businessCode: String(form.get('businessCode') ?? '').trim(),
            name: String(form.get('name') ?? '').trim(),
          })
        } else if (editor.action === 'archive') {
          saved = await warehouseCenterApi.archiveLocation(
            warehouseId,
            item!.id,
            item!.version,
          )
        } else {
          saved = await warehouseCenterApi.updateLocation(
            warehouseId,
            item!.id,
            {
              name:
                editor.action === 'edit'
                  ? String(form.get('name') ?? '').trim()
                  : item!.name,
              status:
                editor.action === 'toggle'
                  ? nextStatus
                  : (item!.status as 'ACTIVE' | 'INACTIVE'),
              version: item!.version,
            },
          )
        }
      }
      onSaved(saved, editor)
    } catch (reason) {
      setError(safeWarehouseMessage(reason, `${title}`))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmation =
    editor.action === 'archive'
      ? editor.resource === 'warehouse'
        ? '归档后默认列表将不再显示此仓库。必须先归档该仓库下全部未归档库位。'
        : '归档后默认列表将不再显示此库位，且不能再编辑或重新启用。'
      : `此操作会将${resourceLabel}状态改为“${statusLabel(nextStatus)}”。`

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="write-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warehouse-dialog-title"
        aria-describedby={
          editor.action === 'archive' || editor.action === 'toggle'
            ? 'warehouse-dialog-description'
            : undefined
        }
        tabIndex={-1}
      >
        <header className="table-heading">
          <h2 id="warehouse-dialog-title">{title}</h2>
          <DialogCloseButton disabled={submitting} onClick={onClose} />
        </header>
        <form className="warehouse-dialog-form" onSubmit={submit}>
          {editor.action === 'create' && (
            <>
              <label>
                业务编码
                <input
                  ref={captureInitialFocus}
                  name="businessCode"
                  required
                  maxLength={64}
                  pattern="[A-Za-z][A-Za-z0-9_-]{1,63}"
                  autoComplete="off"
                  aria-describedby="business-code-help"
                />
              </label>
              <small id="business-code-help">
                必须以字母开头，共 2–64 位，可使用字母、数字、下划线或连字符；保存后统一转为大写。
              </small>
            </>
          )}
          {(editor.action === 'create' || editor.action === 'edit') && (
            <label>
              {resourceLabel}名称
              <input
                ref={
                  editor.action === 'edit'
                    ? captureInitialFocus
                    : undefined
                }
                name="name"
                required
                maxLength={200}
                defaultValue={item?.name ?? ''}
                autoComplete="off"
              />
            </label>
          )}
          {(editor.action === 'archive' || editor.action === 'toggle') && (
            <div
              className={
                editor.action === 'archive'
                  ? 'confirmation-copy danger-copy'
                  : 'confirmation-copy'
              }
              id="warehouse-dialog-description"
            >
              <p>{confirmation}</p>
              <p>
                <strong>{item?.businessCode}</strong> · {item?.name}
              </p>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button
              ref={
                editor.action === 'archive' || editor.action === 'toggle'
                  ? captureInitialFocus
                  : undefined
              }
              className="button button-secondary"
              type="button"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className={`button ${
                editor.action === 'archive'
                  ? 'button-danger'
                  : 'button-primary'
              }`}
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? '正在提交'
                : editor.action === 'archive'
                  ? '确认归档'
                  : editor.action === 'toggle'
                    ? `确认${nextStatus === 'ACTIVE' ? '启用' : '停用'}`
                    : '保存'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function StatusChip({ status }: { status: WarehouseStatus }) {
  return (
    <span className={`warehouse-status warehouse-status-${status.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="warehouse-state" aria-busy="true" aria-live="polite">
      <CircleDashed className="spin" size={20} aria-hidden="true" />
      {label}
    </div>
  )
}

function EmptyState({
  icon,
  label,
}: {
  icon: ReactNode
  label: string
}) {
  return (
    <div className="warehouse-state">
      {icon}
      <span>{label}</span>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="warehouse-state" role="alert">
      <ShieldAlert size={20} aria-hidden="true" />
      <span>{message}</span>
      <button className="button button-secondary" type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}

export function Pagination({
  page,
  label,
  onPageChange,
  onPageSizeChange,
}: {
  page: Page<unknown>
  label: string
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}) {
  const pageSizes = [...new Set([...PAGE_SIZES, page.size])].sort(
    (left, right) => left - right,
  )
  return (
    <nav className="pagination" aria-label={label}>
      <span>
        第 {page.page + 1} / {Math.max(page.totalPages, 1)} 页，共{' '}
        {page.totalElements} 条
      </span>
      <div>
        {onPageSizeChange && (
          <label>
            每页
            <select
              aria-label={`${label}每页条数`}
              value={page.size}
              onChange={(event) =>
                onPageSizeChange(Number(event.currentTarget.value))
              }
            >
              {pageSizes.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="button button-secondary"
          type="button"
          disabled={page.page === 0}
          onClick={() => onPageChange(page.page - 1)}
        >
          上一页
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={page.page + 1 >= page.totalPages}
          onClick={() => onPageChange(page.page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  )
}

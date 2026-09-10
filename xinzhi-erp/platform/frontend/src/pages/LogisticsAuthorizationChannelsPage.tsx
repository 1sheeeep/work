import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  logisticsAuthorizationApi,
  type LogisticsAuthorization,
  type LogisticsAuthorizationChannel,
} from '../modules/logisticsAuthorizationApi'
import { toLogisticsAuthorizationUrl } from './LogisticsAuthorizationPage'
import './WarehouseArchiveShells.css'

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; account: LogisticsAuthorization; channels: LogisticsAuthorizationChannel[] }
  | { status: 'error'; message: string }

type ChannelStatusFilter = 'ALL' | 'ENABLED' | 'DISABLED' | 'UNAVAILABLE'

const pageSizes = [25, 50, 100] as const

function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有查看物流渠道的权限。'
  }
  if (error instanceof ApiError && error.status === 404) {
    return '物流账号不存在或已解绑，请返回物流授权列表。'
  }
  if (error instanceof ApiError && error.status === 409) {
    return '物流账号或渠道已发生变化，请刷新后重试。'
  }
  return '渠道数据读取失败，请稍后重试。'
}

function statusLabel(account: LogisticsAuthorization) {
  if (account.status === 'ARCHIVED') return '已停用'
  if (account.status === 'PENDING') return '待验证'
  return '已启用'
}

function statusClass(account: LogisticsAuthorization) {
  if (account.status === 'ARCHIVED') return 'is-disabled'
  if (account.status === 'PENDING') return 'is-pending'
  return 'is-active'
}

export function LogisticsAuthorizationChannelsPage({ authorizationId }: { authorizationId: string }) {
  const router = useRouter()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('logistics.authorization.write')
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [reload, setReload] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<ChannelStatusFilter>('ALL')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<(typeof pageSizes)[number]>(50)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    setFeedback('')
    Promise.all([
      logisticsAuthorizationApi.get(authorizationId, controller.signal),
      logisticsAuthorizationApi.listChannels(authorizationId, controller.signal),
    ]).then(([account, channels]) => {
      setState({ status: 'ready', account, channels })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(error) })
    })
    return () => controller.abort()
  }, [authorizationId, reload])

  const items = state.status === 'ready' ? state.channels : []
  const enabledCount = items.filter((channel) => channel.effectiveEnabled).length
  const filteredItems = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-CN')
    return items.filter((channel) => {
      const matchesKeyword = !normalizedKeyword
        || channel.channelName.toLocaleLowerCase('zh-CN').includes(normalizedKeyword)
        || channel.channelCode.toLocaleLowerCase('zh-CN').includes(normalizedKeyword)
      const matchesStatus = statusFilter === 'ALL'
        || (statusFilter === 'ENABLED' && channel.effectiveEnabled)
        || (statusFilter === 'DISABLED' && channel.providerAvailable && !channel.effectiveEnabled)
        || (statusFilter === 'UNAVAILABLE' && !channel.providerAvailable)
      return matchesKeyword && matchesStatus
    })
  }, [items, keyword, statusFilter])
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const visibleItems = filteredItems.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const rangeStart = filteredItems.length ? safePage * pageSize + 1 : 0
  const rangeEnd = Math.min((safePage + 1) * pageSize, filteredItems.length)

  useEffect(() => setPage(0), [keyword, pageSize, statusFilter])

  const goBack = () => {
    const category = state.status === 'ready' ? state.account.category : 'PLATFORM'
    router.history.push(toLogisticsAuthorizationUrl({ category }))
  }

  const syncChannels = async () => {
    if (state.status !== 'ready') return
    setSyncing(true)
    setFeedback('')
    try {
      const result = await logisticsAuthorizationApi.probe(
        state.account.id,
        state.account.version,
      )
      const channels = await logisticsAuthorizationApi.listChannels(state.account.id)
      setState({ status: 'ready', account: result.authorization, channels })
      setFeedback(result.message)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  const setChannelEnabled = async (channel: LogisticsAuthorizationChannel, enabled: boolean) => {
    if (state.status !== 'ready') return
    setBusy(true)
    setFeedback('')
    try {
      const updated = enabled
        ? await logisticsAuthorizationApi.enableChannel(state.account.id, channel.id, channel.version)
        : await logisticsAuthorizationApi.disableChannel(state.account.id, channel.id, channel.version)
      setState((current) => current.status === 'ready'
        ? {
            ...current,
            channels: current.channels.map((value) => value.id === updated.id ? updated : value),
          }
        : current)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="logistics-channel-workspace-page" aria-labelledby="logistics-channel-page-title">
      <header className="logistics-channel-page-header">
        <div className="logistics-channel-page-heading">
          <button className="button button-secondary page-back-button logistics-channel-back" type="button" onClick={goBack}>
            <ArrowLeft size={16} aria-hidden="true" />
            返回物流授权
          </button>
          <div>
            <h1 id="logistics-channel-page-title">物流渠道</h1>
            <p>{state.status === 'ready'
              ? `${state.account.providerName} · ${state.account.accountLabel}`
              : '管理物流账号可用于发货的渠道'}</p>
          </div>
        </div>
        <div className="logistics-channel-page-summary" aria-label="渠道概况">
          {state.status === 'ready' ? (
            <>
              <span className={`logistics-status-badge ${statusClass(state.account)}`}>
                {statusLabel(state.account)}
              </span>
              <span><strong>{enabledCount}</strong> 个已启用</span>
              <span><strong>{items.length}</strong> 个渠道</span>
            </>
          ) : null}
          <button className="button button-secondary" type="button" disabled={busy || syncing} onClick={() => setReload((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </button>
        </div>
      </header>

      <section className="warehouse-archive-card logistics-channel-workspace" aria-label="物流渠道列表">
        <div className="logistics-channel-workspace-toolbar">
          <div>
            <strong>渠道列表</strong>
            <span>按需启用后，渠道才可用于发货。</span>
          </div>
          {state.status === 'ready' && canWrite && state.account.status !== 'ARCHIVED' ? (
            <button className="button button-secondary" type="button" disabled={busy || syncing} onClick={() => void syncChannels()}>
              <RefreshCw size={15} aria-hidden="true" />
              {syncing ? '正在同步…' : '同步渠道'}
            </button>
          ) : null}
        </div>

        {state.status === 'ready' && items.length ? (
          <div className="logistics-channel-workspace-filters">
            <label>
              <span>搜索渠道</span>
              <input autoFocus value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入渠道名称或编码" />
            </label>
            <label>
              <span>启用状态</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ChannelStatusFilter)}>
                <option value="ALL">全部渠道</option>
                <option value="ENABLED">已启用</option>
                <option value="DISABLED">未启用</option>
                <option value="UNAVAILABLE">物流商已下线</option>
              </select>
            </label>
          </div>
        ) : null}

        {feedback ? <div className="inline-alert logistics-channel-feedback" role="status" aria-live="polite">{feedback}</div> : null}
        {state.status === 'loading' ? <div className="logistics-channel-empty" role="status"><strong>正在读取渠道…</strong></div> : null}
        {state.status === 'error' ? (
          <div className="logistics-channel-error" role="alert">
            <strong>渠道页面暂时无法打开</strong>
            <span>{state.message}</span>
            <div>
              <button className="button button-secondary" type="button" onClick={goBack}>返回列表</button>
              <button className="button button-primary" type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button>
            </div>
          </div>
        ) : null}
        {state.status === 'ready' && items.length === 0 ? (
          <div className="logistics-channel-empty" role="status">
            <strong>暂无已同步渠道</strong>
            <span>{state.account.status === 'ARCHIVED'
              ? '启用账号后再同步物流商渠道。'
              : '点击“同步渠道”从物流商读取真实可用渠道。'}</span>
          </div>
        ) : null}
        {state.status === 'ready' && items.length ? (
          <>
            <div className="logistics-channel-workspace-table">
              <table aria-label={`${state.account.accountLabel}渠道列表`}>
                <thead><tr><th>渠道名称</th><th>渠道编码</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>{visibleItems.length ? visibleItems.map((channel) => (
                  <tr key={channel.id}>
                    <td><span className="logistics-channel-name">{channel.channelName}</span></td>
                    <td><span className="logistics-channel-code">{channel.channelCode}</span></td>
                    <td>
                      <span className={`logistics-status-badge ${channel.effectiveEnabled ? 'is-active' : channel.providerAvailable ? 'is-disabled' : 'is-unconfigured'}`}>
                        {channel.effectiveEnabled ? '已启用' : channel.providerAvailable ? '未启用' : '物流商已下线'}
                      </span>
                    </td>
                    <td>
                      {canWrite && state.account.status === 'ACTIVE' && channel.providerAvailable ? (
                        <button className={`text-button${channel.enabled ? ' is-danger' : ''}`} type="button" disabled={busy || syncing} onClick={() => void setChannelEnabled(channel, !channel.enabled)}>
                          {channel.enabled ? '停用' : '启用'}
                        </button>
                      ) : <span className="logistics-empty-cell">--</span>}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4}><div className="logistics-channel-empty" role="status">没有匹配的渠道，请调整搜索条件。</div></td></tr>
                )}</tbody>
              </table>
            </div>
            <div className="logistics-channel-workspace-pagination">
              <span>显示 {rangeStart}-{rangeEnd}，共 {filteredItems.length} 条</span>
              <div>
                <label>
                  每页
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as (typeof pageSizes)[number])}>
                    {pageSizes.map((size) => <option key={size} value={size}>{size} 条</option>)}
                  </select>
                </label>
                <span>第 {safePage + 1} / {totalPages} 页</span>
                <button type="button" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
                <button type="button" disabled={safePage + 1 >= totalPages} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>下一页</button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}

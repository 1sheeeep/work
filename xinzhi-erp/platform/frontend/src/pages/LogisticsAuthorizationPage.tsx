import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DialogCloseButton } from '../components/DialogCloseButton'
import {
  logisticsAuthorizationApi,
  type AuthorizationCategory,
  type IntegrationMode,
  type LogisticsAuthorization,
  type LogisticsAuthorizationPage,
  type ProviderCode,
} from '../modules/logisticsAuthorizationApi'
import './WarehouseArchiveShells.css'

export type LogisticsAuthorizationQuery = {
  category: AuthorizationCategory
  name: string
}

type ProviderDefinition = {
  value: ProviderCode
  label: string
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; data: LogisticsAuthorizationPage }
  | { status: 'error'; message: string }

const logisticsNameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
})

const categories: ReadonlyArray<{ value: AuthorizationCategory; label: string }> = [
  { value: 'PLATFORM', label: '平台物流' },
  { value: 'SELF_FULFILLED', label: '自发物流' },
  { value: 'FIRST_MILE', label: '头程物流' },
  { value: 'OVERSEAS', label: '三方 / 海外仓' },
  { value: 'CLOUD_FACTORY', label: '云工厂' },
  { value: 'CUSTOM', label: '自定义物流' },
]

const builtInProviders: ReadonlyArray<ProviderDefinition> = [
  {
    value: 'CHUDA',
    label: '触达物流',
  },
  {
    value: 'DAYUNJIA',
    label: '深圳达运佳国际物流',
  },
  {
    value: 'BIAOJU',
    label: '镖锔科技物流',
  },
  {
    value: 'BAIDU_YIXIA',
    label: '摆渡一下',
  },
  {
    value: 'HUALEI',
    label: '华磊',
  },
  {
    value: 'TONGXI',
    label: '桐溪供应链',
  },
  {
    value: 'JIAYUN_SHENGTU',
    label: '嘉运晟途',
  },
  {
    value: 'SHANDIANHOU_XIAOBAO',
    label: '闪电猴（小包）',
  },
  {
    value: 'SHANDIANHOU_SHANGPAI',
    label: '闪电猴（商派）',
  },
]

const accountPasswordOnly: ReadonlyArray<ProviderCode> = [
  'CHUDA', 'DAYUNJIA', 'BIAOJU', 'BAIDU_YIXIA', 'HUALEI', 'TONGXI', 'JIAYUN_SHENGTU',
  'SHANDIANHOU_XIAOBAO', 'SHANDIANHOU_SHANGPAI',
]

function boundedText(value: string | null, maximum = 120) {
  return (value ?? '').trim().slice(0, maximum)
}

function boundedSecret(value: string | null, maximum: number) {
  return (value ?? '').slice(0, maximum)
}

function category(value: string | null): AuthorizationCategory {
  return categories.some((item) => item.value === value)
    ? value as AuthorizationCategory
    : 'PLATFORM'
}

function safeMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return '已存在同名货代账号，请填写不同的货代别名。'
  }
  if (error instanceof ApiError && error.status === 403) {
    return '当前账号没有物流服务商管理权限。'
  }
  if (error instanceof ApiError && error.status === 400) {
    return '账号信息不完整，请检查必填项后重试。'
  }
  return '操作未完成，请稍后重试。'
}

function providerName(code: ProviderCode, value: string, providers = builtInProviders) {
  if (code === 'CUSTOM') return boundedText(value)
  return providers.find((item) => item.value === code)?.label ?? boundedText(value)
}

function editableAlias(item: LogisticsAuthorization, providers: ReadonlyArray<ProviderDefinition>) {
  const fallback = providerName(item.providerCode, item.providerName, providers)
  const matchesFallback = item.accountLabel.trim().localeCompare(fallback, 'zh-CN', { sensitivity: 'base' }) === 0
  const matchesStoredProvider = item.accountLabel.trim().localeCompare(item.providerName, 'zh-CN', { sensitivity: 'base' }) === 0
  return matchesFallback || matchesStoredProvider
    ? ''
    : item.accountLabel
}

function optionalDisplay(value?: string) {
  const normalized = value?.trim()
  return normalized && normalized.toLowerCase() !== 'null' ? normalized : undefined
}

function statusLabel(item: LogisticsAuthorization) {
  if (item.status === 'ARCHIVED') return '已停用'
  if (item.status === 'PENDING') return '待验证'
  return '已启用'
}

function statusClass(item: LogisticsAuthorization) {
  if (item.status === 'ARCHIVED') return 'is-disabled'
  if (item.status === 'PENDING') return 'is-pending'
  return 'is-active'
}

function formatUpdatedAt(value: string) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`
}

export function parseLogisticsAuthorizationQuery(search: string): LogisticsAuthorizationQuery {
  const parameters = new URLSearchParams(search)
  return {
    category: category(parameters.get('category')),
    name: boundedText(parameters.get('name')),
  }
}

export function toLogisticsAuthorizationUrl(query: Partial<LogisticsAuthorizationQuery>) {
  const parameters = new URLSearchParams()
  if (query.category && query.category !== 'PLATFORM') parameters.set('category', query.category)
  if (query.name) parameters.set('name', boundedText(query.name))
  const search = parameters.toString()
  return search ? `/logistics/authorizations?${search}` : '/logistics/authorizations'
}

export function toLogisticsAuthorizationChannelsUrl(item: LogisticsAuthorization) {
  const parameters = new URLSearchParams({ category: item.category })
  return `/logistics/authorizations/${item.id}/channels?${parameters}`
}

export function LogisticsAuthorizationPage() {
  const router = useRouter()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const query = useMemo(() => parseLogisticsAuthorizationQuery(search), [search])
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('logistics.authorization.write')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<LogisticsAuthorization | null>(null)
  const [mode, setMode] = useState<IntegrationMode>('DIRECT_CREDENTIALS')
  const [provider, setProvider] = useState<ProviderCode>('DAYUNJIA')
  const [providerQuery, setProviderQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [providers, setProviders] = useState<ReadonlyArray<ProviderDefinition>>(builtInProviders)
  const orderedProviders = useMemo(
    () => [...providers].sort((left, right) => logisticsNameCollator.compare(left.label, right.label)),
    [providers],
  )
  const visibleProviders = useMemo(() => {
    const keyword = providerQuery.trim().toLocaleLowerCase('zh-CN')
    return keyword
      ? orderedProviders.filter((item) => item.label.toLocaleLowerCase('zh-CN').includes(keyword))
      : orderedProviders
  }, [orderedProviders, providerQuery])
  const selectedProviderName = providerName(provider, '', providers)
  const selectedProviderIsVisible = provider === 'CUSTOM'
    ? query.category !== 'PLATFORM' && (!providerQuery || '其他物流商'.includes(providerQuery.trim()))
    : visibleProviders.some((item) => item.value === provider)
  const selectedProviderAccountCount = state.status === 'ready'
    ? state.data.items.filter((item) => item.providerCode === provider).length
    : 0
  const editingSiblingCount = editing && state.status === 'ready'
    ? state.data.items.filter((item) => item.providerCode === editing.providerCode && item.id !== editing.id).length
    : 0
  const navigate = (next: Partial<LogisticsAuthorizationQuery>) => {
    router.history.push(toLogisticsAuthorizationUrl(next))
  }

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    logisticsAuthorizationApi.list({
      category: query.category,
      name: query.category === 'PLATFORM' ? undefined : query.name || undefined,
      page: 0,
      pageSize: 100,
      signal: controller.signal,
    }).then((data) => setState({ status: 'ready', data }))
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: safeMessage(error) })
      })
    return () => controller.abort()
  }, [query, refresh])

  useEffect(() => {
    const controller = new AbortController()
    logisticsAuthorizationApi.listProviders(controller.signal)
      .then((items) => setProviders(builtInProviders.map((provider) => ({
        ...provider,
        label: items.find((item) => item.providerCode === provider.value)?.providerName ?? provider.label,
      }))))
      .catch(() => undefined)
    return () => controller.abort()
  }, [refresh])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    navigate({ category: query.category, name: boundedText(String(data.get('name'))) })
  }

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setFeedback('')
    try {
      const direct = mode === 'DIRECT_CREDENTIALS'
      const selectedProviderCode = direct ? provider : 'CUSTOM'
      const selectedProviderDisplayName = providerName(
        selectedProviderCode,
        String(data.get('providerName')),
        providers,
      )
      const created = await logisticsAuthorizationApi.create({
        category: query.category,
        providerCode: selectedProviderCode,
        providerName: selectedProviderDisplayName,
        accountLabel: boundedText(String(data.get('accountLabel')), 160) || selectedProviderDisplayName,
        integrationMode: mode,
        credentials: direct ? {
          username: boundedText(String(data.get('username')), 256),
          password: boundedSecret(String(data.get('password')), 256),
          key: accountPasswordOnly.includes(provider)
            ? undefined
            : boundedSecret(String(data.get('key')), 512) || undefined,
        } : undefined,
        contactName: boundedText(String(data.get('contactName'))) || undefined,
        note: boundedText(String(data.get('note')), 500) || undefined,
      })
      let message = `货代账号“${created.accountLabel}”已添加。`
      if (direct) {
        try {
          message = (await logisticsAuthorizationApi.probe(created.id, created.version)).message
        } catch {
          message = '账号信息已安全保存，连接测试暂未完成，可稍后重试。'
        }
      }
      setOpen(false)
      setFeedback(message)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const updateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const data = new FormData(event.currentTarget)
    const accountLabel = boundedText(data.get('accountLabel') as string | null, 160)
      || providerName(editing.providerCode, editing.providerName, providers)
    const username = boundedText(data.get('username') as string | null, 256)
    const password = boundedSecret(data.get('password') as string | null, 256)
    const key = boundedSecret(data.get('key') as string | null, 512)
    const credentialsRequested = Boolean(username || password || key)
    if (credentialsRequested && (!username || !password)) {
      setFeedback('如需更新账号密码，请同时填写账号和密码；只修改货代别名时可全部留空。')
      return
    }
    setBusy(true)
    setFeedback('')
    try {
      let updated = editing
      const renamed = accountLabel !== editing.accountLabel
      if (renamed) {
        updated = await logisticsAuthorizationApi.rename(
          updated.id, updated.version, accountLabel,
        )
      }
      if (credentialsRequested) {
        updated = await logisticsAuthorizationApi.replaceCredentials(
          updated.id,
          updated.version,
          {
            username,
            password,
            key: accountPasswordOnly.includes(editing.providerCode) ? undefined : key || undefined,
          },
        )
      }
      if (!renamed && !credentialsRequested) {
        setFeedback('没有需要保存的修改。')
        return
      }
      let message = credentialsRequested
        ? updated.status === 'ARCHIVED'
          ? '货代账号已更新，账号仍保持停用。'
          : '货代账号已更新。'
        : `货代别名已修改为“${updated.accountLabel}”。`
      if (credentialsRequested && updated.status !== 'ARCHIVED') {
        try {
          message = (await logisticsAuthorizationApi.probe(updated.id, updated.version)).message
        } catch {
          message = '账号信息已安全更新，连接测试暂未完成，可稍后重试。'
        }
      }
      setEditing(null)
      setFeedback(message)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(error instanceof ApiError && error.status === 409
        ? '账号信息已发生变化，请刷新后重试。'
        : safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const probe = async (item: LogisticsAuthorization) => {
    setBusy(true)
    setFeedback('')
    try {
      const result = await logisticsAuthorizationApi.probe(item.id, item.version)
      setFeedback(result.message)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (item: LogisticsAuthorization) => {
    if (!window.confirm(`停用货代账号“${item.accountLabel}”？停用后不会再调用该账号。`)) return
    setBusy(true)
    setFeedback('')
    try {
      await logisticsAuthorizationApi.disable(item.id, item.version)
      setFeedback(`货代账号“${item.accountLabel}”已停用，可随时重新启用。`)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const enable = async (item: LogisticsAuthorization) => {
    setBusy(true)
    setFeedback('')
    try {
      const enabled = await logisticsAuthorizationApi.enable(item.id, item.version)
      let message = `货代账号“${item.accountLabel}”已启用。`
      if (enabled.integrationMode === 'DIRECT_CREDENTIALS') {
        try {
          message = (await logisticsAuthorizationApi.probe(enabled.id, enabled.version)).message
        } catch {
          message = '账号已恢复为待验证状态，请稍后测试连接。'
        }
      }
      setFeedback(message)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const unbind = async (item: LogisticsAuthorization) => {
    if (!window.confirm(`解绑货代账号“${item.accountLabel}”？保存的账号凭据将被清除。`)) return
    setBusy(true)
    setFeedback('')
    try {
      await logisticsAuthorizationApi.unbind(item.id, item.version)
      setFeedback(`货代账号“${item.accountLabel}”已解绑。`)
      setRefresh((value) => value + 1)
    } catch (error) {
      setFeedback(safeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const openDialog = () => {
    setMode(query.category === 'SELF_FULFILLED' ? 'MANUAL' : 'DIRECT_CREDENTIALS')
    setProvider(orderedProviders[0]?.value ?? 'CHUDA')
    setProviderQuery('')
    setFeedback('')
    setOpen(true)
  }

  const actions = {
    probe,
    editAccount: (item: LogisticsAuthorization) => {
      setFeedback('')
      setEditing(item)
    },
    disable,
    enable,
    unbind,
    manageChannels: (item: LogisticsAuthorization) => {
      router.history.push(toLogisticsAuthorizationChannelsUrl(item))
    },
  }

  return (
    <main className="warehouse-archive-page" aria-labelledby="logistics-authorization-title">
      <header className="warehouse-archive-heading">
        <div>
          <p className="eyebrow">物流 / 物流管理</p>
          <h1 id="logistics-authorization-title">物流授权</h1>
          <p>按物流商管理货代账号、连接状态和接口授权。</p>
        </div>
      </header>

      <div className="warehouse-archive-tabs" role="tablist" aria-label="物流类型">
        {categories.map((item) => (
          <button
            className={query.category === item.value ? 'is-active' : ''}
            key={item.value}
            type="button"
            role="tab"
            aria-selected={query.category === item.value}
            onClick={() => navigate({ category: item.value })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="warehouse-archive-card" aria-label="物流授权搜索与列表">
        <form className="warehouse-archive-filters logistics-provider-search" key={toLogisticsAuthorizationUrl(query)} onSubmit={submit}>
          <label className="logistics-provider-search-field">
            <span className="sr-only">物流商或货代别名</span>
            <input name="name" defaultValue={query.name} maxLength={120} placeholder="输入物流商或货代别名" />
          </label>
          <div className="warehouse-archive-filter-actions">
            <button className="is-primary logistics-search-submit" type="submit">
              搜索
            </button>
            {query.name ? (
              <button type="button" onClick={() => navigate({ category: query.category })}>清除</button>
            ) : null}
          </div>
          <div className="logistics-security-note" role="note" title="账号密码加密保存且不会回显；停用后保留配置，重新启用时再次验证连接。">
            <span>账号凭据已加密</span>
          </div>
        </form>
        {canWrite ? (
          <div className="warehouse-archive-actions">
            <button className="is-primary" type="button" disabled={busy} onClick={() => openDialog()}>
              添加物流商
            </button>
          </div>
        ) : null}
        {feedback ? <div className="inline-alert" role="status" aria-live="polite">{feedback}</div> : null}
        {query.category === 'PLATFORM' ? (
          <PlatformAuthorizationTable
            state={state}
            query={query.name}
            canWrite={canWrite}
            busy={busy}
            providers={providers}
            actions={actions}
          />
        ) : (
          <AuthorizationTable state={state} canWrite={canWrite} busy={busy} actions={actions} />
        )}
      </section>

      {open ? (
        <section className="warehouse-dialog-backdrop" role="presentation">
          <div className="warehouse-dialog logistics-authorization-dialog" role="dialog" aria-modal="true" aria-labelledby="logistics-authorization-dialog-title">
            <div className="table-heading">
              <h2 id="logistics-authorization-dialog-title">添加物流商</h2>
              <DialogCloseButton disabled={busy} onClick={() => setOpen(false)} />
            </div>
            <form className="logistics-authorization-form" onSubmit={(event) => void create(event)}>
              <div className="warehouse-dialog-grid">
                {query.category === 'PLATFORM' ? null : (
                  <>
                    <label>
                      物流类型
                      <input value={categories.find((item) => item.value === query.category)?.label ?? query.category} readOnly />
                    </label>
                    <label>
                      连接方式
                      <select name="integrationMode" value={mode} onChange={(event) => setMode(event.target.value as IntegrationMode)}>
                        <option value="DIRECT_CREDENTIALS">系统对接</option>
                        <option value="MANUAL">人工管理（无需接口）</option>
                      </select>
                    </label>
                  </>
                )}
                {mode === 'DIRECT_CREDENTIALS' ? (
                  <>
                    <fieldset className="logistics-provider-picker is-span-2">
                      <legend>选择物流商</legend>
                      <input
                        type="search"
                        aria-label="搜索物流商"
                        value={providerQuery}
                        maxLength={120}
                        placeholder="输入物流商名称"
                        onChange={(event) => setProviderQuery(event.target.value)}
                      />
                      <div className="logistics-provider-options" role="listbox" aria-label="物流商搜索结果">
                        {visibleProviders.map((item) => (
                          <button
                            className={provider === item.value ? 'is-selected' : undefined}
                            key={item.value}
                            type="button"
                            role="option"
                            aria-selected={provider === item.value}
                            onClick={() => setProvider(item.value)}
                          >
                            {item.label}
                          </button>
                        ))}
                        {query.category !== 'PLATFORM' && (!providerQuery || '其他物流商'.includes(providerQuery.trim())) ? (
                          <button
                            className={provider === 'CUSTOM' ? 'is-selected' : undefined}
                            type="button"
                            role="option"
                            aria-selected={provider === 'CUSTOM'}
                            onClick={() => setProvider('CUSTOM')}
                          >
                            其他物流商
                          </button>
                        ) : null}
                        {visibleProviders.length === 0 && query.category === 'PLATFORM' ? (
                          <p role="status">没有找到已接入的物流商。</p>
                        ) : null}
                      </div>
                    </fieldset>
                    {provider === 'CUSTOM' ? (
                      <label>
                        服务商名称
                        <input name="providerName" required maxLength={120} autoComplete="organization" />
                      </label>
                    ) : null}
                    <label className="is-span-2">
                      货代别名{selectedProviderAccountCount ? '' : '（可选）'}
                      <input
                        key={`account-${provider}`}
                        name="accountLabel"
                        aria-label="货代别名"
                        required={selectedProviderAccountCount > 0}
                        maxLength={160}
                        autoComplete="organization-title"
                        placeholder={selectedProviderAccountCount ? '例如：深圳仓、义乌仓' : `不填则显示“${selectedProviderName}”`}
                      />
                      <span className="form-field-hint">
                        {selectedProviderAccountCount
                          ? `已添加 ${selectedProviderAccountCount} 个账号，请填写便于区分的别名。`
                          : '仅用于区分同一物流商的多个账号。'}
                      </span>
                    </label>
                    <label>
                      账号
                      <input name="username" required maxLength={256} autoComplete="username" />
                    </label>
                    <label>
                      密码
                      <input name="password" type="password" required maxLength={256} autoComplete="new-password" />
                    </label>
                    {accountPasswordOnly.includes(provider) ? null : (
                      <label>
                        Key（可选）
                        <input name="key" type="password" maxLength={512} autoComplete="new-password" />
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label>
                      服务商名称
                      <input name="providerName" required maxLength={120} />
                    </label>
                    <label>
                      货代别名（可选）
                      <input name="accountLabel" maxLength={160} placeholder="不填则使用服务商名称" />
                    </label>
                  </>
                )}
                {mode === 'DIRECT_CREDENTIALS' && accountPasswordOnly.includes(provider) ? null : (
                  <>
                    <label>
                      联系人（可选）
                      <input name="contactName" maxLength={120} autoComplete="name" />
                    </label>
                    <label className="is-span-2">
                      备注（可选）
                      <textarea name="note" maxLength={500} />
                    </label>
                  </>
                )}
              </div>
              {mode === 'DIRECT_CREDENTIALS' ? <p className="form-hint" role="note">填写物流商提供的账号和密码；保存后系统将立即验证连接。</p> : null}
              {feedback ? <div className="inline-alert" role="alert">{feedback}</div> : null}
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
                <button className="is-primary" type="submit" disabled={busy || (mode === 'DIRECT_CREDENTIALS' && !selectedProviderIsVisible)}>{busy ? '正在保存…' : '保存并测试连接'}</button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {editing ? (
        <section className="warehouse-dialog-backdrop" role="presentation">
          <div className="warehouse-dialog logistics-authorization-dialog" role="dialog" aria-modal="true" aria-labelledby="logistics-credential-dialog-title">
            <div className="table-heading">
              <h2 id="logistics-credential-dialog-title">修改货代账号</h2>
              <DialogCloseButton disabled={busy} onClick={() => setEditing(null)} />
            </div>
            <form className="logistics-authorization-form" onSubmit={(event) => void updateAccount(event)}>
              <div className="warehouse-dialog-grid">
                <label>物流商<input value={providerName(editing.providerCode, editing.providerName, providers)} readOnly /></label>
                <label>
                  货代别名{editingSiblingCount ? '' : '（可选）'}
                  <input
                    name="accountLabel"
                    aria-label="货代别名"
                    required={editingSiblingCount > 0}
                    maxLength={160}
                    defaultValue={editableAlias(editing, providers)}
                    placeholder={`不填则显示“${providerName(editing.providerCode, editing.providerName, providers)}”`}
                    autoFocus
                  />
                  <span className="form-field-hint">
                    {editingSiblingCount
                      ? '该物流商还有其他账号，请保留一个便于区分的别名。'
                      : '仅用于区分同一物流商的多个账号。'}
                  </span>
                </label>
                {editing.integrationMode === 'DIRECT_CREDENTIALS' ? <>
                  <label>
                    账号（可选）
                    <input name="username" maxLength={256} autoComplete="username" placeholder="留空则不修改" />
                  </label>
                  <label>
                    密码（可选）
                    <input name="password" type="password" maxLength={256} autoComplete="new-password" placeholder="留空则不修改" />
                  </label>
                  {accountPasswordOnly.includes(editing.providerCode) ? null : (
                    <label>
                      Key（可选）
                      <input name="key" type="password" maxLength={512} autoComplete="new-password" />
                    </label>
                  )}
                </> : null}
              </div>
              {editing.integrationMode === 'DIRECT_CREDENTIALS' ? <p className="form-hint" role="note">只修改货代别名时不必重填账号密码；填写新账号密码后系统会重新验证连接。</p> : null}
              {editing.status === 'ARCHIVED' ? <p className="form-hint" role="note">修改账号不会自动启用，保存后仍保持停用。</p> : null}
              {feedback ? <div className="inline-alert" role="alert">{feedback}</div> : null}
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
                <button className="is-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存修改'}</button>
              </div>
            </form>
          </div>
        </section>
      ) : null}
    </main>
  )
}

type RowActions = {
  probe: (item: LogisticsAuthorization) => Promise<void>
  editAccount: (item: LogisticsAuthorization) => void
  disable: (item: LogisticsAuthorization) => Promise<void>
  enable: (item: LogisticsAuthorization) => Promise<void>
  unbind: (item: LogisticsAuthorization) => Promise<void>
  manageChannels: (item: LogisticsAuthorization) => void
}

function platformAccounts(items: LogisticsAuthorization[], query: string,
  providers: ReadonlyArray<ProviderDefinition>) {
  const keyword = query.trim().toLocaleLowerCase('zh-CN')
  return items
    .filter((item) => {
      if (!keyword) return true
      const displayProvider = providerName(item.providerCode, item.providerName, providers)
      return item.accountLabel.toLocaleLowerCase('zh-CN').includes(keyword)
        || displayProvider.toLocaleLowerCase('zh-CN').includes(keyword)
    })
    .sort((left, right) => {
      const byAlias = logisticsNameCollator.compare(left.accountLabel, right.accountLabel)
      if (byAlias !== 0) return byAlias
      const byProvider = logisticsNameCollator.compare(
        providerName(left.providerCode, left.providerName, providers),
        providerName(right.providerCode, right.providerName, providers),
      )
      return byProvider !== 0 ? byProvider : left.id.localeCompare(right.id)
    })
}

function PlatformAuthorizationTable({
  state,
  query,
  canWrite,
  busy,
  providers,
  actions,
}: {
  state: State
  query: string
  canWrite: boolean
  busy: boolean
  providers: ReadonlyArray<ProviderDefinition>
  actions: RowActions
}) {
  if (state.status === 'loading') return <div className="warehouse-archive-empty" role="status"><strong>正在读取物流账号…</strong></div>
  if (state.status === 'error') return <div className="inline-alert" role="alert">{state.message}</div>
  const items = platformAccounts(state.data.items, query, providers)
  return (
    <div className="warehouse-archive-table-wrap logistics-provider-catalog">
      <table className="logistics-platform-account-table" aria-label="物流账号列表">
        <thead><tr><th>货代别名</th><th>物流商</th><th>状态</th><th>账号信息</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={6}><div className="warehouse-archive-empty" role="status"><strong>{query ? '未找到匹配的物流账号' : '暂无物流账号'}</strong><span>{query ? '请更换关键词后重试。' : '点击“添加物流商”绑定第一个物流商账号。'}</span></div></td></tr>
          ) : items.map((item) => (
            <AuthorizationAccountRow
              key={item.id}
              item={item}
              canWrite={canWrite}
              busy={busy}
              actions={actions}
              showProviderColumn
              providerDisplayName={providerName(item.providerCode, item.providerName, providers)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuthorizationTable({ state, canWrite, busy, actions }: {
  state: State
  canWrite: boolean
  busy: boolean
  actions: RowActions
}) {
  if (state.status === 'loading') return <div className="warehouse-archive-empty" role="status"><strong>正在读取物流服务商…</strong></div>
  if (state.status === 'error') return <div className="inline-alert" role="alert">{state.message}</div>
  return (
    <div className="warehouse-archive-table-wrap logistics-provider-catalog">
      <table aria-label="物流授权列表">
        <thead><tr><th>服务商 / 账号</th><th>状态</th><th>账号</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>
          {state.data.items.length === 0 ? (
            <tr><td colSpan={5}><div className="warehouse-archive-empty" role="status"><strong>暂无物流服务商</strong><span>可新增第一个服务商账号。</span></div></td></tr>
          ) : state.data.items.map((item) => <AuthorizationAccountRow key={item.id} item={item} canWrite={canWrite} busy={busy} actions={actions} />)}
        </tbody>
      </table>
    </div>
  )
}

function AuthorizationAccountRow({ item, canWrite, busy, actions, showProviderColumn = false,
  providerDisplayName = item.providerName }: {
  item: LogisticsAuthorization
  canWrite: boolean
  busy: boolean
  actions: RowActions
  showProviderColumn?: boolean
  providerDisplayName?: string
}) {
  const note = optionalDisplay(item.note)
  const contact = optionalDisplay(item.contactName)
  const secondary = [showProviderColumn ? undefined : providerDisplayName, contact, note].filter(Boolean).join(' · ')
  const credential = item.integrationMode === 'MANUAL'
    ? { label: '人工管理', detail: '此账号由人工维护' }
    : item.credentialConfigured
      ? { label: '已保存', detail: '账号凭据已加密保存' }
      : { label: '待补充', detail: '需要补充账号凭据' }
  return (
    <tr>
        <td>
          <div className="logistics-account-identity">
            <span className="logistics-account-copy">
              <strong>{item.accountLabel}</strong>
              {secondary ? <span>{secondary}</span> : null}
            </span>
          </div>
        </td>
        {showProviderColumn ? <td><span className="logistics-provider-name">{providerDisplayName}</span></td> : null}
        <td><span className={`logistics-status-badge ${statusClass(item)}`}>{statusLabel(item)}</span></td>
        <td>
          <span className="logistics-credential-state" title={credential.detail}>
            {credential.label}
          </span>
        </td>
        <td><time className="logistics-updated-at" dateTime={item.updatedAt}>{formatUpdatedAt(item.updatedAt)}</time></td>
        <td>
          {canWrite ? (
            <div className="logistics-row-actions" aria-label={`${item.accountLabel}操作`}>
              {item.integrationMode === 'DIRECT_CREDENTIALS' ? (
                <RowActionButton
                  label="管理渠道"
                  ariaLabel={`管理${item.accountLabel}物流渠道`}
                  disabled={busy}
                  onClick={() => actions.manageChannels(item)}
                />
              ) : null}
              {item.status === 'ARCHIVED' ? (
                <>
                  <RowActionButton label="启用" disabled={busy} onClick={() => void actions.enable(item)} />
                  <RowActionButton label="修改" disabled={busy} onClick={() => actions.editAccount(item)} />
                  <RowActionButton label="解绑" danger disabled={busy} onClick={() => void actions.unbind(item)} />
                </>
              ) : (
                <>
                  {item.integrationMode === 'DIRECT_CREDENTIALS' ? (
                    <>
                      <RowActionButton label="测试连接" disabled={busy} onClick={() => void actions.probe(item)} />
                      <RowActionButton label="修改" disabled={busy} onClick={() => actions.editAccount(item)} />
                    </>
                  ) : <RowActionButton label="修改" disabled={busy} onClick={() => actions.editAccount(item)} />}
                  <RowActionButton label="停用" danger disabled={busy} onClick={() => void actions.disable(item)} />
                </>
              )}
            </div>
          ) : <span className="logistics-empty-cell">--</span>}
        </td>
    </tr>
  )
}

function RowActionButton({ label, ariaLabel, danger = false, disabled, onClick }: {
  label: string
  ariaLabel?: string
  danger?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`logistics-row-action${danger ? ' is-danger' : ''}`}
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

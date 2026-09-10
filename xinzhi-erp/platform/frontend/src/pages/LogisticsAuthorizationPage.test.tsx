import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsAuthorizationApi } from '../modules/logisticsAuthorizationApi'
import {
  LogisticsAuthorizationPage,
  parseLogisticsAuthorizationQuery,
  toLogisticsAuthorizationChannelsUrl,
  toLogisticsAuthorizationUrl,
} from './LogisticsAuthorizationPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.authorization.write' }),
}))

vi.mock('../modules/logisticsAuthorizationApi', () => ({
  logisticsAuthorizationApi: {
    listProviders: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    replaceCredentials: vi.fn(),
    probe: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    unbind: vi.fn(),
    listChannels: vi.fn(),
    listEnabledChannels: vi.fn(),
    enableChannel: vi.fn(),
    disableChannel: vi.fn(),
  },
}))

const authorization = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'CUSTOM' as const,
  providerCode: 'CUSTOM' as const,
  providerName: 'UAT 人工物流',
  accountLabel: 'UAT 仓库账号',
  integrationMode: 'MANUAL' as const,
  credentialConfigured: false,
  credentialType: undefined,
  contactName: '仓库组',
  note: 'UAT 闭环',
  status: 'ACTIVE' as const,
  createdByDisplayName: 'UAT ERP Tester',
  version: 0,
  createdAt: '2026-08-10T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
}

const directAuthorization = {
  ...authorization,
  category: 'PLATFORM' as const,
  providerCode: 'BIAOJU' as const,
  providerName: '镖锔科技物流',
  accountLabel: '华南发货账号',
  integrationMode: 'DIRECT_CREDENTIALS' as const,
  credentialConfigured: true,
  credentialType: 'ENCRYPTED' as const,
  status: 'PENDING' as const,
}

beforeEach(() => {
  runtime.search = ''
  runtime.push.mockReset()
  vi.mocked(logisticsAuthorizationApi.listProviders).mockReset().mockResolvedValue([
    { providerCode: 'CHUDA', providerName: '触达物流' },
    { providerCode: 'DAYUNJIA', providerName: '深圳达运佳国际物流' },
    { providerCode: 'BIAOJU', providerName: '镖锔科技物流' },
    { providerCode: 'BAIDU_YIXIA', providerName: '摆渡一下' },
    { providerCode: 'HUALEI', providerName: '华磊' },
    { providerCode: 'TONGXI', providerName: '桐溪供应链' },
    { providerCode: 'JIAYUN_SHENGTU', providerName: '嘉运晟途' },
    { providerCode: 'SHANDIANHOU_XIAOBAO', providerName: '闪电猴（小包）' },
    { providerCode: 'SHANDIANHOU_SHANGPAI', providerName: '闪电猴（商派）' },
  ])
  vi.mocked(logisticsAuthorizationApi.list).mockReset().mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
  vi.mocked(logisticsAuthorizationApi.create).mockReset().mockResolvedValue(directAuthorization)
  vi.mocked(logisticsAuthorizationApi.rename).mockReset().mockResolvedValue({ ...directAuthorization, version: 1 })
  vi.mocked(logisticsAuthorizationApi.replaceCredentials).mockReset().mockResolvedValue({ ...directAuthorization, version: 1 })
  vi.mocked(logisticsAuthorizationApi.probe).mockReset().mockResolvedValue({ authorization: { ...directAuthorization, status: 'ACTIVE', version: 1 }, status: 'CONNECTED', message: '镖锔科技物流连接成功，账号认证通过。' })
  vi.mocked(logisticsAuthorizationApi.disable).mockReset().mockResolvedValue({ ...directAuthorization, status: 'ARCHIVED', version: 1 })
  vi.mocked(logisticsAuthorizationApi.enable).mockReset().mockResolvedValue({ ...directAuthorization, status: 'PENDING', version: 2 })
  vi.mocked(logisticsAuthorizationApi.unbind).mockReset().mockResolvedValue({ id: directAuthorization.id })
  vi.mocked(logisticsAuthorizationApi.listChannels).mockReset().mockResolvedValue([])
  vi.mocked(logisticsAuthorizationApi.listEnabledChannels).mockReset().mockResolvedValue([])
  vi.mocked(logisticsAuthorizationApi.enableChannel).mockReset()
  vi.mocked(logisticsAuthorizationApi.disableChannel).mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('logistics authorization', () => {
  it('keeps only category and keyword in the page URL', () => {
    expect(parseLogisticsAuthorizationQuery('?category=BAD&status=ARCHIVED')).toEqual({ category: 'PLATFORM', name: '' })
    expect(toLogisticsAuthorizationUrl({ category: 'CUSTOM', name: ' UAT ' })).toBe('/logistics/authorizations?category=CUSTOM&name=UAT')
    expect(toLogisticsAuthorizationChannelsUrl(directAuthorization)).toBe(`/logistics/authorizations/${directAuthorization.id}/channels?category=PLATFORM`)
  })

  it('shows only added logistics accounts and keeps the built-in catalog in the add flow', async () => {
    render(<LogisticsAuthorizationPage />)

    expect(await screen.findByRole('table', { name: '物流账号列表' })).toBeTruthy()
    expect(screen.getByText('暂无物流账号')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '状态' })).toBeNull()
    expect(screen.queryByText('触达物流')).toBeNull()
    expect(screen.getByRole('button', { name: '添加物流商' })).toBeTruthy()
  })

  it('shows one row per saved account and supports disable, enable, and unbind', async () => {
    const disabled = { ...directAuthorization, status: 'ARCHIVED' as const, version: 3 }
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [disabled], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    render(<LogisticsAuthorizationPage />)

    const accountRow = (await screen.findByText('华南发货账号')).closest('tr') as HTMLTableRowElement
    expect(within(accountRow).getByText('镖锔科技物流')).toBeTruthy()
    const manageChannels = within(accountRow).getByRole('button', { name: '管理华南发货账号物流渠道' })
    expect(manageChannels.closest('td')).toBe(accountRow.lastElementChild)
    fireEvent.click(manageChannels)
    expect(runtime.push).toHaveBeenCalledWith(`/logistics/authorizations/${disabled.id}/channels?category=PLATFORM`)
    expect(screen.getByText('已停用')).toBeTruthy()
    expect(screen.getByText('已保存')).toBeTruthy()
    expect(screen.queryByText('账号已安全保存')).toBeNull()
    expect(screen.queryByText('BIAOJU')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => expect(logisticsAuthorizationApi.enable).toHaveBeenCalledWith(disabled.id, 3))
    expect(logisticsAuthorizationApi.probe).toHaveBeenCalledWith(disabled.id, 2)

    fireEvent.click(screen.getByRole('button', { name: '解绑' }))
    await waitFor(() => expect(logisticsAuthorizationApi.unbind).toHaveBeenCalledWith(disabled.id, 3))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('保存的账号凭据将被清除'))
  })

  it('searches the built-in provider catalog and creates a named freight account', async () => {
    render(<LogisticsAuthorizationPage />)
    await screen.findByRole('table', { name: '物流账号列表' })
    fireEvent.click(screen.getByRole('button', { name: '添加物流商' }))
    const dialog = within(screen.getByRole('dialog', { name: '添加物流商' }))
    fireEvent.change(dialog.getByLabelText('搜索物流商'), { target: { value: '镖锔' } })
    expect(dialog.queryByRole('option', { name: '触达物流' })).toBeNull()
    fireEvent.click(dialog.getByRole('option', { name: '镖锔科技物流' }))
    expect(dialog.queryByLabelText('物流类型')).toBeNull()
    expect(dialog.queryByLabelText('连接方式')).toBeNull()
    expect(dialog.queryByLabelText('Key（可选）')).toBeNull()
    fireEvent.change(dialog.getByLabelText('货代别名'), { target: { value: ' 华南仓 ' } })
    fireEvent.change(dialog.getByLabelText('账号'), { target: { value: ' api@example.com ' } })
    fireEvent.change(dialog.getByLabelText('密码'), { target: { value: ' secret with spaces ' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存并测试连接' }))
    await waitFor(() => expect(logisticsAuthorizationApi.create).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PLATFORM',
      providerCode: 'BIAOJU',
      providerName: '镖锔科技物流',
      accountLabel: '华南仓',
      credentials: { username: 'api@example.com', password: ' secret with spaces ', key: undefined },
    })))
  })

  it('offers the two Shandianhou interface systems under one searchable brand', async () => {
    render(<LogisticsAuthorizationPage />)
    await screen.findByRole('table', { name: '物流账号列表' })
    fireEvent.click(screen.getByRole('button', { name: '添加物流商' }))
    const dialog = within(screen.getByRole('dialog', { name: '添加物流商' }))
    fireEvent.change(dialog.getByLabelText('搜索物流商'), { target: { value: '闪电猴' } })

    expect(dialog.getByRole('option', { name: '闪电猴（小包）' })).toBeTruthy()
    expect(dialog.getByRole('option', { name: '闪电猴（商派）' })).toBeTruthy()
  })

  it('uses the provider name when the optional freight alias is blank', async () => {
    render(<LogisticsAuthorizationPage />)
    await screen.findByRole('table', { name: '物流账号列表' })
    fireEvent.click(screen.getByRole('button', { name: '添加物流商' }))
    const dialog = within(screen.getByRole('dialog', { name: '添加物流商' }))
    fireEvent.change(dialog.getByLabelText('搜索物流商'), { target: { value: '触达' } })
    fireEvent.click(dialog.getByRole('option', { name: '触达物流' }))
    expect(dialog.getByLabelText('货代别名')).not.toHaveProperty('required', true)
    fireEvent.change(dialog.getByLabelText('账号'), { target: { value: 'T00878' } })
    fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'secret' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存并测试连接' }))
    await waitFor(() => expect(logisticsAuthorizationApi.create).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: 'CHUDA',
      providerName: '触达物流',
      accountLabel: '触达物流',
    })))
  })

  it('requires a freight alias when the same provider already has an account', async () => {
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [directAuthorization], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    render(<LogisticsAuthorizationPage />)
    await screen.findByText('华南发货账号')
    fireEvent.click(screen.getByRole('button', { name: '添加物流商' }))
    const dialog = within(screen.getByRole('dialog', { name: '添加物流商' }))
    fireEvent.change(dialog.getByLabelText('搜索物流商'), { target: { value: '镖锔' } })
    fireEvent.click(dialog.getByRole('option', { name: '镖锔科技物流' }))
    expect(dialog.getByLabelText('货代别名')).toHaveProperty('required', true)
    expect(dialog.getByText('已添加 1 个账号，请填写便于区分的别名。')).toBeTruthy()
  })

  it('sorts flat account rows by freight alias with natural text order', async () => {
    const account2 = { ...directAuthorization, id: '22222222-2222-4222-8222-222222222222', accountLabel: '嘉运10号' }
    const account1 = { ...directAuthorization, id: '33333333-3333-4333-8333-333333333333', accountLabel: '嘉运2号' }
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [account2, account1], page: 0, size: 100, totalElements: 2, totalPages: 1 })
    render(<LogisticsAuthorizationPage />)
    const table = await screen.findByRole('table', { name: '物流账号列表' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('嘉运2号')).toBeTruthy()
    expect(within(rows[1]).getByText('嘉运10号')).toBeTruthy()
  })

  it('updates a disabled account without silently enabling it', async () => {
    const disabled = { ...directAuthorization, status: 'ARCHIVED' as const, version: 4 }
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [disabled], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    vi.mocked(logisticsAuthorizationApi.replaceCredentials).mockResolvedValue({ ...disabled, version: 5 })
    render(<LogisticsAuthorizationPage />)
    await screen.findByText('华南发货账号')
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    const dialog = within(screen.getByRole('dialog', { name: '修改货代账号' }))
    expect(dialog.getByText('修改账号不会自动启用，保存后仍保持停用。')).toBeTruthy()
    fireEvent.change(dialog.getByLabelText('账号（可选）'), { target: { value: ' api@example.com ' } })
    fireEvent.change(dialog.getByLabelText('密码（可选）'), { target: { value: ' new secret ' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(logisticsAuthorizationApi.replaceCredentials).toHaveBeenCalledWith(disabled.id, 4, { username: 'api@example.com', password: ' new secret ', key: undefined }))
    expect(logisticsAuthorizationApi.probe).not.toHaveBeenCalled()
  })

  it('renames a freight account without requiring credentials or reconnecting it', async () => {
    const active = { ...directAuthorization, status: 'ACTIVE' as const, version: 2 }
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [active], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    vi.mocked(logisticsAuthorizationApi.rename).mockResolvedValue({ ...active, accountLabel: '美西仓账号', version: 3 })
    render(<LogisticsAuthorizationPage />)
    await screen.findByText('华南发货账号')
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    const dialog = within(screen.getByRole('dialog', { name: '修改货代账号' }))
    fireEvent.change(dialog.getByLabelText('货代别名'), { target: { value: ' 美西仓账号 ' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(logisticsAuthorizationApi.rename)
      .toHaveBeenCalledWith(active.id, 2, '美西仓账号'))
    expect(logisticsAuthorizationApi.replaceCredentials).not.toHaveBeenCalled()
    expect(logisticsAuthorizationApi.probe).not.toHaveBeenCalled()
    expect(await screen.findByText('货代别名已修改为“美西仓账号”。')).toBeTruthy()
  })

  it('uses the platform-managed logistics provider display name', async () => {
    vi.mocked(logisticsAuthorizationApi.listProviders).mockResolvedValue([
      { providerCode: 'CHUDA', providerName: '触达国际物流' },
      { providerCode: 'DAYUNJIA', providerName: '深圳达运佳国际物流' },
      { providerCode: 'BIAOJU', providerName: '镖锔科技物流' },
      { providerCode: 'BAIDU_YIXIA', providerName: '摆渡一下' },
      { providerCode: 'HUALEI', providerName: '华磊' },
      { providerCode: 'TONGXI', providerName: '桐溪供应链' },
      { providerCode: 'JIAYUN_SHENGTU', providerName: '嘉运晟途' },
      { providerCode: 'SHANDIANHOU_XIAOBAO', providerName: '闪电猴（小包）' },
      { providerCode: 'SHANDIANHOU_SHANGPAI', providerName: '闪电猴（商派）' },
    ])
    render(<LogisticsAuthorizationPage />)
    await screen.findByRole('table', { name: '物流账号列表' })
    fireEvent.click(screen.getByRole('button', { name: '添加物流商' }))
    const dialog = within(screen.getByRole('dialog', { name: '添加物流商' }))
    fireEvent.change(dialog.getByLabelText('搜索物流商'), { target: { value: '触达' } })
    expect(dialog.getByRole('option', { name: '触达国际物流' })).toBeTruthy()
  })

  it('keeps manual providers available outside the platform catalog', async () => {
    runtime.search = '?category=CUSTOM'
    vi.mocked(logisticsAuthorizationApi.list).mockResolvedValue({ items: [authorization], page: 0, size: 100, totalElements: 1, totalPages: 1 })
    render(<LogisticsAuthorizationPage />)
    expect(await screen.findByRole('table', { name: '物流授权列表' })).toBeTruthy()
    expect(screen.getByText('UAT 仓库账号')).toBeTruthy()
    expect(screen.getByText('已启用')).toBeTruthy()
  })
})

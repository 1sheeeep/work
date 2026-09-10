import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsAuthorizationApi, type LogisticsAuthorizationChannel } from '../modules/logisticsAuthorizationApi'
import { LogisticsAuthorizationChannelsPage } from './LogisticsAuthorizationChannelsPage'

const runtime = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.authorization.write' }),
}))

vi.mock('../modules/logisticsAuthorizationApi', () => ({
  logisticsAuthorizationApi: {
    get: vi.fn(),
    listChannels: vi.fn(),
    probe: vi.fn(),
    enableChannel: vi.fn(),
    disableChannel: vi.fn(),
  },
}))

const authorization = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'PLATFORM' as const,
  providerCode: 'BIAOJU' as const,
  providerName: '镖锔科技物流',
  accountLabel: '华南发货账号',
  integrationMode: 'DIRECT_CREDENTIALS' as const,
  credentialConfigured: true,
  credentialType: 'ENCRYPTED' as const,
  contactName: undefined,
  note: undefined,
  status: 'ACTIVE' as const,
  createdByDisplayName: 'UAT ERP Tester',
  version: 2,
  createdAt: '2026-08-10T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
}

function channel(index: number, overrides: Partial<LogisticsAuthorizationChannel> = {}): LogisticsAuthorizationChannel {
  return {
    id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    authorizationId: authorization.id,
    providerCode: 'BIAOJU' as const,
    providerName: authorization.providerName,
    accountLabel: authorization.accountLabel,
    accountStatus: 'ACTIVE' as const,
    channelCode: `CHANNEL-${String(index).padStart(3, '0')}`,
    channelName: `测试渠道 ${index}`,
    enabled: false,
    providerAvailable: true,
    effectiveEnabled: false,
    version: 0,
    lastSyncedAt: '2026-08-11T00:01:00Z',
    updatedAt: '2026-08-11T00:01:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  runtime.push.mockReset()
  vi.mocked(logisticsAuthorizationApi.get).mockReset().mockResolvedValue(authorization)
  vi.mocked(logisticsAuthorizationApi.listChannels).mockReset().mockResolvedValue([])
  vi.mocked(logisticsAuthorizationApi.probe).mockReset()
  vi.mocked(logisticsAuthorizationApi.enableChannel).mockReset()
  vi.mocked(logisticsAuthorizationApi.disableChannel).mockReset()
})

afterEach(() => cleanup())

describe('logistics authorization channels workspace', () => {
  it('renders as a dedicated page and enables a synced channel', async () => {
    const disabledChannel = channel(1, { channelName: '美国专线' })
    vi.mocked(logisticsAuthorizationApi.listChannels).mockResolvedValue([disabledChannel])
    vi.mocked(logisticsAuthorizationApi.enableChannel).mockResolvedValue({
      ...disabledChannel,
      enabled: true,
      effectiveEnabled: true,
      version: 1,
    })

    render(<LogisticsAuthorizationChannelsPage authorizationId={authorization.id} />)

    const table = await screen.findByRole('table', { name: '华南发货账号渠道列表' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: '物流渠道' })).toBeTruthy()
    fireEvent.click(within(table).getByRole('button', { name: '启用' }))

    await waitFor(() => expect(logisticsAuthorizationApi.enableChannel)
      .toHaveBeenCalledWith(authorization.id, disabledChannel.id, 0))
    expect(await within(table).findByText('已启用')).toBeTruthy()
  })

  it('keeps the workspace open and refreshes the channel catalog after syncing', async () => {
    const beforeSync = channel(1, { channelName: '同步前渠道' })
    const afterSync = channel(2, { channelName: '同步后渠道' })
    vi.mocked(logisticsAuthorizationApi.listChannels)
      .mockResolvedValueOnce([beforeSync])
      .mockResolvedValueOnce([afterSync])
    vi.mocked(logisticsAuthorizationApi.probe).mockResolvedValue({
      authorization: { ...authorization, version: 3 },
      status: 'CONNECTED',
      message: '渠道同步成功。',
    })

    render(<LogisticsAuthorizationChannelsPage authorizationId={authorization.id} />)
    expect(await screen.findByText('同步前渠道')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '同步渠道' }))

    await waitFor(() => expect(logisticsAuthorizationApi.probe).toHaveBeenCalledWith(authorization.id, 2))
    expect(await screen.findByText('同步后渠道')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '物流渠道' })).toBeTruthy()
  })

  it('searches, filters, paginates, and returns to the account list', async () => {
    const channels = Array.from({ length: 60 }, (_, index) => channel(index + 1, {
      channelName: index === 59 ? '唯一匹配渠道' : `测试渠道 ${index + 1}`,
      enabled: index === 0,
      effectiveEnabled: index === 0,
    }))
    vi.mocked(logisticsAuthorizationApi.listChannels).mockResolvedValue(channels)

    render(<LogisticsAuthorizationChannelsPage authorizationId={authorization.id} />)
    expect(await screen.findByText('第 1 / 2 页')).toBeTruthy()
    expect(screen.getByText('显示 1-50，共 60 条')).toBeTruthy()
    expect(screen.queryByText('唯一匹配渠道')).toBeNull()

    fireEvent.change(screen.getByLabelText('搜索渠道'), { target: { value: '唯一匹配' } })
    expect(await screen.findByText('唯一匹配渠道')).toBeTruthy()
    expect(screen.getByText('显示 1-1，共 1 条')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('启用状态'), { target: { value: 'ENABLED' } })
    expect(await screen.findByText('没有匹配的渠道，请调整搜索条件。')).toBeTruthy()

    const backButton = screen.getByRole('button', { name: '返回物流授权' })
    expect(backButton.className).toContain('button-secondary')
    fireEvent.click(backButton)
    expect(runtime.push).toHaveBeenCalledWith('/logistics/authorizations')
  })
})

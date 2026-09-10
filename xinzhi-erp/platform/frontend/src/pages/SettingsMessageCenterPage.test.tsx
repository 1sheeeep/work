import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsMessageCenterPage, parseSettingsMessageQuery, toSettingsMessageUrl } from './SettingsMessageCenterPage'

const runtime = vi.hoisted(() => ({ search: '', history: { push: vi.fn() } }))
const messageApi = vi.hoisted(() => ({ list: vi.fn(), markRead: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: runtime.history }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }) }))
vi.mock('../modules/settingsMessageApi', () => ({ settingsMessageApi: messageApi }))

const unread = { id: 'a7920000-0000-4000-8000-000000000091', title: '仓库交接公告', content: '请在交班前完成订单复核。', type: 'INTERNAL_NOTICE', pinned: true, createdByDisplayName: '仓库管理员', publishedAt: '2026-08-10T01:00:00Z', read: false, readAt: undefined }

beforeEach(() => {
  runtime.search = ''; runtime.history.push.mockReset(); messageApi.list.mockReset().mockResolvedValue({ items: [unread], page: 0, size: 25, totalElements: 1, totalPages: 1 }); messageApi.markRead.mockReset().mockResolvedValue(1)
})
afterEach(cleanup)

describe('SettingsMessageCenterPage', () => {
  it('parses bounded filters and serializes the live route', () => {
    expect(parseSettingsMessageQuery('?startDate=2026-08-01&endDate=bad&type=OTHER&readState=UNREAD&page=-1&size=500')).toEqual({ startDate: '2026-08-01', endDate: '', type: '', readState: 'UNREAD', page: 0, size: 25 })
    expect(toSettingsMessageUrl({ type: 'INTERNAL_NOTICE', readState: 'READ' })).toBe('/settings/tasks/messages?type=INTERNAL_NOTICE&readState=READ')
  })

  it('loads messages and marks a selected unread message', async () => {
    render(<SettingsMessageCenterPage />)
    expect(await screen.findByText(/仓库交接公告/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 仓库交接公告' }))
    fireEvent.click(screen.getByRole('button', { name: '批量标记已读' }))
    await waitFor(() => expect(messageApi.markRead).toHaveBeenCalledWith([unread.id]))
    await waitFor(() => expect(messageApi.list).toHaveBeenCalledTimes(2))
  })

  it('searches by real message type and read state', async () => {
    render(<SettingsMessageCenterPage />); await screen.findByText(/仓库交接公告/)
    fireEvent.change(screen.getByLabelText('消息类型'), { target: { value: 'INTERNAL_NOTICE' } })
    fireEvent.change(screen.getByLabelText('阅读状态'), { target: { value: 'UNREAD' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.history.push).toHaveBeenCalledWith('/settings/tasks/messages?type=INTERNAL_NOTICE&readState=UNREAD')
  })
})

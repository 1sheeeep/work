import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { settingsMessageApi } from './settingsMessageApi'

vi.mock('../api/client', async (source) => {
  const actual = await source<typeof import('../api/client')>()
  return { ...actual, apiClient: { request: vi.fn() } }
})

const message = {
  id: 'a7920000-0000-4000-8000-000000000091', title: '仓库交接公告',
  content: '请在交班前完成订单复核。', type: 'INTERNAL_NOTICE', pinned: true,
  createdByDisplayName: '仓库管理员', publishedAt: '2026-08-10T01:00:00Z',
  read: false, readAt: null,
}

describe('settingsMessageApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('lists validated message-center records', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [message], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await settingsMessageApi.list({ startDate: '2026-08-01', type: 'INTERNAL_NOTICE', readState: 'UNREAD', page: 0, size: 25 })
    expect(result.items[0]?.read).toBe(false)
    expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('readState=UNREAD'), expect.any(Object))
  })

  it('marks unique messages read', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ markedRead: 1 })
    await expect(settingsMessageApi.markRead([message.id])).resolves.toBe(1)
    expect(apiClient.request).toHaveBeenCalledWith('/api/v1/settings/messages/mark-read', expect.objectContaining({ method: 'POST', body: { messageIds: [message.id] } }))
  })

  it('rejects inconsistent read state and duplicate identifiers', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ ...message, read: true, readAt: null })
    await expect(settingsMessageApi.markRead([message.id, message.id])).rejects.toMatchObject({ status: 400 })
    expect(apiClient.request).not.toHaveBeenCalled()
  })
})

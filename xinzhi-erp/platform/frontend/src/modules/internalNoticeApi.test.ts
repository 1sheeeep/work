import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { internalNoticeApi } from './internalNoticeApi'

vi.mock('../api/client', async (source) => {
  const actual = await source<typeof import('../api/client')>()
  return { ...actual, apiClient: { request: vi.fn() } }
})

const notice = {
  id: 'a7910000-0000-4000-8000-000000000091', title: '仓库交接公告',
  content: '请在交班前完成订单复核。', pinned: true, status: 'ACTIVE',
  publishedAt: '2026-08-10T01:00:00Z', archivedAt: null,
  createdByDisplayName: '仓库管理员', version: 0,
  createdAt: '2026-08-10T01:00:00Z', updatedAt: '2026-08-10T01:00:00Z',
}

describe('internalNoticeApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('lists validated notices with filters', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [notice], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await internalNoticeApi.list({ title: '交接', status: 'ACTIVE', pinned: true, page: 0, size: 25 })
    expect(result.items[0]?.title).toBe('仓库交接公告')
    expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('pinned=true'), expect.any(Object))
  })

  it('creates and changes notice state with request identifiers', async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(notice).mockResolvedValueOnce({ ...notice, pinned: false, version: 1 }).mockResolvedValueOnce({ ...notice, pinned: false, status: 'ARCHIVED', archivedAt: '2026-08-10T02:00:00Z', version: 2 })
    await internalNoticeApi.create({ title: notice.title, content: notice.content, pinned: true })
    await internalNoticeApi.setPinned(notice.id, 0, false)
    await internalNoticeApi.transition(notice.id, 1, 'ARCHIVED')
    expect(apiClient.request).toHaveBeenNthCalledWith(1, '/api/v1/settings/internal-notices', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Request-Id': expect.stringMatching(/^settings-notice\./) }) }))
  })

  it('rejects inconsistent archived responses', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ ...notice, status: 'ARCHIVED', archivedAt: null })
    await expect(internalNoticeApi.transition(notice.id, 0, 'ARCHIVED')).rejects.toMatchObject({ status: 502 })
  })

  it('validates batch identities', async () => {
    await expect(internalNoticeApi.archiveBatch([{ id: notice.id, version: 0 }, { id: notice.id, version: 0 }])).rejects.toMatchObject({ status: 400 })
    expect(apiClient.request).not.toHaveBeenCalled()
  })
})

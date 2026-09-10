import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { settingsTransferTaskApi } from './settingsTransferTaskApi'

vi.mock('../api/client', async (source) => {
  const actual = await source<typeof import('../api/client')>()
  return { ...actual, apiClient: { request: vi.fn() } }
})

const task = {
  id: 'a7930000-0000-4000-8000-000000000001', jobType: 'EXPORT', status: 'SUCCEEDED',
  filename: 'orders-uat.csv', createdByDisplayName: '仓库操作员', requestedCount: 2,
  succeededCount: 2, failedCount: 0, safeErrorSummary: null, resultAvailable: true, resultSizeBytes: 128,
  createdAt: '2026-08-10T01:00:00Z', completedAt: '2026-08-10T01:00:01Z',
}

describe('settingsTransferTaskApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('lists validated transfer task records', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [task], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await settingsTransferTaskApi.list({ jobType: 'EXPORT', status: 'SUCCEEDED', keyword: 'orders', resultAvailable: true, page: 0, size: 25 })
    expect(result.items[0]?.resultAvailable).toBe(true)
    expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('jobType=EXPORT&status=SUCCEEDED'), expect.any(Object))
    expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('keyword=orders&resultAvailable=true'), expect.any(Object))
  })

  it('accepts the unified all-task filter', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [task, { ...task, id: 'a7930000-0000-4000-8000-000000000002', jobType: 'IMPORT', resultAvailable: false, resultSizeBytes: 0 }], page: 0, size: 25, totalElements: 2, totalPages: 1 })
    await expect(settingsTransferTaskApi.list({ jobType: 'ALL', status: 'ALL', page: 0, size: 25 })).resolves.toMatchObject({ totalElements: 2 })
  })

  it('downloads only a validated task result', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ filename: 'orders-uat.csv', mediaType: 'text/csv', contentBase64: 'YQ==' })
    await expect(settingsTransferTaskApi.result(task.id)).resolves.toEqual({ filename: 'orders-uat.csv', mediaType: 'text/csv', contentBase64: 'YQ==' })
    expect(apiClient.request).toHaveBeenCalledWith(`/api/v1/settings/transfer-tasks/${task.id}/result`)
  })

  it('rejects cross-type rows and malformed task identifiers', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [{ ...task, jobType: 'IMPORT', resultAvailable: false, resultSizeBytes: 0 }], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    await expect(settingsTransferTaskApi.list({ jobType: 'EXPORT', status: 'ALL', page: 0, size: 25 })).rejects.toMatchObject({ status: 502 })
    await expect(settingsTransferTaskApi.result('bad')).rejects.toMatchObject({ status: 400 })
  })
})

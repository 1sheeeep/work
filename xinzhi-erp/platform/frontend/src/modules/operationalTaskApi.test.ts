import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../api/client'
import { operationalTaskApi } from './operationalTaskApi'

vi.mock('../api/client', async (source) => {
  const actual = await source<typeof import('../api/client')>()
  return { ...actual, apiClient: { request: vi.fn() } }
})

const task = {
  id: 'a7890000-0000-4000-8000-000000000090', taskNo: 'TASK-20260810-A1B2C3',
  title: '核对 UAT 订单', category: '运营任务', taskObject: 'ORDER-100',
  urgency: 'URGENT', assigneeName: 'UAT Tester', description: null,
  status: 'PENDING', completedAt: null, createdByDisplayName: 'UAT Tester', version: 0,
  createdAt: '2026-08-10T01:00:00Z', updatedAt: '2026-08-10T01:00:00Z',
}

describe('operationalTaskApi', () => {
  beforeEach(() => vi.mocked(apiClient.request).mockReset())

  it('lists validated tenant tasks with filters', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ items: [task], page: 0, size: 25, totalElements: 1, totalPages: 1 })
    const result = await operationalTaskApi.list({ searchBy: 'TASK_NO', keyword: 'A1B2', status: 'PENDING', page: 0, size: 25 })
    expect(result.items[0]?.taskNo).toBe('TASK-20260810-A1B2C3')
    expect(apiClient.request).toHaveBeenCalledWith(expect.stringContaining('searchBy=TASK_NO'), expect.any(Object))
  })

  it('creates and transitions tasks with request identifiers', async () => {
    vi.mocked(apiClient.request).mockResolvedValueOnce(task).mockResolvedValueOnce({ ...task, status: 'IN_PROGRESS', version: 1 })
    await operationalTaskApi.create({ title: task.title, category: task.category, taskObject: task.taskObject, urgency: 'URGENT', assigneeName: task.assigneeName })
    await operationalTaskApi.transition(task.id, 0, 'IN_PROGRESS')
    expect(apiClient.request).toHaveBeenNthCalledWith(1, '/api/v1/settings/tasks', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Request-Id': expect.stringMatching(/^settings-task\./) }) }))
    expect(apiClient.request).toHaveBeenNthCalledWith(2, `/api/v1/settings/tasks/${task.id}/status`, expect.objectContaining({ body: { version: 0, status: 'IN_PROGRESS' } }))
  })

  it('rejects inconsistent lifecycle responses', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ ...task, status: 'COMPLETED', completedAt: null })
    await expect(operationalTaskApi.transition(task.id, 0, 'COMPLETED')).rejects.toMatchObject({ status: 502 })
  })

  it('validates export contracts', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ filename: 'operational-tasks.csv', mediaType: 'text/csv;charset=utf-8', rowCount: 0, content: '\uFEFF\"任务编号\",\"任务标题\",\"分类\"\r\n' })
    const result = await operationalTaskApi.exportCsv({ searchBy: 'TITLE' })
    expect(result.rowCount).toBe(0)
  })
})

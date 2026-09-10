import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsTransferTasksPage, parseSettingsTransferTaskQuery, toSettingsTransferTaskUrl } from './SettingsTransferTasksPage'

const runtime = vi.hoisted(() => ({ search: '', history: { push: vi.fn() } }))
const transferApi = vi.hoisted(() => ({ list: vi.fn(), result: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: runtime.history }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }) }))
vi.mock('../modules/settingsTransferTaskApi', () => ({ settingsTransferTaskApi: transferApi }))

const task = {
  id: 'a7930000-0000-4000-8000-000000000001', jobType: 'EXPORT', status: 'SUCCEEDED',
  filename: 'orders-uat.csv', createdByDisplayName: '仓库操作员', requestedCount: 2,
  succeededCount: 2, failedCount: 0, safeErrorSummary: undefined, resultAvailable: true, resultSizeBytes: 128,
  createdAt: '2026-08-10T01:00:00Z', completedAt: '2026-08-10T01:00:01Z',
}

beforeEach(() => {
  runtime.search = ''; runtime.history.push.mockReset()
  transferApi.list.mockReset().mockResolvedValue({ items: [task], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  transferApi.result.mockReset().mockResolvedValue({ filename: task.filename, mediaType: 'text/csv', contentBase64: 'YQ==' })
  URL.createObjectURL = vi.fn(() => 'blob:transfer-result'); URL.revokeObjectURL = vi.fn()
  HTMLAnchorElement.prototype.click = vi.fn()
})
afterEach(cleanup)

describe('SettingsTransferTasksPage', () => {
  it('parses bounded filters and keeps the live route', () => {
    expect(parseSettingsTransferTaskQuery('?jobType=IMPORT&status=FAILED&startDate=2026-08-01&page=-1&size=500')).toEqual({ jobType: 'IMPORT', status: 'FAILED', startDate: '2026-08-01', endDate: '', page: 0, size: 25 })
    expect(toSettingsTransferTaskUrl({ jobType: 'IMPORT', status: 'FAILED' })).toBe('/settings/tasks/import-export?jobType=IMPORT&status=FAILED')
  })

  it('loads a real export task and downloads its persisted result', async () => {
    render(<SettingsTransferTasksPage />)
    const table = await screen.findByRole('table', { name: '导入导出任务列表' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(10)
    expect(screen.getByText('orders-uat.csv')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下载结果' }))
    await waitFor(() => expect(transferApi.result).toHaveBeenCalledWith(task.id))
    expect(await screen.findByText('已下载 orders-uat.csv。')).toBeTruthy()
  })

  it('switches task type and searches by real status', async () => {
    render(<SettingsTransferTasksPage />); await screen.findByText('orders-uat.csv')
    fireEvent.click(screen.getByRole('tab', { name: '导入任务' }))
    expect(runtime.history.push).toHaveBeenCalledWith('/settings/tasks/import-export?jobType=IMPORT')
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'SUCCEEDED' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.history.push).toHaveBeenCalledWith('/settings/tasks/import-export?status=SUCCEEDED')
  })
})

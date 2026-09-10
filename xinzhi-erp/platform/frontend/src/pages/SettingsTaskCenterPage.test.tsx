import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsTaskCenterPage, parseSettingsTaskCenterQuery, toSettingsTaskCenterUrl } from './SettingsTaskCenterPage'

const runtime = vi.hoisted(() => ({ search: '', history: { push: vi.fn() } }))
const transferApi = vi.hoisted(() => ({ list: vi.fn(), result: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: runtime.history }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../modules/settingsTransferTaskApi', () => ({ settingsTransferTaskApi: transferApi }))

const exportTask = {
  id: 'a7930000-0000-4000-8000-000000000001', jobType: 'EXPORT', status: 'SUCCEEDED',
  filename: 'orders-uat.csv', createdByDisplayName: 'UAT ERP Tester', requestedCount: 3,
  succeededCount: 3, failedCount: 0, safeErrorSummary: undefined,
  resultAvailable: true, resultSizeBytes: 1019,
  createdAt: '2026-08-10T03:11:24Z', completedAt: '2026-08-10T03:11:24Z',
}
const importTask = {
  ...exportTask, id: 'a7930000-0000-4000-8000-000000000002', jobType: 'IMPORT',
  filename: 'uat-orders-import.csv', requestedCount: 1, succeededCount: 1,
  resultAvailable: false, resultSizeBytes: 0,
}

beforeEach(() => {
  runtime.search = ''
  runtime.history.push.mockReset()
  transferApi.list.mockReset().mockResolvedValue({ items: [importTask, exportTask], page: 0, size: 25, totalElements: 2, totalPages: 1 })
  transferApi.result.mockReset().mockResolvedValue({ filename: exportTask.filename, mediaType: 'text/csv', contentBase64: 'YQ==' })
  URL.createObjectURL = vi.fn(() => 'blob:task-center')
  URL.revokeObjectURL = vi.fn()
  HTMLAnchorElement.prototype.click = vi.fn()
})
afterEach(cleanup)

describe('SettingsTaskCenterPage', () => {
  it('parses bounded filters and builds the live route', () => {
    expect(parseSettingsTaskCenterQuery('?jobType=IMPORT&status=FAILED&keyword=%20uat%20&page=-1&size=500')).toEqual({ jobType: 'IMPORT', status: 'FAILED', keyword: 'uat', startDate: '', endDate: '', page: 0, size: 25 })
    expect(toSettingsTaskCenterUrl({ jobType: 'EXPORT', status: 'SUCCEEDED', keyword: 'orders' })).toBe('/settings/tasks/center?jobType=EXPORT&status=SUCCEEDED&keyword=orders')
  })

  it('lists mixed real tasks and shows a closable detail dialog', async () => {
    render(<SettingsTaskCenterPage />)
    const table = await screen.findByRole('table', { name: '任务中心列表' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8)
    expect(screen.getByText('uat-orders-import.csv')).toBeTruthy()
    expect(transferApi.list).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'ALL', status: 'ALL' }))
    fireEvent.click(screen.getAllByRole('button', { name: '查看详情' })[1]!)
    const dialog = screen.getByRole('dialog', { name: 'orders-uat.csv' })
    expect(within(dialog).getAllByText('3')).toHaveLength(2)
    expect(within(dialog).getByRole('button', { name: '下载结果' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭任务详情' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('downloads an export result and switches to import tasks', async () => {
    render(<SettingsTaskCenterPage />)
    await screen.findByText('orders-uat.csv')
    fireEvent.click(screen.getAllByRole('button', { name: '查看详情' })[1]!)
    fireEvent.click(screen.getByRole('button', { name: '下载结果' }))
    await waitFor(() => expect(transferApi.result).toHaveBeenCalledWith(exportTask.id))
    expect(await screen.findByText('已下载 orders-uat.csv。')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '导入任务' }))
    expect(runtime.history.push).toHaveBeenCalledWith('/settings/tasks/center?jobType=IMPORT')
  })
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsAttachmentDownloadsPage, parseSettingsAttachmentQuery, toSettingsAttachmentUrl } from './SettingsAttachmentDownloadsPage'

const runtime = vi.hoisted(() => ({ search: '', history: { push: vi.fn() } }))
const transferApi = vi.hoisted(() => ({ list: vi.fn(), result: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: runtime.history }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../modules/settingsTransferTaskApi', () => ({ settingsTransferTaskApi: transferApi }))

const task = {
  id: 'a7930000-0000-4000-8000-000000000001', jobType: 'EXPORT', status: 'SUCCEEDED',
  filename: 'orders-uat.csv', createdByDisplayName: 'UAT ERP Tester', requestedCount: 3,
  succeededCount: 3, failedCount: 0, safeErrorSummary: undefined,
  resultAvailable: true, resultSizeBytes: 1019,
  createdAt: '2026-08-10T03:11:24Z', completedAt: '2026-08-10T03:11:24Z',
}

beforeEach(() => {
  runtime.search = ''
  runtime.history.push.mockReset()
  transferApi.list.mockReset().mockResolvedValue({ items: [task], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  transferApi.result.mockReset().mockResolvedValue({ filename: task.filename, mediaType: 'text/csv', contentBase64: 'YQ==' })
  URL.createObjectURL = vi.fn(() => 'blob:attachment')
  URL.revokeObjectURL = vi.fn()
  HTMLAnchorElement.prototype.click = vi.fn()
})
afterEach(cleanup)

describe('SettingsAttachmentDownloadsPage', () => {
  it('parses bounded filters and keeps the live route', () => {
    expect(parseSettingsAttachmentQuery('?keyword=%20orders%20&startDate=2026-08-01&page=-1&size=500')).toEqual({ keyword: 'orders', startDate: '2026-08-01', endDate: '', page: 0, size: 25 })
    expect(toSettingsAttachmentUrl({ keyword: 'orders', page: 2 })).toBe('/settings/tasks/attachments?keyword=orders&page=2')
  })

  it('lists only downloadable exports and downloads the persisted file', async () => {
    render(<SettingsAttachmentDownloadsPage />)
    const table = await screen.findByRole('table', { name: '附件下载列表' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7)
    expect(screen.getByText('orders-uat.csv')).toBeTruthy()
    expect(screen.getByText('1019 B')).toBeTruthy()
    expect(transferApi.list).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'EXPORT', status: 'SUCCEEDED', resultAvailable: true }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(transferApi.result).toHaveBeenCalledWith(task.id))
    expect(await screen.findByText('已下载 orders-uat.csv。')).toBeTruthy()
  })

  it('searches by filename and rejects an inverted date range', async () => {
    render(<SettingsAttachmentDownloadsPage />)
    await screen.findByText('orders-uat.csv')
    fireEvent.change(screen.getByPlaceholderText('输入文件名'), { target: { value: ' orders ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.history.push).toHaveBeenCalledWith('/settings/tasks/attachments?keyword=orders')
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-11' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-10' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(screen.getByRole('status').textContent).toContain('开始日期不能晚于结束日期')
  })
})

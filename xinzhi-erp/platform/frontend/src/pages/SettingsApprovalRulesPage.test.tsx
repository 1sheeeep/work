import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsApprovalRulesPage, parseApprovalRuleQuery } from './SettingsApprovalRulesPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
const api = vi.hoisted(() => ({
  list: vi.fn(),
  candidates: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => unknown }) =>
    select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/approvalRuleApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/approvalRuleApi')>()
  return { ...actual, approvalRuleApi: api }
})

const reviewerA = { userId: 'a9900000-0000-4000-8000-000000000002', displayName: '管理员' }
const reviewerB = { userId: 'a9900000-0000-4000-8000-000000000003', displayName: 'UAT ERP Tester' }
const rule = {
  id: 'a9900000-0000-4000-8000-000000000010',
  priority: 2,
  name: '采购单复核',
  documentType: 'PROCUREMENT_ORDER' as const,
  description: '采购单提交后按顺序复核',
  enabled: true,
  approvers: [
    { ...reviewerB, stepOrder: 1 },
    { ...reviewerA, stepOrder: 2 },
  ],
  version: 3,
  createdByDisplayName: 'ERP System Administrator',
  updatedByDisplayName: 'ERP System Administrator',
  createdAt: '2026-08-10T09:00:00Z',
  updatedAt: '2026-08-10T09:00:00Z',
}

beforeEach(() => {
  runtime.search = ''
  runtime.push.mockReset()
  api.list.mockReset().mockResolvedValue({
    items: [rule], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  api.candidates.mockReset().mockResolvedValue([reviewerA, reviewerB])
  api.create.mockReset().mockResolvedValue(rule)
  api.update.mockReset().mockResolvedValue(rule)
  api.setEnabled.mockReset().mockResolvedValue({ ...rule, enabled: false, version: 4 })
  api.remove.mockReset().mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('SettingsApprovalRulesPage', () => {
  it('loads the eight-column contract and applies safe filters', async () => {
    expect(parseApprovalRuleQuery('?enabled=true&documentType=PROCUREMENT_ORDER&page=-1&size=50'))
      .toEqual({ enabled: true, documentType: 'PROCUREMENT_ORDER', keyword: undefined, page: 0, size: 50 })
    render(<SettingsApprovalRulesPage />)
    const table = await screen.findByRole('table', { name: '审批规则' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8)
    expect(screen.getByText('采购单复核')).toBeTruthy()
    expect(screen.getByText('UAT ERP Tester → 管理员')).toBeTruthy()
  })

  it('creates a rule with explicitly ordered approvers', async () => {
    render(<SettingsApprovalRulesPage />)
    await screen.findByText('采购单复核')
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增审批规则' }))
    fireEvent.change(dialog.getByLabelText('规则名称'), { target: { value: '采购单终审' } })
    fireEvent.change(dialog.getByLabelText('备注'), { target: { value: '采购单提交后复核' } })
    fireEvent.change(dialog.getByLabelText('待添加审批人'), { target: { value: reviewerA.userId } })
    fireEvent.click(dialog.getByRole('button', { name: '添加' }))
    fireEvent.change(dialog.getByLabelText('待添加审批人'), { target: { value: reviewerB.userId } })
    fireEvent.click(dialog.getByRole('button', { name: '添加' }))
    fireEvent.click(within(dialog.getByText('UAT ERP Tester').closest('li')!).getByRole('button', { name: '上移' }))
    fireEvent.click(dialog.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      name: '采购单终审',
      description: '采购单提交后复核',
      approverUserIds: [reviewerB.userId, reviewerA.userId],
    })))
    expect(await screen.findByText('审批规则已新增。')).toBeTruthy()
  })

  it('persists status and deletion actions through the API', async () => {
    render(<SettingsApprovalRulesPage />)
    await screen.findByText('采购单复核')
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith(rule.id, 3, false))

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const dialog = within(screen.getByRole('alertdialog', { name: '删除审批规则' }))
    fireEvent.click(dialog.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(rule.id, 3))
  })
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { labelTemplateApi, type LabelTemplate } from '../modules/labelTemplateApi'
import { LogisticsLabelTemplatePage, parseLabelTemplateQuery, toLabelTemplateUrl } from './LogisticsLabelTemplatePage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.label_template.write' }),
}))
vi.mock('../modules/labelTemplateApi', () => ({
  labelTemplateApi: { list: vi.fn(), create: vi.fn(), archive: vi.fn() },
}))

const standard: LabelTemplate = {
  id: '84000000-0000-4000-8000-000000000001',
  scope: 'STANDARD',
  name: '通用地址标签',
  documentCategory: '地址标签',
  widthMm: 100,
  heightMm: 100,
  content: '收件人：{{recipient}}',
  status: 'ACTIVE',
  createdByDisplayName: '系统内置',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const custom: LabelTemplate = {
  ...standard,
  id: '11111111-1111-4111-8111-111111111111',
  scope: 'CUSTOM',
  name: 'UAT 地址标签',
  createdByDisplayName: 'UAT ERP Tester',
}

beforeEach(() => {
  runtime.search = ''
  runtime.push.mockReset()
  vi.mocked(labelTemplateApi.list).mockReset().mockResolvedValue({ items: [standard], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  vi.mocked(labelTemplateApi.create).mockReset().mockResolvedValue(custom)
  vi.mocked(labelTemplateApi.archive).mockReset().mockResolvedValue({ ...custom, status: 'ARCHIVED' })
})

afterEach(cleanup)

describe('logistics label templates', () => {
  it('bounds query values and serializes filters', () => {
    expect(parseLabelTemplateQuery(`?scope=OTHER&keyword=${'A'.repeat(140)}&size=${'1'.repeat(50)}`)).toEqual({
      scope: 'STANDARD', documentCategory: '', size: '1'.repeat(40), keyword: 'A'.repeat(120),
    })
    expect(toLabelTemplateUrl({ scope: 'CUSTOM', documentCategory: ' 地址标签 ', size: ' 100×100 mm ' }))
      .toBe('/logistics/label-templates?scope=CUSTOM&documentCategory=%E5%9C%B0%E5%9D%80%E6%A0%87%E7%AD%BE&size=100%C3%97100+mm')
  })

  it('loads and previews a standard template', async () => {
    render(<LogisticsLabelTemplatePage />)
    expect(await screen.findByText('通用地址标签')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.getByRole('dialog', { name: '标签预览' })).toBeTruthy()
    expect(screen.getByText('收件人：{{recipient}}')).toBeTruthy()
  })

  it('creates a custom template through the write API', async () => {
    runtime.search = '?scope=CUSTOM'
    vi.mocked(labelTemplateApi.list).mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
    render(<LogisticsLabelTemplatePage />)
    await screen.findByText('暂无标签模板')
    fireEvent.click(screen.getByRole('button', { name: '新增自定义模板' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增自定义模板' }))
    fireEvent.change(dialog.getByLabelText('模板名称'), { target: { value: ' UAT 地址标签 ' } })
    fireEvent.change(dialog.getByLabelText('单据类别'), { target: { value: ' 地址标签 ' } })
    fireEvent.change(dialog.getByLabelText('标签内容'), { target: { value: ' 收件人：{{recipient}} ' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(labelTemplateApi.create).toHaveBeenCalledWith({
      name: 'UAT 地址标签', documentCategory: '地址标签', widthMm: 100, heightMm: 100,
      content: '收件人：{{recipient}}', note: undefined,
    }))
  })
})

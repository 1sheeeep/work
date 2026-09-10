import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsOrderExceptionConfigPage } from './SettingsOrderExceptionConfigPage'

const categoryApi = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'settings.parameter.write' }),
}))
vi.mock('../modules/orderExceptionCategoryApi', () => ({ orderExceptionCategoryApi: categoryApi }))

const initial = {
  configured: true,
  revision: 2,
  updatedByDisplayName: 'UAT Operator',
  createdAt: '2026-08-10T08:00:00Z',
  updatedAt: '2026-08-10T08:00:00Z',
  items: [{
    id: 'a9800000-0000-4000-8000-000000000001',
    name: '地址信息待确认',
    handlingGuidance: '联系客户核对收件地址',
    enabled: true,
    sortOrder: 0,
    createdAt: '2026-08-10T08:00:00Z',
    updatedAt: '2026-08-10T08:00:00Z',
  }],
}

beforeEach(() => {
  categoryApi.get.mockReset().mockResolvedValue(initial)
  categoryApi.save.mockReset().mockImplementation(async (_revision, items) => ({
    ...initial,
    revision: 3,
    items: items.map((item: Record<string, unknown>, index: number) => ({
      ...item,
      id: item.id ?? `a9800000-0000-4000-8000-00000000000${index + 2}`,
      sortOrder: index,
      createdAt: initial.createdAt,
      updatedAt: initial.updatedAt,
    })),
  }))
})
afterEach(cleanup)

describe('SettingsOrderExceptionConfigPage', () => {
  it('loads, adds, orders and saves real category drafts', async () => {
    render(<SettingsOrderExceptionConfigPage />)
    expect(await screen.findByDisplayValue('地址信息待确认')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增自定义异常分类' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(3)
    fireEvent.change(screen.getByRole('textbox', { name: '第 2 项分类名称' }), {
      target: { value: '库存待确认' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '第 2 项处理指引' }), {
      target: { value: '核对可用库存' },
    })
    fireEvent.click(within(rows[2]).getByRole('button', { name: '上移' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(categoryApi.save).toHaveBeenCalledWith(2, [
      { id: undefined, name: '库存待确认', handlingGuidance: '核对可用库存', enabled: true },
      { id: initial.items[0].id, name: '地址信息待确认', handlingGuidance: '联系客户核对收件地址', enabled: true },
    ]))
    expect(await screen.findByText('已保存 2 个异常分类。')).toBeTruthy()
  })

  it('blocks duplicate names before calling the API', async () => {
    render(<SettingsOrderExceptionConfigPage />)
    await screen.findByDisplayValue('地址信息待确认')
    fireEvent.click(screen.getByRole('button', { name: '新增自定义异常分类' }))
    fireEvent.change(screen.getByRole('textbox', { name: '第 2 项分类名称' }), {
      target: { value: '地址信息待确认' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect((await screen.findByRole('alert')).textContent).toContain('确保名称不重复')
    expect(categoryApi.save).not.toHaveBeenCalled()
  })
})

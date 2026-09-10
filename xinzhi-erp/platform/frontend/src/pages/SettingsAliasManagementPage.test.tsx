import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsAliasManagementPage, parseShopAliasQuery, toShopAliasUrl } from './SettingsAliasManagementPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => unknown }) =>
    select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/shopAliasApi', () => ({ shopAliasApi: api }))

const alias = {
  shopId: '97000000-0000-4000-8000-000000000001',
  shopDisplayName: 'Original Shopify Shop', platformCode: 'SHOPIFY',
  aliasZhCn: '测试店铺', configured: true, version: 2,
  updatedByDisplayName: 'UAT Operator', updatedAt: '2026-08-10T07:00:00Z',
}

beforeEach(() => {
  runtime.search = ''
  runtime.push.mockReset()
  api.list.mockReset().mockResolvedValue({
    items: [alias], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  api.save.mockReset().mockResolvedValue({ ...alias, aliasEn: 'Test Shop', version: 3 })
})
afterEach(cleanup)

describe('SettingsAliasManagementPage', () => {
  it('sanitizes filters and preserves the thirteen-field contract', async () => {
    expect(parseShopAliasQuery('?keyword=%20shop%20&page=-1&size=50'))
      .toEqual({ keyword: 'shop', page: 0, size: 50 })
    expect(toShopAliasUrl({ keyword: 'shop', page: 1, size: 50 }))
      .toBe('/settings/parameters/aliases?keyword=shop&page=1&size=50')
    render(<SettingsAliasManagementPage />)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(13)
    expect(screen.getByText('测试店铺')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('店铺或别名'), { target: { value: ' alias ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.push).toHaveBeenCalledWith('/settings/parameters/aliases?keyword=alias')
  })

  it('saves multilingual aliases and supports clearing a language', async () => {
    render(<SettingsAliasManagementPage />)
    await screen.findByText('测试店铺')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = within(screen.getByRole('dialog', { name: '编辑店铺别名' }))
    fireEvent.change(dialog.getByLabelText('英文'), { target: { value: 'Test Shop' } })
    fireEvent.change(dialog.getByLabelText('中文'), { target: { value: '' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存别名' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(alias.shopId, 2,
      expect.objectContaining({ aliasEn: 'Test Shop', aliasZhCn: undefined })))
  })
})

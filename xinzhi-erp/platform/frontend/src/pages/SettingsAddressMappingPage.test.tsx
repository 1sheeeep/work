import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsAddressMappingPage, parseAddressMappingQuery, toAddressMappingUrl } from './SettingsAddressMappingPage'

const push = vi.fn()
const api = vi.hoisted(() => ({
  getSetting: vi.fn(), saveSetting: vi.fn(), list: vi.fn(),
  create: vi.fn(), update: vi.fn(), remove: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => unknown }) =>
    select({ location: { searchStr: '' } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))
vi.mock('../modules/addressMappingApi', () => ({ addressMappingApi: api }))

const setting = {
  configured: true, enabled: false, version: 2,
  updatedByDisplayName: 'UAT Operator',
  createdAt: '2026-08-10T06:00:00Z', updatedAt: '2026-08-10T06:00:00Z',
}
const mapping = {
  id: 'a9600000-0000-4000-8000-000000000001',
  platform: 'SHOPIFY' as const, countryCode: 'JP', addressType: 'PROVINCE' as const,
  sourceValue: 'Tōkyō', mappedValue: '東京都', enabled: true, version: 0,
  updatedByDisplayName: 'UAT Operator',
  createdAt: '2026-08-10T06:00:00Z', updatedAt: '2026-08-10T06:00:00Z',
}

beforeEach(() => {
  push.mockReset()
  api.getSetting.mockReset().mockResolvedValue(setting)
  api.saveSetting.mockReset().mockResolvedValue({ ...setting, enabled: true, version: 3 })
  api.list.mockReset().mockResolvedValue({
    items: [mapping], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  api.create.mockReset().mockResolvedValue(mapping)
  api.update.mockReset().mockResolvedValue({ ...mapping, mappedValue: '東京都港区', version: 1 })
  api.remove.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('SettingsAddressMappingPage', () => {
  it('sanitizes filters and creates stable URLs', () => {
    expect(parseAddressMappingQuery('?platform=OTHER&countryCode=jp&addressType=CITY&keyword=%20Tokyo%20&page=-2&size=100')).toEqual({
      platform: undefined, countryCode: 'JP', addressType: 'CITY',
      keyword: 'Tokyo', page: 0, size: 100,
    })
    expect(toAddressMappingUrl({ platform: 'SHOPIFY', countryCode: 'JP', page: 1, size: 50 }))
      .toBe('/settings/parameters/address-mappings?platform=SHOPIFY&countryCode=JP&page=1&size=50')
  })

  it('loads mappings, saves the switch and keeps success feedback visible', async () => {
    render(<SettingsAddressMappingPage />)
    expect(await screen.findByText('Tōkyō')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '启用地址映射' }))
    fireEvent.click(screen.getByRole('button', { name: '保存开关' }))
    await waitFor(() => expect(api.saveSetting).toHaveBeenCalledWith(2, true))
    expect(await screen.findByText('地址自动转换已启用。')).toBeTruthy()
  })

  it('creates, edits and deletes a mapping through real dialogs', async () => {
    render(<SettingsAddressMappingPage />)
    expect(await screen.findByText('Tōkyō')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新增映射' }))
    let dialog = within(screen.getByRole('dialog', { name: '新增地址映射' }))
    fireEvent.change(dialog.getByLabelText('国家代码'), { target: { value: 'jp' } })
    fireEvent.change(dialog.getByLabelText('平台原始信息'), { target: { value: 'Tōkyō' } })
    fireEvent.change(dialog.getByLabelText('转换后地址信息'), { target: { value: '東京都' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存映射' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      countryCode: 'jp', sourceValue: 'Tōkyō', mappedValue: '東京都', enabled: true,
    })))

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    dialog = within(screen.getByRole('dialog', { name: '编辑地址映射' }))
    fireEvent.change(dialog.getByLabelText('转换后地址信息'), { target: { value: '東京都港区' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存映射' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(mapping.id, 0,
      expect.objectContaining({ mappedValue: '東京都港区' })))

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const alert = within(screen.getByRole('alertdialog', { name: '删除地址映射' }))
    fireEvent.click(alert.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(mapping.id, 0))
  })
})

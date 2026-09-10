import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsDeclarationEntityApi } from '../modules/logisticsDeclarationEntityApi'
import {
  LogisticsDeclarationEntityPage,
  parseDeclarationEntityQuery,
  toDeclarationEntityUrl,
} from './LogisticsDeclarationEntityPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn(), canWrite: true }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => runtime.canWrite }),
}))
vi.mock('../modules/logisticsDeclarationEntityApi', () => ({
  logisticsDeclarationEntityApi: {
    list: vi.fn(), shopOptions: vi.fn(), detail: vi.fn(), create: vi.fn(),
    update: vi.fn(), archive: vi.fn(),
  },
}))

const shop = {
  shopId: '79000000-0000-4000-8000-000000000011', shopName: 'Shop A',
  shopStatus: 'ACTIVE', platformCode: 'SHOPIFY', platformName: 'Shopify',
}
const item = {
  id: '79000000-0000-4000-8000-000000000001', name: '新知生产销售企业',
  enterpriseCode: 'CN-91310000ABC', shops: [shop], status: 'ACTIVE' as const,
  version: 0, createdAt: '2026-08-07T00:00:00Z',
  updatedAt: '2026-08-07T00:00:00Z',
}
const option = {
  id: shop.shopId, name: shop.shopName, status: shop.shopStatus,
  platformCode: shop.platformCode, platformName: shop.platformName,
}

beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset(); runtime.canWrite = true
  vi.mocked(logisticsDeclarationEntityApi.list).mockReset().mockResolvedValue({
    items: [item], page: 0, size: 25, totalElements: 1, totalPages: 1,
  })
  vi.mocked(logisticsDeclarationEntityApi.shopOptions).mockReset().mockResolvedValue({
    items: [option], page: 0, size: 100, totalElements: 1, totalPages: 1,
  })
  vi.mocked(logisticsDeclarationEntityApi.detail).mockReset().mockResolvedValue(item)
  vi.mocked(logisticsDeclarationEntityApi.create).mockReset().mockResolvedValue(item)
  vi.mocked(logisticsDeclarationEntityApi.update).mockReset().mockResolvedValue(item)
  vi.mocked(logisticsDeclarationEntityApi.archive).mockReset().mockResolvedValue({
    ...item, status: 'ARCHIVED', version: 1,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('logistics declaration entity management', () => {
  it('bounds URL state and rejects unknown values', () => {
    expect(parseDeclarationEntityQuery(`?searchField=OTHER&status=FAILED&page=-2&keyword=${'A'.repeat(140)}`))
      .toEqual({ searchField: 'NAME', status: 'ACTIVE', keyword: 'A'.repeat(120), page: 0 })
    expect(toDeclarationEntityUrl({
      searchField: 'SHOP', status: 'ARCHIVED', keyword: ' 店铺 A ', page: 2,
    })).toBe('/logistics/declaration-entities?searchField=SHOP&status=ARCHIVED&keyword=%E5%BA%97%E9%93%BA+A&page=2')
  })

  it('loads bindings and writes confirmed filters to the URL', async () => {
    render(<LogisticsDeclarationEntityPage />)
    expect(await screen.findByText('新知生产销售企业')).toBeTruthy()
    expect(screen.getByText('Shopify · Shop A')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜索字段'), { target: { value: 'CODE' } })
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'ALL' } })
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: ' CODE-1 ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(runtime.push).toHaveBeenCalledWith('/logistics/declaration-entities?searchField=CODE&status=ALL&keyword=CODE-1')
  })

  it('creates an entity with searchable shop selection and clear feedback', async () => {
    render(<LogisticsDeclarationEntityPage />)
    await screen.findByText('新知生产销售企业')
    fireEvent.click(screen.getByRole('button', { name: '新增企业信息' }))
    const form = screen.getByRole('form', { name: '新增企业申报信息' })
    fireEvent.change(within(form).getByLabelText('生产销售企业名称'), { target: { value: ' 深圳生产企业 ' } })
    fireEvent.change(within(form).getByLabelText('生产销售企业编码'), { target: { value: 'cn-shenzhen-1' } })
    const checkbox = await within(form).findByRole('checkbox', { name: 'Shopify · Shop A' })
    fireEvent.click(checkbox)
    fireEvent.click(within(form).getByRole('button', { name: '保存企业信息' }))
    await waitFor(() => expect(logisticsDeclarationEntityApi.create).toHaveBeenCalledWith({
      name: '深圳生产企业', enterpriseCode: 'CN-SHENZHEN-1', shopIds: [shop.shopId],
    }))
    expect(await screen.findByText('企业“深圳生产企业”已创建。')).toBeTruthy()
  })

  it('loads detail for editing, confirms archive, and respects write permission', async () => {
    const { unmount } = render(<LogisticsDeclarationEntityPage />)
    await screen.findByText('新知生产销售企业')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByDisplayValue('CN-91310000ABC')).toBeTruthy()
    expect(logisticsDeclarationEntityApi.detail).toHaveBeenCalledWith(item.id)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(logisticsDeclarationEntityApi.archive).toHaveBeenCalledWith(item.id, 0))
    expect(window.confirm).toHaveBeenCalled()
    unmount(); runtime.canWrite = false
    render(<LogisticsDeclarationEntityPage />)
    await screen.findByText('新知生产销售企业')
    expect(screen.queryByRole('button', { name: '新增企业信息' })).toBeNull()
  })
})

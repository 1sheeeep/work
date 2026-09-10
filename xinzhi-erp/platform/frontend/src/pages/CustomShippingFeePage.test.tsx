import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shippingFeeApi } from '../modules/shippingFeeApi'
import { CustomShippingFeePage, parseCustomShippingFeeQuery, toCustomShippingFeeUrl } from './CustomShippingFeePage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: { push: runtime.push } }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }) }))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.shipping_fee.write' }) }))
vi.mock('../modules/shippingFeeApi', () => ({ shippingFeeApi: { regions: vi.fn(), rules: vi.fn(), createRegion: vi.fn(), createRule: vi.fn(), archiveRegion: vi.fn(), archiveRule: vi.fn(), estimate: vi.fn() } }))

const region = { id: '11111111-1111-4111-8111-111111111111', name: '美国西部', countryCode: 'US', city: 'Los Angeles', postalCodePrefix: '90', status: 'ACTIVE' as const, createdByDisplayName: 'UAT ERP Tester', version: 0, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z' }
const rule = { id: '22222222-2222-4222-8222-222222222222', regionId: region.id, regionName: region.name, countryCode: 'US', name: '标准小包', minimumWeightGrams: 0, maximumWeightGrams: 2000, baseFeeMinor: 1000, perKilogramFeeMinor: 500, otherFeeMinor: 100, currencyCode: 'USD', status: 'ACTIVE' as const, createdByDisplayName: 'UAT ERP Tester', version: 0, createdAt: '2026-08-10T00:00:00Z', updatedAt: '2026-08-10T00:00:00Z' }

beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset()
  vi.mocked(shippingFeeApi.regions).mockReset().mockResolvedValue({ items: [region], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  vi.mocked(shippingFeeApi.rules).mockReset().mockResolvedValue({ items: [rule], page: 0, size: 100, totalElements: 1, totalPages: 1 })
  vi.mocked(shippingFeeApi.createRegion).mockReset().mockResolvedValue(region)
  vi.mocked(shippingFeeApi.createRule).mockReset().mockResolvedValue(rule)
  vi.mocked(shippingFeeApi.archiveRegion).mockReset().mockResolvedValue({ ...region, status: 'ARCHIVED' })
  vi.mocked(shippingFeeApi.archiveRule).mockReset().mockResolvedValue({ ...rule, status: 'ARCHIVED' })
  vi.mocked(shippingFeeApi.estimate).mockReset().mockResolvedValue([{ regionId: region.id, regionName: region.name, ruleId: rule.id, ruleName: rule.name, actualWeightGrams: 800, volumetricWeightGrams: 1200, chargeableWeightGrams: 1200, shippingFeeMinor: 1600, otherFeeMinor: 100, totalFeeMinor: 1700, currencyCode: 'USD' }])
})
afterEach(cleanup)

describe('custom shipping fee page', () => {
  it('bounds query values and serializes estimate inputs', () => {
    expect(parseCustomShippingFeeQuery(`?view=OTHER&status=BAD&regionName=${'A'.repeat(120)}&weightGrams=-1&weighingMode=OTHER`)).toEqual(expect.objectContaining({ view: 'REGIONS', status: 'ALL', regionName: 'A'.repeat(100), weightGrams: '', weighingMode: 'ACTUAL' }))
    expect(toCustomShippingFeeUrl({ view: 'ESTIMATE', country: 'US', weightGrams: '120.5', weighingMode: 'MAXIMUM' })).toBe('/logistics/custom-fees?view=ESTIMATE&country=US&weightGrams=120.5&weighingMode=MAXIMUM')
  })

  it('loads regions and creates a persisted region', async () => {
    render(<CustomShippingFeePage />)
    expect(await screen.findByText('美国西部')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增区域' }))
    const dialog = within(screen.getByRole('dialog', { name: '新增区域' }))
    fireEvent.change(dialog.getByLabelText('区域名称'), { target: { value: ' 加拿大 ' } })
    fireEvent.change(dialog.getByLabelText('国家 / 地区代码'), { target: { value: 'ca' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存区域' }))
    await waitFor(() => expect(shippingFeeApi.createRegion).toHaveBeenCalledWith({ name: '加拿大', countryCode: 'CA', city: undefined, postalCodePrefix: undefined, note: undefined }))
  })

  it('calculates a real estimate and formats currency', async () => {
    runtime.search = '?view=ESTIMATE'
    render(<CustomShippingFeePage />)
    fireEvent.change(screen.getByLabelText('目的国代码'), { target: { value: 'US' } })
    fireEvent.change(screen.getByLabelText('实际重量（g）'), { target: { value: '800' } })
    fireEvent.change(screen.getByLabelText('长（mm）'), { target: { value: '300' } })
    fireEvent.change(screen.getByLabelText('宽（mm）'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('高（mm）'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('计重方式'), { target: { value: 'MAXIMUM' } })
    fireEvent.click(screen.getByRole('button', { name: '运费试算' }))
    expect(await screen.findByText('US$17.00')).toBeTruthy()
    expect(shippingFeeApi.estimate).toHaveBeenCalledWith(expect.objectContaining({ countryCode: 'US', weightGrams: 800, lengthMm: 300, widthMm: 200, heightMm: 100, volumetricDivisor: 5000, weighingMode: 'MAXIMUM' }))
  })
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logisticsInquiryApi } from '../modules/logisticsInquiryApi'
import { LogisticsInquiryPage, parseLogisticsInquiryQuery, toLogisticsInquiryUrl } from './LogisticsInquiryPage'

const runtime = vi.hoisted(() => ({ search: '', push: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}))
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: (permission: string) => permission === 'logistics.inquiry.write' }) }))
vi.mock('../modules/logisticsInquiryApi', () => ({ logisticsInquiryApi: { list: vi.fn(), detail: vi.fn(), contact: vi.fn(), saveContact: vi.fn(), create: vi.fn(), update: vi.fn(), transition: vi.fn(), addQuote: vi.fn(), withdrawQuote: vi.fn() } }))

const inquiry = {
  id: '11111111-1111-4111-8111-111111111111', inquiryNo: 'LI-20260810-ABC123', origin: '中国深圳', destination: '美国本土',
  weeklyOrderCount: 120, weeklyWeightKg: 360.5, category: '服装', contactName: 'UAT 联系人', contactPhone: '+86 138 0000 0000',
  status: 'BIDDING' as const, note: 'UAT 询价', activeQuoteCount: 0, publishedAt: '2026-08-10T01:00:00Z',
  createdByDisplayName: 'UAT ERP Tester', version: 0, createdAt: '2026-08-10T01:00:00Z', updatedAt: '2026-08-10T01:00:00Z',
}
const quote = {
  id: '22222222-2222-4222-8222-222222222222', inquiryId: inquiry.id, providerName: 'UAT 承运商', serviceName: '标准专线',
  pricePerKg: 4.8, currency: 'USD', transitDays: 8, note: undefined, status: 'ACTIVE' as const,
  createdByDisplayName: 'UAT ERP Tester', version: 0, createdAt: '2026-08-10T02:00:00Z', updatedAt: '2026-08-10T02:00:00Z',
}

beforeEach(() => {
  runtime.search = ''; runtime.push.mockReset()
  vi.mocked(logisticsInquiryApi.list).mockReset().mockResolvedValue({ items: [inquiry], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  vi.mocked(logisticsInquiryApi.contact).mockReset().mockResolvedValue({ contactName: inquiry.contactName, contactPhone: inquiry.contactPhone, version: 0, updatedAt: inquiry.updatedAt })
  vi.mocked(logisticsInquiryApi.saveContact).mockReset().mockResolvedValue({ contactName: inquiry.contactName, contactPhone: inquiry.contactPhone, version: 1, updatedAt: inquiry.updatedAt })
  vi.mocked(logisticsInquiryApi.create).mockReset().mockResolvedValue(inquiry)
  vi.mocked(logisticsInquiryApi.update).mockReset().mockResolvedValue({ ...inquiry, version: 1 })
  vi.mocked(logisticsInquiryApi.transition).mockReset().mockResolvedValue({ ...inquiry, status: 'PAUSED', version: 1 })
  vi.mocked(logisticsInquiryApi.detail).mockReset().mockResolvedValue({ inquiry, quotes: [quote] })
  vi.mocked(logisticsInquiryApi.addQuote).mockReset().mockResolvedValue({ inquiry: { ...inquiry, activeQuoteCount: 1 }, quotes: [quote] })
  vi.mocked(logisticsInquiryApi.withdrawQuote).mockReset().mockResolvedValue({ inquiry: { ...inquiry, activeQuoteCount: 0 }, quotes: [{ ...quote, status: 'WITHDRAWN', version: 1 }] })
})
afterEach(cleanup)

describe('logistics inquiry workflow', () => {
  it('bounds and serializes supported filters', () => {
    expect(parseLogisticsInquiryQuery(`?view=OTHER&status=UNKNOWN&country=${'A'.repeat(120)}&publishedFrom=2026-99-99`)).toEqual({ view: 'MY_INQUIRIES', status: 'ALL', country: 'A'.repeat(100), publishedFrom: '', publishedTo: '', page: 0, size: 25 })
    expect(toLogisticsInquiryUrl({ view: 'MARKET', status: 'BIDDING', country: ' US ', publishedFrom: '2026-08-01', size: 50 })).toBe('/logistics/inquiries?view=MARKET&country=US&publishedFrom=2026-08-01&size=50')
  })

  it('loads records and publishes a real inquiry', async () => {
    render(<LogisticsInquiryPage />)
    expect(await screen.findByText(inquiry.inquiryNo)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '发布物流需求' }))
    const dialog = within(await screen.findByRole('dialog', { name: '发布物流需求' }))
    fireEvent.change(dialog.getByLabelText('起运地'), { target: { value: '中国深圳' } })
    fireEvent.change(dialog.getByLabelText('运送范围'), { target: { value: '美国本土' } })
    fireEvent.change(dialog.getByLabelText('每周订单数'), { target: { value: '120' } })
    fireEvent.change(dialog.getByLabelText('每周重量（kg）'), { target: { value: '360.5' } })
    fireEvent.change(dialog.getByLabelText('品类'), { target: { value: '服装' } })
    fireEvent.click(dialog.getByRole('button', { name: '发布需求' }))
    await waitFor(() => expect(logisticsInquiryApi.create).toHaveBeenCalledWith(expect.objectContaining({ origin: '中国深圳', destination: '美国本土', weeklyOrderCount: 120, weeklyWeightKg: 360.5, contactName: inquiry.contactName })))
  })

  it('uses an in-app dialog for status transitions', async () => {
    render(<LogisticsInquiryPage />); await screen.findByText(inquiry.inquiryNo)
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    const dialog = within(screen.getByRole('alertdialog', { name: '已暂停询价' }))
    expect(dialog.getByText(`询价单 ${inquiry.inquiryNo}`)).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(logisticsInquiryApi.transition).toHaveBeenCalledWith(inquiry.id, 0, 'PAUSED'))
  })

  it('shows saved quotes and can register a new quote', async () => {
    render(<LogisticsInquiryPage />); await screen.findByText(inquiry.inquiryNo)
    fireEvent.click(screen.getByRole('button', { name: '查看报价' }))
    const dialog = within(await screen.findByRole('dialog', { name: `询价与报价 · ${inquiry.inquiryNo}` }))
    expect(dialog.getByText('UAT 承运商')).toBeTruthy()
    fireEvent.change(dialog.getByLabelText('承运商'), { target: { value: '新承运商' } })
    fireEvent.change(dialog.getByLabelText('服务方案'), { target: { value: '空运专线' } })
    fireEvent.change(dialog.getByLabelText('每公斤报价'), { target: { value: '5.2' } })
    fireEvent.change(dialog.getByLabelText('预计时效（天）'), { target: { value: '6' } })
    fireEvent.click(dialog.getByRole('button', { name: '登记报价' }))
    await waitFor(() => expect(logisticsInquiryApi.addQuote).toHaveBeenCalledWith(inquiry.id, expect.objectContaining({ providerName: '新承运商', pricePerKg: 5.2, currency: 'USD', transitDays: 6 })))
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerServiceWorkspace } from './CustomerServiceWorkspace'
import type { CustomerServiceApi, DisputeCatalogPage, ReturnCatalogPage, ReturnRefundPreview } from './contracts'

const shop = { id: '22222222-2222-4222-8222-222222222222', displayName: '测试店铺' }
const amount = { shopMoney: { amount: '39.99', currencyCode: 'USD' }, presentmentMoney: { amount: '39.99', currencyCode: 'USD' } }
afterEach(cleanup)
const returnPage: ReturnCatalogPage = {
  state: 'CONNECTED', pageInfo: { hasNextPage: false }, fetchedAt: '2026-08-06T10:00:00Z',
  returns: [{
    id: 'gid://shopify/Return/10', name: '#R1', orderId: 'gid://shopify/Order/11', orderName: '#1001', status: 'OPEN',
    createdAt: '2026-08-06T09:00:00Z', totalQuantity: 1,
    lineItems: [{
      id: 'gid://shopify/ReturnLineItem/20', fulfillmentLineId: 'gid://shopify/FulfillmentLineItem/21', orderLineId: 'gid://shopify/LineItem/22',
      name: '测试商品', sku: 'SKU-1', quantity: 1, processableQuantity: 1, processedQuantity: 0, refundableQuantity: 1, refundedQuantity: 0,
      duties: [{ id: 'gid://shopify/Duty/40', price: { ...amount, shopMoney: { amount: '4.00', currencyCode: 'USD' }, presentmentMoney: { amount: '4.00', currencyCode: 'USD' } } }],
    }],
  }],
}
const preview: ReturnRefundPreview = {
  returnId: 'gid://shopify/Return/10', lineItems: [{ returnLineId: 'gid://shopify/ReturnLineItem/20', quantity: 1 }],
  refundShipping: true, refundDuties: [{ dutyId: 'gid://shopify/Duty/40', refundType: 'PROPORTIONAL' }],
  state: 'REFUNDABLE', refundAmount: amount, maximumRefundable: amount,
  shippingAmount: { ...amount, shopMoney: { amount: '10.00', currencyCode: 'USD' }, presentmentMoney: { amount: '10.00', currencyCode: 'USD' } },
  dutyAmount: { ...amount, shopMoney: { amount: '4.00', currencyCode: 'USD' }, presentmentMoney: { amount: '4.00', currencyCode: 'USD' } },
  previewToken: 'signed-preview-token-01234567890123456789', expiresAt: '2026-08-06T10:10:00Z', fetchedAt: '2026-08-06T10:00:00Z',
}

function api(overrides: Partial<CustomerServiceApi> = {}): CustomerServiceApi {
  return {
    listReturns: vi.fn().mockResolvedValue(returnPage),
    decideReturn: vi.fn(),
    previewReturnRefund: vi.fn().mockResolvedValue(preview),
    processReturnRefund: vi.fn().mockResolvedValue({ returnId: returnPage.returns[0].id, returnStatus: 'CLOSED', outcome: 'APPLIED', refundAmount: amount, recoveredFromShopify: false, updatedAt: '2026-08-06T10:01:00Z' }),
    listDisputes: vi.fn().mockResolvedValue({ state: 'CONNECTED', disputes: [], pageInfo: { hasNextPage: false } }),
    ...overrides,
  }
}

describe('CustomerServiceWorkspace', () => {
  it('previews and processes refund selections without accepting client money', async () => {
    const service = api()
    render(<CustomerServiceWorkspace api={service} shops={[shop]} capabilities={{ manageReturns: true, readDisputes: true }} confirmAction={() => true} />)
    expect(await screen.findByText('测试商品')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('退款数量'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/关税/), { target: { value: 'PROPORTIONAL' } })
    fireEvent.click(screen.getByLabelText('全额退还可退运费'))
    fireEvent.click(screen.getByRole('button', { name: '预览退款' }))
    await waitFor(() => expect(service.previewReturnRefund).toHaveBeenCalledTimes(1))
    const previewInput = vi.mocked(service.previewReturnRefund).mock.calls[0][0]
    expect(previewInput).toMatchObject({ refundShipping: true, refundDuties: [{ dutyId: 'gid://shopify/Duty/40', refundType: 'PROPORTIONAL' }] })
    expect(previewInput).not.toHaveProperty('refundAmount')
    fireEvent.click(await screen.findByRole('button', { name: '确认退款' }))
    await waitFor(() => expect(service.processReturnRefund).toHaveBeenCalledTimes(1))
    expect(vi.mocked(service.processReturnRefund).mock.calls[0][0]).toMatchObject({ previewToken: preview.previewToken, refundShipping: true })
  })

  it('shows dispute metadata without exposing evidence actions', async () => {
    const disputes: DisputeCatalogPage = {
      state: 'CONNECTED', pageInfo: { hasNextPage: false }, fetchedAt: '2026-08-06T10:00:00Z',
      disputes: [{ id: 'gid://shopify/ShopifyPaymentsDispute/10', orderName: '#1001', status: 'NEEDS_RESPONSE', type: 'CHARGEBACK', reason: 'fraudulent', amount: { amount: '39.99', currencyCode: 'USD' }, initiatedAt: '2026-08-05T10:00:00Z', evidenceDueBy: '2026-08-08T10:00:00Z' }],
    }
    const service = api({ listDisputes: vi.fn().mockResolvedValue(disputes) })
    render(<CustomerServiceWorkspace api={service} shops={[shop]} capabilities={{ manageReturns: true, readDisputes: true }} initialView="disputes" />)
    expect(await screen.findByText('#1001')).toBeTruthy()
    expect(screen.getByText(/证据材料的查看、编辑和提交请在 Shopify Admin 中完成/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /证据/ })).toBeNull()
  })
})

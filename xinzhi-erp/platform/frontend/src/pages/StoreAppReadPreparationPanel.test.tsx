import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { storeAppReadPreparationApi, type PreparationStatus, type PreparationOrders } from '../modules/storeAppReadPreparationApi'
import { StoreAppReadPreparationPanel } from './StoreAppReadPreparationPanel'

const SHOP = '22222222-2222-4222-8222-222222222222'
const status = (): PreparationStatus => ({ readOnly: true, productionReady: false, bindingVersion: 7,
  snapshot: { mode: 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY', shopify: { status: 'CONNECTED', shopName: 'Synthetic shop', shopDomain: 'synthetic-preparation.myshopify.com', updatedAt: '2026-09-06T01:02:03Z' }, shopifyScopes: [{ scope: 'read_orders', status: 'GRANTED' }] } })
const orders = (): PreparationOrders => ({ readOnly: true, productionReady: false, bindingVersion: 7,
  page: { mode: 'CUSTOMER_SERVICE_STORE_APP_READ_ONLY', connectionStatus: 'CONNECTED', fetchedAt: '2026-09-06T01:02:03Z', hasNextPage: false,
    orders: [{ externalOrderRef: 'gid://shopify/Order/123', name: '#SYNTHETIC-123', createdAt: '2026-09-05T01:02:03Z' }] } })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Store app read preparation panel', () => {
  it('does not contact a provider on mount and offers no write or switch action', () => {
    const check = vi.spyOn(storeAppReadPreparationApi, 'status')
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    expect(check).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button').map(x => x.textContent)).toEqual(['核验候选授权', '只读预览订单'])
    expect(screen.getByText('只读核验 · 未切换')).toBeTruthy()
  })
  it('checks live status before preview, displays sample and never calls import', async () => {
    const check = vi.spyOn(storeAppReadPreparationApi, 'status').mockResolvedValue(status())
    const read = vi.spyOn(storeAppReadPreparationApi, 'orders').mockResolvedValue(orders())
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    fireEvent.click(screen.getByRole('button', { name: '只读预览订单' }))
    expect(await screen.findByText('#SYNTHETIC-123')).toBeTruthy()
    expect(screen.getByText('候选授权已核验，尚未切换')).toBeTruthy()
    expect(screen.getByText('本页返回 1 条订单；这不是全量同步或正式接入验收。')).toBeTruthy()
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0])
  })
  it('hides order preview without order-read authority', () => {
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders={false} />)
    expect(screen.queryByRole('button', { name: '只读预览订单' })).toBeNull()
  })
  it('clears previous successful evidence after a later failure and redacts errors', async () => {
    vi.spyOn(storeAppReadPreparationApi, 'status').mockResolvedValueOnce(status()).mockRejectedValueOnce(new Error('secret-do-not-show'))
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    fireEvent.click(screen.getByRole('button', { name: '核验候选授权' }))
    await screen.findByText('候选授权已核验，尚未切换')
    fireEvent.click(screen.getByRole('button', { name: '核验候选授权' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('候选授权已核验，尚未切换')).toBeNull()
    expect(document.body.textContent).not.toContain('secret-do-not-show')
  })
  it('does not label an unenabled channel as a revoked shop authorization', async () => {
    vi.spyOn(storeAppReadPreparationApi, 'status').mockRejectedValue(new ApiError('do-not-show', { status: 404 }))
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    fireEvent.click(screen.getByRole('button', { name: '核验候选授权' }))
    expect(await screen.findByText('准备通道尚未启用。当前店铺仍按原方式使用。')).toBeTruthy()
  })
  it('rejects a binding version changed between status and order reads', async () => {
    vi.spyOn(storeAppReadPreparationApi, 'status').mockResolvedValue(status())
    vi.spyOn(storeAppReadPreparationApi, 'orders').mockResolvedValue({ ...orders(), bindingVersion: 8 })
    render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    fireEvent.click(screen.getByRole('button', { name: '只读预览订单' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('#SYNTHETIC-123')).toBeNull()
  })
  it('discards delayed results from the previous shop', async () => {
    let complete!: (value: PreparationStatus) => void
    vi.spyOn(storeAppReadPreparationApi, 'status').mockReturnValue(new Promise(resolve => { complete = resolve }))
    const view = render(<StoreAppReadPreparationPanel shopId={SHOP} canReadOrders />)
    fireEvent.click(screen.getByRole('button', { name: '核验候选授权' }))
    expect((screen.getByRole('button', { name: '只读预览订单' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<StoreAppReadPreparationPanel shopId="33333333-3333-4333-8333-333333333333" canReadOrders />)
    await act(async () => complete(status()))
    await waitFor(() => expect(screen.queryByText('候选授权已核验，尚未切换')).toBeNull())
  })
})

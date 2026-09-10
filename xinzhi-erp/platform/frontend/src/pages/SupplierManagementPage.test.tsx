import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supplierApi } from '../modules/supplierApi'
import { supplierSkuMappingApi } from '../modules/supplierSkuMappingApi'
import { SupplierManagementPage } from './SupplierManagementPage'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }))

const supplier = {
  id: '97000000-0000-4000-8000-000000000031', businessCode: 'SUP_ONE', name: '华东工厂', status: 'ACTIVE' as const,
  contactName: '陈经理', contactPhone: '13800000000', contactEmail: 'buyer@example.com', address: '上海', taxRegistrationNumber: 'TAX-01', settlementCurrency: 'CNY', paymentTermsDays: 30, notes: null,
  createdAt: '2026-08-14T10:00:00Z', updatedAt: '2026-08-14T10:00:00Z', version: 1,
}

beforeEach(() => {
  vi.spyOn(supplierApi, 'list').mockResolvedValue({ items: [supplier], page: 0, size: 25, totalElements: 1, totalPages: 1 })
  vi.spyOn(supplierSkuMappingApi, 'list').mockResolvedValue({ items: [], page: 0, size: 100, totalElements: 0, totalPages: 0 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('SupplierManagementPage', () => {
  it('shows supplier master data and opens the sourcing relationship workbench', async () => {
    render(<SupplierManagementPage />)
    expect(screen.getByRole('heading', { name: '供应商' })).toBeTruthy()
    expect(await screen.findByText('SUP_ONE')).toBeTruthy()
    expect(screen.getByText('30 天账期')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看 / 供货关系' }))
    expect(await screen.findByRole('heading', { name: 'SKU 供货关系' })).toBeTruthy()
    await waitFor(() => expect(supplierSkuMappingApi.list).toHaveBeenCalledWith(supplier.id, expect.objectContaining({ page: 0, size: 100 })))
    expect(screen.getByText('新增后，采购单即可选择此供应商。')).toBeTruthy()
  })

  it('opens grouped supplier creation fields', async () => {
    render(<SupplierManagementPage />)
    await screen.findByText('SUP_ONE')
    fireEvent.click(screen.getByRole('button', { name: '新增供应商' }))
    expect(screen.getByRole('heading', { name: '新增供应商' })).toBeTruthy()
    expect(screen.getAllByText('联系人').length).toBeGreaterThan(0)
    expect(screen.getByText('结算与税务')).toBeTruthy()
  })
})

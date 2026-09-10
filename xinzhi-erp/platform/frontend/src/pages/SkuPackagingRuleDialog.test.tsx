import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductSku } from '../modules/productCenterApi'
import { shippingConfigurationApi } from '../modules/shippingConfigurationApi'
import { SkuPackagingRuleDialog } from './SkuPackagingRuleDialog'

const sku = {
  id: '11111111-1111-4111-8111-111111111111',
  businessCode: 'SKU_RED_M',
  name: '红色中码',
} as unknown as ProductSku
const template = {
  id: '22222222-2222-4222-8222-222222222222',
  businessCode: 'BOX_S',
  name: '小号纸箱',
  packagingType: 'BOX' as const,
  standardWeightGrams: 50,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  status: 'ACTIVE' as const,
  version: 1,
  updatedAt: '2026-08-07T08:00:00Z',
}
const rule = {
  id: '33333333-3333-4333-8333-333333333333',
  skuId: sku.id,
  minQuantity: 1,
  maxQuantity: 5,
  packagingTemplateId: template.id,
  packagingCode: template.businessCode,
  packagingName: template.name,
  status: 'ACTIVE' as const,
  version: 1,
  updatedAt: '2026-08-07T08:00:00Z',
}

beforeEach(() => {
  vi.spyOn(shippingConfigurationApi, 'listRules').mockResolvedValue([rule])
  vi.spyOn(shippingConfigurationApi, 'listTemplates').mockResolvedValue([
    template,
  ])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SkuPackagingRuleDialog', () => {
  it('loads rules for read-only users without exposing mutations', async () => {
    render(
      <SkuPackagingRuleDialog sku={sku} canWrite={false} onClose={vi.fn()} />,
    )
    expect(await screen.findByRole('dialog', { name: sku.businessCode })).toBeTruthy()
    expect(screen.getByText('1–5')).toBeTruthy()
    expect(screen.getByText(template.businessCode)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增规则' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
  })

  it('creates a non-overlapping rule with integer quantity bounds', async () => {
    const createRule = vi
      .spyOn(shippingConfigurationApi, 'createRule')
      .mockResolvedValue({ ...rule, id: '44444444-4444-4444-8444-444444444444', minQuantity: 6, maxQuantity: 10 })
    render(<SkuPackagingRuleDialog sku={sku} canWrite onClose={vi.fn()} />)
    await screen.findByText('1–5')

    fireEvent.change(screen.getByLabelText('最小数量'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('最大数量'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('发货包装模板'), { target: { value: template.id } })
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }))

    await waitFor(() =>
      expect(createRule).toHaveBeenCalledWith(sku.id, {
        minQuantity: 6,
        maxQuantity: 10,
        packagingTemplateId: template.id,
      }),
    )
    expect(await screen.findByText('发货包装规则已创建。')).toBeTruthy()
  })

  it('blocks overlapping ranges locally and supports versioned deactivation', async () => {
    const createRule = vi.spyOn(shippingConfigurationApi, 'createRule')
    const updateRule = vi
      .spyOn(shippingConfigurationApi, 'updateRule')
      .mockResolvedValue({ ...rule, status: 'INACTIVE', version: 2 })
    render(<SkuPackagingRuleDialog sku={sku} canWrite onClose={vi.fn()} />)
    await screen.findByText('1–5')

    fireEvent.change(screen.getByLabelText('最小数量'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('最大数量'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('发货包装模板'), { target: { value: template.id } })
    fireEvent.click(screen.getByRole('button', { name: '新增规则' }))
    expect(
      await screen.findByText('该数量区间与现有启用规则重叠，请先调整或停用原规则。'),
    ).toBeTruthy()
    expect(createRule).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('状态'), {
      target: { value: 'INACTIVE' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))
    await waitFor(() =>
      expect(updateRule).toHaveBeenCalledWith(sku.id, rule.id, {
        version: 1,
        minQuantity: 1,
        maxQuantity: 5,
        packagingTemplateId: template.id,
        status: 'INACTIVE',
      }),
    )
  })
})

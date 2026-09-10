import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shippingConfigurationApi } from '../modules/shippingConfigurationApi'
import type { Warehouse } from '../modules/warehouseCenterApi'
import { ShippingConfigurationDialog } from './ShippingConfigurationDialog'

const warehouse: Warehouse = {
  id: '11111111-1111-4111-8111-111111111111',
  businessCode: 'WH_NORTH',
  name: '北区仓',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-08-07T08:00:00Z',
  updatedAt: '2026-08-07T08:00:00Z',
}
const template = {
  id: '22222222-2222-4222-8222-222222222222',
  businessCode: 'BOX_S',
  name: '小号纸箱',
  packagingType: 'BOX' as const,
  standardWeightGrams: 50,
  lengthMm: 200,
  widthMm: 150,
  heightMm: 100,
  status: 'ACTIVE' as const,
  version: 2,
  updatedAt: '2026-08-07T08:00:00Z',
}
const scale = {
  id: '33333333-3333-4333-8333-333333333333',
  warehouseId: warehouse.id,
  deviceNumber: 'SCALE-01',
  displayName: '打包台 1 号秤',
  status: 'ACTIVE' as const,
  version: 1,
  updatedAt: '2026-08-07T08:00:00Z',
}

beforeEach(() => {
  vi.spyOn(shippingConfigurationApi, 'listWarehousePackaging').mockResolvedValue([
    { template, enabled: true },
  ])
  vi.spyOn(shippingConfigurationApi, 'listScales').mockResolvedValue([scale])
  vi.spyOn(shippingConfigurationApi, 'getTolerance').mockResolvedValue({
    toleranceGrams: 30,
    toleranceBasisPoints: 300,
    warehouseOverride: false,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShippingConfigurationDialog', () => {
  it('loads all warehouse configuration and keeps read-only users non-mutating', async () => {
    render(
      <ShippingConfigurationDialog
        warehouse={warehouse}
        canWrite={false}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByRole('dialog', { name: '发货配置' })).toBeTruthy()
    expect(screen.getByText('BOX_S')).toBeTruthy()
    expect(screen.getByText('SCALE-01')).toBeTruthy()
    expect(screen.getByText('公司默认值')).toBeTruthy()
    expect(
      (screen.getByLabelText('小号纸箱在本仓启用') as HTMLInputElement)
        .disabled,
    ).toBe(true)
    expect(screen.queryByRole('button', { name: '保存容差' })).toBeNull()
    expect(screen.queryByRole('button', { name: '绑定电子秤' })).toBeNull()
  })

  it('closes with Escape and restores focus to the warehouse action', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const onClose = vi.fn()
    render(
      <ShippingConfigurationDialog
        warehouse={warehouse}
        canWrite={false}
        onClose={onClose}
      />,
    )
    await screen.findByText('BOX_S')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '关闭' }),
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('saves basis points exactly and updates warehouse packaging availability', async () => {
    const setTolerance = vi
      .spyOn(shippingConfigurationApi, 'setTolerance')
      .mockResolvedValue({
        toleranceGrams: 35,
        toleranceBasisPoints: 250,
        warehouseOverride: true,
      })
    const setPackaging = vi
      .spyOn(shippingConfigurationApi, 'setWarehousePackaging')
      .mockResolvedValue([{ template, enabled: false }])

    render(
      <ShippingConfigurationDialog
        warehouse={warehouse}
        canWrite
        onClose={vi.fn()}
      />,
    )
    await screen.findByText('BOX_S')

    fireEvent.change(screen.getByLabelText('固定容差（克）'), {
      target: { value: '35' },
    })
    fireEvent.change(screen.getByLabelText('比例容差（%）'), {
      target: { value: '2.50' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存容差' }))
    await waitFor(() =>
      expect(setTolerance).toHaveBeenCalledWith(warehouse.id, {
        toleranceGrams: 35,
        toleranceBasisPoints: 250,
      }),
    )
    expect(await screen.findByText('本仓称重容差已保存。')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('小号纸箱在本仓启用'))
    await waitFor(() =>
      expect(setPackaging).toHaveBeenCalledWith(
        warehouse.id,
        template.id,
        false,
      ),
    )
    expect(await screen.findByText('发货包装已在本仓停用。')).toBeTruthy()
  })

  it('binds a scale and rejects incomplete packaging dimensions locally', async () => {
    const createScale = vi
      .spyOn(shippingConfigurationApi, 'createScale')
      .mockResolvedValue({ ...scale, id: '44444444-4444-4444-8444-444444444444' })
    const createTemplate = vi.spyOn(shippingConfigurationApi, 'createTemplate')

    render(
      <ShippingConfigurationDialog
        warehouse={warehouse}
        canWrite
        onClose={vi.fn()}
      />,
    )
    await screen.findByText('BOX_S')

    fireEvent.change(screen.getByLabelText('设备编号'), {
      target: { value: 'SCALE-02' },
    })
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: '打包台 2 号秤' },
    })
    fireEvent.click(screen.getByRole('button', { name: '绑定电子秤' }))
    await waitFor(() =>
      expect(createScale).toHaveBeenCalledWith(warehouse.id, {
        deviceNumber: 'SCALE-02',
        displayName: '打包台 2 号秤',
      }),
    )

    fireEvent.change(screen.getByLabelText('业务编码'), {
      target: { value: 'BOX_M' },
    })
    fireEvent.change(screen.getByLabelText('名称'), {
      target: { value: '中号纸箱' },
    })
    fireEvent.change(screen.getByLabelText('包装重量（克）'), {
      target: { value: '70' },
    })
    fireEvent.change(screen.getByLabelText('长'), {
      target: { value: '300' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增模板' }))
    expect(
      await screen.findByText('请填写名称和有效重量；尺寸必须全部留空或完整填写。'),
    ).toBeTruthy()
    expect(createTemplate).not.toHaveBeenCalled()
  })
})

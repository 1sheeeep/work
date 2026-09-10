import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsShippingDeadlinePage } from './SettingsShippingDeadlinePage'

const deadlineApi = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => permission === 'settings.parameter.write' }),
}))
vi.mock('../modules/shippingDeadlineSettingApi', () => ({ shippingDeadlineSettingApi: deadlineApi }))

const initial = {
  configured: false, deadlineDays: 3, version: 0,
  updatedByDisplayName: undefined, createdAt: undefined, updatedAt: undefined,
}

beforeEach(() => {
  deadlineApi.get.mockReset().mockResolvedValue(initial)
  deadlineApi.save.mockReset().mockResolvedValue({
    configured: true, deadlineDays: 5, version: 0,
    updatedByDisplayName: 'UAT ERP Tester',
    createdAt: '2026-08-10T04:00:00Z', updatedAt: '2026-08-10T04:00:00Z',
  })
})
afterEach(cleanup)

describe('SettingsShippingDeadlinePage', () => {
  it('loads the current rule and saves a changed deadline', async () => {
    render(<SettingsShippingDeadlinePage />)
    const input = await screen.findByRole('spinbutton', { name: /发货期限/ })
    expect(input).toHaveProperty('value', '3')
    expect(screen.getByText('系统默认')).toBeTruthy()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(deadlineApi.save).toHaveBeenCalledWith(0, 5))
    expect(await screen.findByText('发货期限已保存为 5 天。')).toBeTruthy()
    expect(screen.getByText('UAT ERP Tester')).toBeTruthy()
  })
})

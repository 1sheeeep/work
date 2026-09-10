import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'

const mocks = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Navigate: () => <div>redirected</div>,
  useSearch: () => ({}),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ status: 'unauthenticated', login: mocks.login }),
}))
import { LoginPage } from './LoginPage'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('native ERP login', () => {
  it('renders native credentials without discovering or contacting One', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<LoginPage />)
    expect(screen.getByLabelText('企业标识')).toBeTruthy()
    expect(screen.getByLabelText('密码')).toBeTruthy()
    expect(screen.getByRole('button', { name: '登录工作台' })).toBeTruthy()
    expect(screen.queryByText(/Xinzhi One/)).toBeNull()
    expect(screen.getByText(/不开放自助注册/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '联系工作人员开通' }).getAttribute('href')).toBe('mailto:support@xzkj.ai')
    expect(screen.queryByRole('button', { name: /注册|开通/ })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses native tenant credentials and keeps safe, focused errors', async () => {
    mocks.login.mockRejectedValueOnce(new ApiError('private detail', { status: 401 }))
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('企业标识'), { target: { value: ' fixture ' } })
    fireEvent.change(screen.getByLabelText('邮箱或手机号'), { target: { value: ' Admin@Example.test ' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'SyntheticOnly!2026' } })
    fireEvent.click(screen.getByRole('button', { name: '登录工作台' }))
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith({
      tenantCode: 'fixture', email: 'admin@example.test', password: 'SyntheticOnly!2026',
    }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
    expect(screen.getByRole('alert').textContent).not.toContain('private detail')
    expect((screen.getByLabelText('企业标识') as HTMLInputElement).value).toBe(' fixture ')
  })
})

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, ApiError } from '../api/client'
import { AuthProvider, useAuth } from './AuthContext'
import type { AuthAdapter } from './authApi'
import { sessionStore } from './sessionStore'
import type { AuthSession, LoginResponse } from './types'

const session: AuthSession = {
  tenant: { id: 'tenant-1', code: 'acme', name: 'Acme' },
  user: { id: 'user-1', username: 'operator', displayName: 'Operator' },
  permissions: ['orders.read'],
  applications: [{ code: 'ERP', modules: ['ORDERS'] }],
  expiresAt: '2026-07-28T20:00:00Z',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function AuthProbe() {
  const auth = useAuth()
  return (
    <>
      <output data-testid="status">{auth.status}</output>
      <output data-testid="tenant">{auth.currentTenant?.code ?? 'none'}</output>
      <output data-testid="erp-access">{String(auth.hasApplication('ERP'))}</output>
      <output data-testid="orders-access">
        {String(auth.hasApplicationModule('ERP', 'ORDERS'))}
      </output>
      <output data-testid="products-access">
        {String(auth.hasApplicationModule('ERP', 'PRODUCTS'))}
      </output>
      <button
        type="button"
        onClick={() =>
          void auth.login({
            tenantCode: 'acme',
            username: 'operator',
            password: 'not-a-real-password',
          })
        }
      >
        login
      </button>
    </>
  )
}

function adapter(overrides: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    login: vi.fn().mockResolvedValue({
      session,
      credentials: { accessToken: 'new-token', tokenType: 'Bearer' },
    } satisfies LoginResponse),
    getSession: vi.fn().mockResolvedValue({ session }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  sessionStore.clear()
  apiClient.setUnauthorizedHandler(() => undefined)
  vi.restoreAllMocks()
})

describe('AuthProvider', () => {
  it('does not let an older bootstrap 401 replace a newer login session', async () => {
    const pendingBootstrap = deferred<{ session: AuthSession }>()
    const authAdapter = adapter({ getSession: vi.fn(() => pendingBootstrap.promise) })

    render(
      <AuthProvider adapter={authAdapter}>
        <AuthProbe />
      </AuthProvider>,
    )

    await act(async () => {
      screen.getByRole('button', { name: 'login' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))

    await act(async () => {
      pendingBootstrap.reject(new ApiError('expired', { status: 401 }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authenticated')
      expect(screen.getByTestId('tenant').textContent).toBe('acme')
      expect(screen.getByTestId('erp-access').textContent).toBe('true')
      expect(screen.getByTestId('orders-access').textContent).toBe('true')
      expect(screen.getByTestId('products-access').textContent).toBe('false')
      expect(sessionStore.accessToken()).toBe('new-token')
    })
  })

  it('clears local authentication after a current protected request returns 401', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'authentication_required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchStub)
    sessionStore.write({ accessToken: 'old-token', tokenType: 'Bearer' })

    render(
      <AuthProvider adapter={adapter()}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await expect(apiClient.request('/api/v1/orders')).rejects.toMatchObject({ status: 401 })

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
      expect(sessionStore.accessToken()).toBeNull()
    })
  })

  it('keeps the active login after a forbidden response', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'permission_denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchStub)
    sessionStore.write({ accessToken: 'active-token', tokenType: 'Bearer' })

    render(
      <AuthProvider adapter={adapter()}>
        <AuthProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    await expect(apiClient.request('/api/v1/platform-center/shops')).rejects.toMatchObject({ status: 403 })

    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(sessionStore.accessToken()).toBe('active-token')
  })

  it('rejects an already-aborted request before issuing a fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)

    await expect(
      apiClient.request('/api/v1/orders', { signal: controller.signal }),
    ).rejects.toMatchObject({ status: 0 })
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

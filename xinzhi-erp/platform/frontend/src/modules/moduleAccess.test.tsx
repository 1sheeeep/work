import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { ModuleAccessGate } from '../auth/ModuleAccessGate'
import type { AuthAdapter } from '../auth/authApi'
import type { AuthSession } from '../auth/types'
import { getAccessibleModules } from './moduleAccess'
import { moduleDefinitions } from './moduleDefinitions'

const session: AuthSession = {
  tenant: { id: 'tenant-1', code: 'acme', name: 'Acme' },
  user: { id: 'user-1', username: 'operator', displayName: 'Operator' },
  permissions: ['orders.read'],
}

function adapterFor(currentSession: AuthSession): AuthAdapter {
  return {
    login: async () => ({ session: currentSession }),
    getSession: async () => ({ session: currentSession }),
    logout: async () => undefined,
  }
}

describe('module permission gates', () => {
  it('only includes modules with their exact stable permission code', () => {
    const accessible = getAccessibleModules(moduleDefinitions, (permission) =>
      session.permissions.includes(permission),
    )

    expect(accessible.map((module) => module.id)).toEqual(['orders'])
  })

  it('denies a direct shop route when shop:read is absent', async () => {
    const shops = moduleDefinitions.find((module) => module.id === 'shops')!
    const deniedSession = { ...session, permissions: [] }

    render(
      <AuthProvider adapter={adapterFor(deniedSession)}>
        <ModuleAccessGate
          module={shops}
          renderDenied={(module) => (
            <output data-testid="denied">403:{module.requiredPermission}</output>
          )}
        >
          <output data-testid="module-content">protected route content</output>
        </ModuleAccessGate>
      </AuthProvider>,
    )

    expect((await screen.findByTestId('denied')).textContent).toBe('403:shop:read')
    expect(screen.queryByTestId('module-content')).toBeNull()
  })

  it('denies a direct product route when products.read is absent', async () => {
    const products = moduleDefinitions.find((module) => module.id === 'products')!
    const deniedSession = { ...session, permissions: [] }
    render(<AuthProvider adapter={adapterFor(deniedSession)}><ModuleAccessGate module={products} renderDenied={(module) => <output data-testid="product-denied">403:{module.requiredPermission}</output>}><output>protected product route</output></ModuleAccessGate></AuthProvider>)
    expect((await screen.findByTestId('product-denied')).textContent).toBe('403:products.read')
  })

  it('denies the warehouse route unless warehouses.read is present', async () => {
    const warehouses = moduleDefinitions.find(
      (module) => module.id === 'warehouses',
    )!
    const deniedSession = { ...session, permissions: ['warehouses.write'] }
    render(
      <AuthProvider adapter={adapterFor(deniedSession)}>
        <ModuleAccessGate
          module={warehouses}
          renderDenied={(module) => (
            <output data-testid="warehouse-denied">
              403:{module.requiredPermission}
            </output>
          )}
        >
          <output>protected warehouse route</output>
        </ModuleAccessGate>
      </AuthProvider>,
    )
    expect((await screen.findByTestId('warehouse-denied')).textContent).toBe(
      '403:warehouses.read',
    )
  })

  it('does not expose the paused supplier module', () => {
    expect(moduleDefinitions.some((module) => module.id === 'suppliers')).toBe(false)
  })
})

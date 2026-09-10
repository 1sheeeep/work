import type { PropsWithChildren, ReactNode } from 'react'
import { canAccessModule } from '../modules/moduleAccess'
import type { ModuleDefinition } from '../modules/moduleDefinitions'
import { ForbiddenPage } from '../pages/ForbiddenPage'
import { useAuth } from './AuthContext'

type ModuleAccessGateProps = PropsWithChildren<{
  module: ModuleDefinition
  renderDenied?: (module: ModuleDefinition) => ReactNode
}>

export function ModuleAccessGate({
  module,
  children,
  renderDenied,
}: ModuleAccessGateProps) {
  const { hasPermission } = useAuth()

  if (!canAccessModule(module, hasPermission)) {
    return renderDenied?.(module) ?? <ForbiddenPage module={module} />
  }

  return children
}

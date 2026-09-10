import type { ModuleDefinition } from './moduleDefinitions'

export type PermissionChecker = (permission: string) => boolean

export function canAccessModule(
  module: ModuleDefinition,
  hasPermission: PermissionChecker,
) {
  return hasPermission(module.requiredPermission)
}

export function getAccessibleModules(
  modules: readonly ModuleDefinition[],
  hasPermission: PermissionChecker,
) {
  return modules.filter((module) => canAccessModule(module, hasPermission))
}

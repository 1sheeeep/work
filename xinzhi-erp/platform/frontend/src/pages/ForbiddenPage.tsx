import { ShieldX } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { ModuleDefinition } from '../modules/moduleDefinitions'

type ForbiddenPageProps = {
  module: ModuleDefinition
}

export function ForbiddenPage({ module }: ForbiddenPageProps) {
  return (
    <section className="empty-panel forbidden-page" role="alert">
      <span className="empty-panel-icon forbidden-icon">
        <ShieldX size={30} aria-hidden="true" />
      </span>
      <p className="eyebrow">403 无权访问</p>
      <h1>你没有访问“{module.label}”的权限</h1>
      <p>
        此模块需要 <code>{module.requiredPermission}</code> 权限。请联系企业管理员调整角色授权后重试。
      </p>
      <Link className="button button-primary" to="/">
        返回工作台
      </Link>
    </section>
  )
}

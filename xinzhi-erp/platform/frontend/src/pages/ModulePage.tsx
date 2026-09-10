import {
  ArrowLeft,
  Layers3,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import {
  type ModuleDefinition,
} from '../modules/moduleDefinitions'

type ModulePageProps = {
  module: ModuleDefinition
}

export function ModulePage({ module }: ModulePageProps) {
  const Icon = module.icon

  return (
    <>
      <section className="page-heading module-heading">
        <div className="module-title-row">
          <span className="page-icon">
            <Icon size={26} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">{module.group.toUpperCase()}</p>
            <h1>{module.label}</h1>
            <p>{module.summary}</p>
          </div>
        </div>
      </section>

      <section className="placeholder-layout">
        <article className="empty-panel">
          <span className="empty-panel-icon">
            <Layers3 size={30} aria-hidden="true" />
          </span>
          <h2>模块入口已就绪</h2>
          <p>
            当前页面暂未提供可用数据。
          </p>
          <Link className="button button-secondary" to="/">
            <ArrowLeft size={17} aria-hidden="true" />
            返回工作台
          </Link>
        </article>

        <aside className="module-contract-panel" aria-labelledby="module-overview-title">
          <div className="panel-title">
            <Layers3 size={19} aria-hidden="true" />
            <h2 id="module-overview-title">功能说明</h2>
          </div>
          <p>相关功能将在此显示。</p>
        </aside>
      </section>
    </>
  )
}

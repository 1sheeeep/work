import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Link, type ErrorComponentProps } from '@tanstack/react-router'

export function RouteErrorPage({ reset }: ErrorComponentProps) {

  return (
    <main className="full-page-state" role="alert">
      <span className="state-icon state-icon-error">
        <AlertTriangle size={27} aria-hidden="true" />
      </span>
      <h1>页面暂时无法显示</h1>
      <p>页面暂时无法显示。请重新加载；如果问题持续，请联系系统管理员并提供发生时间。</p>
      <div className="state-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={() => reset()}
        >
          <RefreshCw size={17} aria-hidden="true" />
          重新加载
        </button>
        <Link className="button button-secondary" to="/">
          返回工作台
        </Link>
      </div>
    </main>
  )
}

import { LoaderCircle, RotateCcw } from 'lucide-react'
import { Outlet } from '@tanstack/react-router'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { status, error, retry } = useAuth()

  if (status === 'initializing') {
    return (
      <main className="full-page-state" aria-busy="true" aria-live="polite">
        <LoaderCircle className="spin" size={28} aria-hidden="true" />
        <h1>正在确认登录状态</h1>
        <p>正在安全连接到认证服务，请稍候。</p>
      </main>
    )
  }

  if (status === 'unavailable') {
    return (
      <main className="full-page-state" role="alert">
        <div className="state-icon state-icon-error">
          <RotateCcw size={26} aria-hidden="true" />
        </div>
        <h1>暂时无法验证登录状态</h1>
        <p>{error}</p>
        <button className="button button-primary" type="button" onClick={() => void retry()}>
          重新连接
        </button>
      </main>
    )
  }

  if (status !== 'authenticated') {
    // The authenticated route's beforeLoad hook owns navigation. Rendering a
    // second Navigate here races router.invalidate() during logout and can
    // recursively wrap /login inside its own redirect query string.
    return (
      <main className="full-page-state" aria-busy="true" aria-live="polite">
        <LoaderCircle className="spin" size={28} aria-hidden="true" />
        <h1>正在退出工作台</h1>
        <p>正在安全返回登录页面，请稍候。</p>
      </main>
    )
  }

  return <Outlet />
}

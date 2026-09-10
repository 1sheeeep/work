import { ArrowLeft, SearchX } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export function NotFoundPage() {
  return (
    <section className="empty-panel not-found">
      <span className="empty-panel-icon">
        <SearchX size={30} aria-hidden="true" />
      </span>
      <p className="eyebrow">404 页面不存在</p>
      <h1>没有找到这个页面</h1>
      <p>该地址可能已变更，或当前模块尚未提供此功能。</p>
      <Link className="button button-primary" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        返回工作台
      </Link>
    </section>
  )
}

import { useState } from 'react'
import type { CustomerServiceApi, CustomerServiceCapabilities, CustomerServiceShop } from './contracts'
import { DisputesWorkspace } from './DisputesWorkspace'
import { ReturnsWorkspace } from './ReturnsWorkspace'

export type CustomerServiceWorkspaceProps = {
  api: CustomerServiceApi
  shops: CustomerServiceShop[]
  capabilities: CustomerServiceCapabilities
  initialShopId?: string
  initialView?: 'returns' | 'disputes'
  confirmAction?: (message: string) => boolean | Promise<boolean>
}

export function CustomerServiceWorkspace({ api, shops, capabilities, initialShopId, initialView = 'returns', confirmAction }: CustomerServiceWorkspaceProps) {
  const [view, setView] = useState<'returns' | 'disputes'>(initialView)
  return <div className="xzcs-root">
    <a className="xzcs-skip-link" href="#xzcs-main">跳到主要内容</a>
    <nav className="xzcs-tabs" aria-label="客服业务">
      <button type="button" aria-current={view === 'returns' ? 'page' : undefined} onClick={() => setView('returns')}>退货与退款</button>
      <button type="button" aria-current={view === 'disputes' ? 'page' : undefined} onClick={() => setView('disputes')}>拒付概览</button>
    </nav>
    <main id="xzcs-main" tabIndex={-1}>
      {view === 'returns' ? <ReturnsWorkspace api={api} shops={shops} canManage={capabilities.manageReturns} initialShopId={initialShopId} confirmAction={confirmAction} /> :
        <DisputesWorkspace api={api} shops={shops} canRead={capabilities.readDisputes} initialShopId={initialShopId} />}
    </main>
  </div>
}

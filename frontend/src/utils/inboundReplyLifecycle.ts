/**
 * Frontend boundary for inbound AI reply state.
 *
 * The API still exposes taskStatus/sendStatus for audit and troubleshooting,
 * but views should make decisions from this small, stable vocabulary instead
 * of duplicating transport-level status checks in templates.
 */
export type ReplyLifecycle = 'WAITING' | 'PROCESSING' | 'DONE'

export type ReplyUiStatus =
  | 'SUCCESS'
  | 'UNCONFIRMED'
  | 'FAILED'
  | 'RETRY_WAIT'
  | 'READY_TO_SEND'
  | 'SENDING'
  | 'PROCESSING'
  | 'SILENT'
  | 'WAITING'

export interface ReplyLifecycleEvent {
  taskStatus?: string | null
  sendStatus?: string | null
}
export function replyUiStatus(event?: ReplyLifecycleEvent | null): ReplyUiStatus {
  if (!event) return 'WAITING'
  if (event.sendStatus === 'SUCCEEDED') return 'SUCCESS'
  if (event.sendStatus === 'UNKNOWN') return 'UNCONFIRMED'
  if (event.taskStatus === 'FAILED' || event.sendStatus === 'FAILED') return 'FAILED'
  if (event.taskStatus === 'RETRY_WAIT') return 'RETRY_WAIT'
  if (event.sendStatus === 'READY') return 'READY_TO_SEND'
  if (event.sendStatus === 'CLAIMED') return 'SENDING'
  if (event.taskStatus === 'PROCESSING') return 'PROCESSING'
  if (event.sendStatus === 'SKIPPED') return 'SILENT'
  return 'WAITING'
}
export function replyLifecycle(event?: ReplyLifecycleEvent | null): ReplyLifecycle {
  switch (replyUiStatus(event)) {
    case 'SUCCESS':
    case 'UNCONFIRMED':
    case 'FAILED':
    case 'SILENT':
      return 'DONE'
    case 'PROCESSING':
    case 'SENDING':
      return 'PROCESSING'
    default:
      return 'WAITING'
  }
}

export function replyIsActive(event?: ReplyLifecycleEvent | null): boolean {
  return replyLifecycle(event) !== 'DONE'
}

export function replyPhaseLabel(event?: ReplyLifecycleEvent | null): string {
  switch (replyUiStatus(event)) {
    case 'SUCCESS': return '已自动回复'
    case 'UNCONFIRMED': return '发送待确认'
    case 'FAILED': return '处理失败'
    case 'RETRY_WAIT': return '等待重试'
    case 'READY_TO_SEND': return '等待页面发送'
    case 'SENDING': return '正在发送'
    case 'PROCESSING': return 'AI 处理中'
    case 'SILENT': return '已安全跳过'
    default: return '等待处理'
  }
}

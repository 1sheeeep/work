export const DEFAULTS = Object.freeze({
  enabled: true,
  emergencyStop: true,
  monitorOnly: true,
  draftFillOnly: false,
  accountAlias: '',
  backendUrl: 'http://localhost:8088',
  syncMessageContent: false,
  timeoutNotifications: false,
  observationTimeoutMinutes: 120,
  timeoutMinutes: 120,
  dailyLimit: 20,
  minimumIntervalSeconds: 180,
  windowStart: '09:00',
  windowEnd: '21:00',
  template: '您好，已收到您关于「{jobTitle}」的消息，招聘团队会尽快查看并与您沟通。',
  requireVisibleTab: true,
  stabilityDelayMs: 800,
  selectors: {
    conversation: '', conversationUnread: '', conversationJob: '', conversationTime: '', conversationPreview: '',
    conversationIdentity: '', conversationIdAttribute: 'data-conversation-id',
    activeConversation: '', candidateName: '', jobTitle: '',
    message: '', messageIdAttribute: 'data-message-id', directionAttribute: 'data-direction',
    inboundMarker: '', outboundMarker: '', messageTime: '',
    timeAttribute: 'data-created-at', editor: '', sendButton: ''
  }
})

export const REAL_BOSS_MONITOR_SELECTORS = Object.freeze({
  conversation: '.geek-item', conversationUnread: '.badge-count',
  conversationJob: '.source-job', conversationTime: '.time', conversationPreview: '.push-text',
  conversationIdentity: '.geek-item.selected', activeConversation: '.conversation-message',
  conversationIdAttribute: 'data-id', candidateName: '.geek-item.selected .geek-name', jobTitle: '',
  message: '.item-friend, .item-myself', messageIdAttribute: '', directionAttribute: '',
  inboundMarker: '.item-friend', outboundMarker: '.item-myself', messageTime: '.message-time',
  timeAttribute: '', editor: '.boss-chat-editor-input', sendButton: ''
})

export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function insideWindow(now, start, end) {
  const value = now.getHours() * 60 + now.getMinutes()
  const minutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5))
  const from = minutes(start), to = minutes(end)
  return from < to ? value >= from && value < to : value >= from || value < to
}

export function renderTemplate(template, data) {
  return template.replaceAll('{jobTitle}', data.jobTitle || '该职位').replaceAll('{candidateName}', data.candidateName || '您')
}

export function validateConfig(config) {
  const s = config.selectors || {}
  const required = config.draftFillOnly ? ['conversation','conversationUnread','conversationIdAttribute','conversationIdentity','activeConversation','message','editor'] : config.monitorOnly ? ['conversation', 'conversationUnread', 'conversationIdAttribute'] : ['conversationIdentity', 'activeConversation', 'message', 'editor', 'sendButton']
  const missing = required.filter((key) => !String(s[key] || '').trim())
  if (missing.length) return `页面适配器未配置：${missing.join(', ')}`
  if (!Number.isInteger(config.observationTimeoutMinutes) || config.observationTimeoutMinutes < 1 || config.observationTimeoutMinutes > 1440) return '本地超时判定必须为 1–1440 分钟'
  try { const url = new URL(config.backendUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error() } catch { return '后端地址无效' }
  return null
}

export function classifyUnreadObservations(observations = [], timeoutMinutes = 120, now = new Date()) {
  const threshold = Math.max(1, Math.min(1440, Number(timeoutMinutes) || 120)) * 60000
  const timestamp = now.getTime()
  const items = observations.map((item) => { const firstSeen = Date.parse(item.firstSeenAt), ageMinutes = Number.isFinite(firstSeen) ? Math.max(0, Math.floor((timestamp - firstSeen) / 60000)) : 0; return { ...item, ageMinutes, timedOut: Number.isFinite(firstSeen) && timestamp - firstSeen >= threshold } }).sort((a, b) => Number(b.timedOut) - Number(a.timedOut) || b.ageMinutes - a.ageMinutes || a.chatDigest.localeCompare(b.chatDigest))
  const timedOut = items.filter((item) => item.timedOut)
  const observing = items.filter((item) => !item.timedOut)
  const dueTimes = observing.map((item) => Date.parse(item.firstSeenAt) + threshold).filter(Number.isFinite)
  const nextDueAt = dueTimes.length ? new Date(Math.min(...dueTimes)).toISOString() : null
  return { thresholdMinutes: threshold / 60000, total: items.length, observingCount: observing.length, timedOutCount: timedOut.length, nextDueAt, items }
}

export function unnotifiedTimedOutObservations(observations = [], timeoutMinutes = 120, now = new Date()) {
  return classifyUnreadObservations(observations, timeoutMinutes, now).items.filter((item) => item.timedOut && !item.timedOutNotifiedAt)
}

export function assessReplyEligibility(queue, diagnostic) {
  return { ...queue, items: queue.items.map((item) => {
    if (!item.timedOut) return { ...item, eligibility: 'NOT_TIMED_OUT' }
    if (!diagnostic?.chatDigest || diagnostic.chatDigest !== item.chatDigest) return { ...item, eligibility: 'DETAIL_NOT_SELECTED' }
    if (diagnostic.selectedConversationUnread === false) return { ...item, eligibility: 'NO_LONGER_UNREAD' }
    if (diagnostic.direction === 'OUTBOUND') return { ...item, eligibility: 'HR_REPLIED' }
    if (diagnostic.direction !== 'INBOUND') return { ...item, eligibility: 'DIRECTION_UNKNOWN' }
    return { ...item, eligibility: 'ELIGIBLE_READ_ONLY' }
  }) }
}

export function mergeUnreadObservations(current = [], entries = [], now = new Date()) {
  const validDigest = (value) => /^[a-f0-9]{64}$/.test(String(value || '')) ? value : null
  const timestamp = now.getTime()
  const previous = new Map(current.map((item) => [item.chatDigest, item]))
  for (const raw of entries.slice(0, 200)) {
    const chatDigest = validDigest(raw.chatDigest)
    if (!chatDigest) continue
    const unreadCount = Math.max(0, Math.min(999, Number(raw.unreadCount) || 0))
    const existing = previous.get(chatDigest)
    if (unreadCount > 0) previous.set(chatDigest, { chatDigest, previewDigest: validDigest(raw.previewDigest), jobDigest: validDigest(raw.jobDigest), timeDigest: validDigest(raw.timeDigest), unreadCount, firstSeenAt: existing?.firstSeenAt || now.toISOString(), lastSeenAt: now.toISOString(), timedOutNotifiedAt: existing?.timedOutNotifiedAt || null })
    else previous.delete(chatDigest)
  }
  return [...previous.values()].filter((item) => timestamp - Date.parse(item.lastSeenAt) < 7 * 86400000).sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt)).slice(0, 200)
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function sanitizeDiagnostic(value = {}, tab = {}, now = new Date()) {
  const digest = (input) => /^[a-f0-9]{64}$/.test(String(input || '')) ? input : null
  const direction = ['INBOUND', 'OUTBOUND'].includes(value.direction) ? value.direction : null
  const status = ['READY', 'BLOCKED', 'RISK', 'UNBOUND', 'BACKEND_ERROR', 'OBSERVING'].includes(value.status) ? value.status : 'BLOCKED'
  let origin = ''
  try { origin = new URL(tab.url).origin } catch {}
  return { observedAt: now.toISOString(), tabId: Number.isInteger(tab.id) ? tab.id : null, origin, status,
    reason: String(value.reason || '').slice(0, 200), adapterDigest: digest(value.adapterDigest), chatDigest: digest(value.chatDigest),
    messageDigest: digest(value.messageDigest), direction, createdAt: Number.isFinite(Date.parse(value.createdAt)) ? value.createdAt : null,
    ageMinutes: Number.isFinite(value.ageMinutes) ? Math.max(0, Math.round(value.ageMinutes)) : null,
    conversationCount: Number.isInteger(value.conversationCount) ? Math.max(0, value.conversationCount) : null,
    unreadConversationCount: Number.isInteger(value.unreadConversationCount) ? Math.max(0, value.unreadConversationCount) : null,
    selectedConversationUnread: typeof value.selectedConversationUnread === 'boolean' ? value.selectedConversationUnread : null,
    messageNodeCount: Number.isInteger(value.messageNodeCount) ? Math.max(0, value.messageNodeCount) : null,
    inboundMessageCount: Number.isInteger(value.inboundMessageCount) ? Math.max(0, value.inboundMessageCount) : null,
    outboundMessageCount: Number.isInteger(value.outboundMessageCount) ? Math.max(0, value.outboundMessageCount) : null,
    bound: typeof value.bound === 'boolean' ? value.bound : null, visible: Boolean(value.visible) }
}

export function diagnosticSignature(value) {
  return [value.tabId, value.status, value.reason, value.adapterDigest, value.chatDigest, value.messageDigest, value.direction, value.createdAt, value.conversationCount, value.unreadConversationCount, value.selectedConversationUnread, value.messageNodeCount, value.inboundMessageCount, value.outboundMessageCount, value.bound, value.visible].join('|')
}

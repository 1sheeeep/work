export const DEFAULTS = Object.freeze({
  enabled: true,
  emergencyStop: true,
  accountAlias: '',
  backendUrl: 'http://localhost:8088',
  syncMessageContent: false,
  timeoutMinutes: 120,
  dailyLimit: 20,
  minimumIntervalSeconds: 180,
  windowStart: '09:00',
  windowEnd: '21:00',
  template: '您好，已收到您关于「{jobTitle}」的消息，招聘团队会尽快查看并与您沟通。',
  requireVisibleTab: true,
  selectors: {
    conversation: '', conversationIdAttribute: 'data-conversation-id',
    activeConversation: '', candidateName: '', jobTitle: '',
    message: '', messageIdAttribute: 'data-message-id', directionAttribute: 'data-direction',
    timeAttribute: 'data-created-at', editor: '', sendButton: ''
  }
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
  const missing = ['activeConversation', 'message', 'editor', 'sendButton'].filter((key) => !String(s[key] || '').trim())
  if (missing.length) return `页面适配器未配置：${missing.join(', ')}`
  try { const url = new URL(config.backendUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error() } catch { return '后端地址无效' }
  return null
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

import { DEFAULTS, localDay } from './shared.js'

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['config', 'runtime'])
  if (!stored.config) await chrome.storage.local.set({ config: structuredClone(DEFAULTS) })
  if (!stored.runtime) await chrome.storage.local.set({ runtime: freshRuntime() })
  chrome.alarms.create('health', { periodInMinutes: 1 })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse)
  return true
})

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== 'health') return
  const { runtime = freshRuntime() } = await chrome.storage.local.get('runtime')
  if (runtime.lastHeartbeatAt && Date.now() - runtime.lastHeartbeatAt > 120_000) {
    runtime.state = 'PAUSED'; runtime.reason = '会话页超过 2 分钟无心跳'
    await chrome.storage.local.set({ runtime })
  }
})

async function handle(message, sender) {
  const stored = await chrome.storage.local.get(['config', 'runtime'])
  const config = { ...DEFAULTS, ...(stored.config || {}) }
  const runtime = rollDay(stored.runtime || freshRuntime())
  if (message.type === 'HEARTBEAT') {
    runtime.lastHeartbeatAt = Date.now(); runtime.url = sender.tab?.url || ''; runtime.state = message.state; runtime.reason = message.reason || ''
    await chrome.storage.local.set({ runtime }); return { ok: true, config, runtime }
  }
  if (message.type === 'SENT') {
    runtime.sentToday += 1; runtime.lastSentAt = Date.now(); runtime.lastMessageKey = message.messageKey; runtime.state = 'RUNNING'; runtime.reason = ''
    await chrome.storage.local.set({ runtime }); return { ok: true }
  }
  if (message.type === 'PAUSE') {
    runtime.state = 'PAUSED'; runtime.reason = message.reason || '页面安全检查未通过'
    await chrome.storage.local.set({ runtime }); return { ok: true }
  }
  if (message.type === 'GET_STATE') return { ok: true, config, runtime }
  return { ok: false }
}

function freshRuntime() { return { state: 'DISABLED', reason: '', day: localDay(), sentToday: 0, lastSentAt: 0, lastMessageKey: '', lastHeartbeatAt: 0, url: '' } }
function rollDay(runtime) { if (runtime.day !== localDay()) { runtime.day = localDay(); runtime.sentToday = 0 } return runtime }

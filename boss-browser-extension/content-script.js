(() => {
  const RISK_TEXT = /(验证码|安全验证|操作频繁|异常访问|账号异常|请完成验证|登录状态已失效|重新登录)/
  let busy = false
  setInterval(tick, 5000)
  tick()

  async function tick() {
    if (busy) return
    busy = true
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' })
      const config = state.config, runtime = state.runtime
      if (!config.enabled) return heartbeat('DISABLED', '监测开关未开启')
      if (RISK_TEXT.test(document.body?.innerText || '')) return pause('检测到登录、验证码或平台风险提示')
      if (config.requireVisibleTab && document.visibilityState !== 'visible') return heartbeat('PAUSED', '会话页不在前台')
      const snapshot = readSnapshot(config.selectors)
      if (!snapshot.ok) return heartbeat('PAUSED', snapshot.reason)
      const synced = await chrome.runtime.sendMessage({ type: 'SYNC_MESSAGE', payload: { externalChatId: snapshot.chatId, externalMessageId: snapshot.messageId, direction: snapshot.direction, createdAt: new Date(snapshot.createdAt).toISOString(), content: config.syncMessageContent ? snapshot.content : null } })
      if (!synced?.ok) return heartbeat('PAUSED', synced?.action === 'DEVICE_NOT_PAIRED' ? '扩展尚未与招聘系统配对' : '招聘系统连接失败或设备已撤销')
      if (!synced.bound) return heartbeat('PAUSED', '当前网页会话尚未与候选人人工绑定')
      await heartbeat('RUNNING', '')
      if (!config.automaticSend || snapshot.direction !== 'INBOUND') return
      if (Date.now() - snapshot.createdAt < config.timeoutMinutes * 60_000) return
      if (runtime.sentToday >= config.dailyLimit) return heartbeat('PAUSED', '已达到账号当日上限')
      if (runtime.lastSentAt && Date.now() - runtime.lastSentAt < config.minimumIntervalSeconds * 1000) return
      if (!insideWindow(new Date(), config.windowStart, config.windowEnd)) return
      if (runtime.lastMessageKey === snapshot.messageKey) return
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const verified = readSnapshot(config.selectors)
      if (!verified.ok || verified.messageKey !== snapshot.messageKey || verified.direction !== 'INBOUND') return
      const content = render(config.template, verified)
      fillEditor(verified.editor, content)
      const finalCheck = readSnapshot(config.selectors)
      if (!finalCheck.ok || finalCheck.messageKey !== snapshot.messageKey || finalCheck.direction !== 'INBOUND') { clearEditor(verified.editor); return }
      verified.sendButton.click()
      await chrome.runtime.sendMessage({ type: 'SENT', messageKey: snapshot.messageKey })
    } catch (error) {
      await pause(`页面适配失败：${String(error?.message || error).slice(0, 160)}`)
    } finally { busy = false }
  }

  function readSnapshot(s) {
    const active = document.querySelector(s.activeConversation)
    const editor = document.querySelector(s.editor), sendButton = document.querySelector(s.sendButton)
    if (!active || !editor || !sendButton) return { ok: false, reason: '未找到当前会话、输入框或发送按钮' }
    const messages = [...active.querySelectorAll(s.message)]
    const last = messages.at(-1)
    if (!last) return { ok: false, reason: '当前会话暂无可识别消息' }
    const chatId = active.getAttribute(s.conversationIdAttribute) || active.dataset.conversationId || location.pathname
    const messageId = last.getAttribute(s.messageIdAttribute) || `${last.textContent?.trim().slice(0, 80)}:${last.getAttribute(s.timeAttribute) || ''}`
    const rawDirection = (last.getAttribute(s.directionAttribute) || '').toUpperCase()
    const direction = ['INBOUND', 'RECEIVED', 'GEEK'].includes(rawDirection) ? 'INBOUND' : 'OUTBOUND'
    const parsed = Date.parse(last.getAttribute(s.timeAttribute) || '')
    return { ok: true, chatId, messageId, content:last.textContent?.trim()||'', messageKey: `${chatId}:${messageId}`, direction, createdAt: Number.isFinite(parsed) ? parsed : Date.now(),
      candidateName: text(s.candidateName), jobTitle: text(s.jobTitle), editor, sendButton }
  }

  function fillEditor(editor, value) {
    editor.focus()
    if ('value' in editor) { const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(editor, value) }
    else editor.textContent = value
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  }
  function clearEditor(editor) { if ('value' in editor) editor.value = ''; else editor.textContent = ''; editor.dispatchEvent(new Event('input', { bubbles: true })) }
  function text(selector) { return selector ? document.querySelector(selector)?.textContent?.trim() || '' : '' }
  function render(template, data) { return template.replaceAll('{jobTitle}', data.jobTitle || '该职位').replaceAll('{candidateName}', data.candidateName || '您') }
  function insideWindow(now, start, end) { const v=now.getHours()*60+now.getMinutes(),m=x=>Number(x.slice(0,2))*60+Number(x.slice(3,5)),a=m(start),b=m(end);return a<b?v>=a&&v<b:v>=a||v<b }
  async function heartbeat(state, reason) { return chrome.runtime.sendMessage({ type: 'HEARTBEAT', state, reason }) }
  async function pause(reason) { return chrome.runtime.sendMessage({ type: 'PAUSE', reason }) }
})()

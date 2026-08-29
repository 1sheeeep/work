import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, diagnosticSignature, insideWindow, renderTemplate, sanitizeDiagnostic, sha256, validateConfig } from '../shared.js'

test('supports daytime and overnight safety windows', () => {
  assert.equal(insideWindow(new Date('2026-08-28T10:00:00'), '09:00', '21:00'), true)
  assert.equal(insideWindow(new Date('2026-08-28T22:00:00'), '09:00', '21:00'), false)
  assert.equal(insideWindow(new Date('2026-08-28T23:00:00'), '21:00', '08:00'), true)
})

test('fails closed until selectors are explicitly learned', () => {
  assert.equal(DEFAULTS.monitorOnly, true)
  assert.equal(DEFAULTS.emergencyStop, true)
  assert.match(validateConfig(DEFAULTS), /页面适配器未配置/)
  const config = structuredClone(DEFAULTS)
  Object.assign(config.selectors, { conversationIdentity: '.selected-chat', activeConversation: '.chat', message: '.message', editor: '#editor', sendButton: '#send' })
  assert.equal(validateConfig(config), null)
  config.monitorOnly = false
  config.selectors.sendButton = ''
  assert.match(validateConfig(config), /sendButton/)
})

test('renders only supported non-sensitive placeholders', () => {
  assert.equal(renderTemplate('您好 {candidateName}，关于 {jobTitle}', { candidateName: '张同学', jobTitle: 'Java 工程师' }), '您好 张同学，关于 Java 工程师')
})

test('creates stable irreversible identifiers without retaining message plaintext', async () => {
  assert.equal(await sha256('候选人消息'), await sha256('候选人消息'))
  assert.match(await sha256('候选人消息'), /^[a-f0-9]{64}$/)
  assert.notEqual(await sha256('候选人消息'), await sha256('另一条消息'))
})

test('sanitizes diagnostics and strips URL paths and invalid identifiers', () => {
  const fixed = new Date('2026-08-29T06:00:00Z')
  const report = sanitizeDiagnostic({ status: 'READY', reason: 'ok', chatDigest: 'a'.repeat(64), messageDigest: 'raw-message-id', direction: 'INBOUND', createdAt: 'bad', bound: true, visible: true, plaintext: '不得保存' }, { id: 7, url: 'https://www.zhipin.com/web/chat?id=secret' }, fixed)
  assert.equal(report.origin, 'https://www.zhipin.com')
  assert.equal(report.chatDigest, 'a'.repeat(64))
  assert.equal(report.messageDigest, null)
  assert.equal(report.createdAt, null)
  assert.equal('plaintext' in report, false)
  assert.equal(diagnosticSignature(report), diagnosticSignature({ ...report }))
})

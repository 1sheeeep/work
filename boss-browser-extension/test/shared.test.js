import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, REAL_BOSS_MONITOR_SELECTORS, assessReplyEligibility, classifyUnreadObservations, diagnosticSignature, insideWindow, mergeUnreadObservations, renderTemplate, sanitizeDiagnostic, sha256, unnotifiedTimedOutObservations, validateConfig } from '../shared.js'

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
  Object.assign(config.selectors, { conversation: '.conversation', conversationUnread: '.unread', conversationIdAttribute: 'data-id' })
  assert.equal(validateConfig(config), null)
  config.monitorOnly = false
  Object.assign(config.selectors, { conversationIdentity: '.selected-chat', activeConversation: '.chat', message: '.message', editor: '#editor', sendButton: '#send' })
  config.selectors.sendButton = ''
  assert.match(validateConfig(config), /sendButton/)
})

test('real BOSS preset remains monitor-only and has no send target', () => {
  assert.equal(REAL_BOSS_MONITOR_SELECTORS.conversationIdentity, '.geek-item.selected')
  assert.equal(REAL_BOSS_MONITOR_SELECTORS.message, '.item-friend, .item-myself')
  assert.equal(REAL_BOSS_MONITOR_SELECTORS.sendButton, '')
})

test('renders only supported non-sensitive placeholders', () => {
  assert.equal(renderTemplate('您好 {candidateName}，关于 {jobTitle}', { candidateName: '张同学', jobTitle: 'Java 工程师' }), '您好 张同学，关于 Java 工程师')
})

test('creates stable irreversible identifiers without retaining message plaintext', async () => {
  assert.equal(await sha256('候选人消息'), await sha256('候选人消息'))
  assert.match(await sha256('候选人消息'), /^[a-f0-9]{64}$/)
  assert.notEqual(await sha256('候选人消息'), await sha256('另一条消息'))
})

test('tracks unread duration without resetting first seen time and removes read conversations', () => {
  const chatDigest = 'a'.repeat(64)
  const first = mergeUnreadObservations([], [{ chatDigest, unreadCount: 2 }], new Date('2026-08-29T10:00:00Z'))
  const refreshed = mergeUnreadObservations(first, [{ chatDigest, unreadCount: 3 }], new Date('2026-08-29T10:05:00Z'))
  assert.equal(refreshed[0].firstSeenAt, '2026-08-29T10:00:00.000Z')
  assert.equal(refreshed[0].lastSeenAt, '2026-08-29T10:05:00.000Z')
  assert.equal(refreshed[0].unreadCount, 3)
  const notified = mergeUnreadObservations([{ ...refreshed[0], timedOutNotifiedAt: '2026-08-29T10:05:30.000Z' }], [{ chatDigest, unreadCount: 3 }], new Date('2026-08-29T10:05:40Z'))
  assert.equal(notified[0].timedOutNotifiedAt, '2026-08-29T10:05:30.000Z')
  assert.deepEqual(mergeUnreadObservations(refreshed, [{ chatDigest, unreadCount: 0 }], new Date('2026-08-29T10:06:00Z')), [])
})

test('classifies observing and timed-out unread conversations without page actions', () => {
  const queue = classifyUnreadObservations([
    { chatDigest: 'a'.repeat(64), firstSeenAt: '2026-08-29T09:00:00.000Z' },
    { chatDigest: 'b'.repeat(64), firstSeenAt: '2026-08-29T09:45:00.000Z' }
  ], 30, new Date('2026-08-29T10:00:00.000Z'))
  assert.equal(queue.timedOutCount, 1)
  assert.equal(queue.observingCount, 1)
  assert.equal(queue.nextDueAt, '2026-08-29T10:15:00.000Z')
  assert.equal(queue.items[0].chatDigest, 'a'.repeat(64))
  assert.equal(queue.items[0].timedOut, true)
})

test('selects each newly timed-out conversation for notification only once', () => {
  const now = new Date('2026-08-29T10:00:00.000Z')
  const observation = { chatDigest: 'a'.repeat(64), firstSeenAt: '2026-08-29T09:00:00.000Z', timedOutNotifiedAt: null }
  assert.equal(unnotifiedTimedOutObservations([observation], 30, now).length, 1)
  assert.equal(unnotifiedTimedOutObservations([{ ...observation, timedOutNotifiedAt: now.toISOString() }], 30, now).length, 0)
})

test('requires a selected unread conversation with an inbound last message', () => {
  const digest = 'a'.repeat(64), base = { timedOutCount: 1, items: [{ chatDigest: digest, timedOut: true }] }
  assert.equal(assessReplyEligibility(base, null).items[0].eligibility, 'DETAIL_NOT_SELECTED')
  assert.equal(assessReplyEligibility(base, { chatDigest: digest, selectedConversationUnread: true, direction: 'OUTBOUND' }).items[0].eligibility, 'HR_REPLIED')
  assert.equal(assessReplyEligibility(base, { chatDigest: digest, selectedConversationUnread: true, direction: 'INBOUND' }).items[0].eligibility, 'ELIGIBLE_READ_ONLY')
})

test('sanitizes diagnostics and strips URL paths and invalid identifiers', () => {
  const fixed = new Date('2026-08-29T06:00:00Z')
  const report = sanitizeDiagnostic({ status: 'READY', reason: 'ok', chatDigest: 'a'.repeat(64), messageDigest: 'raw-message-id', direction: 'INBOUND', createdAt: 'bad', bound: true, visible: true, plaintext: '不得保存' }, { id: 7, url: 'https://www.zhipin.com/web/chat?id=secret' }, fixed)
  assert.equal(report.origin, 'https://www.zhipin.com')
  assert.equal(report.chatDigest, 'a'.repeat(64))
  assert.equal(report.messageDigest, null)
  assert.equal(report.createdAt, null)
  assert.equal(report.unreadConversationCount, null)
  assert.equal('plaintext' in report, false)
  assert.equal(diagnosticSignature(report), diagnosticSignature({ ...report }))
})

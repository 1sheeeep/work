import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, insideWindow, renderTemplate, validateConfig } from '../shared.js'

test('supports daytime and overnight safety windows', () => {
  assert.equal(insideWindow(new Date('2026-08-28T10:00:00'), '09:00', '21:00'), true)
  assert.equal(insideWindow(new Date('2026-08-28T22:00:00'), '09:00', '21:00'), false)
  assert.equal(insideWindow(new Date('2026-08-28T23:00:00'), '21:00', '08:00'), true)
})

test('fails closed until selectors are explicitly learned', () => {
  assert.match(validateConfig(DEFAULTS), /页面适配器未配置/)
  const config = structuredClone(DEFAULTS)
  Object.assign(config.selectors, { activeConversation: '.chat', message: '.message', editor: '#editor', sendButton: '#send' })
  assert.equal(validateConfig(config), null)
})

test('renders only supported non-sensitive placeholders', () => {
  assert.equal(renderTemplate('您好 {candidateName}，关于 {jobTitle}', { candidateName: '张同学', jobTitle: 'Java 工程师' }), '您好 张同学，关于 Java 工程师')
})

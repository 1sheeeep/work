import test from 'node:test';
import assert from 'node:assert/strict';
import { publicStatus, snapshotSignature, validateBackendUrl, validateSnapshot } from '../src/bridge-core.mjs';

const digest = 'a'.repeat(64);
const digest2 = 'b'.repeat(64);

test('only accepts the local recruitment console URL', () => {
  assert.equal(validateBackendUrl('http://localhost:8088/'), 'http://localhost:8088');
  assert.equal(validateBackendUrl('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
  assert.throws(() => validateBackendUrl('https://example.com'), /只允许/);
});

test('accepts a minimized unread snapshot and selected direction', () => {
  const payload = { pageState: 'CHAT_PAGE_READY', entries: [{ chatDigest: digest, previewDigest: digest2, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 2 }], selected: { chatDigest: digest, messageDigest: digest2, direction: 'INBOUND', messageAt: '2026-08-30T08:00:00.000Z', selectedUnread: true } };
  assert.equal(validateSnapshot(payload), payload);
  assert.match(snapshotSignature(payload), /^a{64}:2:/);
});

test('rejects duplicate identities and raw or malformed values', () => {
  const entry = { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 };
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [entry, entry] }), /重复/);
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [{ ...entry, previewDigest: '候选人消息原文' }] }), /摘要无效/);
});

test('public status never exposes the local device token and keeps legacy counters compatible', () => {
  const status = publicStatus({ deviceToken: 'secret-device-token', accountName: '主账号', enabled: true }, { state: 'RUNNING', unread: 5 });
  assert.equal(status.paired, true);
  assert.equal(status.accountName, '主账号');
  assert.equal(status.currentUnread, 5);
  assert.equal(status.trackedUnread, 5);
  assert.equal('deviceToken' in status, false);
});

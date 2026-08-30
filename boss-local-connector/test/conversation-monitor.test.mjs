import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSelectedConversation, validateUnreadSnapshot } from '../src/lib/conversation-monitor.mjs';

const digest = 'a'.repeat(64);

test('accepts a privacy-safe stable unread snapshot', () => {
  const result = validateUnreadSnapshot({
    ok: true,
    entries: [{
      chatDigest: digest,
      previewDigest: 'b'.repeat(64),
      jobDigest: 'c'.repeat(64),
      jobTitle: 'Node.js 全栈开发工程师',
      timeDigest: 'd'.repeat(64),
      unreadCount: 2,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.equal(result.unread, 1);
});

test('rejects an unstable snapshot without a stable conversation digest', () => {
  const result = validateUnreadSnapshot({ ok: true, entries: [{ chatDigest: 'not-a-digest', unreadCount: 1 }] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /身份摘要无效/);
});

test('rejects digest collisions rather than merging conversations', () => {
  const result = validateUnreadSnapshot({
    ok: true,
    entries: [
      { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 },
      { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 0 },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /发生碰撞/);
});

test('accepts a read-only selected conversation detail without message text', () => {
  const result = validateSelectedConversation({
    ok: true,
    chatDigest: digest,
    messageDigest: 'b'.repeat(64),
    direction: 'INBOUND',
    messageAt: '2026-08-30T06:40:00.000Z',
    selectedUnread: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.direction, 'INBOUND');
});

test('rejects selected conversation details with an unparseable message time', () => {
  const result = validateSelectedConversation({
    ok: true,
    chatDigest: digest,
    messageDigest: 'b'.repeat(64),
    direction: 'INBOUND',
    messageAt: '稍后联系',
    selectedUnread: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TIME_UNRECOGNISED');
});

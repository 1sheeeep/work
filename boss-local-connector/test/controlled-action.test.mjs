import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActionPreview } from '../src/lib/controlled-action.mjs';

const base = { actionType: 'SEND_MESSAGE', chatDigest: 'a'.repeat(64), capabilityStatus: 'READY_FOR_MANUAL_TEST', pageState: 'CHAT_PAGE_READY', selectedConversationVerified: true, hasRiskOrVerification: false };

test('blocks every unverified write capability', () => {
  const result = buildActionPreview({ ...base, capabilityStatus: 'UNVERIFIED' });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'CAPABILITY_UNVERIFIED');
});

test('blocks an unstable conversation target', () => {
  const result = buildActionPreview({ ...base, chatDigest: 'unknown' });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'TARGET_UNSTABLE');
});

test('returns preview only after every precondition passes', () => {
  const result = buildActionPreview(base);
  assert.equal(result.allowed, true);
  assert.equal(result.mode, 'PREVIEW_ONLY');
  assert.equal('execute' in result, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPageFacts } from '../src/lib/page-probe.mjs';

test('pauses when the browser is not on a BOSS page', () => {
  const result = classifyPageFacts({ url: 'https://example.com', bodyReady: true });
  assert.equal(result.code, 'NOT_BOSS_PAGE');
  assert.equal(result.runtimeState, 'PAUSED');
});

test('pauses on BOSS verification before any conversation handling', () => {
  const result = classifyPageFacts({
    url: 'https://www.zhipin.com/web/user/safe/verify',
    bodyReady: true,
    hasRiskNotice: true,
  });
  assert.equal(result.code, 'RISK_OR_VERIFICATION');
});

test('recognises a ready chat page without enabling message monitoring', () => {
  const result = classifyPageFacts({
    url: 'https://www.zhipin.com/web/chat/index',
    bodyReady: true,
    hasLoginNotice: false,
    hasRiskNotice: false,
  });
  assert.deepEqual(result, {
    runtimeState: 'PAUSED',
    code: 'CHAT_PAGE_READY',
    reason: 'BOSS 沟通页已就绪，等待实页只监测适配确认。',
  });
});

test('does not mistake the recommended-candidates page for the conversation list', () => {
  const result = classifyPageFacts({
    url: 'https://www.zhipin.com/web/chat/recommend',
    bodyReady: true,
    hasLoginNotice: false,
    hasRiskNotice: false,
  });
  assert.equal(result.code, 'NOT_CHAT_PAGE');
  assert.equal(result.runtimeState, 'PAUSED');
});

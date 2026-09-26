import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function collectPostSendConversation(');
const helper = source.slice(start, source.indexOf('\n  async function collectSelectedConversation(', start));

function fixture() {
  const panel = { isConnected: true };
  const anchor = { node: {}, identity: 'original-message', rawText: '好的', direction: 'INBOUND' };
  const state = { selected: { ok: false, code: 'NO_SELECTED_CONVERSATION' }, panels: [panel], turns: [anchor], reads: 0 };
  const collect = runInNewContext(`${helper}\ncollectPostSendConversation`, {
    collectSelectedConversation: async () => state.selected,
    document: { querySelectorAll: () => state.panels }, SELECTORS: { activeConversation: 'panel' },
    visible: () => true, readConversationTurns: () => state.turns,
    collectActiveConversationDetail: async chatDigest => { state.reads++; return { ok: true, chatDigest }; },
  });
  return { state, panel, anchor, run: () => collect('original-chat', panel, [anchor]) };
}

test('missing selected row allows the unchanged panel with retained original message evidence', async () => {
  const f = fixture();
  assert.equal((await f.run()).chatDigest, 'original-chat');
});
for (const scenario of ['other-chat', 'replaced-panel', 'reused-panel', 'changed-message', 'unreadable-time', 'multiple-panels']) {
  test(`post-send fallback rejects ${scenario}`, async () => {
    const f = fixture();
    if (scenario === 'other-chat') f.state.selected = { ok: true, chatDigest: 'other' };
    if (scenario === 'replaced-panel') f.state.panels = [{ isConnected: true }];
    if (scenario === 'reused-panel') f.state.turns = [{ ...f.anchor, node: {} }];
    if (scenario === 'changed-message') f.state.turns = [{ ...f.anchor, rawText: '不同正文' }];
    if (scenario === 'unreadable-time') f.state.selected = { ok: false, code: 'TIME_UNRECOGNISED' };
    if (scenario === 'multiple-panels') f.state.panels.push({ isConnected: true });
    assert.notEqual((await f.run()).chatDigest, 'original-chat');
    assert.equal(f.state.reads, 0);
  });
}

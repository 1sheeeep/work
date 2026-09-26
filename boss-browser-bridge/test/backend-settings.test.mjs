import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DEFAULT_BACKEND_URL, validateBackendUrl } from '../src/bridge-core.mjs';

// Exercise the actual background handlers with persistent storage across worker restarts.
const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const handlers = ['initialise', 'saveBackendUrl', 'forgetDevice', 'pair'].map(name => {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');

function worker(storage) {
  const context = {
    DEFAULT_BACKEND_URL, validateBackendUrl,
    BOSS_TAB_PATTERNS: [],
    sendToBossTab: async () => ({ ok: true }),
    SETTINGS_KEY: 'settings', RUNTIME_KEY: 'runtime', ALARM_NAME: 'alarm',
    request: async () => { throw new Error('令牌无效'); },
    chrome: { tabs: { query: async () => [], reload: async () => {} }, runtime: { getManifest: () => ({ version: '0.38.8' }) }, storage: { local: {
      get: async key => ({ [key]: storage[key] }),
      set: async values => Object.assign(storage, values),
      remove: async key => { delete storage[key]; },
    } }, alarms: { create: async () => {} } },
    prunePendingSendReconciliations: async () => {},
    recoverVerifiedInterviewEntryLock: async () => {},
    pollConversationLocations: async () => {},
    getSettings: async () => storage.settings,
    setRuntime: async value => { storage.runtime = { ...storage.runtime, ...value }; },
    getPublicStatus: async () => storage.settings,
  };
  return runInNewContext(`${handlers}\n({initialise, saveBackendUrl, forgetDevice, pair})`, context);
}

test('failed pairing preserves the selected environment across worker restarts', async () => {
  const storage = { settings: { backendUrl: DEFAULT_BACKEND_URL } };
  await assert.rejects(worker(storage).pair({ backendUrl: 'http://localhost:8088', deviceName: 'test', pairingToken: 'x'.repeat(32) }), /http:\/\/localhost:8088.*令牌无效/);
  await worker(storage).initialise();
  assert.equal(storage.settings.backendUrl, 'http://localhost:8088');
});

test('popup polling does not overwrite an edited address after focus moves to token', () => {
  const popup = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, addEventListener(type, fn) { this[type] = fn; }, setAttribute() {} });
    return nodes.get(id);
  };
  const context = {
    document: { getElementById: node, activeElement: null },
    chrome: { runtime: { getManifest: () => ({ version: 'test' }), sendMessage: async () => ({ ok: false }) } },
    setInterval: () => 1, clearInterval() {}, window: { addEventListener() {} },
  };
  const render = runInNewContext(`${popup}\nrender`, context);
  render({ paired: true, backendUrl: 'http://localhost:8088' });
  assert.equal(node('backendUrl').value, 'http://localhost:8088');
  assert.equal(node('pairForm').hidden, true);
  render({ backendUrl: DEFAULT_BACKEND_URL });
  node('backendUrl').value = 'http://localhost:8088';
  node('backendUrl').input();
  context.document.activeElement = node('pairingToken');
  render({ backendUrl: DEFAULT_BACKEND_URL });
  assert.equal(node('backendUrl').value, 'http://localhost:8088');
});

for (const url of ['http://localhost:8088', 'https://hr.xzkj.ai']) {
  test(`save, restart, pair and unpair preserve ${url}`, async () => {
    const storage = {};
    await worker(storage).initialise();
    await worker(storage).saveBackendUrl(url);
    await worker(storage).initialise();
    assert.equal(storage.settings.backendUrl, url);
    // Pairing writes a fresh settings object without the former migration marker.
    storage.settings = { backendUrl: url, enabled: true, deviceToken: 'token', deviceId: 'device' };
    await worker(storage).initialise();
    assert.equal(storage.settings.deviceToken, 'token');
    assert.equal(storage.settings.backendUrl, url);
    await worker(storage).forgetDevice();
    await worker(storage).initialise();
    assert.equal(storage.settings.backendUrl, url);
    assert.equal(storage.settings.deviceToken, undefined);
  });
}

test('switching environments clears credentials and old runtime, same address preserves pairing', async () => {
  const storage = { settings: { backendUrl: DEFAULT_BACKEND_URL, deviceToken: 'production-token' }, runtime: { oldTask: 'task' } };
  await worker(storage).saveBackendUrl(DEFAULT_BACKEND_URL);
  assert.equal(storage.settings.deviceToken, 'production-token');
  await worker(storage).saveBackendUrl('http://localhost:8088');
  assert.equal(storage.settings.deviceToken, undefined);
  assert.equal(storage.runtime.oldTask, undefined);
  assert.equal(storage.runtime.state, 'UNPAIRED');
  await worker(storage).initialise();
  assert.equal(storage.settings.backendUrl, 'http://localhost:8088');
});

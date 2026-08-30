import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, validateConfig } from '../src/lib/config.mjs';

const account = {
  accountId: '11111111-1111-4111-8111-111111111111',
  label: '上海社招账号',
  profileKey: 'shanghai-social',
  cdpPort: 54101,
  enabled: true,
};

test('accepts isolated multi-account configuration', () => {
  const config = validateConfig({
    backendUrl: 'http://localhost:8088',
    machineName: 'HR-Mac',
    accounts: [account, { ...account, accountId: '22222222-2222-4222-8222-222222222222', label: '技术招聘账号', profileKey: 'engineering', cdpPort: 54102 }],
  }, '/private/tmp/connector-test');
  assert.equal(config.accounts.length, 2);
  assert.match(config.accounts[0].profileDirectory, /profiles\/shanghai-social$/);
});

test('rejects a reused Chrome profile or CDP port', () => {
  assert.throws(() => validateConfig({
    backendUrl: 'http://localhost:8088', machineName: 'HR-Mac', accounts: [account, { ...account, accountId: '22222222-2222-4222-8222-222222222222', label: '重复账号' }],
  }), ConfigError);
});

test('rejects backend paths and credentials', () => {
  assert.throws(() => validateConfig({ backendUrl: 'https://user:pass@example.com/api', machineName: 'HR-Mac', accounts: [account] }), ConfigError);
});

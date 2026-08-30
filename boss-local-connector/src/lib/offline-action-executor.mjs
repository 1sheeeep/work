import { createHash } from 'node:crypto';

const ACTIONS = new Set(['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE']);
const DIGEST = /^[a-f0-9]{64}$/;

export const EXECUTOR_MANIFEST = Object.freeze({
  mode: 'FIXTURE_ONLY',
  productionEnabled: false,
  selectorSetId: null,
  actions: Object.freeze([...ACTIONS]),
});

export async function runOfflineActionDrill(adapter, lease, { stepTimeoutMs = 1000 } = {}) {
  assertFixtureAdapter(adapter);
  assertLease(lease);
  if (!Number.isInteger(stepTimeoutMs) || stepTimeoutMs < 10 || stepTimeoutMs > 10000) throw new Error('离线演练超时配置无效。');
  const before = await withTimeout(adapter.inspect(lease.actionType), stepTimeoutMs, '执行前检查超时');
  assertSnapshot(before, lease.targetDigest, '执行前');
  if (before.hasRiskOrVerification) throw new Error('执行前出现风险或验证提示，演练已停止。');
  const simulated = await withTimeout(adapter.simulate(lease.actionType), stepTimeoutMs, '仿真动作超时');
  if (simulated?.mode !== 'SIMULATED_NO_BROWSER_INPUT') throw new Error('适配器试图离开纯仿真模式，已拒绝。');
  const after = await withTimeout(adapter.inspect(lease.actionType), stepTimeoutMs, '执行后检查超时');
  assertSnapshot(after, lease.targetDigest, '执行后');
  if (after.hasRiskOrVerification) throw new Error('执行后出现风险或验证提示，结果记为未知。');
  if (before.stateDigest === after.stateDigest) throw new Error('仿真前后状态未发生可验证变化。');
  return Object.freeze({
    actionType: lease.actionType,
    outcome: 'PASSED',
    evidenceSource: 'FIXTURE_ONLY',
    beforeDigest: before.stateDigest,
    afterDigest: after.stateDigest,
    receiptDigest: sha256(`${lease.actionType}|${before.stateDigest}|${after.stateDigest}`),
    productionEnabled: false,
  });
}

function assertFixtureAdapter(adapter) {
  if (!adapter || adapter.mode !== 'FIXTURE_ONLY' || typeof adapter.inspect !== 'function' || typeof adapter.simulate !== 'function') throw new Error('只允许本地 fixture 适配器。');
}
function assertLease(lease) {
  if (!lease || !ACTIONS.has(lease.actionType) || !DIGEST.test(lease.targetDigest ?? '') || lease.mode !== 'OFFLINE_DRILL') throw new Error('离线演练租约无效。');
}
function assertSnapshot(value, target, stage) {
  if (!value || value.targetDigest !== target || !DIGEST.test(value.stateDigest ?? '') || typeof value.hasRiskOrVerification !== 'boolean') throw new Error(`${stage}快照无效或目标发生变化。`);
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function withTimeout(value, timeoutMs, message) {
  let timer;
  return Promise.race([Promise.resolve(value), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]).finally(() => clearTimeout(timer));
}

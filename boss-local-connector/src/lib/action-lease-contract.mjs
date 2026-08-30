const DIGEST = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(['SUCCEEDED', 'FAILED', 'UNKNOWN']);

export function validateClaimEnvelope(value) {
  if (!value?.available) return Object.freeze({ available: false, mode: 'NO_APPROVED_TASK' });
  if (value.mode !== 'CONTRACT_ONLY_NO_EXECUTOR') throw new Error('服务端租约模式不安全，已拒绝。');
  if (!value.leaseId || !value.taskId || !value.leaseToken || !DIGEST.test(value.targetDigest ?? '')) throw new Error('动作租约字段不完整，已拒绝。');
  if (!Number.isFinite(Date.parse(value.leaseUntil))) throw new Error('动作租约过期时间无效，已拒绝。');
  return Object.freeze({ ...value, executorAvailable: false });
}

export function buildReceipt(leaseToken, outcome, receiptDigest, reason) {
  if (!leaseToken || !OUTCOMES.has(outcome) || !DIGEST.test(receiptDigest ?? '')) throw new Error('动作回执无效。');
  const cleanReason = String(reason ?? '').trim();
  if (!cleanReason || cleanReason.length > 300) throw new Error('动作回执说明无效。');
  return Object.freeze({ leaseToken, outcome, receiptDigest, reason: cleanReason });
}

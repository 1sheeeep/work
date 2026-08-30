const WRITE_ACTIONS = new Set(['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE']);
const DIGEST = /^[a-f0-9]{64}$/;

export function buildActionPreview(input) {
  if (!input || !WRITE_ACTIONS.has(input.actionType)) return blocked('ACTION_UNSUPPORTED', '不支持的页面动作。');
  if (!DIGEST.test(input.chatDigest ?? '')) return blocked('TARGET_UNSTABLE', '当前会话缺少稳定摘要，禁止定位操作目标。');
  if (input.capabilityStatus !== 'READY_FOR_MANUAL_TEST' && input.capabilityStatus !== 'PRODUCTION_APPROVED') {
    return blocked('CAPABILITY_UNVERIFIED', '该写操作尚未通过真实页面验收。');
  }
  if (input.pageState !== 'CHAT_PAGE_READY') return blocked('PAGE_NOT_READY', '当前不在稳定的 BOSS 沟通页面。');
  if (!input.selectedConversationVerified) return blocked('CONVERSATION_NOT_VERIFIED', '尚未复核当前选中会话。');
  if (input.hasRiskOrVerification) return blocked('RISK_OR_VERIFICATION', '页面出现验证或风险提示。');
  return Object.freeze({
    allowed: true,
    actionType: input.actionType,
    targetDigest: input.chatDigest,
    mode: 'PREVIEW_ONLY',
    reason: '前置条件已满足；当前版本仍只生成操作预览，不包含点击或输入实现。',
  });
}

function blocked(code, reason) {
  return Object.freeze({ allowed: false, code, reason, mode: 'PREVIEW_ONLY' });
}

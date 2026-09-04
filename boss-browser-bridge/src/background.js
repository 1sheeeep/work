import { DEFAULT_BACKEND_URL, consolePathForContext, isJobManagementUrl, jobSnapshotSignature, pageContextFromUrl, publicStatus, snapshotSignature, validateApprovedDraftFillContext, validateApprovedDraftFillResult, validateBackendUrl, validateControlDomDiagnostic, validateCurrentActionEntryTestResult, validateCurrentTestDraftSendResult, validateDraftFillResult, validateExchangeConfirmationTestResult, validateJobSnapshot, validateSnapshot, validateValidationReadiness } from './bridge-core.mjs';

const SETTINGS_KEY = 'bridgeSettingsV1';
const RUNTIME_KEY = 'bridgeRuntimeV1';
const ALARM_NAME = 'bridge-observe';
const MIN_SYNC_INTERVAL_MS = 10_000;
const BOSS_TAB_PATTERNS = ['https://zhipin.com/*', 'https://*.zhipin.com/*'];
let syncInFlight = null;
let jobSyncInFlight = null;

chrome.runtime.onInstalled.addListener(() => initialise());
chrome.runtime.onStartup.addListener(() => initialise());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void collectFromBestTab();
});
chrome.commands.onCommand.addListener((command) => {
  if (command === 'check-reply-readiness') void checkReplyReadiness().catch((error) => setRuntime({ readinessState: `回复入口检查失败：${safeError(error)}` }));
  if (command === 'fill-test-draft') void fillTestDraft().catch((error) => setRuntime({ draftTestState: `草稿测试失败：${safeError(error)}` }));
  if (command === 'fill-approved-draft') void fillApprovedDraft().catch((error) => setRuntime({ approvedDraftFillState: `已审核草稿填入失败：${safeError(error)}` }));
  if (command === 'inspect-current-controls') void inspectCurrentControls()
    .catch((error) => setRuntime({ controlDiagnosticState: `快捷键识别失败：${safeError(error)}` }));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});

void initialise();

async function initialise() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { backendUrl: DEFAULT_BACKEND_URL, enabled: true } });
  }
  await recoverVerifiedInterviewEntryLock();
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes: 1 });
}

async function recoverVerifiedInterviewEntryLock() {
  const runtime = await getRuntime();
  if (!runtime.actionTestLocks?.INTERVIEW
      || runtime.interviewInnerTargetRecoveryApplied
      || !String(runtime.actionTestState || '').includes('约面试：点击后结果无法明确确认')) return;
  const diagnostic = runtime.controlDiagnostic;
  if (!diagnostic || diagnostic.actionType !== 'CURRENT_CONTROL_DOM_DIAGNOSTIC' || !/^[a-f0-9]{64}$/.test(diagnostic.chatDigest || '')) return;
  const outer = diagnostic.controls?.filter((control) => control.knownAction === '约面试' && control.classes?.includes('operate-btn') && control.visible && !control.disabled);
  const inner = diagnostic.controls?.filter((control) => control.ownerAction === '约面试' && control.classes?.includes('interview') && control.visible && !control.disabled && control.cursor === 'pointer');
  if (outer?.length !== 1 || inner?.length !== 1 || outer[0].labelDigest !== inner[0].labelDigest) return;
  const actionTestLocks = { ...(runtime.actionTestLocks || {}) };
  delete actionTestLocks.INTERVIEW;
  await setRuntime({ actionTestLocks, interviewInnerTargetRecoveryApplied: true,
    actionTestState: '约面试：已依据点击后脱敏报告确认页面未变化；仅允许改用内部入口再执行一次人工验收。' });
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'BRIDGE_GET_STATUS':
      return { ok: true, status: await getPublicStatus() };
    case 'BRIDGE_PAIR':
      return pair(message.payload);
    case 'BRIDGE_SET_ENABLED':
      return setEnabled(Boolean(message.enabled));
    case 'BRIDGE_FORGET_DEVICE':
      return forgetDevice();
    case 'BRIDGE_COLLECT_NOW':
      await collectFromBestTab();
      return { ok: true, status: await getPublicStatus() };
    case 'BRIDGE_COLLECT_JOBS_NOW':
      return { ok: true, jobSync: await collectJobsFromBestTab(), status: await getPublicStatus() };
    case 'BRIDGE_CHECK_REPLY_READINESS':
      return { ok: true, readiness: await checkReplyReadiness(), status: await getPublicStatus() };
    case 'BRIDGE_INSPECT_CURRENT_CONTROLS':
      return { ok: true, diagnostic: await inspectCurrentControls(), status: await getPublicStatus() };
    case 'BRIDGE_TEST_CURRENT_ACTION_ENTRY':
      return { ok: true, actionTest: await testCurrentActionEntry(message.action), status: await getPublicStatus() };
    case 'BRIDGE_CONFIRM_CURRENT_EXCHANGE':
      return { ok: true, exchangeConfirm: await confirmCurrentExchange(message.action), status: await getPublicStatus() };
    case 'BRIDGE_FILL_TEST_DRAFT':
      return { ok: true, draftTest: await fillTestDraft(), status: await getPublicStatus() };
    case 'BRIDGE_PREPARE_CURRENT_SEND_TEST':
      return { ok: true, preparation: await prepareCurrentSendTest(), status: await getPublicStatus() };
    case 'BRIDGE_SEND_CURRENT_TEST_DRAFT':
      return { ok: true, sendTest: await sendCurrentTestDraft(), status: await getPublicStatus() };
    case 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY':
      return { ok: true, diagnostic: await diagnoseCurrentAutoReply(), status: await getPublicStatus() };
    case 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST':
      return { ok: true, armed: await armCurrentAutoReplyTest(), status: await getPublicStatus() };
    case 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST':
      return { ok: true, cancelled: await cancelCurrentAutoReplyTest(), status: await getPublicStatus() };
    case 'BRIDGE_FILL_APPROVED_DRAFT':
      return { ok: true, approvedDraftFill: await fillApprovedDraft(), status: await getPublicStatus() };
    case 'BRIDGE_OPEN_CONSOLE':
      return openConsole();
    case 'BRIDGE_PAGE_SNAPSHOT':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的快照。');
      return submitSnapshot(message.payload);
    case 'BRIDGE_JOB_SNAPSHOT':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的职位快照。');
      return submitJobSnapshot(message.payload);
    case 'BRIDGE_JOB_BLOCKED':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的职位状态。');
      return reportJobBlocked(message.payload);
    case 'BRIDGE_PAGE_BLOCKED':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的状态。');
      return reportBlocked(message.payload);
    case 'BRIDGE_AUTO_REPLY_TEST_RESULT':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的触发测试结果。');
      return recordAutoReplyTestResult(message.payload);
    case 'BRIDGE_AUTO_REPLY_TEST_PROGRESS':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的触发测试进度。');
      return recordAutoReplyTestProgress(message.payload);
    default:
      throw new Error('未知的桥接请求。');
  }
}

async function inspectCurrentControls() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_INSPECT_CURRENT_CONTROLS' });
  if (!response?.ok) throw new Error(response?.error || '当前会话功能键 DOM 识别失败。');
  const diagnostic = validateControlDomDiagnostic(response.diagnostic);
  await setRuntime({ controlDiagnostic: diagnostic, controlDiagnosticState: `已识别 ${diagnostic.controls.length} 个当前会话可见控件；报告仅保存在本机扩展。`, lastControlDiagnosticAt: diagnostic.observedAt });
  return diagnostic;
}

async function testCurrentActionEntry(action) {
  const settings = await getSettings();
  const runtime = await getRuntime();
  const labels = { REQUEST_RESUME: '求简历', EXCHANGE_PHONE: '换电话', EXCHANGE_WECHAT: '换微信', INTERVIEW: '约面试' };
  if (!labels[action]) throw new Error('不支持的操作入口测试。');
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  if (runtime.actionTestLocks?.[action]) throw new Error(`“${labels[action]}”入口测试已点击过一次，为避免重复操作已锁定。`);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const actionTestLocks = { ...(runtime.actionTestLocks || {}), [action]: true };
  await setRuntime({ actionTestLocks, actionTestState: `${labels[action]}：正在执行单次入口核对；异常中断时保持锁定。` });
  let response;
  try {
    response = await sendToBossTab(tab.id, { type: 'BRIDGE_TEST_CURRENT_ACTION_ENTRY', action });
    if (!response?.ok) {
      const latest = await getRuntime();
      const clearedLocks = { ...(latest.actionTestLocks || {}) }; delete clearedLocks[action];
      await setRuntime({ actionTestLocks: clearedLocks, actionTestState: `${labels[action]}：页面在点击前拒绝了测试，可修正后重试。` });
      throw new Error(response?.error || `“${labels[action]}”入口测试失败。`);
    }
  } catch (error) {
    if (response?.ok === false) throw error;
    throw new Error(`${labels[action]}入口测试通信中断，无法证明是否已点击；已保持锁定，禁止重试。`);
  }
  const result = validateCurrentActionEntryTestResult(response.actionTest);
  const outcome = { DIALOG_OPENED: '已打开平台确认弹窗，扩展未确认，请由 HR 检查或取消。', STATE_CHANGED: '点击后页面状态已变化，扩展未执行第二次操作。', UNKNOWN: '点击后结果无法明确确认，已停止且不会重试。' }[result.outcome];
  await setRuntime({ actionTestLocks, actionTestState: `${labels[action]}：${outcome}`, lastActionTestAt: new Date().toISOString() });
  return result;
}

async function confirmCurrentExchange(action) {
  const settings = await getSettings(); const runtime = await getRuntime();
  const labels = { EXCHANGE_PHONE: '换电话', EXCHANGE_WECHAT: '换微信' };
  if (!labels[action]) throw new Error('不支持的联系方式二级确认测试。');
  if (!settings.deviceToken || settings.enabled === false) throw new Error('浏览器桥接未配对或已暂停。');
  if (runtime.exchangeConfirmLocks?.[action]) throw new Error(`“${labels[action]}”二级确定测试已执行过，禁止重复。`);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const exchangeConfirmLocks = { ...(runtime.exchangeConfirmLocks || {}), [action]: true };
  await setRuntime({ exchangeConfirmLocks, exchangeConfirmState: `${labels[action]}：正在核对二级确定入口；异常中断保持锁定。` });
  let response;
  try {
    response = await sendToBossTab(tab.id, { type: 'BRIDGE_CONFIRM_CURRENT_EXCHANGE', action });
    if (!response?.ok) {
      const latest = await getRuntime(); const cleared = { ...(latest.exchangeConfirmLocks || {}) }; delete cleared[action];
      await setRuntime({ exchangeConfirmLocks: cleared, exchangeConfirmState: `${labels[action]}：在点击前未通过二级确认核对，可修正后重试。` });
      throw new Error(response?.error || '二级确认测试失败。');
    }
  } catch (error) {
    if (response?.ok === false) throw error;
    throw new Error(`${labels[action]}二级确认测试通信中断，无法证明是否已点击；已保持锁定。`);
  }
  const result = validateExchangeConfirmationTestResult(response.exchangeConfirm);
  const text = result.outcome === 'STATE_CHANGED' ? '二级确定后页面状态已变化，未执行其他动作。' : '二级确定后结果不明确，已停止且不重试。';
  await setRuntime({ exchangeConfirmLocks, exchangeConfirmState: `${labels[action]}：${text}`, lastExchangeConfirmAt: new Date().toISOString() });
  return result;
}

async function fillTestDraft() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => item.active && /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (!tab?.id) throw new Error('请由 HR 手动打开 BOSS 沟通页，并选中一个已读会话。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_FILL_TEST_DRAFT' });
  if (!response?.ok) throw new Error(response?.error || '测试草稿未能写入。');
  validateDraftFillResult(response.draftTest);
  const draftTestState = '固定测试草稿已写入当前已读会话的空输入框；未点击发送，请由 HR 目视确认并手动清空。';
  await setRuntime({ draftTestState, lastDraftTestAt: new Date().toISOString() });
  return response.draftTest;
}

async function fillApprovedDraft() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => item.active && /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (!tab?.id) throw new Error('请由 HR 手动打开 BOSS 沟通页，并选中需要处理的会话。');
  const prepared = await sendToBossTab(tab.id, { type: 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL' });
  if (!prepared?.ok) throw new Error(prepared?.error || '当前页面未满足草稿填入条件。');
  const context = validateApprovedDraftFillContext(prepared.context);
  let claim = null;
  try {
    claim = await request(settings.backendUrl, '/api/local-connector/runtime/approved-draft-fill/claim', { method: 'POST', token: settings.deviceToken, body: { chatDigest: context.chatDigest } });
    if (claim.chatDigest !== context.chatDigest || !/^[a-f0-9]{64}$/.test(claim.draftDigest || '') || !claim.claimToken || !claim.content) throw new Error('后台返回的已审核草稿凭据无效。');
    const filled = await sendToBossTab(tab.id, { type: 'BRIDGE_FILL_APPROVED_DRAFT', payload: { chatDigest: claim.chatDigest, controlDigest: context.controlDigest, draftDigest: claim.draftDigest, content: claim.content } });
    if (!filled?.ok) throw new Error(filled?.error || '页面未能保留已审核草稿。');
    const result = validateApprovedDraftFillResult(filled.result);
    await request(settings.backendUrl, '/api/local-connector/runtime/approved-draft-fill/receipt', { method: 'POST', token: settings.deviceToken, body: { chatDigest: result.chatDigest, draftDigest: result.draftDigest, claimToken: claim.claimToken, outcome: 'FILLED', beforeStateDigest: result.beforeStateDigest, afterStateDigest: result.afterStateDigest, controlDigest: result.controlDigest } });
    const approvedDraftFillState = '后台已审核安全草稿已填入当前输入框；未点击发送，请由 HR 目视确认。';
    await setRuntime({ approvedDraftFillState, lastApprovedDraftFillAt: new Date().toISOString() });
    return result;
  } catch (error) {
    if (claim?.claimToken && claim?.chatDigest && claim?.draftDigest) {
      const unknownDigest = await digestText(`${claim.chatDigest}|${context.controlDigest}|UNKNOWN`);
      await request(settings.backendUrl, '/api/local-connector/runtime/approved-draft-fill/receipt', { method: 'POST', token: settings.deviceToken, body: { chatDigest: claim.chatDigest, draftDigest: claim.draftDigest, claimToken: claim.claimToken, outcome: 'UNKNOWN', beforeStateDigest: unknownDigest, afterStateDigest: unknownDigest, controlDigest: context.controlDigest } }).catch(() => {});
    }
    throw error;
  }
}

async function sendCurrentTestDraft() {
  const settings = await getSettings();
  const runtime = await getRuntime();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  if (runtime.sendTestLocked === true || !/^[a-f0-9]{64}$/.test(runtime.sendTestPreparedChatDigest || '')) throw new Error('请先为当前新的已读会话执行一次安全准备。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/(^|\.)zhipin\.com$/i.test(safeHostname(tab?.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab?.url || '')) throw new Error('扩展当前窗口的活动标签不是 BOSS 沟通页，已停止发送测试。');
  if (!tab?.id) throw new Error('请由 HR 手动打开 BOSS 沟通页，并保持当前测试会话选中。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_SEND_CURRENT_TEST_DRAFT', expectedChatDigest: runtime.sendTestPreparedChatDigest });
  if (!response?.ok) throw new Error(response?.error || '当前会话未能执行单次发送测试。');
  const result = validateCurrentTestDraftSendResult(response.sendTest);
  const sendTestState = result.outcome === 'SUCCEEDED'
    ? '当前已打开会话的固定测试草稿已发送并识别到页面成功变化；未操作其他会话。'
    : '已对当前会话点击一次发送，但页面结果未能明确确认；已停止且不会重试。';
  await setRuntime({ sendTestState, lastSendTestAt: new Date().toISOString(), sendTestLocked: true, sendTestLockedChatDigest: result.chatDigest, sendTestPreparedChatDigest: null });
  return result;
}

async function prepareCurrentSendTest() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_PREPARE_CURRENT_SEND_TEST' });
  if (!response?.ok) throw new Error(response?.error || '当前会话未通过新一轮发送测试准备。');
  const context = response.context;
  if (context?.actionType !== 'CURRENT_SEND_TEST_PREPARATION' || !/^[a-f0-9]{64}$/.test(context.chatDigest || '') || !/^[a-f0-9]{64}$/.test(context.controlDigest || '') || context.selectedUnread !== false || context.editorEmpty !== true || context.repeatManuallyAuthorized !== true || context.stableCycles !== 2) throw new Error('当前会话发送测试准备证据无效。');
  const runtime = await getRuntime();
  await setRuntime({ sendTestLocked: false, sendTestPreparedChatDigest: context.chatDigest, sendTestState: `当前会话已通过本轮安全准备（定位码 ${context.chatDigest.slice(0, 12)}）；本轮仅允许一次固定草稿发送测试。` });
  return context;
}

async function armCurrentAutoReplyTest() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const runtime = await getRuntime();
  if (runtime.autoReplyTestArmed === true) throw new Error('当前已有一轮触发测试处于等待状态。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST' });
  if (!response?.ok) throw new Error(response?.error || '当前会话未能开启触发测试。');
  const context = response.context;
  if (context?.actionType !== 'CURRENT_AUTO_REPLY_TEST_ARMED' || !/^[a-f0-9]{64}$/.test(context.chatDigest || '') || !/^[a-f0-9]{64}$/.test(context.baselineMessageDigest || '') || context.oneShot !== true || !Number.isFinite(Date.parse(context.expiresAt))) throw new Error('触发测试准备证据无效。');
  await setRuntime({ autoReplyTestArmed: true, autoReplyTestChatDigest: context.chatDigest, autoReplyTestExpiresAt: context.expiresAt, autoReplyTestOutcome: 'ARMED', autoReplyTestReason: '正在判断当前会话最后一条消息方向；候选人来信将触发一次回复。', autoReplyTestState: `已监测当前会话（定位码 ${context.chatDigest.slice(0, 12)}）；最后一条消息为候选人来信时立即触发，最长等待 10 分钟。` });
  return context;
}

async function diagnoseCurrentAutoReply() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) throw new Error('当前活动标签不是 BOSS 沟通页。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY' });
  if (!response?.ok) throw new Error(response?.error || '当前触发条件诊断失败。');
  const diagnostic = response.diagnostic;
  if (diagnostic?.actionType !== 'CURRENT_AUTO_REPLY_DIAGNOSTIC' || typeof diagnostic.selectedConversation !== 'boolean' || !String(diagnostic.code || '').trim() || !String(diagnostic.reason || '').trim() || !Number.isFinite(Date.parse(diagnostic.checkedAt))) throw new Error('当前触发条件诊断结果无效。');
  if (diagnostic.selectedConversation && (!/^[a-f0-9]{64}$/.test(diagnostic.chatDigest || '') || !['INBOUND', 'OUTBOUND'].includes(diagnostic.direction) || typeof diagnostic.selectedUnread !== 'boolean' || typeof diagnostic.editorReady !== 'boolean' || typeof diagnostic.editorEmpty !== 'boolean' || !Number.isInteger(diagnostic.sendButtonCount) || typeof diagnostic.sendButtonReady !== 'boolean')) throw new Error('当前触发条件诊断字段无效。');
  const state = diagnostic.selectedConversation
    ? `方向=${diagnostic.direction}；已读=${!diagnostic.selectedUnread}；输入框可用=${diagnostic.editorReady}；输入框为空=${diagnostic.editorEmpty}；空输入框阶段可用发送按钮=${diagnostic.sendButtonCount}（写入草稿后再复核）。`
    : `当前会话识别失败：${diagnostic.reason}`;
  await setRuntime({ autoReplyDiagnosticState: state, lastAutoReplyDiagnosticAt: diagnostic.checkedAt });
  return diagnostic;
}

async function cancelCurrentAutoReplyTest() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && /(^|\.)zhipin\.com$/i.test(safeHostname(tab.url))) await sendToBossTab(tab.id, { type: 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST' }).catch(() => {});
  await setRuntime({ autoReplyTestArmed: false, autoReplyTestChatDigest: null, autoReplyTestExpiresAt: null, autoReplyTestOutcome: 'CANCELLED', autoReplyTestReason: '本轮触发测试已由 HR 取消，未发送。', autoReplyTestState: '本轮触发测试已由 HR 取消，未发送。' });
  return true;
}

async function recordAutoReplyTestResult(payload) {
  const runtime = await getRuntime();
  if (payload?.actionType !== 'CURRENT_AUTO_REPLY_TEST_RESULT' || !['SUCCEEDED', 'UNKNOWN', 'BLOCKED', 'CANCELLED', 'EXPIRED'].includes(payload.outcome) || payload.retryTriggered !== false || !String(payload.reason || '').trim() || !Number.isFinite(Date.parse(payload.occurredAt))) throw new Error('触发测试结果无效。');
  if (runtime.autoReplyTestChatDigest && payload.chatDigest && runtime.autoReplyTestChatDigest !== payload.chatDigest) throw new Error('触发测试结果与已武装会话不一致。');
  const state = payload.outcome === 'SUCCEEDED' ? '触发成功：确认当前会话最后一条消息来自候选人，并自动发送了一次固定测试草稿。'
    : payload.outcome === 'UNKNOWN' ? '已点击一次发送，但结果无法确认；本轮已停止且不会重试。'
    : String(payload.reason).slice(0, 300);
  await setRuntime({ autoReplyTestArmed: false, autoReplyTestChatDigest: null, autoReplyTestExpiresAt: null, autoReplyTestOutcome: payload.outcome, autoReplyTestReason: String(payload.reason).slice(0, 300), autoReplyTestState: state, lastAutoReplyTestAt: payload.occurredAt });
  return { ok: true };
}

async function recordAutoReplyTestProgress(payload) {
  const runtime = await getRuntime();
  if (payload?.actionType !== 'CURRENT_AUTO_REPLY_TEST_PROGRESS' || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '') || !['INBOUND', 'OUTBOUND'].includes(payload.direction) || typeof payload.messageChanged !== 'boolean' || !Number.isFinite(Date.parse(payload.checkedAt))) throw new Error('触发测试进度无效。');
  if (!runtime.autoReplyTestArmed || runtime.autoReplyTestChatDigest !== payload.chatDigest) return { ok: true, ignored: true };
  const directionLabel = payload.direction === 'INBOUND' ? '求职者来信（INBOUND）' : 'HR 发出（OUTBOUND）';
  await setRuntime({ autoReplyTestOutcome: 'ARMED', autoReplyTestReason: `最近检查识别为：${directionLabel}${payload.messageChanged ? '，消息摘要已变化' : '，消息摘要未变化'}。`, autoReplyTestLastCheckedAt: payload.checkedAt });
  return { ok: true };
}

async function digestText(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function openConsole() {
  const settings = await getSettings();
  const runtime = await getRuntime();
  const url = `${validateBackendUrl(settings.backendUrl || DEFAULT_BACKEND_URL)}${consolePathForContext(runtime.pageContext)}`;
  await chrome.tabs.create({ url });
  return { ok: true };
}

async function checkReplyReadiness() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('只读桥接已暂停。');
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => item.active && /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (!tab?.id) throw new Error('请在当前 Chrome 中手动打开 BOSS 沟通页并选中一个已读会话。');
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_CHECK_REPLY_READINESS' });
  if (!response?.ok) throw new Error(response?.error || '回复入口尚未稳定识别。');
  validateValidationReadiness(response.readiness);
  const result = await request(settings.backendUrl, '/api/local-connector/runtime/validation-readiness', {
    method: 'POST', token: settings.deviceToken, body: response.readiness,
  });
  const readinessState = '回复入口已连续稳定识别 3 次，可在后台开启单次人工验收；本次未点击、未输入、未发送。';
  await setRuntime({ readinessState, lastReadinessAt: new Date().toISOString() });
  return result;
}

async function collectJobsFromBestTab() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('只读桥接已暂停，请先开启只读观测。');
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => item.active && isJobManagementUrl(item.url)) || tabs.find((item) => isJobManagementUrl(item.url));
  if (!tab?.id) {
    const reason = '请先在当前招聘账号中手动打开“职位管理”页面；扩展不会自动跳转。';
    await setRuntime({ jobState: reason });
    throw new Error(reason);
  }
  try {
    const response = await collectJobsFromAllFrames(tab.id);
    if (!response?.ok) throw new Error(response?.error || '职位页面脚本未连接。');
    return response.sync || { received: 0, created: 0, updated: 0, unchanged: 0 };
  } catch (error) {
    const reason = `职位页暂未采集：${safeError(error)} 请刷新 BOSS 页面后重试。`;
    await setRuntime({ jobState: reason });
    throw new Error(reason);
  }
}

async function collectJobsFromAllFrames(tabId) {
  const injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/content.js'] });
  const frameIds = [...new Set(injected.map((item) => item.frameId))].sort((a, b) => a - b);
  if (!frameIds.length) throw new Error('当前 BOSS 页面没有可访问的文档 frame。');
  const failures = [];
  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_COLLECT_JOBS', allowEmbeddedJobList: frameId !== 0 }, { frameId });
      if (response?.ok) return response;
      if (response?.pageMatched) throw new Error(response.error || '本地服务未接受已识别的职位详情。');
      failures.push(response?.error || `frame ${frameId} 未返回职位数据`);
    } catch (error) { failures.push(safeError(error)); }
  }
  throw new Error([...new Set(failures)].slice(0, 3).join('；') || '所有页面 frame 均未找到职位列表。');
}

async function sendToBossTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const reason = safeError(error);
    if (!/receiving end does not exist|could not establish connection/i.test(reason)) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
    await new Promise((resolve) => setTimeout(resolve, 120));
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function pair(payload) {
  const pairingToken = String(payload?.pairingToken || '').trim();
  const deviceName = String(payload?.deviceName || '').trim();
  if (pairingToken.length < 20 || pairingToken.length > 200) throw new Error('请粘贴有效的一次性接入码。');
  if (!deviceName || deviceName.length > 80) throw new Error('请填写 1–80 字的设备名称。');
  const backendUrl = validateBackendUrl(payload?.backendUrl || DEFAULT_BACKEND_URL);
  const credentials = await request(backendUrl, '/api/local-connector/runtime/pair', {
    method: 'POST',
    body: {
      pairingToken,
      deviceName: `Chrome 只读桥接 · ${deviceName}`,
      clientType: 'BROWSER_READONLY_BRIDGE',
      clientVersion: chrome.runtime.getManifest().version,
    },
  });
  const settings = {
    backendUrl,
    enabled: true,
    deviceId: credentials.deviceId,
    deviceToken: credentials.deviceToken,
    accountId: credentials.accountId,
    accountName: credentials.accountName,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await setRuntime({ state: 'PAIRED', reason: '已配对，等待 BOSS 沟通页的稳定只读快照。' });
  void collectFromBestTab();
  return { ok: true, status: await getPublicStatus() };
}

async function setEnabled(enabled) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled } });
  if (!enabled) {
    await sendHeartbeatIfPaired({ ...settings, enabled }, 'PAUSED', '已由 HR 暂停只读桥接。', (await getRuntime()).pageContext);
    await setRuntime({ state: 'PAUSED', reason: '已由 HR 暂停只读桥接。' });
  } else {
    await setRuntime({ state: 'IDLE', reason: '已恢复只读桥接，等待下一次检测。' });
    void collectFromBestTab();
  }
  return { ok: true, status: await getPublicStatus() };
}

async function forgetDevice() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { backendUrl: DEFAULT_BACKEND_URL, enabled: true } });
  await chrome.storage.local.remove(RUNTIME_KEY);
  return { ok: true, status: await getPublicStatus() };
}

async function collectFromBestTab() {
  const settings = await getSettings();
  if (!settings.deviceToken || settings.enabled === false) return;
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (!tab?.id) {
    const visibleBossTab = tabs.find((item) => item.active) || tabs[0];
    const pageContext = pageContextFromUrl(visibleBossTab?.url);
    await sendHeartbeatIfPaired(settings, 'PAUSED', '未找到已打开的 BOSS 沟通页；职位管理页仍可手动同步。', pageContext);
    await setRuntime({ state: 'PAUSED', reason: '未找到已打开的 BOSS 沟通页；职位管理页仍可手动同步。', pageContext });
    return;
  }
  try {
    const response = await sendToBossTab(tab.id, { type: 'BRIDGE_COLLECT' });
    if (!response?.ok) throw new Error(response?.error || '页面脚本未连接。');
  } catch {
    await sendHeartbeatIfPaired(settings, 'PAUSED', 'BOSS 页面脚本尚未就绪，请手动刷新该页面。', 'CHAT');
    await setRuntime({ state: 'PAUSED', reason: 'BOSS 页面脚本尚未就绪，请手动刷新该页面。', pageContext: 'CHAT' });
  }
}

async function submitSnapshot(payload) {
  const settings = await getSettings();
  if (!settings.deviceToken) return { ok: false, error: '请先用后台一次性接入码完成配对。' };
  if (settings.enabled === false) return { ok: false, error: '只读桥接已暂停。' };
  validateSnapshot(payload);
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSubmitSnapshot(settings, payload).finally(() => { syncInFlight = null; });
  return syncInFlight;
}

async function submitJobSnapshot(payload) {
  const settings = await getSettings();
  if (!settings.deviceToken) return { ok: false, error: '请先用后台一次性接入码完成配对。' };
  if (settings.enabled === false) return { ok: false, error: '只读桥接已暂停。' };
  validateJobSnapshot(payload);
  if (jobSyncInFlight) return jobSyncInFlight;
  jobSyncInFlight = doSubmitJobSnapshot(settings, payload).finally(() => { jobSyncInFlight = null; });
  return jobSyncInFlight;
}

async function doSubmitJobSnapshot(settings, payload) {
  const runtime = await getRuntime();
  const signature = jobSnapshotSignature(payload);
  const now = Date.now();
  if (runtime.lastJobSignature === signature && now - Number(runtime.lastJobSubmittedAt || 0) < MIN_SYNC_INTERVAL_MS) return { ok: true, skipped: true };
  const sync = await request(settings.backendUrl, '/api/local-connector/runtime/job-observations', {
    method: 'POST', token: settings.deviceToken, body: { entries: payload.entries, observedAt: payload.observedAt },
  });
  const jobState = `职位页同步完成：识别 ${sync.received} 个，新增 ${sync.created} 个，更新 ${sync.updated} 个，重复或无需变更 ${sync.unchanged} 个。`;
  const pageContext = payload.entries.some((entry) => entry.completeness > 5) ? 'JOB_DETAIL' : 'JOB_LIST';
  await sendHeartbeatIfPaired(settings, 'RUNNING', jobState, pageContext);
  await setRuntime({ jobState, jobTotal: sync.received, lastJobSyncAt: new Date().toISOString(), lastJobSignature: signature, lastJobSubmittedAt: now, pageContext });
  return { ok: true, sync };
}

async function doSubmitSnapshot(settings, payload) {
  const runtime = await getRuntime();
  const signature = snapshotSignature(payload);
  const now = Date.now();
  if (runtime.lastSignature === signature && now - Number(runtime.lastSubmittedAt || 0) < MIN_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }
  const sync = await request(settings.backendUrl, '/api/local-connector/runtime/unread-observations', {
    method: 'POST', token: settings.deviceToken, body: { entries: payload.entries },
  });
  let detailState = payload.detailStatus?.reason || '尚未复核当前会话详情。';
  if (payload.selected) {
    try {
      await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
        method: 'POST', token: settings.deviceToken, body: payload.selected,
      });
      detailState = '当前会话详情已稳定复核并安全入库。';
    } catch (error) {
      detailState = `详情暂未入库：${safeError(error)}`;
    }
  }
  const currentUnread = payload.entries.filter((entry) => entry.unreadCount > 0).length;
  const trackedUnread = Number.isInteger(sync?.activeUnread) ? sync.activeUnread : currentUnread;
  const reason = `本次页面稳定识别 ${payload.entries.length} 个会话、${currentUnread} 个未读；后端持续观察 ${trackedUnread} 条（仅上传摘要）；${detailState}`;
  await sendHeartbeatIfPaired(settings, 'RUNNING', reason, 'CHAT');
  await setRuntime({ state: 'RUNNING', reason, detailState, lastSyncAt: new Date().toISOString(), total: payload.entries.length, currentUnread, trackedUnread, lastSignature: signature, lastSubmittedAt: now, pageContext: 'CHAT' });
  return { ok: true };
}

async function reportBlocked(payload) {
  const settings = await getSettings();
  const code = String(payload?.code || 'PAGE_NOT_READY').slice(0, 80);
  const reason = String(payload?.reason || '当前页面不可观测。').slice(0, 220);
  await sendHeartbeatIfPaired(settings, 'PAUSED', `${code}：${reason}`, 'CHAT');
  await setRuntime({ state: 'PAUSED', reason });
  return { ok: true };
}

async function reportJobBlocked(payload) {
  const code = String(payload?.code || 'JOB_PAGE_NOT_READY').slice(0, 80);
  const reason = String(payload?.reason || '当前职位页面不可采集。').slice(0, 220);
  await setRuntime({ jobState: `${code}：${reason}` });
  return { ok: true };
}

async function request(backendUrl, path, options) {
  let response;
  try {
    response = await fetch(`${validateBackendUrl(backendUrl)}${path}`, {
      method: options.method,
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Device ${options.token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new Error(`无法连接本机招聘值守台：${safeError(error)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `本地服务返回 HTTP ${response.status}`);
  return body;
}

async function sendHeartbeatIfPaired(settings, state, reason, pageContext = 'NO_BOSS_PAGE') {
  if (!settings?.deviceToken) return;
  await request(settings.backendUrl, '/api/local-connector/runtime/heartbeat', {
    method: 'POST', token: settings.deviceToken, body: { state, reason: String(reason).slice(0, 300), pageContext },
  }).catch(() => {});
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return stored[SETTINGS_KEY] || { backendUrl: DEFAULT_BACKEND_URL, enabled: true };
}

async function getRuntime() {
  const stored = await chrome.storage.local.get(RUNTIME_KEY);
  return stored[RUNTIME_KEY] || {};
}

async function setRuntime(patch) {
  await chrome.storage.local.set({ [RUNTIME_KEY]: { ...(await getRuntime()), ...patch } });
}

async function getPublicStatus() {
  return publicStatus(await getSettings(), await getRuntime());
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function safeHostname(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

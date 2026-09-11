import { DEFAULT_BACKEND_URL, compactProcessedMessages, consolePathForContext, isJobManagementUrl, isSupportedActionLeaseMode, jobSnapshotSignature, nextConsecutiveFailureCount, pageContextFromUrl, publicStatus, snapshotSignature, validateActionLeaseExecutionResult, validateApprovedDraftFillContext, validateApprovedDraftFillResult, validateBackendUrl, validateControlDomDiagnostic, validateCurrentActionEntryTestResult, validateCurrentTestDraftSendResult, validateDraftFillResult, validateExchangeConfirmationTestResult, validateJobSnapshot, validateSingleAccountBaseline, validateSnapshot, validateValidationReadiness, validateVisibleResumeTextCapture } from './bridge-core.mjs';

const SETTINGS_KEY = 'bridgeSettingsV1';
const RUNTIME_KEY = 'bridgeRuntimeV1';
const ALARM_NAME = 'bridge-observe';
const MIN_SYNC_INTERVAL_MS = 10_000;
const BOSS_TAB_PATTERNS = ['https://zhipin.com/*', 'https://*.zhipin.com/*'];
let syncInFlight = null;
let jobSyncInFlight = null;
let actionExecutionInFlight = null;
let runtimeMutationTail = Promise.resolve();
let locationPolling = false;

chrome.runtime.onInstalled.addListener(() => initialise());
chrome.runtime.onStartup.addListener(() => initialise());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runObservationCycle();
});
chrome.commands.onCommand.addListener((command) => {
  if (command === 'check-reply-readiness') void checkReplyReadiness().catch((error) => setRuntime({ readinessState: `回复入口检查失败：${safeError(error)}` }));
  if (command === 'fill-test-draft') void fillTestDraft().catch((error) => setRuntime({ draftTestState: `草稿测试失败：${safeError(error)}` }));
  if (command === 'fill-approved-draft') void fillApprovedDraft().catch((error) => setRuntime({ approvedDraftFillState: `已审核草稿填入失败：${safeError(error)}` }));
  if (command === 'inspect-current-controls') void inspectCurrentControls()
    .catch((error) => setRuntime({ controlDiagnosticState: `快捷键识别失败：${safeError(error)}` }));
  if (command === 'recognize-current-resume') void recognizeCurrentResume()
    .then(() => flashActionBadge('完成', '#0D9488'))
    .catch(async (error) => {
      await setRuntime({ visibleResumeState: `识别失败：${safeError(error)}`, lastVisibleResumeAt: new Date().toISOString() });
      await flashActionBadge('失败', '#C2410C');
    });
});

async function flashActionBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 5_000);
}

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
  void pollConversationLocations();
}

async function pollConversationLocations() {
  if (locationPolling) return;
  locationPolling = true;
  try {
    while (true) {
      const settings = await getSettings();
      if (!settings.deviceToken || settings.enabled === false) { await new Promise(resolve => setTimeout(resolve, 3_000)); continue; }
      let claim;
      try { claim = await request(settings.backendUrl, '/api/local-connector/runtime/conversation-locations/claim', { method: 'GET', token: settings.deviceToken, timeoutMs: 22_000 }); }
      catch { await new Promise(resolve => setTimeout(resolve, 1_500)); continue; }
      if (!claim?.id) continue;
      let success = false; let reason = '未找到已打开的 BOSS 沟通页。';
      try {
        const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
        const tab = tabs.find(item => /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
        if (tab?.id) {
          const result = await sendToBossTab(tab.id, { type: 'BRIDGE_LOCATE_CONVERSATION', chatDigest: claim.chatDigest });
          success = result?.ok === true; reason = result?.reason || result?.error || reason;
          if (success) { await chrome.tabs.update(tab.id, { active: true }); if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }); }
        }
      } catch (error) { reason = safeError(error); }
      await request(settings.backendUrl, '/api/local-connector/runtime/conversation-locations/receipt', { method: 'POST', token: settings.deviceToken, body: { id: claim.id, success, reason: String(reason).slice(0, 300) } }).catch(() => {});
      await flashActionBadge(success ? '已定位' : '失败', success ? '#0D9488' : '#C2410C');
    }
  } finally { locationPolling = false; }
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
    case 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY':
      return setSingleAccountAutoReply(Boolean(message.enabled));
    case 'BRIDGE_SYNC_DUTY_AUTOMATION':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的挂机状态同步。');
      return syncDutyAutomation();
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
    case 'BRIDGE_COPY_CURRENT_TRANSCRIPT':
      return { ok: true, transcript: await copyCurrentTranscript() };
    case 'BRIDGE_SYNC_CURRENT_TRANSCRIPT':
      return { ok: true, transcriptSync: await syncCurrentTranscript() };
    case 'BRIDGE_RECOGNIZE_CURRENT_RESUME':
      return { ok: true, resumeRecognition: await recognizeCurrentResume(), status: await getPublicStatus() };
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
    case 'BRIDGE_DECIDE_INBOUND_REPLY':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的候选人消息。');
      return decideInboundReply(message.payload);
    case 'BRIDGE_POLL_INBOUND_REPLY':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的 AI 任务查询。');
      return pollInboundReply(message.payload);
    case 'BRIDGE_GET_PENDING_INBOUND_REPLIES':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的待处理任务查询。');
      return pendingInboundReplies();
    case 'BRIDGE_GET_SINGLE_ACCOUNT_BASELINE':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的恢复基线查询。');
      return singleAccountBaseline();
    case 'BRIDGE_SAVE_SINGLE_ACCOUNT_BASELINE':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的恢复基线写入。');
      return saveSingleAccountBaseline(message.payload);
    case 'BRIDGE_DISCARD_STALE_INBOUND_REPLY':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的旧回复作废请求。');
      return discardStaleInboundReply(message.payload);
    case 'BRIDGE_CLAIM_INBOUND_REPLY_SEND':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的发送租约请求。');
      return claimInboundReplySend(message.payload);
    case 'BRIDGE_RECEIPT_INBOUND_REPLY_SEND':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的发送回执。');
      return receiptInboundReplySend(message.payload);
    case 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_RESULT':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的持续回复结果。');
      return recordSingleAccountAutoReplyResult(message.payload);
    case 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的持续回复状态。');
      return recordSingleAccountAutoReplyState(message.payload);
    case 'BRIDGE_RESUME_PREVIEW_CLICK_DIAGNOSTIC':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的简历预览诊断。');
      return recordResumePreviewClickDiagnostic(message.payload);
    case 'BRIDGE_VISIBLE_RESUME_PDF_CAPTURE':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的 PDF 简历。');
      return importVisibleResumePdf(message.payload);
    case 'BRIDGE_VISIBLE_RESUME_IMPORT_STATUS':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的简历导入状态。');
      return recordVisibleResumeImportStatus(message.payload);
    case 'BRIDGE_FETCH_VISIBLE_RESUME_MAIN_WORLD':
      if (!sender.tab?.id) throw new Error('只接受 BOSS 页面脚本的主环境 PDF 请求。');
      return fetchVisibleResumeFromMainWorld(sender.tab.id, message.payload);
    default:
      throw new Error('未知的桥接请求。');
  }
}

async function decideInboundReply(payload) {
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.messageDigest || '')
      || typeof payload.messageText !== 'string' || !payload.messageText.trim()
      || payload.messageText.length > 1000 || !Number.isFinite(Date.parse(payload.messageAt))
      || (payload.conversationContext != null && (typeof payload.conversationContext !== 'string' || payload.conversationContext.length > 2400))
      || typeof payload.selectedUnread !== 'boolean' || !payload.conversationSignals
      || !Number.isFinite(Date.parse(payload.observedAt))) {
    throw new Error('候选人消息识别请求无效。');
  }
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  const continuous = payload.continuous === true;
  const decisionPayload = { ...payload };
  delete decisionPayload.continuous;
  const messageKey = `${payload.chatDigest}:${payload.messageDigest}`;
  if (continuous) {
    const claim = await claimSingleAccountMessage(messageKey);
    if (claim === 'DISABLED') {
      return { ok: true, decision: { replyAllowed: false, category: 'DISABLED', reason: '单账号持续自动回复已停止。' } };
    }
    if (claim === 'DUPLICATE') {
      return { ok: true, decision: { replyAllowed: false, category: 'DUPLICATE', reason: '该条候选人消息已经处理，禁止重复回复。' } };
    }
  } else {
    await setRuntime({ autoReplyTestState: '正在判断候选人消息是否与当前岗位相关…' });
  }
  try {
  await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
    method: 'POST', token: settings.deviceToken, body: {
      chatDigest: payload.chatDigest, messageDigest: payload.messageDigest, direction: 'INBOUND',
      messageAt: payload.messageAt, selectedUnread: payload.selectedUnread,
      conversationSignals: payload.conversationSignals, observedAt: payload.observedAt,
    },
  });
  if (continuous) {
    const accepted = await request(settings.backendUrl, '/api/local-connector/runtime/inbound-reply-tasks', {
      method: 'POST', token: settings.deviceToken, body: decisionPayload, timeoutMs: 8_000,
    });
    if (accepted?.status === 'COMPLETED' && accepted.decision) {
      await updateSingleAccountProcessedMessage(messageKey, accepted.decision.replyAllowed ? 'READY' : 'SILENT');
      return { ok: true, pending: false, decision: accepted.decision };
    }
    if (!/^[0-9a-f-]{36}$/i.test(accepted?.taskId || '')) throw new Error('AI 队列未返回有效任务编号。');
    await attachSingleAccountTask(messageKey, accepted.taskId, payload.chatDigest, payload.messageDigest);
    await setRuntime({ singleAccountAutoReplyState: 'AI 任务已入队，继续检查其他新消息…' });
    return { ok: true, pending: true, taskId: accepted.taskId };
  }
  const decision = await request(settings.backendUrl, '/api/local-connector/runtime/inbound-reply-decision', {
    method: 'POST', token: settings.deviceToken, body: decisionPayload, timeoutMs: 135_000,
  });
  if (continuous) {
    await updateSingleAccountProcessedMessage(messageKey, decision.replyAllowed ? 'READY' : 'SILENT');
    await setRuntime({ singleAccountAutoReplyState: decision.replyAllowed
      ? `岗位相关，已生成短回复（${Math.round(Number(decision.confidence || 0) * 100)}%），准备发送。`
      : `已静默跳过：${decision.reason || '消息不符合自动回复条件'}。`, lastSingleAccountAutoReplyAt: new Date().toISOString() });
  } else {
    await setRuntime({ autoReplyTestState: decision.replyAllowed
      ? `岗位相关，已生成受限回复（${Math.round(Number(decision.confidence || 0) * 100)}%）。`
      : `未自动回复：${decision.reason || '消息不符合自动回复条件'}。` });
  }
  return { ok: true, decision };
  } catch (error) {
    if (continuous) {
      await mutateRuntime((runtime) => ({
        singleAccountProcessedMessages: (runtime.singleAccountProcessedMessages || []).filter((item) => item.key !== messageKey),
        singleAccountAutoReplyState: `岗位相关性服务暂不可用：${safeError(error)}；稍后重试。`,
      }));
    }
    throw error;
  }
}

async function pollInboundReply(payload) {
  if (!payload || !/^[0-9a-f-]{36}$/i.test(payload.taskId || '')
      || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.messageDigest || '')) throw new Error('AI 任务查询参数无效。');
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  const key = `${payload.chatDigest}:${payload.messageDigest}`;
  const runtime = await getRuntime();
  const tracked = (runtime.singleAccountProcessedMessages || [])
    .find((item) => item.key === key && item.taskId === payload.taskId && item.outcome === 'PROCESSING');
  if (!tracked) return { ok: true, status: 'CANCELLED' };
  const result = await request(settings.backendUrl, `/api/local-connector/runtime/inbound-reply-tasks/${payload.taskId}`, {
    method: 'GET', token: settings.deviceToken, timeoutMs: 8_000,
  });
  if (!['COMPLETED', 'FAILED'].includes(result?.status)) return { ok: true, status: result?.status || 'QUEUED' };
  const decision = result.decision || { replyAllowed: false, category: 'UNCERTAIN', reason: 'AI 任务未返回有效结果。' };
  if (!decision.replyAllowed) await updateSingleAccountProcessedMessage(key, 'SILENT');
  await setRuntime({ singleAccountAutoReplyState: decision.replyAllowed
    ? `AI 已生成安全短回复（${Math.round(Number(decision.confidence || 0) * 100)}%），等待页面复核。`
    : `已静默跳过：${decision.reason || '消息不符合自动回复条件'}。` });
  return { ok: true, status: result.status, decision };
}

async function pendingInboundReplies() {
  const runtime = await getRuntime();
  const tasks = (runtime.singleAccountProcessedMessages || [])
    .filter((item) => item.outcome === 'PROCESSING' && /^[0-9a-f-]{36}$/i.test(item.taskId || '')
      && /^[a-f0-9]{64}$/.test(item.chatDigest || '') && /^[a-f0-9]{64}$/.test(item.messageDigest || ''))
    .map(({ taskId, chatDigest, messageDigest }) => ({ taskId, chatDigest, messageDigest }));
  return { ok: true, tasks };
}

async function singleAccountBaseline() {
  const runtime = await getRuntime();
  try {
    return { ok: true, ...validateSingleAccountBaseline({
      unread: runtime.singleAccountUnreadBaseline || [], selected: runtime.singleAccountSelectedMessageBaseline || [],
    }) };
  } catch (_error) {
    return { ok: true, unread: [], selected: [] };
  }
}

async function saveSingleAccountBaseline(payload) {
  const baseline = validateSingleAccountBaseline(payload);
  await setRuntime({ singleAccountUnreadBaseline: baseline.unread, singleAccountSelectedMessageBaseline: baseline.selected });
  return { ok: true };
}

async function discardStaleInboundReply(payload) {
  if (!payload || !/^[0-9a-f-]{36}$/i.test(payload.taskId || '')
      || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.messageDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.currentMessageDigest || '')
      || payload.messageDigest === payload.currentMessageDigest
      || !Number.isFinite(Date.parse(payload.currentMessageAt))
      || typeof payload.selectedUnread !== 'boolean' || !payload.conversationSignals) throw new Error('旧回复作废参数无效。');
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
    method: 'POST', token: settings.deviceToken, body: {
      chatDigest: payload.chatDigest, messageDigest: payload.currentMessageDigest, direction: 'INBOUND',
      messageAt: payload.currentMessageAt, selectedUnread: payload.selectedUnread,
      conversationSignals: payload.conversationSignals, observedAt: new Date().toISOString(),
    }, timeoutMs: 8_000,
  });
  return request(settings.backendUrl, `/api/local-connector/runtime/inbound-reply-tasks/${payload.taskId}/discard`, {
    method: 'POST', token: settings.deviceToken, body: {
      chatDigest: payload.chatDigest, messageDigest: payload.messageDigest,
      currentMessageDigest: payload.currentMessageDigest,
      reason: '候选人在 AI 分析期间发送了更新消息，旧回复已安全作废。',
    }, timeoutMs: 8_000,
  });
}

async function claimInboundReplySend(payload) {
  if (!payload || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.taskId || '')
      || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '') || !/^[a-f0-9]{64}$/.test(payload.messageDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.beforeStateDigest || '') || !Number.isFinite(Date.parse(payload.messageAt))
      || typeof payload.selectedUnread !== 'boolean' || !payload.conversationSignals
      || !Number.isFinite(Date.parse(payload.observedAt))) throw new Error('AI 回复发送租约参数无效。');
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
    method: 'POST', token: settings.deviceToken, body: {
      chatDigest: payload.chatDigest, messageDigest: payload.messageDigest, direction: 'INBOUND',
      messageAt: payload.messageAt, selectedUnread: payload.selectedUnread,
      conversationSignals: payload.conversationSignals, observedAt: payload.observedAt,
    },
  });
  return request(settings.backendUrl, '/api/local-connector/runtime/inbound-reply-send/claim', {
    method: 'POST', token: settings.deviceToken, body: {
      taskId: payload.taskId, chatDigest: payload.chatDigest,
      messageDigest: payload.messageDigest, beforeStateDigest: payload.beforeStateDigest,
    }, timeoutMs: 8_000,
  });
}

async function receiptInboundReplySend(payload) {
  if (!payload || typeof payload.leaseToken !== 'string' || !payload.leaseToken
      || !['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(payload.outcome)
      || !/^[a-f0-9]{64}$/.test(payload.beforeStateDigest || '') || !/^[a-f0-9]{64}$/.test(payload.afterStateDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.receiptDigest || '') || typeof payload.reason !== 'string'
      || !payload.reason.trim() || payload.reason.length > 300) throw new Error('AI 回复发送回执无效。');
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  return request(settings.backendUrl, '/api/local-connector/runtime/inbound-reply-send/receipt', {
    method: 'POST', token: settings.deviceToken, body: payload, timeoutMs: 8_000,
  });
}

async function recordSingleAccountAutoReplyResult(payload) {
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.messageDigest || '')
      || !['SENT', 'SILENT', 'UNKNOWN'].includes(payload.outcome)
      || typeof payload.reason !== 'string' || payload.reason.length > 300
      || !Number.isFinite(Date.parse(payload.occurredAt))) throw new Error('持续自动回复结果无效。');
  const key = `${payload.chatDigest}:${payload.messageDigest}`;
  await updateSingleAccountProcessedMessage(key, payload.outcome);
  const runtime = await getRuntime();
  const previousFailures = Number(runtime.singleAccountConsecutiveFailures || 0);
  const consecutiveFailures = nextConsecutiveFailureCount(previousFailures, payload.outcome);
  const shouldStop = consecutiveFailures >= 3;
  await setRuntime({
    singleAccountAutoReplyEnabled: shouldStop ? false : runtime.singleAccountAutoReplyEnabled === true,
    singleAccountConsecutiveFailures: consecutiveFailures,
    singleAccountAutoReplyState: shouldStop ? `连续 ${consecutiveFailures} 次页面发送结果无法确认，已自动停止，请 HR 检查 BOSS 页面。`
      : payload.outcome === 'SENT' ? `已发送：${payload.reason}`
      : payload.outcome === 'SILENT' ? `已静默跳过：${payload.reason}` : `结果待人工确认：${payload.reason}`,
    lastSingleAccountAutoReplyAt: payload.occurredAt,
  });
  return { ok: true, shouldStop, consecutiveFailures };
}

async function recordSingleAccountAutoReplyState(payload) {
  if (!payload || typeof payload.state !== 'string' || !payload.state.trim() || payload.state.length > 300
      || typeof payload.disable !== 'boolean' || !Number.isFinite(Date.parse(payload.observedAt))) {
    throw new Error('持续自动回复状态无效。');
  }
  await setRuntime({
    singleAccountAutoReplyEnabled: payload.disable ? false : (await getRuntime()).singleAccountAutoReplyEnabled === true,
    singleAccountAutoReplyState: payload.state.trim(),
    lastSingleAccountAutoReplyAt: payload.observedAt,
  });
  return { ok: true };
}

async function claimSingleAccountMessage(key) {
  let outcome = 'CLAIMED';
  await mutateRuntime((runtime) => {
    if (runtime.singleAccountAutoReplyEnabled !== true) {
      outcome = 'DISABLED';
      return {};
    }
    if ((runtime.singleAccountProcessedMessages || []).some((item) => item.key === key)) {
      outcome = 'DUPLICATE';
      return {};
    }
    const entries = [...(runtime.singleAccountProcessedMessages || []), {
      key, outcome: 'PROCESSING', at: new Date().toISOString(),
    }];
    return {
      singleAccountProcessedMessages: compactProcessedMessages(entries),
      singleAccountAutoReplyState: '正在判断未读消息是否与岗位相关…',
    };
  });
  return outcome;
}

async function updateSingleAccountProcessedMessage(key, outcome) {
  await mutateRuntime((runtime) => {
    const entries = (runtime.singleAccountProcessedMessages || []).filter((item) => item.key !== key);
    entries.push({ key, outcome, at: new Date().toISOString() });
    return { singleAccountProcessedMessages: compactProcessedMessages(entries) };
  });
}

async function attachSingleAccountTask(key, taskId, chatDigest, messageDigest) {
  await mutateRuntime((runtime) => {
    const entries = (runtime.singleAccountProcessedMessages || []).filter((item) => item.key !== key);
    entries.push({ key, taskId, chatDigest, messageDigest, outcome: 'PROCESSING', at: new Date().toISOString() });
    return { singleAccountProcessedMessages: compactProcessedMessages(entries) };
  });
}

async function recordResumePreviewClickDiagnostic(payload) {
  const diagnostic = validateControlDomDiagnostic(payload);
  const previewCount = Math.max(0, (diagnostic.resumeCandidates?.length || 1) - 1);
  const runtime = await getRuntime();
  const currentResumeState = String(runtime.visibleResumeState || '');
  const preserveResumeState = /正在加载 PDF|正在通过 BOSS|正在捕获真实 PDF|PDF 已安全读取|已导入|已完成 AI 分析|PDF 尚未导入|识别失败|导入失败/.test(currentResumeState);
  await setRuntime({
    controlDiagnostic: diagnostic,
    controlDiagnosticState: previewCount > 0
      ? `已自动记录预览按钮及 ${previewCount} 个预览层节点的脱敏 DOM。`
      : '已自动记录本次“点击预览附件简历”的脱敏 DOM；正在等待预览层出现。',
    lastControlDiagnosticAt: diagnostic.observedAt,
    visibleResumeState: preserveResumeState ? currentResumeState : (previewCount > 0
      ? `已捕获简历预览结构（${previewCount} 个节点），正在判断 PDF 读取方式。`
      : '已捕获简历预览按钮，正在等待预览内容稳定后导入。'),
    lastVisibleResumeAt: diagnostic.observedAt,
  });
  return { ok: true };
}

async function importVisibleResumePdf(payload) {
  console.log('[background] importVisibleResumePdf 收到请求', { chatDigest: payload?.chatDigest?.slice(0, 12), fileSize: payload?.fileSize });
  const settings = await getSettings();
  if (!settings.deviceToken) { console.error('[background] 缺少 deviceToken'); throw new Error('请先完成浏览器桥接配对。'); }
  if (!payload || payload.actionType !== 'VISIBLE_RESUME_PDF_CAPTURE'
      || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.sourceEventDigest || '')
      || !/^[a-f0-9]{64}$/.test(payload.fileDigest || '')
      || !Number.isInteger(payload.fileSize) || payload.fileSize < 5 || payload.fileSize > 8 * 1024 * 1024
      || typeof payload.fileBase64 !== 'string' || payload.fileBase64.length > 12_000_000) {
    console.error('[background] PDF 简历采集数据无效', { actionType: payload?.actionType, chatDigest: payload?.chatDigest?.slice(0, 12), fileSize: payload?.fileSize });
    throw new Error('PDF 简历采集数据无效。');
  }
  const runtime = await getRuntime();
  console.log('[background] runtime', { lastSelectedChatDigest: runtime.lastSelectedChatDigest?.slice(0, 12), lastSelectedObservationId: runtime.lastSelectedObservationId, payloadChatDigest: payload.chatDigest?.slice(0, 12) });
  // PDF 事件通常早于稳定会话快照到达。等待快照提交完成，避免首次打开预览时误报“尚未完成稳定复核”。
  let stableRuntime = runtime;
  for (let attempt = 0; attempt < 25 && (stableRuntime.lastSelectedChatDigest !== payload.chatDigest || !stableRuntime.lastSelectedObservationId); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    stableRuntime = await getRuntime();
  }
  if (stableRuntime.lastSelectedChatDigest !== payload.chatDigest || !stableRuntime.lastSelectedObservationId) {
    console.error('[background] 会话不一致', { runtime: runtime.lastSelectedChatDigest?.slice(0, 12), payload: payload.chatDigest?.slice(0, 12), observationId: runtime.lastSelectedObservationId });
    throw new Error('当前 PDF 与最近稳定会话观测不一致，已停止导入。');
  }
  const binary = atob(payload.fileBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') { console.error('[background] PDF 文件头校验失败'); throw new Error('PDF 文件头校验失败。'); }
  console.log('[background] 准备发送到后端, observationId=' + stableRuntime.lastSelectedObservationId);
  await setRuntime({ visibleResumeState: 'PDF 已安全读取，正在导入并进行 AI 分析…', lastVisibleResumeAt: new Date().toISOString() });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'boss-resume.pdf');
  console.log('[background] 开始调用后端 API...');
  const result = await requestMultipart(settings.backendUrl,
    `/api/local-connector/runtime/resume-documents?observationId=${encodeURIComponent(stableRuntime.lastSelectedObservationId)}&sourceEventDigest=${encodeURIComponent(payload.sourceEventDigest)}`,
    settings.deviceToken, form, 120_000);
  console.log('[background] 后端响应:', result);
  await setRuntime({
    lastVisibleResumeEventDigest: payload.sourceEventDigest,
    visibleResumeState: result?.analysisStatus === 'SUCCEEDED'
      ? '当前 BOSS PDF 简历已完成 AI 分析，可在简历分析页查看。'
      : `当前 BOSS PDF 简历已导入，处理状态：${result?.analysisStatus || result?.processingStatus || '处理中'}。`,
    lastVisibleResumeAt: new Date().toISOString(),
  });
  return {
    ok: true,
    intakeId: result?.intakeId || '',
    candidateName: result?.candidateName || '',
    receivedAt: result?.receivedAt || '',
    duplicate: result?.duplicate === true,
    processingStatus: result?.processingStatus || '',
    failureCode: result?.failureCode || '',
    failureReason: result?.failureReason || '',
    analysisStatus: result?.analysisStatus || '',
    analysisFailureCode: result?.analysisFailureCode || '',
    analysisFailureReason: result?.analysisFailureReason || '',
  };
}

async function recordVisibleResumeImportStatus(payload) {
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')
      || typeof payload.state !== 'string' || !payload.state.trim() || payload.state.length > 220
      || !Number.isFinite(Date.parse(payload.observedAt))) throw new Error('简历导入状态无效。');
  const runtime = await getRuntime();
  if (runtime.lastSelectedChatDigest && runtime.lastSelectedChatDigest !== payload.chatDigest)
    throw new Error('简历导入状态与当前稳定会话不一致。');
  await setRuntime({ visibleResumeState: payload.state.trim(), lastVisibleResumeAt: payload.observedAt });
  return { ok: true };
}

async function fetchVisibleResumeFromMainWorld(tabId, payload) {
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.chatDigest || '')) throw new Error('当前会话摘要无效。');
  const runtime = await getRuntime();
  if (runtime.lastSelectedChatDigest !== payload.chatDigest || !runtime.lastSelectedObservationId)
    throw new Error('当前会话尚未完成稳定复核。');
  await setRuntime({ visibleResumeState: '正在通过 BOSS 页面登录上下文安全读取 PDF…', lastVisibleResumeAt: new Date().toISOString() });
  const execution = chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, world: 'MAIN',
    func: async () => {
      const MAX_BYTES = 8 * 1024 * 1024;
      const sources = [];
      const frame = document.querySelector('iframe.attachment-iframe, .attachment-view iframe');
      if (frame?.src) {
        sources.push(frame.src);
        try {
          const viewerUrl = new URL(frame.src, location.href);
          for (const key of ['file', 'url', 'src', 'downloadUrl']) {
            const nested = viewerUrl.searchParams.get(key);
            if (nested && /^(?:blob:|https?:)/i.test(nested)) sources.push(nested);
          }
        } catch { /* iframe 地址可能是 blob。 */ }
      }
      for (const control of document.querySelectorAll('.attachment-resume-btns a[href], .attachment-resume-btns [data-url], .attachment-resume-btns [data-src], a[download][href]')) {
        const source = control.href || control.getAttribute('data-url') || control.getAttribute('data-src');
        if (source && /^(?:blob:|https?:)/i.test(source)) sources.push(source);
      }
      for (const entry of performance.getEntriesByType('resource').slice(-120)) {
        if (/(pdf|resume|attachment|download)/i.test(entry.name || '')) sources.push(entry.name);
      }
      if (document.contentType === 'application/pdf' || location.protocol === 'blob:') sources.push(location.href);
      for (const source of [...new Set(sources)]) {
        try {
          const response = await fetch(source, { credentials: 'include', signal: AbortSignal.timeout(8_000) });
          if (!response.ok) continue;
          const declared = Number(response.headers.get('content-length') || 0);
          if (declared > MAX_BYTES) return { ok: false, error: 'PDF 文件超过 8MB 限制。' };
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length < 5 || bytes.length > MAX_BYTES || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') continue;
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
          return { ok: true, fileBase64: btoa(binary), fileSize: bytes.length };
        } catch { /* 尝试下一可访问 frame。 */ }
      }
      return { ok: false, error: '预览 frame 中没有可直接读取的 PDF；请点击预览器内的“下载”按钮触发文件捕获。' };
    },
  });
  const injections = await Promise.race([
    execution,
    new Promise((_, reject) => setTimeout(() => reject(new Error('页面 PDF 读取超过 15 秒，已停止本次尝试。')), 15_000)),
  ]);
  const captured = injections.map((entry) => entry.result).find((result) => result?.ok && result.fileBase64);
  if (!captured) throw new Error(injections.map((entry) => entry.result?.error).find(Boolean) || '页面主环境未返回 PDF 数据。');
  const fileDigest = await digestText(captured.fileBase64);
  const sourceEventDigest = await digestText(`${payload.chatDigest}|${runtime.lastSelectedMessageDigest || ''}|${fileDigest}`);
  return importVisibleResumePdf({ actionType: 'VISIBLE_RESUME_PDF_CAPTURE', chatDigest: payload.chatDigest,
    sourceEventDigest, fileDigest, fileBase64: captured.fileBase64, fileSize: captured.fileSize });
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

async function copyCurrentTranscript() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url))
      || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) {
    throw new Error('请先在当前标签打开 BOSS 沟通页，并选中需要复制的会话。');
  }
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_COPY_CURRENT_TRANSCRIPT' });
  if (!response?.ok) throw new Error(response?.reason || response?.error || '当前会话记录读取失败。');
  if (!response.transcript?.text || !Number.isInteger(response.transcript.messageCount)) {
    throw new Error('页面返回的聊天记录格式无效，未写入剪贴板。');
  }
  return response.transcript;
}

async function syncCurrentTranscript() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对，才能同步到示例库。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停，无法同步聊天记录。');
  const transcript = await copyCurrentTranscript();
  try {
    const imported = await request(settings.backendUrl, '/api/local-connector/runtime/hr-reply-examples/import', {
      method: 'POST', token: settings.deviceToken, body: { transcript: transcript.text }, timeoutMs: 20_000,
    });
    return { ...transcript, import: imported, importError: null };
  } catch (error) {
    // 复制结果仍然返回，避免后端暂时不可用时丢失本机已脱敏记录。
    return { ...transcript, import: null, importError: safeError(error) };
  }
}

async function recognizeCurrentResume() {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('浏览器桥接已暂停。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url))
      || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) {
    throw new Error('请先打开 BOSS 沟通页并选中包含 PDF 简历的会话。');
  }
  await setRuntime({ visibleResumeState: '正在识别当前会话中的 PDF 简历并尝试安全导入…' });
  const response = await sendToBossTab(tab.id, { type: 'BRIDGE_COLLECT' });
  if (!response?.ok) {
    const reason = response?.error || '当前会话采集失败。';
    await setRuntime({ visibleResumeState: `识别失败：${reason}`, lastVisibleResumeAt: new Date().toISOString() });
    throw new Error(reason);
  }
  const runtime = await getRuntime();
  const state = String(runtime.visibleResumeState || '');
  if (!state || state.startsWith('正在识别')) {
    const reason = runtime.detailState || '当前会话没有识别到可预览的 PDF 简历附件。';
    await setRuntime({ visibleResumeState: `识别未完成：${reason}`, lastVisibleResumeAt: new Date().toISOString() });
    throw new Error(reason);
  }
  return { state, completedAt: runtime.lastVisibleResumeAt || new Date().toISOString() };
}

async function testCurrentActionEntry(action) {
  const settings = await getSettings();
  const runtime = await getRuntime();
  const labels = { REQUEST_RESUME: '求简历', EXCHANGE_PHONE: '查看电话', EXCHANGE_WECHAT: '换微信', INTERVIEW: '查看面试' };
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
  if (runtime.singleAccountAutoReplyEnabled === true) throw new Error('请先停止单账号持续自动回复，再开启单会话触发测试。');
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
  const state = payload.outcome === 'SUCCEEDED' ? '触发成功：消息已通过岗位相关性识别，并自动发送了一次受限岗位事实回复。'
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
    const response = await collectJobsFromAllFrames(tab.id, true);
    if (!response?.ok) throw new Error(response?.error || '职位页面脚本未连接。');
    return response.sync || { received: 0, created: 0, updated: 0, unchanged: 0 };
  } catch (error) {
    const reason = `职位页暂未采集：${safeError(error)} 请刷新 BOSS 页面后重试。`;
    await setRuntime({ jobState: reason });
    throw new Error(reason);
  }
}

async function collectJobsFromOpenTabIfAvailable() {
  const settings = await getSettings();
  if (!settings.deviceToken || settings.enabled === false) return { ok: true, skipped: true };
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => item.active && isJobManagementUrl(item.url)) || tabs.find((item) => isJobManagementUrl(item.url));
  if (!tab?.id) return { ok: true, skipped: true };
  try {
    const response = await collectJobsFromAllFrames(tab.id, false);
    if (!response?.ok) throw new Error(response?.error || '职位页面脚本未连接。');
    return response;
  } catch (error) {
    const reason = `职位自动同步暂未完成：${safeError(error)}；保留上一次成功数据，稍后自动重试。`;
    await setRuntime({ jobState: reason, lastJobAutoSyncAttemptAt: new Date().toISOString() });
    return { ok: false, error: reason };
  }
}

async function collectJobsFromAllFrames(tabId, refreshRequested = false) {
  const injected = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/content.js'] });
  const frameIds = [...new Set(injected.map((item) => item.frameId))].sort((a, b) => a - b);
  if (!frameIds.length) throw new Error('当前 BOSS 页面没有可访问的文档 frame。');
  const failures = [];
  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'BRIDGE_COLLECT_JOBS', allowEmbeddedJobList: frameId !== 0, refreshRequested }, { frameId });
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
  void runObservationCycle();
  return { ok: true, status: await getPublicStatus() };
}

async function setEnabled(enabled) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled } });
  if (!enabled) {
    await sendHeartbeatIfPaired({ ...settings, enabled }, 'PAUSED', '已由 HR 暂停只读桥接。', (await getRuntime()).pageContext);
    await setRuntime({ state: 'PAUSED', reason: '已由 HR 暂停只读桥接。', singleAccountAutoReplyEnabled: false, singleAccountAutoReplyState: '页面观测已暂停，持续自动回复同步停止。' });
    const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
    await Promise.all(tabs.filter((tab) => tab.id && /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || ''))
      .map((tab) => sendToBossTab(tab.id, { type: 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY', enabled: false }).catch(() => null)));
  } else {
    await setRuntime({ state: 'IDLE', reason: '已恢复只读桥接，等待下一次检测。' });
    void runObservationCycle();
  }
  return { ok: true, status: await getPublicStatus() };
}

async function setSingleAccountAutoReply(enabled) {
  const settings = await getSettings();
  if (!settings.deviceToken) throw new Error('请先完成本机账号配对。');
  if (settings.enabled === false) throw new Error('请先开启页面观测。');
  if (enabled && (await getRuntime()).autoReplyTestArmed === true) throw new Error('请先取消当前单会话一次触发测试。');
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const chatTabs = tabs.filter((item) => item.id && /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (enabled && chatTabs.length === 0) throw new Error('请先打开当前配对账号的 BOSS 沟通页。');
  if (enabled && chatTabs.length > 1) throw new Error('检测到多个 BOSS 沟通页。单账号模式只允许保留一个沟通页后再开启。');
  await setRuntime({
    singleAccountAutoReplyEnabled: enabled,
    ...(enabled ? {} : { singleAccountUnreadBaseline: [], singleAccountSelectedMessageBaseline: [] }),
    singleAccountConsecutiveFailures: enabled ? 0 : Number((await getRuntime()).singleAccountConsecutiveFailures || 0),
    singleAccountAutoReplyState: enabled
      ? `正在监测“${settings.accountName || '当前配对账号'}”的未读消息。`
      : '已由 HR 停止；不会再选择会话或发送消息。',
    lastSingleAccountAutoReplyAt: new Date().toISOString(),
  });
  const responses = await Promise.all(chatTabs.map((tab) => sendToBossTab(tab.id, { type: 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY', enabled }).catch((error) => ({ ok: false, error: safeError(error) }))));
  const response = responses[0] || { ok: true };
  if (enabled && !response?.ok) {
    await setRuntime({ singleAccountAutoReplyEnabled: false, singleAccountAutoReplyState: `未能启动：${response?.error || 'BOSS 页面脚本未连接。'}` });
    throw new Error(response?.error || 'BOSS 页面脚本未连接。');
  }
  if (enabled) await setRuntime({ singleAccountAutoReplyState: `运行中：已将当前列表的 ${Number(response.initialUnreadCount || 0)} 条未读纳入队列，并持续监测新来信。` });
  return { ok: true, status: await getPublicStatus() };
}

async function syncDutyAutomation() {
  const settings = await getSettings();
  if (!settings.deviceToken) return { ok: true, enabled: false };
  const control = await request(settings.backendUrl, '/api/local-connector/runtime/duty-automation', {
    method: 'GET', token: settings.deviceToken, timeoutMs: 5_000,
  });
  const desired = settings.enabled !== false && control?.enabled === true;
  const runtime = await getRuntime();
  if (runtime.singleAccountAutoReplyEnabled !== desired) await setSingleAccountAutoReply(desired);
  return { ok: true, enabled: desired, endsAt: control?.endsAt || null };
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
    const runtime = await getRuntime();
    await sendToBossTab(tab.id, { type: 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY', enabled: runtime.singleAccountAutoReplyEnabled === true, restore: true });
  } catch {
    await sendHeartbeatIfPaired(settings, 'PAUSED', 'BOSS 页面脚本尚未就绪，请手动刷新该页面。', 'CHAT');
    await setRuntime({ state: 'PAUSED', reason: 'BOSS 页面脚本尚未就绪，请手动刷新该页面。', pageContext: 'CHAT' });
  }
}

async function runObservationCycle() {
  await syncDutyAutomation().catch((error) => setRuntime({
    singleAccountAutoReplyState: `挂机控制同步失败：${safeError(error)}`,
  }));
  await collectJobsFromOpenTabIfAvailable();
  await collectFromBestTab();
  await executeReadyAction().catch((error) => setRuntime({
    productionActionState: `完整周期动作未执行：${safeError(error)}`,
    lastProductionActionAt: new Date().toISOString(),
  }));
}

async function executeReadyAction() {
  if (actionExecutionInFlight) return actionExecutionInFlight;
  actionExecutionInFlight = doExecuteReadyAction().finally(() => { actionExecutionInFlight = null; });
  return actionExecutionInFlight;
}

async function doExecuteReadyAction() {
  const settings = await getSettings();
  if (!settings.deviceToken || settings.enabled === false) return;
  if ((await getRuntime()).singleAccountAutoReplyEnabled === true) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/(^|\.)zhipin\.com$/i.test(safeHostname(tab.url)) || !/\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(tab.url || '')) return;
  const prepared = await sendToBossTab(tab.id, { type: 'BRIDGE_PREPARE_ACTION_LEASE' });
  if (!prepared?.ok) return;
  const context = prepared.context;
  if (!/^[a-f0-9]{64}$/.test(context?.targetDigest || '')
      || !/^[a-f0-9]{64}$/.test(context.messageDigest || '')
      || !['INBOUND', 'OUTBOUND'].includes(context.direction) || context.stableCycles !== 3 || !Number.isFinite(Date.parse(context.observedAt))) {
    throw new Error('当前会话的完整周期动作准备证据无效。');
  }
  let lease = null;
  for (const actionType of ['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE']) {
    const candidate = await request(settings.backendUrl, '/api/local-connector/runtime/action-leases/claim', {
      method: 'POST', token: settings.deviceToken, body: { actionType, targetDigest: context.targetDigest },
    });
    if (candidate?.available) { lease = candidate; break; }
  }
  if (!lease?.available) return;
  if (!['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE'].includes(lease.actionType) || lease.targetDigest !== context.targetDigest || !lease.leaseToken
      || !Number.isFinite(Date.parse(lease.leaseUntil)) || Date.parse(lease.leaseUntil) <= Date.now() || !isSupportedActionLeaseMode(lease.mode)) {
    throw new Error('后端返回的页面动作租约无效。');
  }
  let result;
  try {
    const response = await sendToBossTab(tab.id, { type: 'BRIDGE_EXECUTE_ACTION_LEASE', lease: {
      actionType: lease.actionType, targetDigest: lease.targetDigest, leaseUntil: lease.leaseUntil,
      payload: lease.payload,
    } });
    if (!response?.ok) {
      const reason = String(response?.error || '页面在点击前拒绝了索要简历租约。').slice(0, 240);
      const beforeStateDigest = await digestText(`${lease.leaseId}|${lease.actionType}|PRECLICK`);
      const afterStateDigest = await digestText(`${lease.leaseId}|${lease.actionType}|FAILED|${reason}`);
      result = { outcome: 'FAILED', beforeStateDigest, afterStateDigest,
        receiptDigest: await digestText(`${beforeStateDigest}|${afterStateDigest}|FAILED`), reason };
    } else {
      result = validateActionLeaseExecutionResult(response.result, lease.targetDigest, lease.actionType);
    }
  } catch (error) {
    const reason = `页面执行通信中断，无法证明是否已点击；已停止且不会重试。${safeError(error)}`.slice(0, 240);
    const beforeStateDigest = await digestText(`${lease.leaseId}|${lease.actionType}|UNKNOWN-BEFORE`);
    const afterStateDigest = await digestText(`${lease.leaseId}|${lease.actionType}|UNKNOWN-AFTER`);
    result = { outcome: 'UNKNOWN', beforeStateDigest, afterStateDigest,
      receiptDigest: await digestText(`${beforeStateDigest}|${afterStateDigest}|UNKNOWN`), reason };
  }
  await request(settings.backendUrl, '/api/local-connector/runtime/action-leases/receipt', {
    method: 'POST', token: settings.deviceToken, body: { leaseToken: lease.leaseToken, outcome: result.outcome,
      beforeStateDigest: result.beforeStateDigest, afterStateDigest: result.afterStateDigest,
      receiptDigest: result.receiptDigest, reason: result.reason },
  });
  await setRuntime({ productionActionState: result.reason, productionActionOutcome: result.outcome,
    lastProductionActionAt: new Date().toISOString() });
  if (result.outcome === 'UNKNOWN') {
    await sendHeartbeatIfPaired(settings, 'OFFLINE', `${lease.actionType} 页面结果无法确认，已冻结当前账号自动动作。`, 'CHAT');
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
  if (!payload.refreshRequested && runtime.lastJobSignature === signature && now - Number(runtime.lastJobSubmittedAt || 0) < MIN_SYNC_INTERVAL_MS) return { ok: true, skipped: true };
  const sync = await request(settings.backendUrl, '/api/local-connector/runtime/job-observations', {
    method: 'POST', token: settings.deviceToken, body: { entries: payload.entries, observedAt: payload.observedAt, scope: payload.scope, authoritative: payload.authoritative, refreshRequested: payload.refreshRequested === true },
  });
  const lifecycle = [sync.automaticallyClosed ? `自动关闭 ${sync.automaticallyClosed} 个` : '', sync.reopenedForReview ? `恢复待核对 ${sync.reopenedForReview} 个` : ''].filter(Boolean).join('，');
  const jobState = `职位页同步完成：识别 ${sync.received} 个，新增 ${sync.created} 个，更新 ${sync.updated} 个，重复或无需变更 ${sync.unchanged} 个${lifecycle ? `，${lifecycle}` : ''}。`;
  const pageContext = payload.entries.some((entry) => entry.completeness > 5) ? 'JOB_DETAIL' : 'JOB_LIST';
  await sendHeartbeatIfPaired(settings, 'RUNNING', jobState, pageContext);
  await setRuntime({ jobState, jobTotal: sync.received, lastJobSyncAt: new Date().toISOString(), lastJobSignature: signature, lastJobSubmittedAt: now, pageContext });
  return { ok: true, sync };
}

async function doSubmitSnapshot(settings, payload) {
  const runtime = await getRuntime();
  const signature = snapshotSignature(payload);
  const now = Date.now();
  const resumeAwaitingImport = payload.selected?.conversationSignals?.resumeReceived === true
    && !String(runtime.visibleResumeState || '').includes('已完成 AI 分析');
  if (!resumeAwaitingImport && runtime.lastSignature === signature && now - Number(runtime.lastSubmittedAt || 0) < MIN_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }
  const sync = await request(settings.backendUrl, '/api/local-connector/runtime/unread-observations', {
    method: 'POST', token: settings.deviceToken, body: { entries: payload.entries },
  });
  let detailState = payload.detailStatus?.reason || '尚未复核当前会话详情。';
  if (payload.selected) {
    try {
      const observation = await request(settings.backendUrl, '/api/local-connector/runtime/selected-conversation', {
        method: 'POST', token: settings.deviceToken, body: payload.selected,
      });
      await setRuntime({ lastSelectedObservationId: observation.id, lastSelectedChatDigest: payload.selected.chatDigest,
        lastSelectedMessageDigest: payload.selected.messageDigest });
      const stageLabel = { UNKNOWN: '阶段待识别', INITIAL_CONTACT: '首次联系', AWAITING_REPLY: '等待求职者回复', CAN_REQUEST_RESUME: '可索要简历', RESUME_REQUESTED: '已索要简历', RESUME_RECEIVED: '简历已到达', RESUME_APPROVED: '简历已通过复核', CAN_EXCHANGE_CONTACT: '可交换联系方式', CONTACT_EXCHANGED: '联系方式已交换', CAN_SCHEDULE_INTERVIEW: '等待人工约面', INTERVIEW_SCHEDULED: '面试已确认' }[observation?.conversationStage] || '阶段待识别';
      detailState = `当前会话详情已稳定复核：${stageLabel}。`;
      if (observation?.conversationSignals?.resumeReceived === true) {
        try {
          await ingestVisibleResumeFromCurrentTab(settings, observation, payload.selected.chatDigest);
        } catch (textError) {
          const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
          const tab = tabs.find((item) => /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
          try {
            if (!tab?.id) throw new Error('没有找到已打开的 BOSS 沟通页。');
            await fetchVisibleResumeFromMainWorld(tab.id, { chatDigest: payload.selected.chatDigest });
          } catch (pdfError) {
            await setRuntime({
              visibleResumeState: `PDF 尚未导入：${safeError(pdfError)}（在线文本分支：${safeError(textError)}）`.slice(0, 300),
              lastVisibleResumeAt: new Date().toISOString(),
            });
          }
        }
      }
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

async function ingestVisibleResumeFromCurrentTab(settings, observation, expectedChatDigest) {
  const runtime = await getRuntime();
  const tabs = await chrome.tabs.query({ url: BOSS_TAB_PATTERNS });
  const tab = tabs.find((item) => /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i.test(item.url || ''));
  if (!tab?.id) throw new Error('在线简历已识别，但没有找到已打开的 BOSS 沟通页。');
  let response = await sendToBossTab(tab.id, { type: 'BRIDGE_COLLECT_VISIBLE_RESUME' });
  if (!response?.ok) {
    const opened = await sendToBossTab(tab.id, { type: 'BRIDGE_OPEN_VISIBLE_RESUME', expectedChatDigest });
    if (!opened?.ok) throw new Error(opened?.error || response?.error || '在线简历入口尚未稳定呈现。');
    response = await sendToBossTab(tab.id, { type: 'BRIDGE_COLLECT_VISIBLE_RESUME' });
  }
  if (!response?.ok) throw new Error(response?.error || '在线简历正文尚未稳定呈现。');
  const capture = validateVisibleResumeTextCapture(response.resume, expectedChatDigest);
  if (runtime.lastVisibleResumeEventDigest === capture.sourceEventDigest) return;
  const result = await request(settings.backendUrl, '/api/local-connector/runtime/visible-resume-text', {
    method: 'POST', token: settings.deviceToken, body: {
      observationId: observation.id,
      sourceEventDigest: capture.sourceEventDigest,
      resumeText: capture.resumeText,
    }, timeoutMs: 120_000,
  });
  await setRuntime({
    lastVisibleResumeEventDigest: capture.sourceEventDigest,
    visibleResumeState: result?.analysisStatus === 'SUCCEEDED'
      ? '当前 BOSS 在线简历已完成 AI 分析，可在简历分析页查看。'
      : `当前 BOSS 在线简历已接收，处理状态：${result?.analysisStatus || result?.processingStatus || '处理中'}。`,
    lastVisibleResumeAt: new Date().toISOString(),
  });
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
      signal: AbortSignal.timeout(options.timeoutMs || 8_000),
    });
  } catch (error) {
    throw new Error(`无法连接本机招聘值守台：${safeError(error)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || `本地服务返回 HTTP ${response.status}`);
  return body;
}

async function requestMultipart(backendUrl, path, token, body, timeoutMs) {
  let response;
  try {
    response = await fetch(`${validateBackendUrl(backendUrl)}${path}`, {
      method: 'POST', headers: { Authorization: `Device ${token}` }, body,
      signal: AbortSignal.timeout(timeoutMs || 120_000),
    });
  } catch (error) { throw new Error(`无法连接本机招聘值守台：${safeError(error)}`); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || `本地服务返回 HTTP ${response.status}`);
  return result;
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
  return mutateRuntime(() => patch);
}

async function mutateRuntime(createPatch) {
  const previous = runtimeMutationTail;
  let release;
  runtimeMutationTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const current = await getRuntime();
    const patch = await createPatch(current);
    if (patch && Object.keys(patch).length > 0) {
      await chrome.storage.local.set({ [RUNTIME_KEY]: { ...current, ...patch } });
    }
    return patch;
  } finally {
    release();
  }
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

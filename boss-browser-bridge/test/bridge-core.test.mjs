import test from 'node:test';
import assert from 'node:assert/strict';
import { consolePathForContext, isJobManagementUrl, jobSnapshotSignature, pageContextFromUrl, publicStatus, snapshotSignature, validateApprovedDraftFillContext, validateApprovedDraftFillResult, validateBackendUrl, validateControlDomDiagnostic, validateCurrentActionEntryTestResult, validateCurrentTestDraftSendResult, validateDraftFillResult, validateExchangeConfirmationTestResult, validateJobSnapshot, validateSnapshot, validateValidationReadiness } from '../src/bridge-core.mjs';

const digest = 'a'.repeat(64);
const digest2 = 'b'.repeat(64);

test('only accepts the local recruitment console URL', () => {
  assert.equal(validateBackendUrl('http://localhost:8088/'), 'http://localhost:8088');
  assert.equal(validateBackendUrl('http://127.0.0.1:8088'), 'http://127.0.0.1:8088');
  assert.throws(() => validateBackendUrl('https://example.com'), /只允许/);
});

test('recognizes the real BOSS job management route without confusing chat pages', () => {
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/job/list'), true);
  assert.equal(isJobManagementUrl('https://www.zhipin.com/web/chat/job/list/'), true);
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/index'), false);
  assert.equal(isJobManagementUrl('https://zhipin.com/web/chat/user-center'), false);
});

test('maps BOSS page context to one clear console destination', () => {
  assert.equal(pageContextFromUrl('https://www.zhipin.com/web/chat/index'), 'CHAT');
  assert.equal(pageContextFromUrl('https://www.zhipin.com/web/chat/job/list'), 'JOB_LIST');
  assert.equal(pageContextFromUrl('https://www.zhipin.com/web/chat/job/edit?encryptId=x'), 'JOB_DETAIL');
  assert.equal(pageContextFromUrl('https://example.com/web/chat/index'), 'NO_BOSS_PAGE');
  assert.equal(consolePathForContext('CHAT'), '/dashboard');
  assert.equal(consolePathForContext('JOB_DETAIL'), '/job-positions');
  assert.equal(consolePathForContext('NO_BOSS_PAGE'), '/boss-accounts');
});

test('accepts a minimized unread snapshot and selected direction', () => {
  const payload = { pageState: 'CHAT_PAGE_READY', entries: [{ chatDigest: digest, previewDigest: digest2, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 2 }], selected: { chatDigest: digest, messageDigest: digest2, direction: 'INBOUND', messageAt: '2026-08-30T08:00:00.000Z', selectedUnread: true, observedAt: '2026-08-30T08:00:01.000Z' } };
  assert.equal(validateSnapshot(payload), payload);
  assert.match(snapshotSignature(payload), /^a{64}:2:/);
});

test('binds selected detail to the current list and includes it in deduplication', () => {
  const entry = { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 };
  const selected = { chatDigest: digest, messageDigest: digest2, direction: 'INBOUND', messageAt: '2026-08-30T08:00:00.000Z', selectedUnread: false, observedAt: '2026-08-30T08:00:01.000Z' };
  const first = { pageState: 'CHAT_PAGE_READY', entries: [entry], selected };
  const changed = { ...first, selected: { ...selected, direction: 'OUTBOUND' } };
  assert.notEqual(snapshotSignature(first), snapshotSignature(changed));
  assert.throws(() => validateSnapshot({ ...first, selected: { ...selected, chatDigest: 'c'.repeat(64) } }), /不属于/);
  assert.equal(validateSnapshot({ ...first, detailStatus: { code: 'VERIFIED', reason: '当前会话详情已稳定识别。' } }).detailStatus.code, 'VERIFIED');
  assert.throws(() => validateSnapshot({ ...first, detailStatus: { code: 'bad code', reason: '候选人原文' } }), /状态无效/);
});

test('rejects duplicate identities and raw or malformed values', () => {
  const entry = { chatDigest: digest, previewDigest: null, jobDigest: null, jobTitle: null, timeDigest: null, unreadCount: 1 };
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [entry, entry] }), /重复/);
  assert.throws(() => validateSnapshot({ pageState: 'CHAT_PAGE_READY', entries: [{ ...entry, previewDigest: '候选人消息原文' }] }), /摘要无效/);
});

test('public status never exposes the local device token and keeps legacy counters compatible', () => {
  const status = publicStatus({ deviceToken: 'secret-device-token', accountName: '主账号', enabled: true }, { state: 'RUNNING', unread: 5 });
  assert.equal(status.paired, true);
  assert.equal(status.accountName, '主账号');
  assert.equal(status.currentUnread, 5);
  assert.equal(status.trackedUnread, 5);
  assert.equal(status.detailState, '尚未复核当前会话详情。');
  assert.equal(status.sendTestLocked, false);
  assert.equal('deviceToken' in status, false);
});

test('accepts minimized job snapshots and rejects duplicate or raw source identities', () => {
  const entry = { sourceDigest: digest, title: 'Java 开发工程师', location: '上海·徐汇', salaryDisplay: '20-30K·13薪', salaryMinK: 20, salaryMaxK: 30, salaryMonths: 13, experienceRequirement: '3-5年', educationRequirement: '本科', description: null, completeness: 5 };
  const payload = { pageState: 'JOB_MANAGEMENT_READY', entries: [entry], observedAt: '2026-08-30T08:00:00.000Z' };
  assert.equal(validateJobSnapshot(payload), payload);
  assert.match(jobSnapshotSignature(payload), /^a{64}:Java 开发工程师:/);
  assert.throws(() => validateJobSnapshot({ ...payload, entries: [entry, entry] }), /重复/);
  assert.throws(() => validateJobSnapshot({ ...payload, entries: [{ ...entry, sourceDigest: 'raw-platform-id' }] }), /摘要无效/);
});

test('accepts unified visible job detail fields', () => {
  const payload = { pageState: 'JOB_MANAGEMENT_READY', observedAt: '2026-08-30T08:00:00.000Z', entries: [{
    sourceDigest: 'd'.repeat(64), title: '跨境客服主管', location: null, salaryDisplay: '8-13K',
    salaryMinK: 8, salaryMaxK: 13, salaryMonths: null, experienceRequirement: '1-3年', educationRequirement: '大专',
    description: '负责客户咨询与售后问题处理。', recruitmentType: '社会全职', jobCategory: '客服主管',
    overseasRequirement: '境内岗位', jobKeywords: '客服｜跨境电商', workAddress: '东莞中熙时代大厦22楼', completeness: 10,
  }] };
  assert.equal(validateJobSnapshot(payload), payload);
  assert.match(jobSnapshotSignature(payload), /东莞中熙时代大厦22楼/);
});

test('accepts only stable and anonymized reply readiness evidence', () => {
  const payload = { actionType: 'SEND_MESSAGE', chatDigest: digest, controlDigest: digest2, pageState: 'CHAT_PAGE_READY', selectedConversationVerified: true, hasRiskOrVerification: false, stableCycles: 3 };
  assert.equal(validateValidationReadiness(payload), payload);
  assert.throws(() => validateValidationReadiness({ ...payload, stableCycles: 2 }), /稳定/);
  assert.throws(() => validateValidationReadiness({ ...payload, hasRiskOrVerification: true }), /安全状态/);
});

test('accepts only an unsent draft fill result for a stable read conversation', () => {
  const payload = { actionType: 'DRAFT_FILL_TEST', chatDigest: digest, controlDigest: digest2, draftDigest: 'c'.repeat(64), filledLength: 28, selectedUnread: false, stableCycles: 2, sendTriggered: false };
  assert.equal(validateDraftFillResult(payload), payload);
  assert.throws(() => validateDraftFillResult({ ...payload, selectedUnread: true }), /已读会话/);
  assert.throws(() => validateDraftFillResult({ ...payload, sendTriggered: true }), /禁止触发发送/);
  assert.throws(() => validateDraftFillResult({ ...payload, stableCycles: 1 }), /稳定/);
});

test('accepts only a stable inbound approved-draft context and an unsent fill receipt', () => {
  const context = { actionType: 'APPROVED_DRAFT_FILL', chatDigest: digest, controlDigest: digest2, latestDirection: 'INBOUND', editorEmpty: true, stableCycles: 2 };
  assert.equal(validateApprovedDraftFillContext(context), context);
  assert.throws(() => validateApprovedDraftFillContext({ ...context, latestDirection: 'OUTBOUND' }), /不满足/);
  const result = { actionType: 'APPROVED_DRAFT_FILL', outcome: 'FILLED', chatDigest: digest, controlDigest: digest2, draftDigest: 'c'.repeat(64), beforeStateDigest: 'd'.repeat(64), afterStateDigest: 'e'.repeat(64), receiptDigest: 'f'.repeat(64), sendTriggered: false };
  assert.equal(validateApprovedDraftFillResult(result), result);
  assert.throws(() => validateApprovedDraftFillResult({ ...result, afterStateDigest: result.beforeStateDigest }), /状态变化/);
  assert.throws(() => validateApprovedDraftFillResult({ ...result, sendTriggered: true }), /禁止触发发送/);
});

test('accepts only a single current-conversation test send without retry', () => {
  const result = { actionType: 'CURRENT_TEST_DRAFT_SEND', outcome: 'SUCCEEDED', chatDigest: digest,
    controlDigest: digest2, draftDigest: 'c'.repeat(64), beforeStateDigest: 'd'.repeat(64),
    afterStateDigest: 'e'.repeat(64), clickTriggered: true, retryTriggered: false };
  assert.equal(validateCurrentTestDraftSendResult(result), result);
  assert.throws(() => validateCurrentTestDraftSendResult({ ...result, retryTriggered: true }), /只能触发一次/);
  assert.throws(() => validateCurrentTestDraftSendResult({ ...result, outcome: 'SUCCEEDED', afterStateDigest: result.beforeStateDigest }), /状态变化/);
  assert.equal(validateCurrentTestDraftSendResult({ ...result, outcome: 'UNKNOWN', afterStateDigest: result.beforeStateDigest }).outcome, 'UNKNOWN');
});

test('accepts only sanitized current-control DOM diagnostics', () => {
  const control = { fingerprint: digest2, tag: 'BUTTON', classes: ['send-btn'], role: 'button', type: 'button', ariaLabel: null, title: null,
    tabIndex: 0, disabled: false, visible: true, width: 72, height: 32, cursor: 'pointer', knownAction: '发送', labelDigest: digest,
    ownerAction: null, interviewField: null, selected: null, dataAttributeNames: ['data-testid'], icon: 'svg.icon-send', ancestors: ['div.toolbar', 'div.chat-editor'] };
  const payload = { actionType: 'CURRENT_CONTROL_DOM_DIAGNOSTIC', pageState: 'CHAT_PAGE_READY', chatDigest: digest, observedAt: '2026-08-31T08:00:00.000Z',
    rawContentIncluded: false, truncated: false, editor: { ...control, tag: 'TEXTAREA', knownAction: null }, controls: [control], reportDigest: digest2 };
  assert.equal(validateControlDomDiagnostic(payload), payload);
  assert.throws(() => validateControlDomDiagnostic({ ...payload, outerHTML: '<button>发送</button>' }), /未允许字段/);
  assert.throws(() => validateControlDomDiagnostic({ ...payload, controls: [{ ...control, textContent: '候选人消息正文' }] }), /未允许字段/);
  assert.throws(() => validateControlDomDiagnostic({ ...payload, rawContentIncluded: true }), /安全标记/);
  assert.equal(validateControlDomDiagnostic({ ...payload, controls: [{ ...control, knownAction: '确认', ownerAction: '换电话' }] }).controls[0].ownerAction, '换电话');
  assert.equal(validateControlDomDiagnostic({ ...payload, controls: [{ ...control, knownAction: null, interviewField: 'MODE_OPTION', selected: true }] }).controls[0].interviewField, 'MODE_OPTION');
  assert.throws(() => validateControlDomDiagnostic({ ...payload, controls: [{ ...control, interviewField: 'CANDIDATE_NAME' }] }), /字段分类无效/);
  assert.throws(() => validateControlDomDiagnostic({ ...payload, controls: [{ ...control, ownerAction: '候选人原文' }] }), /所属操作无效/);
});

test('accepts one-click current action entry evidence and rejects retries', () => {
  const result = { actionType: 'CURRENT_ACTION_ENTRY_TEST', action: 'REQUEST_RESUME', outcome: 'STATE_CHANGED', chatDigest: digest,
    controlDigest: digest2, beforeStateDigest: 'c'.repeat(64), afterStateDigest: 'd'.repeat(64), clickTriggered: true, retryTriggered: false };
  assert.equal(validateCurrentActionEntryTestResult(result), result);
  assert.equal(validateCurrentActionEntryTestResult({ ...result, action: 'INTERVIEW' }).action, 'INTERVIEW');
  assert.throws(() => validateCurrentActionEntryTestResult({ ...result, action: 'DELETE_CHAT' }), /类型无效/);
  assert.throws(() => validateCurrentActionEntryTestResult({ ...result, retryTriggered: true }), /只能触发一次/);
});

test('accepts only one-click phone or wechat confirmation evidence', () => {
  const result = { actionType: 'CURRENT_EXCHANGE_CONFIRMATION_TEST', action: 'EXCHANGE_PHONE', outcome: 'STATE_CHANGED', chatDigest: digest,
    controlDigest: digest2, beforeStateDigest: 'c'.repeat(64), afterStateDigest: 'd'.repeat(64), clickTriggered: true, retryTriggered: false };
  assert.equal(validateExchangeConfirmationTestResult(result), result);
  assert.throws(() => validateExchangeConfirmationTestResult({ ...result, action: 'REQUEST_RESUME' }), /类型无效/);
});

export const DEFAULT_BACKEND_URL = 'http://localhost:8088';
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_CONVERSATIONS = 200;
export const MAX_JOBS = 200;
export const MAX_CONTROL_DIAGNOSTICS = 120;

export function validateBackendUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('本地服务地址无效。');
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '8088') {
    throw new Error('只允许连接本机 localhost:8088 招聘值守台。');
  }
  if (url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('本地服务地址不得包含账号、路径或参数。');
  }
  return `${url.protocol}//${url.host}`;
}

export function isJobManagementUrl(value) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /^\/web\/chat\/job\/list\/?$/.test(path) || (/(?:job|position)/.test(path) && !/^\/web\/chat\/(?:index|user-center)\/?$/.test(path));
  } catch { return false; }
}

export function pageContextFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)zhipin\.com$/i.test(url.hostname)) return 'NO_BOSS_PAGE';
    const path = url.pathname.toLowerCase();
    if (/^\/web\/chat\/(?:index|user-center)\/?$/.test(path)) return 'CHAT';
    if (/^\/web\/chat\/job\/list\/?$/.test(path)) return 'JOB_LIST';
    if (/(?:\/job\/(?:edit|detail)|\/position\/detail)/.test(path)) return 'JOB_DETAIL';
    return 'OTHER_BOSS';
  } catch { return 'NO_BOSS_PAGE'; }
}

export function consolePathForContext(context) {
  if (context === 'CHAT') return '/dashboard';
  if (context === 'JOB_LIST' || context === 'JOB_DETAIL') return '/job-positions';
  return '/boss-accounts';
}

export function validateSnapshot(payload) {
  if (!payload || payload.pageState !== 'CHAT_PAGE_READY') throw new Error('当前不是可观测的沟通页。');
  if (!Array.isArray(payload.entries) || payload.entries.length === 0 || payload.entries.length > MAX_CONVERSATIONS) {
    throw new Error('会话列表数量无效。');
  }
  const seen = new Set();
  for (const entry of payload.entries) {
    if (!DIGEST_PATTERN.test(entry?.chatDigest || '') || seen.has(entry.chatDigest)) throw new Error('会话摘要无效或重复。');
    seen.add(entry.chatDigest);
    if (!Number.isInteger(entry.unreadCount) || entry.unreadCount < 0 || entry.unreadCount > 999) throw new Error('未读计数无效。');
    for (const key of ['previewDigest', 'jobDigest', 'timeDigest']) {
      if (entry[key] !== null && entry[key] !== undefined && !DIGEST_PATTERN.test(entry[key])) throw new Error('页面摘要无效。');
    }
    if (entry.jobTitle !== null && entry.jobTitle !== undefined && (typeof entry.jobTitle !== 'string' || entry.jobTitle.length > 120)) {
      throw new Error('岗位标题无效。');
    }
  }
  if (payload.selected !== null && payload.selected !== undefined) {
    validateSelected(payload.selected);
    if (!seen.has(payload.selected.chatDigest)) throw new Error('选中会话不属于本次稳定列表。');
  }
  if (payload.detailStatus !== null && payload.detailStatus !== undefined) {
    if (!/^[A-Z0-9_]{2,40}$/.test(payload.detailStatus?.code || '') || typeof payload.detailStatus?.reason !== 'string' || payload.detailStatus.reason.length > 120) {
      throw new Error('会话详情状态无效。');
    }
  }
  return payload;
}

export function validateSelected(selected) {
  if (!DIGEST_PATTERN.test(selected?.chatDigest || '') || !DIGEST_PATTERN.test(selected?.messageDigest || '')) throw new Error('选中会话摘要无效。');
  if (!['INBOUND', 'OUTBOUND'].includes(selected.direction)) throw new Error('最后消息方向无效。');
  if (!Number.isFinite(Date.parse(selected.messageAt))) throw new Error('最后消息时间无效。');
  if (!Number.isFinite(Date.parse(selected.observedAt))) throw new Error('会话复核时间无效。');
  if (typeof selected.selectedUnread !== 'boolean') throw new Error('选中会话未读状态无效。');
  validateConversationSignals(selected.conversationSignals);
  return selected;
}

export function validateConversationSignals(signals) {
  const keys = ['requestResumeAvailable', 'resumeReceived', 'exchangeWechatAvailable', 'exchangePhoneAvailable', 'wechatExchanged', 'phoneExchanged', 'scheduleInterviewAvailable', 'interviewScheduled'];
  if (!signals || Object.keys(signals).length !== keys.length || keys.some((key) => typeof signals[key] !== 'boolean')) {
    throw new Error('会话阶段信号无效。');
  }
  return signals;
}

export function validateVisibleResumeTextCapture(payload, expectedChatDigest) {
  if (!payload || payload.actionType !== 'VISIBLE_RESUME_TEXT_CAPTURE') throw new Error('在线简历采集结果类型无效。');
  if (!DIGEST_PATTERN.test(payload.chatDigest || '') || payload.chatDigest !== expectedChatDigest) throw new Error('在线简历与当前会话不一致。');
  if (!DIGEST_PATTERN.test(payload.sourceEventDigest || '') || !DIGEST_PATTERN.test(payload.textDigest || '')) throw new Error('在线简历事件摘要无效。');
  if (typeof payload.resumeText !== 'string' || payload.resumeText.trim().length < 100 || payload.resumeText.length > 30000) throw new Error('在线简历文本长度无效。');
  if (payload.resumeReceived !== true) throw new Error('页面尚未确认简历已到达。');
  return payload;
}

export function validateValidationReadiness(payload) {
  if (!payload || payload.actionType !== 'SEND_MESSAGE' || payload.pageState !== 'CHAT_PAGE_READY') throw new Error('当前不是可验收的回复页面。');
  if (!DIGEST_PATTERN.test(payload.chatDigest || '') || !DIGEST_PATTERN.test(payload.controlDigest || '')) throw new Error('页面验收摘要无效。');
  if (payload.selectedConversationVerified !== true || payload.hasRiskOrVerification !== false) throw new Error('当前会话或页面安全状态未通过。');
  if (!Number.isInteger(payload.stableCycles) || payload.stableCycles < 3 || payload.stableCycles > 20) throw new Error('稳定检查次数无效。');
  return payload;
}

export function validateDraftFillResult(payload) {
  if (!payload || payload.actionType !== 'DRAFT_FILL_TEST') throw new Error('草稿测试结果类型无效。');
  for (const key of ['chatDigest', 'controlDigest', 'draftDigest']) {
    if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('草稿测试摘要无效。');
  }
  if (!Number.isInteger(payload.filledLength) || payload.filledLength < 1 || payload.filledLength > 120) throw new Error('草稿测试长度无效。');
  if (payload.selectedUnread !== false) throw new Error('草稿测试只允许已读会话。');
  if (!Number.isInteger(payload.stableCycles) || payload.stableCycles < 2 || payload.stableCycles > 10) throw new Error('草稿测试稳定检查次数无效。');
  if (payload.sendTriggered !== false) throw new Error('草稿测试禁止触发发送。');
  return payload;
}

export function validateApprovedDraftFillContext(payload) {
  if (!payload || payload.actionType !== 'APPROVED_DRAFT_FILL') throw new Error('已审核草稿填入上下文无效。');
  if (!DIGEST_PATTERN.test(payload.chatDigest || '') || !DIGEST_PATTERN.test(payload.controlDigest || '')) throw new Error('已审核草稿填入摘要无效。');
  if (payload.latestDirection !== 'INBOUND' || payload.editorEmpty !== true) throw new Error('当前会话不满足已审核草稿填入条件。');
  if (!Number.isInteger(payload.stableCycles) || payload.stableCycles < 2 || payload.stableCycles > 10) throw new Error('已审核草稿填入稳定次数无效。');
  return payload;
}

export function validateApprovedDraftFillResult(payload) {
  if (!payload || payload.actionType !== 'APPROVED_DRAFT_FILL' || payload.outcome !== 'FILLED') throw new Error('已审核草稿填入结果无效。');
  for (const key of ['chatDigest', 'controlDigest', 'draftDigest', 'beforeStateDigest', 'afterStateDigest', 'receiptDigest']) {
    if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('已审核草稿填入回执摘要无效。');
  }
  if (payload.beforeStateDigest === payload.afterStateDigest) throw new Error('已审核草稿填入没有可验证的状态变化。');
  if (payload.sendTriggered !== false) throw new Error('已审核草稿填入禁止触发发送。');
  return payload;
}

export function validateCurrentTestDraftSendResult(payload) {
  if (!payload || payload.actionType !== 'CURRENT_TEST_DRAFT_SEND' || !['SUCCEEDED', 'UNKNOWN'].includes(payload.outcome)) throw new Error('当前会话发送测试结果无效。');
  for (const key of ['chatDigest', 'controlDigest', 'draftDigest', 'beforeStateDigest', 'afterStateDigest']) {
    if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('当前会话发送测试摘要无效。');
  }
  if (payload.clickTriggered !== true || payload.retryTriggered !== false) throw new Error('发送测试必须且只能触发一次。');
  if (payload.outcome === 'SUCCEEDED' && payload.beforeStateDigest === payload.afterStateDigest) throw new Error('发送成功缺少可核对的页面状态变化。');
  return payload;
}

export function validateCurrentActionEntryTestResult(payload) {
  if (!payload || payload.actionType !== 'CURRENT_ACTION_ENTRY_TEST' || !['REQUEST_RESUME', 'EXCHANGE_PHONE', 'EXCHANGE_WECHAT', 'INTERVIEW'].includes(payload.action)) throw new Error('当前会话操作入口测试类型无效。');
  if (!['DIALOG_OPENED', 'STATE_CHANGED', 'UNKNOWN'].includes(payload.outcome)) throw new Error('当前会话操作入口测试结果无效。');
  for (const key of ['chatDigest', 'controlDigest', 'beforeStateDigest', 'afterStateDigest']) if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('当前会话操作入口测试摘要无效。');
  if (payload.clickTriggered !== true || payload.retryTriggered !== false) throw new Error('操作入口测试必须且只能触发一次。');
  return payload;
}

export function validateActionLeaseExecutionResult(payload, expectedTargetDigest, expectedActionType = 'REQUEST_RESUME') {
  if (!payload || !['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE'].includes(expectedActionType)
      || payload.actionType !== expectedActionType || !['SUCCEEDED', 'UNKNOWN'].includes(payload.outcome)) throw new Error('页面动作租约执行结果无效。');
  if (!DIGEST_PATTERN.test(expectedTargetDigest || '') || payload.chatDigest !== expectedTargetDigest) throw new Error('页面动作租约目标不一致。');
  for (const key of ['messageDigest', 'controlDigest', 'beforeStateDigest', 'afterStateDigest', 'receiptDigest']) {
    if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('页面动作租约回执摘要无效。');
  }
  if (payload.clickTriggered !== true || payload.retryTriggered !== false) throw new Error('页面动作必须且只能执行一次入口点击。');
  if (typeof payload.confirmTriggered !== 'boolean' || (payload.outcome === 'SUCCEEDED' && expectedActionType !== 'SEND_MESSAGE' && payload.confirmTriggered !== true)) throw new Error('原生页面动作成功回执必须包含唯一一次确认点击。');
  if (payload.outcome === 'SUCCEEDED' && payload.beforeStateDigest === payload.afterStateDigest) throw new Error('页面动作成功回执缺少页面状态变化。');
  if (typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.length > 300) throw new Error('页面动作执行原因无效。');
  return payload;
}

export function isSupportedActionLeaseMode(mode) {
  return mode === 'VERIFIED_PAGE_EXECUTOR' || mode === 'EXPLICIT_SINGLE_CONVERSATION_TEST';
}

export function validateExchangeConfirmationTestResult(payload) {
  if (!payload || payload.actionType !== 'CURRENT_EXCHANGE_CONFIRMATION_TEST' || !['EXCHANGE_PHONE', 'EXCHANGE_WECHAT'].includes(payload.action)) throw new Error('联系方式二级确认测试类型无效。');
  if (!['STATE_CHANGED', 'UNKNOWN'].includes(payload.outcome)) throw new Error('联系方式二级确认测试结果无效。');
  for (const key of ['chatDigest', 'controlDigest', 'beforeStateDigest', 'afterStateDigest']) if (!DIGEST_PATTERN.test(payload[key] || '')) throw new Error('联系方式二级确认测试摘要无效。');
  if (payload.clickTriggered !== true || payload.retryTriggered !== false) throw new Error('联系方式二级确认测试必须且只能触发一次。');
  return payload;
}

export function validateControlDomDiagnostic(payload) {
  if (!payload || payload.actionType !== 'CURRENT_CONTROL_DOM_DIAGNOSTIC' || payload.pageState !== 'CHAT_PAGE_READY') throw new Error('功能键 DOM 诊断类型无效。');
  const allowedPayloadKeys = new Set(['actionType', 'pageState', 'chatDigest', 'observedAt', 'rawContentIncluded', 'truncated', 'editor', 'controls', 'resumeCandidates', 'reportDigest']);
  if (Object.keys(payload).some((key) => !allowedPayloadKeys.has(key))) throw new Error('功能键 DOM 诊断包含未允许字段。');
  if (!DIGEST_PATTERN.test(payload.chatDigest || '') || !DIGEST_PATTERN.test(payload.reportDigest || '')) throw new Error('功能键 DOM 诊断摘要无效。');
  if (!Number.isFinite(Date.parse(payload.observedAt)) || payload.rawContentIncluded !== false) throw new Error('功能键 DOM 诊断安全标记无效。');
  if (!payload.editor || !Array.isArray(payload.controls) || payload.controls.length > MAX_CONTROL_DIAGNOSTICS) throw new Error('功能键 DOM 诊断数量无效。');
  if (payload.resumeCandidates !== undefined && (!Array.isArray(payload.resumeCandidates) || payload.resumeCandidates.length > 80)) throw new Error('简历入口 DOM 诊断数量无效。');
  const allowedKeys = new Set(['fingerprint', 'tag', 'classes', 'role', 'type', 'ariaLabel', 'title', 'tabIndex', 'disabled', 'visible', 'width', 'height', 'cursor', 'knownAction', 'ownerAction', 'interviewField', 'selected', 'labelDigest', 'dataAttributeNames', 'icon', 'ancestors', 'hints']);
  for (const control of [payload.editor, ...payload.controls, ...(payload.resumeCandidates || [])]) {
    if (!control || Object.keys(control).some((key) => !allowedKeys.has(key))) throw new Error('功能键 DOM 诊断包含未允许字段。');
    if (!DIGEST_PATTERN.test(control.fingerprint || '') || !/^[A-Z][A-Z0-9-]{0,24}$/.test(control.tag || '')) throw new Error('功能键 DOM 控件摘要无效。');
    if (!Array.isArray(control.classes) || control.classes.length > 12 || control.classes.some((item) => typeof item !== 'string' || item.length > 80)) throw new Error('功能键 DOM 类名无效。');
    if (!Array.isArray(control.dataAttributeNames) || control.dataAttributeNames.length > 20 || control.dataAttributeNames.some((item) => !/^data-[a-z0-9_-]{1,60}$/i.test(item))) throw new Error('功能键 DOM 数据属性名无效。');
    if (!Array.isArray(control.ancestors) || control.ancestors.length > 4 || control.ancestors.some((item) => typeof item !== 'string' || item.length > 240)) throw new Error('功能键 DOM 父级路径无效。');
    for (const key of ['role', 'type', 'ariaLabel', 'title', 'cursor', 'icon']) if (control[key] !== null && control[key] !== undefined && (typeof control[key] !== 'string' || control[key].length > 160)) throw new Error('功能键 DOM 属性无效。');
    for (const key of ['width', 'height']) if (!Number.isInteger(control[key]) || control[key] < 0 || control[key] > 10000) throw new Error('功能键 DOM 尺寸无效。');
    if (!Number.isInteger(control.tabIndex) || typeof control.disabled !== 'boolean' || typeof control.visible !== 'boolean') throw new Error('功能键 DOM 状态无效。');
    if (control.knownAction !== null && control.knownAction !== undefined && !['发送', '求简历', '接收简历', '换电话', '换微信', '约面试', '不合适', '确认', '确定', '取消', '暂不'].includes(control.knownAction)) throw new Error('功能键 DOM 操作标签无效。');
    if (control.ownerAction !== null && control.ownerAction !== undefined && !['求简历', '换电话', '换微信', '约面试'].includes(control.ownerAction)) throw new Error('功能键 DOM 所属操作无效。');
    if (control.interviewField !== null && control.interviewField !== undefined && !['JOB', 'ADDRESS', 'NOTE', 'DATE', 'TIME', 'MODE_OPTION', 'CONTACT', 'CANCEL', 'SEND'].includes(control.interviewField)) throw new Error('面试弹窗字段分类无效。');
    if (control.selected !== null && control.selected !== undefined && typeof control.selected !== 'boolean') throw new Error('面试弹窗选择状态无效。');
    if (control.hints !== undefined && (!Array.isArray(control.hints) || control.hints.length > 5 || control.hints.some((item) => !['RESUME','ATTACHMENT','PDF','PREVIEW','DOWNLOAD'].includes(item)))) throw new Error('简历入口提示分类无效。');
    if (control.labelDigest !== null && control.labelDigest !== undefined && !DIGEST_PATTERN.test(control.labelDigest)) throw new Error('功能键 DOM 文字摘要无效。');
  }
  return payload;
}

export function validateJobSnapshot(payload) {
  if (!payload || payload.pageState !== 'JOB_MANAGEMENT_READY') throw new Error('当前不是可采集的职位管理页。');
  if (!Array.isArray(payload.entries) || payload.entries.length === 0 || payload.entries.length > MAX_JOBS) throw new Error('职位列表数量无效。');
  if (!Number.isFinite(Date.parse(payload.observedAt))) throw new Error('职位快照时间无效。');
  if (!['OPEN_JOBS', 'CLOSED_JOBS', 'MIXED', 'SINGLE_JOB'].includes(payload.scope)) throw new Error('职位快照范围无效。');
  if (typeof payload.authoritative !== 'boolean') throw new Error('职位快照完整性标记无效。');
  if (payload.authoritative && payload.scope !== 'OPEN_JOBS') throw new Error('只有完整的在招职位清单可以作为下架依据。');
  const seen = new Set();
  for (const entry of payload.entries) {
    if (!DIGEST_PATTERN.test(entry?.sourceDigest || '') || seen.has(entry.sourceDigest)) throw new Error('职位来源摘要无效或重复。');
    seen.add(entry.sourceDigest);
    if (typeof entry.title !== 'string' || entry.title.trim().length < 2 || entry.title.length > 120) throw new Error('职位标题无效。');
    for (const [key, max] of [['location', 120], ['salaryDisplay', 120], ['experienceRequirement', 80], ['educationRequirement', 80], ['description', 10000], ['recruitmentType', 40], ['jobCategory', 120], ['overseasRequirement', 40], ['jobKeywords', 500], ['workAddress', 240]]) {
      if (entry[key] !== null && entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > max)) throw new Error('职位字段无效。');
    }
    for (const key of ['salaryMinK', 'salaryMaxK']) if (entry[key] !== null && entry[key] !== undefined && (!Number.isInteger(entry[key]) || entry[key] < 1 || entry[key] > 1000)) throw new Error('职位薪资无效。');
    if (entry.salaryMonths !== null && entry.salaryMonths !== undefined && (!Number.isInteger(entry.salaryMonths) || entry.salaryMonths < 12 || entry.salaryMonths > 16)) throw new Error('职位薪数无效。');
    if (!Number.isInteger(entry.completeness) || entry.completeness < 1 || entry.completeness > 12) throw new Error('职位完整度无效。');
    if (!['OPEN', 'CLOSED', 'UNKNOWN'].includes(entry.platformStatus)) throw new Error('职位平台状态无效。');
  }
  if (payload.authoritative && payload.entries.some((entry) => entry.platformStatus !== 'OPEN')) throw new Error('完整在招清单包含非在招职位。');
  return payload;
}

export function jobSnapshotSignature(payload) {
  return `${payload.scope}:${payload.authoritative}|${payload.entries.map((entry) => [entry.sourceDigest, entry.title, entry.platformStatus, entry.location || '', entry.salaryDisplay || '', entry.experienceRequirement || '', entry.educationRequirement || '', entry.description || '', entry.recruitmentType || '', entry.jobCategory || '', entry.overseasRequirement || '', entry.jobKeywords || '', entry.workAddress || ''].join(':')).join('|')}`;
}

export function snapshotSignature(payload) {
  const list = payload.entries
    .map((entry) => [entry.chatDigest, entry.unreadCount, entry.previewDigest || '', entry.jobDigest || '', entry.timeDigest || ''].join(':'))
    .join('|');
  const selected = payload.selected
    ? [payload.selected.chatDigest, payload.selected.messageDigest, payload.selected.direction, payload.selected.messageAt, payload.selected.selectedUnread,
      ...Object.values(payload.selected.conversationSignals || {}).map((value) => value ? 1 : 0)].join(':')
    : 'none';
  return `${list}|selected:${selected}`;
}

export function compactProcessedMessages(entries, terminalLimit = 200, absoluteLimit = 1200) {
  const safe = Array.isArray(entries) ? entries.filter((item) => item && typeof item === 'object') : [];
  const processing = safe.filter((item) => item.outcome === 'PROCESSING');
  const terminal = safe.filter((item) => item.outcome !== 'PROCESSING').slice(-terminalLimit);
  return [...terminal, ...processing].slice(-absoluteLimit);
}

export function validateSingleAccountBaseline(payload, limit = 500) {
  const validateEntries = (entries) => {
    if (!Array.isArray(entries) || entries.length > limit) throw new Error('持续回复恢复基线无效。');
    const keys = new Set();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2
          || !/^[a-f0-9]{64}$/.test(entry[0]) || !/^[a-f0-9]{64}$/.test(entry[1])
          || keys.has(entry[0])) throw new Error('持续回复恢复基线无效。');
      keys.add(entry[0]);
    }
    return entries;
  };
  if (!payload || typeof payload !== 'object') throw new Error('持续回复恢复基线无效。');
  return { unread: validateEntries(payload.unread), selected: validateEntries(payload.selected) };
}

export function nextConsecutiveFailureCount(previous, outcome) {
  const safePrevious = Math.max(0, Number(previous) || 0);
  if (outcome === 'SENT') return 0;
  if (outcome === 'UNKNOWN') return safePrevious + 1;
  return safePrevious;
}

export function publicStatus(settings, runtime) {
  return {
    paired: Boolean(settings?.deviceToken),
    enabled: settings?.enabled !== false,
    accountName: settings?.accountName || '',
    deviceId: settings?.deviceId || '',
    backendUrl: settings?.backendUrl || DEFAULT_BACKEND_URL,
    state: runtime?.state || 'IDLE',
    reason: runtime?.reason || '等待检测 BOSS 沟通页。',
    lastSyncAt: runtime?.lastSyncAt || null,
    total: runtime?.total || 0,
    currentUnread: runtime?.currentUnread ?? runtime?.unread ?? 0,
    trackedUnread: runtime?.trackedUnread ?? runtime?.unread ?? 0,
    detailState: runtime?.detailState || '尚未复核当前会话详情。',
    jobState: runtime?.jobState || '尚未同步职位页面。',
    jobTotal: runtime?.jobTotal || 0,
    lastJobSyncAt: runtime?.lastJobSyncAt || null,
    readinessState: runtime?.readinessState || '尚未检查当前会话的回复入口。',
    lastReadinessAt: runtime?.lastReadinessAt || null,
    draftTestState: runtime?.draftTestState || '尚未执行已读会话草稿写入测试。',
    lastDraftTestAt: runtime?.lastDraftTestAt || null,
    approvedDraftFillState: runtime?.approvedDraftFillState || '尚未填入后台已审核安全草稿。',
    lastApprovedDraftFillAt: runtime?.lastApprovedDraftFillAt || null,
    sendTestState: runtime?.sendTestState || '尚未执行当前会话单次发送测试。',
    lastSendTestAt: runtime?.lastSendTestAt || null,
    sendTestLocked: runtime?.sendTestLocked === true,
    sendTestPrepared: /^[a-f0-9]{64}$/.test(runtime?.sendTestPreparedChatDigest || ''),
    autoReplyTestArmed: runtime?.autoReplyTestArmed === true,
    autoReplyTestState: runtime?.autoReplyTestState || '尚未开启当前会话新消息触发测试。',
    autoReplyTestOutcome: runtime?.autoReplyTestOutcome || 'NOT_RUN',
    autoReplyTestReason: runtime?.autoReplyTestReason || '尚未执行触发测试。',
    autoReplyTestExpiresAt: runtime?.autoReplyTestExpiresAt || null,
    lastAutoReplyTestAt: runtime?.lastAutoReplyTestAt || null,
    autoReplyTestLastCheckedAt: runtime?.autoReplyTestLastCheckedAt || null,
    autoReplyDiagnosticState: runtime?.autoReplyDiagnosticState || '尚未执行当前触发条件诊断。',
    lastAutoReplyDiagnosticAt: runtime?.lastAutoReplyDiagnosticAt || null,
    singleAccountAutoReplyEnabled: runtime?.singleAccountAutoReplyEnabled === true,
    singleAccountAutoReplyState: runtime?.singleAccountAutoReplyState || '当前未开启；仅支持当前配对账号。',
    singleAccountAutoReplyProcessedCount: Array.isArray(runtime?.singleAccountProcessedMessages) ? runtime.singleAccountProcessedMessages.length : 0,
    singleAccountConsecutiveFailures: Number(runtime?.singleAccountConsecutiveFailures || 0),
    lastSingleAccountAutoReplyAt: runtime?.lastSingleAccountAutoReplyAt || null,
    controlDiagnosticState: runtime?.controlDiagnosticState || '尚未识别当前会话功能键 DOM。',
    lastControlDiagnosticAt: runtime?.lastControlDiagnosticAt || null,
    controlDiagnostic: runtime?.controlDiagnostic || null,
    actionTestState: runtime?.actionTestState || '尚未执行求简历或联系方式入口测试。',
    lastActionTestAt: runtime?.lastActionTestAt || null,
    actionTestLocks: runtime?.actionTestLocks || {},
    exchangeConfirmState: runtime?.exchangeConfirmState || '尚未执行联系方式二级确定测试。',
    lastExchangeConfirmAt: runtime?.lastExchangeConfirmAt || null,
    exchangeConfirmLocks: runtime?.exchangeConfirmLocks || {},
    productionActionState: runtime?.productionActionState || '尚未执行生产自动动作。',
    productionActionOutcome: runtime?.productionActionOutcome || 'NOT_RUN',
    lastProductionActionAt: runtime?.lastProductionActionAt || null,
    visibleResumeState: runtime?.visibleResumeState || '尚未识别当前会话中的 PDF 简历。',
    lastVisibleResumeAt: runtime?.lastVisibleResumeAt || null,
    pageContext: runtime?.pageContext || 'NO_BOSS_PAGE',
  };
}

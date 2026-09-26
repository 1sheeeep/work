(() => {
  if (window.__recruitmentReadOnlyBridgeLoaded) return;
  window.__recruitmentReadOnlyBridgeLoaded = true;

  const CHAT_URL = /\/web\/chat\/(?:index|user-center)(?:[/?#]|$)/i;
  const SELECTORS = {
    conversation: '.geek-item', unread: '.badge-count', job: '.source-job', preview: '.push-text', time: '.time',
    selectedConversation: '.geek-item.selected', activeConversation: '.conversation-message',
    message: '.item-friend, .item-myself', inbound: '.item-friend', outbound: '.item-myself', messageTime: '.message-time',
  };
  const JOB_SELECTORS = {
    cards: ['.job-jobInfo-warp[data-id]', '.job-jobInfo-warp', '[data-job-id]', '[data-position-id]', '.job-list-wrap .job-card-wrapper', '.job-list-box .job-card-wrapper', '.job-list .job-item', '.job-list-item', '.job-card', '[class*="job-card"]', '[class*="job-item"]'],
    title: ['.job-title a', '[class*="job-name"]', '[class*="job-title"]', '.name', 'h3', 'h2'],
    location: ['[class*="job-area"]', '[class*="location"]', '[class*="address"]'],
    salary: ['[class*="salary"]', '[class*="red"]'],
    experience: ['[class*="experience"]', '[class*="exp"]'],
    education: ['[class*="degree"]', '[class*="education"]'],
    description: ['[class*="job-detail"]', '[class*="description"]', '[class*="job-desc"]'],
  };
  const TEST_DRAFT_TEXT = '【草稿测试，不会自动发送】您好，已收到您的消息。';
  const RESUME_ATTACHMENT_RECEIPT_CONTEXT = '[SYSTEM_RESUME_ATTACHMENT_RECEIPT]';
  const SINGLE_ACCOUNT_PREFETCH_LIMIT = 5;
  // A full BOSS virtual list can contain thousands of rows. Give the page
  // loop back to READY sends after a small read-only scan window instead of
  // monopolising it for an 80-position sweep.
  // Keep deep virtual-list scans deliberately short and infrequent.  A long
  // list must not monopolise the page while a new message is waiting in the
  // currently open conversation.
  const LIST_SCAN_MAX_POSITIONS_PER_TURN = 4;
  const LIST_SCAN_MAX_TURN_MS = 1_200;
  const LIST_SCAN_CONTINUE_DELAY_MS = 1_200;
  const READ_REPLY_REVIEW_INTERVAL_MS = 30_000;
  const READ_REPLY_REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
  let collectTimer = null;
  let collecting = false;
  let autoReplyArm = null;
  let autoReplyTimer = null;
  let autoReplyBusy = false;
  let autoReplyGeneration = 0;
  let singleAccountAutoReplyEnabled = false;
  let singleAccountAutoReplyTimer = null;
  let singleAccountAutoReplyDueAt = 0;
  let dutyControlTimer = null;
  let singleAccountPendingChatDigest = null;
  // BOSS virtualizes the conversation list. The selected row can disappear
  // from the list DOM while its detail pane remains open, so retain only the
  // digest of the last positively verified active conversation. This lets the
  // loop notice a new inbound message in the open pane without trusting an
  // unread badge or guessing a different conversation identity.
  let singleAccountActiveChatDigest = null;
  let singleAccountUnreadBaseline = new Map();
  let singleAccountSelectedMessageBaseline = new Map();
  let singleAccountConversationLocators = new Map();
  let conversationScanCursors = new Map();
  let singleAccountPendingReplies = new Map();
  let singleAccountUnknownReconciliations = new Map();
  // One page-side task queue. Each entry keeps its existing lane so the
  // scheduler can preserve SEND -> ANALYSIS -> REVALIDATION priority without
  // maintaining three independent arrays.
  let singleAccountPipelineQueue = [];
  const PIPELINE_LANE_PRIORITY = { SEND: 0, ANALYSIS: 1, REVALIDATION: 2 };
  let singleAccountRetryLocateDeferrals = new Map();
  let singleAccountRetryRefreshAt = 0;
  let singleAccountConversationQueue = [];
  let singleAccountReadReviewInventory = [];
  let singleAccountReadReviewNextAt = 0;
  let singleAccountBacklogMode = false;
  let singleAccountBacklogSeen = new Map();
  let singleAccountQueueWindowInitialized = false;
  let lastDeepConversationScanAt = 0;
  let lastConversationSweepCode = 'NOT_RUN';
  let lastConversationSweepCount = 0;
  const DEEP_SCAN_COOLDOWN_MS = 3_000;
  const QUEUE_TARGET_MAX_LOCATE_FAILURES = 5;
  const QUEUE_TARGET_MAX_WAIT_MS = 30_000;
  const QUEUE_TARGET_RETRY_BASE_MS = 1_500;
  const QUEUE_TARGET_RETRY_MAX_MS = 12_000;
  const RETRY_TARGET_MAX_LOCATE_FAILURES = 3;
  const RETRY_TARGET_MAX_WAIT_MS = 30_000;
  const RETRY_TARGET_DEFER_MS = 5 * 60_000;
  const CURRENT_CONVERSATION_AI_HOLD_MS = 45_000;
  const READY_SEND_WAKE_AFTER_MS = 15_000;
  const READY_SEND_WAKE_INTERVAL_MS = 10_000;
  const READY_SEND_RELOCATE_DELAY_MS = 4_000;
  const READY_SEND_MAX_LOCATE_FAILURES = 10;
  const READY_SEND_MAX_WAIT_MS = 2 * 60_000;
  const LIST_DOM_RETRY_DELAY_MS = 4_000;
  const LIST_POINTER_IDLE_FOCUS_MS = 10_000;
  const AUTO_REPLY_WAKE_WATCHDOG_MS = 5_000;
  // Content-script calls to the background service worker used to have no
  // outer deadline. A stuck page operation could therefore keep the whole
  // automation loop waiting forever. Keep the normal bridge calls bounded,
  // while allowing the synchronous one-shot AI endpoint its documented wait.
  const BRIDGE_MESSAGE_TIMEOUT_MS = 30_000;
  const BRIDGE_MESSAGE_TIMEOUTS = Object.freeze({
    BRIDGE_DECIDE_INBOUND_REPLY: 145_000,
    BRIDGE_CLASSIFY_RESUME_ATTACHMENT: 130_000,
    BRIDGE_VISIBLE_RESUME_PDF_CAPTURE: 130_000,
    BRIDGE_SYNC_CURRENT_TRANSCRIPT: 25_000,
  });
  let jobConfirmationTimer = null;
  let pendingJobConfirmationSignature = '';
  let resumeCaptureStatusBar = null;
  let resumeCaptureCopyBtn = null;
  let resumeCaptureStatusLog = null;
  let resumeCardScanTimer = null;
  let resumeAttachmentProcessing = false;
  let resumePreviewOpenPending = false;
  let resumeCaptureStatusCollapsed = false;
  let resumePreviewCloseFirstFailureAt = 0;
  let resumePreviewCloseAttempts = 0;
  // A transcript export is strictly read-only. MutationObserver events from
  // its scroll/rerender must not be interpreted as a new resume attachment.
  let transcriptCaptureInProgress = false;
  let resumeCaptureRequest = null;
  let resumePreviewOpenAttempts = 0;
  let resumeAttachmentEpoch = 0;
  const RESUME_ATTACHMENT_WAIT_MS = 30_000;
  let lastResumePdfImportOutcome = null;
  let lastResumeCardScanSignature = '';
  let lastResumeCardScanAt = 0;
  let lastAutoReplyTraceKey = '';
  let lastAutoReplyTraceAt = 0;
  let lastConversationDomProbeKey = '';
  let lastConversationDomProbeAt = 0;
  let lastMouseInConversationListAt = Date.now();
  let lastConversationListActivationAt = 0;
  let lastResumeCloseDomProbeKey = '';
  let lastResumeCloseDomProbeAt = 0;
  let resumeDialogDiagnosticSequence = 0;
  const resumeDialogDiagnosticIds = new WeakMap();
  let autoReplyTraceRunId = '';
  let autoReplyTraceRunStartedAt = 0;
  let autoReplyTraceRunSequence = 0;
  let autoReplyWakeWatchdogTimer = null;
  let autoReplyWatchdogRecoveryCount = 0;
  let autoReplyWatchdogLastProgressAt = 0;
  let autoReplyWatchdogRecoveryAt = 0;
  const AUTO_REPLY_STALL_THRESHOLD_MS = 90_000;
  const AUTO_REPLY_WATCHDOG_COOLDOWN_MS = 10 * 60_000;
  const AUTO_REPLY_WATCHDOG_MAX_RECOVERIES = 3;
  const clickedResumeCardControls = new WeakSet();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['BRIDGE_COLLECT', 'BRIDGE_COLLECT_JOBS', 'BRIDGE_LOCATE_CONVERSATION', 'BRIDGE_CHECK_REPLY_READINESS', 'BRIDGE_INSPECT_CURRENT_CONTROLS', 'BRIDGE_COPY_CURRENT_TRANSCRIPT', 'BRIDGE_TEST_CURRENT_ACTION_ENTRY', 'BRIDGE_CONFIRM_CURRENT_EXCHANGE', 'BRIDGE_PREPARE_ACTION_LEASE', 'BRIDGE_EXECUTE_ACTION_LEASE', 'BRIDGE_FILL_TEST_DRAFT', 'BRIDGE_PREPARE_CURRENT_SEND_TEST', 'BRIDGE_SEND_CURRENT_TEST_DRAFT', 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY', 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY', 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL', 'BRIDGE_FILL_APPROVED_DRAFT', 'BRIDGE_COLLECT_VISIBLE_RESUME', 'BRIDGE_OPEN_VISIBLE_RESUME'].includes(message?.type)) return false;
    const task = message.type === 'BRIDGE_COLLECT_JOBS'
      ? collectJobsAndPublish(Boolean(message.allowEmbeddedJobList), Boolean(message.refreshRequested))
      : message.type === 'BRIDGE_LOCATE_CONVERSATION'
        ? locateConversation(message.chatDigest)
      : message.type === 'BRIDGE_CHECK_REPLY_READINESS'
        ? collectReplyReadiness()
        : message.type === 'BRIDGE_INSPECT_CURRENT_CONTROLS'
          ? inspectCurrentConversationControls()
        : message.type === 'BRIDGE_COPY_CURRENT_TRANSCRIPT'
          ? collectCurrentTranscript()
        : message.type === 'BRIDGE_TEST_CURRENT_ACTION_ENTRY'
          ? testCurrentActionEntry(message.action)
        : message.type === 'BRIDGE_CONFIRM_CURRENT_EXCHANGE'
          ? confirmCurrentExchange(message.action)
        : message.type === 'BRIDGE_PREPARE_ACTION_LEASE'
          ? prepareActionLeaseContext()
        : message.type === 'BRIDGE_EXECUTE_ACTION_LEASE'
          ? executeActionLease(message.lease)
        : message.type === 'BRIDGE_FILL_TEST_DRAFT'
          ? fillTestDraft()
          : message.type === 'BRIDGE_PREPARE_CURRENT_SEND_TEST'
            ? prepareCurrentSendTest()
          : message.type === 'BRIDGE_SEND_CURRENT_TEST_DRAFT'
            ? sendCurrentTestDraft(message.expectedChatDigest)
          : message.type === 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY'
            ? diagnoseCurrentAutoReply()
          : message.type === 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST'
            ? armCurrentAutoReplyTest()
          : message.type === 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST'
            ? cancelCurrentAutoReplyTest('CANCELLED')
          : message.type === 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY'
            ? setSingleAccountAutoReply(Boolean(message.enabled), Boolean(message.restore))
          : message.type === 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL'
            ? prepareApprovedDraftFill()
            : message.type === 'BRIDGE_FILL_APPROVED_DRAFT'
              ? fillApprovedDraft(message.payload)
              : message.type === 'BRIDGE_COLLECT_VISIBLE_RESUME'
                ? collectVisibleResumeText()
                : message.type === 'BRIDGE_OPEN_VISIBLE_RESUME' ? openVisibleResume(message.expectedChatDigest) : collectAndPublish(true);
    task.then((result) => sendResponse(result || { ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  const observer = new MutationObserver((mutations) => {
    const pageChanged = mutations.some(automationRelevantMutation);
    if (!pageChanged) return;
    scheduleCollect(1_200);
    scheduleAutoReplyCheck(500);
    scheduleSingleAccountAutoReply(300);
    if (!transcriptCaptureInProgress) scheduleResumeCardScan(1_000);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });

  function automationRelevantMutation(mutation) {
    if (mutation.target instanceof Element && mutation.target.closest('#__recruitment_capture_status')) return false;
    const selectors = `${SELECTORS.conversation}, ${SELECTORS.activeConversation}, .message-card-wrap, .hyperLink, [class*="resume"], .boss-popup__wrapper, .user-list`;
    if (mutation.target instanceof Element && mutation.target.closest(selectors)) return true;
    if (mutation.type !== 'childList') return false;
    return [...mutation.addedNodes, ...mutation.removedNodes]
      .some((node) => node instanceof Element && (node.matches(selectors) || node.querySelector(selectors)));
  }
  document.addEventListener('click', (event) => {
    const nodes = [...event.composedPath()].filter((c) => c instanceof HTMLElement);
    const node = nodes.find((c) => /^(?:查看简历|点击预览附件简历|预览附件简历)$/.test(compact(controlLabel(c))));
    if (node) {
      showResumeCaptureStatus('点击匹配: ' + compact(controlLabel(node)));
      void recordResumePreviewControl(node);
    } else {
      const card = nodes.find((c) => /message-card-wrap|hyperlink/i.test((c.className || '').toString()));
      if (card) {
        showResumeCaptureStatus('点击在简历卡片内');
        void recordResumePreviewControl(card);
      }
    }
  }, true);
  window.addEventListener('message', (event) => {
    if (!/^https:\/\/(?:[^./]+\.)?zhipin\.com$/i.test(event.origin)) return;
    if (event.data?.type === 'RECRUITMENT_VISIBLE_RESUME_PDF') void forwardMainWorldResumePdf(event.data);
    if (event.data?.type === 'RECRUITMENT_RESUME_DOWNLOAD_DETECTED') void reportResumeDownloadDetected();
    if (event.data?.type === 'RECRUITMENT_RESUME_CAPTURE_STATUS') void forwardResumeCaptureStatus(event.data);
  });
  function wakeVisibleAutomation() {
    if (document.hidden) return;
    scheduleCollect(300);
    scheduleDutyControlSync(0);
    if (singleAccountAutoReplyEnabled) {
      clearSingleAccountAutoReplyTimer();
      traceAutoReply('PAGE_VISIBLE_RESUMED', { outcome: 'INFO', reason: '页面已恢复可见，立即重新校验会话并继续待处理队列。' });
      scheduleSingleAccountAutoReply(100);
    }
  }
  window.addEventListener('focus', wakeVisibleAutomation, { passive: true });
  document.addEventListener('visibilitychange', wakeVisibleAutomation, { passive: true });
  scheduleCollect(1_500);
  bootResumeCaptureStatusPanel();
  void restoreSingleAccountAutoReply();
  scheduleDutyControlSync(1_000);

  let lastMouseDiagKey = '';
  let lastMouseDiagAt = 0;

  function diagnoseMouseAndScroll(event) {
    const now = Date.now();
    if (now - lastMouseDiagAt < 800) return;
    const x = event?.clientX ?? -1;
    const y = event?.clientY ?? -1;
    const el = document.elementFromPoint(x, y);
    const elTag = el ? describeDomNode(el) : 'null';
    const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
    const scroller = conversationScrollContainer();
    const scrollInfo = scroller
      ? `容器=${describeDomNode(scroller)} scrollTop=${Math.round(scroller.scrollTop)} clientH=${Math.round(scroller.clientHeight)} scrollH=${Math.round(scroller.scrollHeight)} overflowY=${getComputedStyle(scroller).overflowY}`
      : '未找到';
    const inList = scroller && scroller.contains(el);
    if (event?.isTrusted && inList) lastMouseInConversationListAt = now;
    const key = `${x},${y},${rows.length},${!!scroller},${inList}`;
    if (key === lastMouseDiagKey) return;
    lastMouseDiagKey = key;
    lastMouseDiagAt = now;
    showResumeCaptureStatus(
      `🖱️ (${x},${y}) 悬停=${elTag} | 会话行=${rows.length} | 滚动=${scrollInfo} | 在列表内=${inList}`,
      inList ? 'success' : 'error',
    );
  }

  document.addEventListener('mousemove', diagnoseMouseAndScroll, { passive: true });

  function diagnoseScrollContainerAtStartup() {
    const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
    const scroller = conversationScrollContainer();
    const candidates = [...document.querySelectorAll(
      '.geek-list, .geek-list-wrap, .user-list, .conversation-list, .chat-list, [class*="geek-list"], [class*="user-list"], [class*="conversation-list"], [class*="chat-list"]',
    )].filter((c) => c instanceof HTMLElement && visible(c));
    const candidateDetails = candidates.slice(0, 3).map((c) => {
      const s = getComputedStyle(c);
      const canScroll = c.scrollHeight > c.clientHeight + 24;
      const overflowY = s.overflowY;
      const overflow = s.overflow;
      let scrollTopTest = false;
      if (canScroll) {
        const orig = c.scrollTop;
        c.scrollTop = orig + 1;
        scrollTopTest = c.scrollTop !== orig;
        c.scrollTop = orig;
      }
      return `${describeDomNode(c)} scrollH=${Math.round(c.scrollHeight)} clientH=${Math.round(c.clientHeight)} overflowY=${overflowY} overflow=${overflow} 可溢出=${canScroll} scrollTop可写=${scrollTopTest}`;
    }).join(' | ');
    showResumeCaptureStatus(
      `🔍 启动诊断: 会话行=${rows.length} | 滚动容器=${scroller ? describeDomNode(scroller) : '未找到'} | 候选容器(${candidates.length})=${candidateDetails || '无'}`,
      scroller ? 'success' : 'error',
    );
  }

  function bootResumeCaptureStatusPanel() {
    showResumeCaptureStatus('简历自动处理状态面板已启动，正在检查当前会话。', 'info');
    setTimeout(diagnoseScrollContainerAtStartup, 1_500);
    setTimeout(diagnoseScrollContainerAtStartup, 4_000);
    scheduleResumeCardScan(500);
    setTimeout(() => showResumeCaptureStatus('状态面板仍在运行，等待简历卡片或预览动作。', 'info'), 2_000);
    setTimeout(() => scheduleResumeCardScan(0), 5_000);
  }

  function scheduleDutyControlSync(delay = 5_000) {
    clearTimeout(dutyControlTimer);
    dutyControlTimer = setTimeout(async () => {
      dutyControlTimer = null;
      try { await send({ type: 'BRIDGE_SYNC_DUTY_AUTOMATION' }); } catch { /* 后端暂时不可用时保持当前安全状态。 */ }
      scheduleDutyControlSync();
    }, delay);
  }

  function scheduleCollect(delay) {
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => {
      const task = /(?:job|position)/i.test(location.pathname) && !CHAT_URL.test(location.pathname)
        ? collectJobsAndPublish(false)
        : collectAndPublish(false);
      void task;
    }, delay);
  }

  function scheduleAutoReplyCheck(delay) {
    if (!autoReplyArm) return;
    // BOSS 页面会持续产生 DOM 变化。这里必须节流而不能防抖，
    // 否则高频变化会不断重置计时器，导致已武装触发器永远不执行。
    if (autoReplyTimer) return;
    autoReplyTimer = setTimeout(() => {
      autoReplyTimer = null;
      void checkArmedAutoReply();
    }, delay);
  }

  async function armCurrentAutoReplyTest() {
    if (singleAccountAutoReplyEnabled) return { ok: false, error: '持续自动回复已开启，请先关闭后再进行单会话测试。' };
    if (!await waitForCollectionIdle(4_000)) return { ok: false, error: '页面只读快照持续占用，未开启触发测试。' };
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: false, error: selected.reason };
    if (selected.selectedUnread) return { ok: false, error: '当前会话必须先处于已读状态。' };
    const controls = findReplyControls();
    if (!controls.editor || readEditorText(controls.editor).trim()) return { ok: false, error: '当前回复输入框必须为空。' };
    autoReplyArm = { chatDigest: selected.chatDigest, baselineMessageDigest: selected.messageDigest, armedAt: Date.now(), expiresAt: Date.now() + 10 * 60_000, transientFailures: 0 };
    scheduleAutoReplyCheck(1_000);
    return { ok: true, context: { actionType: 'CURRENT_AUTO_REPLY_TEST_ARMED', chatDigest: selected.chatDigest, baselineMessageDigest: selected.messageDigest, expiresAt: new Date(autoReplyArm.expiresAt).toISOString(), oneShot: true } };
  }

  async function cancelCurrentAutoReplyTest(reason) {
    clearTimeout(autoReplyTimer);
    autoReplyTimer = null;
    const previous = autoReplyArm;
    autoReplyArm = null;
    return { ok: true, cancelled: Boolean(previous), reason };
  }

  async function checkArmedAutoReply() {
    if (!autoReplyArm) return;
    if (autoReplyBusy) return scheduleAutoReplyCheck(300);
    if (Date.now() >= autoReplyArm.expiresAt) return void finishAutoReplyTest('EXPIRED', '10 分钟内没有检测到新的候选人来信，触发测试已自动结束。');
    if (collecting) return scheduleAutoReplyCheck(500);
    autoReplyBusy = true;
    try {
      const armed = autoReplyArm;
      const first = await collectSelectedConversation();
      if (!first.ok) {
        armed.transientFailures += 1;
        if (armed.transientFailures <= 5) return scheduleAutoReplyCheck(800);
        return void finishAutoReplyTest('BLOCKED', `连续 5 次无法稳定读取当前会话：${first.reason || first.code || '未知原因'}；未发送。`);
      }
      if (first.chatDigest !== armed.chatDigest) return void finishAutoReplyTest('CANCELLED', '当前选中会话发生变化，触发测试已停止。');
      armed.transientFailures = 0;
      await reportAutoReplyProgress(first.direction, first.messageDigest !== armed.baselineMessageDigest);
      // The HR explicitly arms the currently open read conversation. If its
      // latest stable message is already inbound, handle it immediately; a
      // post-arm message change is no longer required.
      if (first.messageDigest === armed.baselineMessageDigest && first.direction !== 'INBOUND') return scheduleAutoReplyCheck(1_000);
      if (first.direction !== 'INBOUND') return void finishAutoReplyTest('CANCELLED', '检测到的最新变化不是候选人来信，触发测试已停止。');
      await delay(900);
      const second = await collectSelectedConversation();
      if (!second.ok || second.chatDigest !== armed.chatDigest || second.signature !== first.signature || second.direction !== 'INBOUND') {
        if (autoReplyArm) { autoReplyArm.transientFailures += 1; if (autoReplyArm.transientFailures <= 5) return scheduleAutoReplyCheck(800); }
        return void finishAutoReplyTest('BLOCKED', '候选人新消息连续 5 次未能稳定确认；未发送。');
      }
      if (!second.messageText) return void finishAutoReplyTest('BLOCKED', '最后一条候选人消息不是可识别的纯文本，已转人工且未发送。');
      const replyResult = await send({ type: 'BRIDGE_DECIDE_INBOUND_REPLY', payload: {
        chatDigest: second.chatDigest, messageDigest: second.messageDigest,
        messageText: second.messageText, conversationContext: second.conversationContext, messageAt: second.messageAt,
        selectedUnread: second.selectedUnread, conversationSignals: second.conversationSignals,
        observedAt: new Date().toISOString(),
      } });
      if (!replyResult?.ok) return void finishAutoReplyTest('BLOCKED', `岗位相关性识别失败：${replyResult?.error || '后端不可用'}；未发送。`);
      const decision = replyResult.decision;
      if (!decision?.replyAllowed || !decision.content) return void finishAutoReplyTest('BLOCKED', `${decision?.reason || '消息不符合自动回复条件'}；未发送。`);
      const replyText = compact(decision.content).slice(0, 200);
      if (!replyText) return void finishAutoReplyTest('BLOCKED', '后端没有返回可发送的安全短回复；未发送。');
      const controls = findReplyControls();
      if (!controls.editor || readEditorText(controls.editor).trim()) return void finishAutoReplyTest('BLOCKED', '回复输入框不可用或已有内容，未发送。');
      writeEditorText(controls.editor, replyText);
      await delay(300);
      if (readEditorText(controls.editor).trim() !== replyText) return void finishAutoReplyTest('BLOCKED', '安全短回复未稳定写入，未发送。');
      let filledControls = findReplyControls();
      for (let attempt = 0; attempt < 5 && (!filledControls.sendButton || filledControls.sendButtonCount !== 1); attempt++) {
        await delay(200);
        filledControls = findReplyControls();
      }
      if (filledControls.editor !== controls.editor || !filledControls.sendButton || filledControls.sendButtonCount !== 1) {
        writeEditorText(controls.editor, '');
        return void finishAutoReplyTest('BLOCKED', '测试草稿写入后仍未出现唯一可用发送按钮；已清除测试草稿，未发送。');
      }
      const beforeSend = await collectSelectedConversation();
      if (!beforeSend.ok || beforeSend.chatDigest !== armed.chatDigest || beforeSend.messageDigest !== second.messageDigest || beforeSend.direction !== 'INBOUND') {
        writeEditorText(controls.editor, '');
        return void finishAutoReplyTest('BLOCKED', '发送前会话状态发生变化；已清除测试草稿，未发送。');
      }
      autoReplyArm = null;
      clearTimeout(autoReplyTimer);
      filledControls.sendButton.click();
      let confirmed = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await delay(500);
        const current = await collectSelectedConversation();
        if (!current.ok || current.chatDigest !== armed.chatDigest) break;
        const currentControls = findReplyControls();
        const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const last = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1) : null;
        if (currentControls.editor && !readEditorText(currentControls.editor).trim() && directionOf(last) === 'OUTBOUND' && compact(last?.textContent).includes(replyText)) { confirmed = true; break; }
      }
      await finishAutoReplyTest(confirmed ? 'SUCCEEDED' : 'UNKNOWN', confirmed ? `已识别为${decision.category}并自动发送一次岗位事实回复。` : '已点击一次发送，但页面结果无法确认；不会重试。', armed.chatDigest);
    } finally {
      autoReplyBusy = false;
      if (autoReplyArm) scheduleAutoReplyCheck(1_000);
    }
  }

  async function diagnoseCurrentAutoReply() {
    if (!await waitForCollectionIdle(4_000)) return { ok: false, error: '页面只读快照持续占用，暂时无法诊断。' };
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: true, diagnostic: { actionType: 'CURRENT_AUTO_REPLY_DIAGNOSTIC', selectedConversation: false, code: selected.code || 'UNKNOWN', reason: selected.reason || '当前会话不可识别', checkedAt: new Date().toISOString() } };
    const controls = findReplyControls();
    return { ok: true, diagnostic: { actionType: 'CURRENT_AUTO_REPLY_DIAGNOSTIC', selectedConversation: true, chatDigest: selected.chatDigest, direction: selected.direction, selectedUnread: selected.selectedUnread, editorReady: Boolean(controls.editor), editorEmpty: Boolean(controls.editor) && !readEditorText(controls.editor).trim(), sendButtonCount: controls.sendButtonCount || 0, sendButtonReady: Boolean(controls.sendButton) && controls.sendButtonCount === 1, sendButtonCheckedAfterDraft: false, code: 'CHECKED', reason: '空输入框阶段只读诊断完成；发送按钮将在写入测试草稿后再次复核。', checkedAt: new Date().toISOString() } };
  }

  async function finishAutoReplyTest(outcome, reason, chatDigest = autoReplyArm?.chatDigest) {
    clearTimeout(autoReplyTimer);
    autoReplyTimer = null;
    autoReplyArm = null;
    await send({ type: 'BRIDGE_AUTO_REPLY_TEST_RESULT', payload: { actionType: 'CURRENT_AUTO_REPLY_TEST_RESULT', outcome, reason, chatDigest: chatDigest || null, occurredAt: new Date().toISOString(), retryTriggered: false } });
  }

  async function reportAutoReplyProgress(direction, messageChanged) {
    const now = Date.now();
    if (!autoReplyArm || now - Number(autoReplyArm.lastProgressAt || 0) < 1_500) return;
    autoReplyArm.lastProgressAt = now;
    await send({ type: 'BRIDGE_AUTO_REPLY_TEST_PROGRESS', payload: { actionType: 'CURRENT_AUTO_REPLY_TEST_PROGRESS', chatDigest: autoReplyArm.chatDigest, direction, messageChanged: Boolean(messageChanged), checkedAt: new Date(now).toISOString() } });
  }

  async function restoreSingleAccountAutoReply() {
    const result = await send({ type: 'BRIDGE_SYNC_DUTY_AUTOMATION' });
    if (result?.ok && result.enabled) await setSingleAccountAutoReply(true, true);
  }

  async function setSingleAccountAutoReply(enabled, restore = false) {
    if (enabled && autoReplyArm) return { ok: false, error: '请先取消当前单会话一次触发测试。' };
    autoReplyGeneration += 1;
    const wasEnabled = singleAccountAutoReplyEnabled;
    let initialUnreadCount = 0;
    singleAccountAutoReplyEnabled = enabled;
    if (!enabled) {
      clearInterval(autoReplyWakeWatchdogTimer);
      autoReplyWakeWatchdogTimer = null;
      resumePreviewOpenPending = false;
      resumeCaptureRequest = null;
      resumePreviewOpenAttempts = 0;
      resumePreviewCloseFirstFailureAt = 0;
      resumePreviewCloseAttempts = 0;
      clearTimeout(resumeCardScanTimer);
      resumeCardScanTimer = null;
      singleAccountPendingChatDigest = null;
      singleAccountActiveChatDigest = null;
      singleAccountUnreadBaseline = new Map();
      singleAccountSelectedMessageBaseline = new Map();
      singleAccountConversationLocators = new Map();
      conversationScanCursors = new Map();
      singleAccountPendingReplies = new Map();
      singleAccountUnknownReconciliations = new Map();
      resetPipelineQueues();
      singleAccountRetryLocateDeferrals = new Map();
      singleAccountRetryRefreshAt = 0;
      singleAccountConversationQueue = [];
      singleAccountReadReviewInventory = [];
      singleAccountReadReviewNextAt = 0;
      singleAccountBacklogMode = false;
      singleAccountBacklogSeen = new Map();
      singleAccountQueueWindowInitialized = false;
    } else if (!wasEnabled) {
      if (!restore) autoReplyWatchdogRecoveryCount = 0;
      resumePreviewOpenPending = false;
      resumeCaptureRequest = null;
      resumePreviewOpenAttempts = 0;
      resumePreviewCloseFirstFailureAt = 0;
      resumePreviewCloseAttempts = 0;
      singleAccountActiveChatDigest = null;
      conversationScanCursors = new Map();
      const saved = restore ? await send({ type: 'BRIDGE_GET_SINGLE_ACCOUNT_BASELINE' }) : null;
      const currentUnread = await collectUnreadBaseline();
      initialUnreadCount = currentUnread.size;
      traceAutoReply('INITIAL_LIST_SWEEP', {
        outcome: ['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN', 'PARTIAL'].includes(lastConversationSweepCode) ? 'WAITING' : 'SUCCESS',
        reason: lastConversationSweepCode === 'PARTIAL'
          ? `首次扫描已覆盖当前滚动窗口，暂见 ${lastConversationSweepCount} 条未读；列表其余部分将在后续轮次继续扫描。`
          : ['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN'].includes(lastConversationSweepCode)
          ? lastConversationSweepCode === 'PAGE_NOT_READY'
            ? '首次扫描时会话列表尚未挂载可见 DOM，暂不判断为没有未读消息。'
            : `首次扫描仅覆盖可见会话 ${lastConversationSweepCount} 条，未找到列表滚动容器，暂不宣称全量扫描。`
          : `首次稳定扫描完成，发现未读会话 ${lastConversationSweepCount} 条（扫描模式=${lastConversationSweepCode}）。`,
      });
      singleAccountUnreadBaseline = restore && saved?.ok && saved.unread?.length
        ? new Map(saved.unread) : new Map();
      singleAccountSelectedMessageBaseline = saved?.ok && saved.selected?.length
        ? new Map(saved.selected) : new Map();
      singleAccountConversationLocators = saved?.ok && saved.locators?.length
        ? new Map(saved.locators) : new Map();
      // Always bind the visible detail pane to a positively identified row at
      // startup. Only seed a baseline when this conversation has no persisted
      // history, so an existing changed inbound message is still detectable.
      const selected = await collectSelectedConversation();
      if (selected.ok && selected.direction === 'OUTBOUND'
          && !singleAccountSelectedMessageBaseline.has(selected.chatDigest)) {
        singleAccountSelectedMessageBaseline.set(selected.chatDigest, selected.messageDigest);
      }
      const pending = await send({ type: 'BRIDGE_GET_PENDING_INBOUND_REPLIES' });
      const unresolvedSends = await send({ type: 'BRIDGE_GET_PENDING_SEND_RECONCILIATIONS' });
      singleAccountUnknownReconciliations = new Map((unresolvedSends?.tasks || [])
        .map((task) => [task.taskId, { ...task, nextCheckAt: 0 }]));
      singleAccountPendingReplies = new Map((pending?.tasks || []).map((task) => [task.taskId, {
        ...task, nextPollAt: 0,
        readyDiscoveredAt: task.recoveredSend && Number.isFinite(Date.parse(task.updatedAt || ''))
          ? Date.parse(task.updatedAt) : undefined,
      }]));
      resetPipelineQueues();
      for (const task of singleAccountPendingReplies.values()) {
        if (task.recoveredSend === true || task.queueLane === 'SEND') enqueuePipelineTask(task.taskId, 'SEND');
        else if (task.retryable === true || task.queueLane === 'REVALIDATION') enqueuePipelineTask(task.taskId, 'REVALIDATION');
        else enqueuePipelineTask(task.taskId, 'ANALYSIS');
      }
      for (const task of singleAccountPendingReplies.values()) {
        if (task.recoveredSend === true) markReadyTaskDiscovered(task);
      }
      singleAccountRetryRefreshAt = Date.now() + 10_000;
      singleAccountConversationQueue = [];
      singleAccountReadReviewInventory = [];
      singleAccountReadReviewNextAt = 0;
      // A manual enable starts one bounded backlog pass. A background restore
      // resumes only unseen/changed messages to avoid replaying old replies.
      singleAccountBacklogMode = !restore;
      singleAccountBacklogSeen = new Map();
      singleAccountQueueWindowInitialized = false;
      await persistSingleAccountBaseline();
    }
    clearSingleAccountAutoReplyTimer();
    if (enabled) {
      ensureAutoReplyWakeWatchdog();
      scheduleSingleAccountAutoReply(800);
    }
    return { ok: true, enabled, baselineCount: singleAccountUnreadBaseline.size,
      initialUnreadCount: enabled && !restore ? initialUnreadCount : 0 };
  }

  async function persistSingleAccountBaseline() {
    if (!singleAccountAutoReplyEnabled) return;
    const unread = [...singleAccountUnreadBaseline.entries()].slice(-500);
    const selected = [...singleAccountSelectedMessageBaseline.entries()].slice(-500);
    const locators = [...singleAccountConversationLocators.entries()]
      .sort((left, right) => Number(left[1]?.updatedAt || 0) - Number(right[1]?.updatedAt || 0)).slice(-1000);
    singleAccountUnreadBaseline = new Map(unread);
    singleAccountSelectedMessageBaseline = new Map(selected);
    singleAccountConversationLocators = new Map(locators);
    await send({ type: 'BRIDGE_SAVE_SINGLE_ACCOUNT_BASELINE', payload: {
      unread, selected, locators,
    } });
  }

  function pipelineQueueFor(lane) {
    return singleAccountPipelineQueue
      .filter((entry) => entry.lane === lane)
      .map((entry) => entry.taskId);
  }

  function resetPipelineQueues() {
    singleAccountPipelineQueue.length = 0;
  }

  function orderedPipelineTaskIds() {
    return singleAccountPipelineQueue
      .slice()
      .sort((left, right) => (PIPELINE_LANE_PRIORITY[left.lane] ?? 1) - (PIPELINE_LANE_PRIORITY[right.lane] ?? 1))
      .map((entry) => entry.taskId);
  }

  function removePipelineTask(taskId) {
    if (!taskId) return;
    // Remove every occurrence so a lane transition cannot leave a duplicate
    // task behind in the unified queue.
    for (let index = singleAccountPipelineQueue.length - 1; index >= 0; index -= 1) {
      if (singleAccountPipelineQueue[index].taskId === taskId) singleAccountPipelineQueue.splice(index, 1);
    }
  }

  function enqueuePipelineTask(taskId, lane = 'ANALYSIS') {
    if (!taskId) return;
    removePipelineTask(taskId);
    singleAccountPipelineQueue.push({ taskId, lane: PIPELINE_LANE_PRIORITY[lane] == null ? 'ANALYSIS' : lane });
  }

  function removePendingPipelineTask(taskId, chatDigest = null) {
    removePipelineTask(taskId);
    singleAccountPendingReplies.delete(taskId);
    if (chatDigest && singleAccountPendingChatDigest === chatDigest) {
      singleAccountPendingChatDigest = null;
    }
  }

  function pipelineQueueDepths() {
    return {
      scan: singleAccountConversationQueue.length,
      analysis: pipelineQueueFor('ANALYSIS').length,
      send: pipelineQueueFor('SEND').length,
      revalidation: pipelineQueueFor('REVALIDATION').length,
    };
  }

  async function collectUnreadBaseline() {
    const baseline = new Map();
    const items = await collectUnreadItemsAcrossPages(500);
    for (const { item, chatDigest, signature } of items) {
      baseline.set(chatDigest, signature || await unreadRowSignature(item));
    }
    return baseline;
  }

  async function collectUnreadItemsAcrossPages(limit = 500) {
    return collectConversationItemsAcrossPages(limit, 'UNREAD');
  }

  async function collectReadConversationItemsAcrossPages(limit = 500) {
    return collectConversationItemsAcrossPages(limit, 'READ');
  }

  async function collectConversationItemsAcrossPages(limit = 500, mode = 'UNREAD') {
    const found = new Map();
    if (singleAccountAutoReplyEnabled && !resumeAttachmentProcessing && findVisibleResumeDialog()) {
      lastConversationSweepCode = 'PREVIEW_OPEN';
      lastConversationSweepCount = 0;
      traceAutoReply('LIST_SCAN_BLOCKED_PREVIEW', {
        outcome: 'WAITING',
        reason: '简历预览仍处于打开状态，已禁止滚动会话列表；先完成预览关闭确认。',
      });
      return [];
    }
    const add = async (item) => {
      const unread = hasUnread(item);
      if (found.size >= limit || !visible(item)
          || (mode === 'UNREAD' ? !unread : unread)) return false;
      const identity = stableIdentity(item);
      if (!identity) return false;
      const chatDigest = await digest(identity);
      if (found.has(chatDigest)) return false;
      const signature = await unreadRowSignature(item);
      found.set(chatDigest, { item, chatDigest, signature });
      return true;
    };
    const visibleRows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
    lastConversationSweepCode = visibleRows.length ? 'VISIBLE_ONLY' : 'PAGE_NOT_READY';
    for (const item of visibleRows) await add(item);
    // In auto-reply mode always touch the real list scroller once per scan
    // window, even when the first viewport already contains enough rows.
    if (found.size < limit || singleAccountAutoReplyEnabled) {
      const scroller = conversationScrollContainer();
      if (!scroller) {
        lastConversationSweepCode = visibleRows.length ? 'SCROLLER_NOT_FOUND' : 'PAGE_NOT_READY';
        if (singleAccountAutoReplyEnabled) traceAutoReply(visibleRows.length ? 'LIST_SCROLL_CONTAINER_NOT_FOUND' : 'LIST_PAGE_NOT_READY', {
          outcome: 'WAITING',
          reason: visibleRows.length
            ? `当前仅扫描到可见会话 ${found.size} 条，未找到可安全滚动的会话列表容器。`
            : '当前会话列表尚未挂载可见 DOM，暂不判断为没有未读消息。',
        });
      } else {
        lastConversationSweepCode = 'SCANNED';
        const sweep = await scanConversationPages(async (item) => add(item), {
          scanKey: `COLLECT_${mode}`, stopOnMatch: false, keepMatchPosition: true,
        });
        if (!sweep.complete) lastConversationSweepCode = 'PARTIAL';
        if (![...document.querySelectorAll(SELECTORS.conversation)].some(visible)) {
          lastConversationSweepCode = 'PAGE_NOT_READY';
          if (singleAccountAutoReplyEnabled) traceAutoReply('LIST_PAGE_NOT_READY', {
            outcome: 'WAITING',
            reason: '滚动容器存在但扫描后仍未挂载可见会话行，暂不判断为没有未读消息。',
          });
        }
      }
    }
    lastConversationSweepCount = found.size;
    return [...found.values()];
  }

  async function unreadRowSignature(item) {
    const preview = textOf(item, SELECTORS.preview);
    const job = textOf(item, SELECTORS.job);
    const time = textOf(item, SELECTORS.time);
    const unreadNode = findUnreadNode(item);
    const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
    return digest(`${preview}|${job}|${time}|${unreadCount}`);
  }

  function pendingReplyCoversUnreadRow(chatDigest, signature) {
    return [...singleAccountPendingReplies.values()].some((task) => task.retryable !== true
      && task.chatDigest === chatDigest && task.pendingRowSignature === signature);
  }

  function pendingReplyCoversMessage(chatDigest, messageDigest) {
    return [...singleAccountPendingReplies.values()].some((task) => task.retryable !== true
      && task.chatDigest === chatDigest && task.messageDigest === messageDigest);
  }

  async function findChangedCurrentConversation() {
    const selectedItem = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    // Prefer a currently visible selected row because it refreshes the trusted
    // active-chat binding. Fall back to the last verified binding only when the
    // virtualized list has temporarily removed that row from the DOM.
    const current = selectedItem
      ? await collectSelectedConversation()
      : await collectKnownActiveConversation();
    if (!current.ok) return { item: null, snapshot: null };

    const baselineMessageDigest = singleAccountSelectedMessageBaseline.get(current.chatDigest);
    if (!baselineMessageDigest) {
      // An outbound last message proves that HR already answered. An inbound
      // last message does not: BOSS may already have cleared its unread badge
      // merely because the pane was opened. Let it enter the same stable
      // review path as the read/unreplied inventory instead of silently
      // seeding a baseline that would hide it forever.
      if (current.direction === 'OUTBOUND') {
        singleAccountSelectedMessageBaseline.set(current.chatDigest, current.messageDigest);
        await persistSingleAccountBaseline();
        return { item: null, snapshot: current };
      }
      let target = selectedItem;
      if (!target) target = await findConversationByDigest(current.chatDigest);
      if (!target) target = (await findConversationByDigestDeep(current.chatDigest)).item;
      return { item: target || null, snapshot: current, readReview: true };
    }
    if (baselineMessageDigest === current.messageDigest) return { item: null, snapshot: current };
    if (current.direction !== 'INBOUND') {
      // HR or the automation has already replied. Advance the pane baseline so
      // that this outbound row is not reconsidered on every scan.
      singleAccountSelectedMessageBaseline.set(current.chatDigest, current.messageDigest);
      await persistSingleAccountBaseline();
      return { item: null, snapshot: current };
    }
    if (pendingReplyCoversMessage(current.chatDigest, current.messageDigest)) {
      return { item: null, snapshot: current };
    }

    let target = selectedItem;
    if (!target) target = await findConversationByDigest(current.chatDigest);
    if (!target) target = (await findConversationByDigestDeep(current.chatDigest)).item;
    return { item: target || null, snapshot: current };
  }

  function sameConversationMessage(left, right) {
    if (!left?.ok || !right?.ok) return false;
    return [left.chatDigest, left.messageDigest, left.direction, left.messageAt, left.messageText || ''].join('|')
      === [right.chatDigest, right.messageDigest, right.direction, right.messageAt, right.messageText || ''].join('|');
  }

  function latestVisibleConversationMessage() {
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    return active
      ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
      : null;
  }

  function looksLikeResumeAttachmentMessage(snapshot) {
    const last = latestVisibleConversationMessage();
    return Boolean(last?.querySelector('.message-card-wrap, .hyperLink, video, audio, [class*="attachment"], [class*="resume"]'))
      || /(?:简历|附件)/.test(compact(snapshot?.messageText || ''));
  }

  async function collectStableResumeReceiptSnapshot(expectedChatDigest) {
    for (const wait of [250, 500, 900, 1_400]) {
      await delay(wait);
      // 预览关闭会触发 BOSS 重绘简历卡片。先把重绘后的摘要同步给
      // 后端，再以两次一致快照作为收件回执的新目标。
      await collectAndPublish(true, true);
      const first = await collectExpectedActiveConversation(expectedChatDigest);
      await delay(300);
      const second = await collectExpectedActiveConversation(expectedChatDigest);
      if (first.ok && second.ok && first.chatDigest === expectedChatDigest
          && sameConversationMessage(first, second) && second.direction === 'INBOUND'
          && second.conversationSignals?.resumeReceived === true
          && looksLikeResumeAttachmentMessage(second)) return second;
    }
    return null;
  }

  async function findNewOrChangedUnreadConversation() {
    const items = [...document.querySelectorAll(SELECTORS.conversation)]
      .filter((item) => visible(item) && hasUnread(item));
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return { error: '未读会话没有稳定 DOM 身份，禁止猜测目标。' };
      const chatDigest = await digest(identity);
      const signature = await unreadRowSignature(item);
      if (pendingReplyCoversUnreadRow(chatDigest, signature)) continue;
      if (!singleAccountUnreadBaseline.has(chatDigest) || singleAccountUnreadBaseline.get(chatDigest) !== signature) {
        return { item, chatDigest };
      }
    }
    return { item: null, chatDigest: null };
  }

  async function refillSingleAccountConversationQueue() {
    if (singleAccountConversationQueue.length >= SINGLE_ACCOUNT_PREFETCH_LIMIT) {
      return { observedUnread: null, added: 0, queueLength: singleAccountConversationQueue.length, skipped: 'PREFETCH_WINDOW_FULL', scanCode: lastConversationSweepCode };
    }
    const queued = new Set(singleAccountConversationQueue.map((item) => item.chatDigest));
    const items = await collectUnreadItemsAcrossPages(SINGLE_ACCOUNT_PREFETCH_LIMIT * 2);
    let added = 0;
    for (const { item, chatDigest, signature: observedSignature } of items) {
      if (singleAccountConversationQueue.length >= SINGLE_ACCOUNT_PREFETCH_LIMIT) break;
      if (queued.has(chatDigest)) continue;
      const signature = observedSignature || await unreadRowSignature(item);
      if (pendingReplyCoversUnreadRow(chatDigest, signature)) continue;
      const known = singleAccountUnreadBaseline.get(chatDigest);
      if (singleAccountBacklogMode) {
        if (singleAccountBacklogSeen.get(chatDigest) === signature) continue;
        singleAccountBacklogSeen.set(chatDigest, signature);
      } else if (known && known === signature) continue;
      singleAccountConversationQueue.push({ chatDigest, signature });
      queued.add(chatDigest);
      added += 1;
      traceAutoReply('QUEUE_ENQUEUED', { chatDigest, queueLane: 'SCAN', queuePosition: singleAccountConversationQueue.length, outcome: 'INFO', reason: '新会话已加入扫描预取队列。' });
    }
    const unreadScanCode = lastConversationSweepCode;
    const readReview = lastConversationSweepCode !== 'PARTIAL'
      && singleAccountConversationQueue.length === 0 && added === 0
      ? await refillReadReplyReviewQueue()
      : { observedRead: null, added: 0, skipped: 'UNREAD_PRIORITY' };
    return {
      observedUnread: items.length,
      observedRead: readReview.observedRead,
      added: added + readReview.added,
      readReviewAdded: readReview.added,
      queueLength: singleAccountConversationQueue.length,
      scanCode: readReview.scanCode || unreadScanCode,
      readReviewSkipped: readReview.skipped || null,
    };
  }

  async function refillReadReplyReviewQueue() {
    const now = Date.now();
    if (singleAccountReadReviewInventory.length === 0) {
      if (now < singleAccountReadReviewNextAt) {
        return { observedRead: null, added: 0, skipped: 'COOLDOWN', scanCode: lastConversationSweepCode };
      }
      const rows = await collectReadConversationItemsAcrossPages(500);
      singleAccountReadReviewInventory = rows
        .filter(({ chatDigest, signature }) => singleAccountUnreadBaseline.get(chatDigest) !== signature)
        .filter(({ chatDigest }) => ![...singleAccountPendingReplies.values()]
          .some((task) => task.chatDigest === chatDigest))
        .map(({ chatDigest, signature }) => ({ chatDigest, signature, readReview: true }));
      singleAccountReadReviewNextAt = now + (lastConversationSweepCode === 'PARTIAL'
        ? LIST_SCAN_CONTINUE_DELAY_MS : READ_REPLY_REVIEW_INTERVAL_MS);
      traceAutoReply('READ_UNREPLIED_REVIEW_DISCOVERED', {
        outcome: 'INFO',
        reason: `已滚动检查 ${rows.length} 条已读会话，其中 ${singleAccountReadReviewInventory.length} 条列表摘要未处理或已变化；将按每批 ${SINGLE_ACCOUNT_PREFETCH_LIMIT} 条逐个打开，以最后一条消息方向为准。`,
      });
      if (!rows.length && ['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN'].includes(lastConversationSweepCode)) {
        return { observedRead: 0, added: 0, skipped: lastConversationSweepCode, scanCode: lastConversationSweepCode };
      }
    }
    const queued = new Set(singleAccountConversationQueue.map((item) => item.chatDigest));
    let added = 0;
    while (singleAccountConversationQueue.length < SINGLE_ACCOUNT_PREFETCH_LIMIT
        && singleAccountReadReviewInventory.length > 0) {
      const candidate = singleAccountReadReviewInventory.shift();
      if (!candidate || queued.has(candidate.chatDigest)) continue;
      singleAccountConversationQueue.push(candidate);
      queued.add(candidate.chatDigest);
      added += 1;
      traceAutoReply('READ_UNREPLIED_REVIEW_ENQUEUED', {
        chatDigest: candidate.chatDigest, queuePosition: singleAccountConversationQueue.length,
        outcome: 'INFO', reason: '已读会话已加入安全复核窗口；只有稳定确认最后一条来自候选人才会进入 AI。',
      });
    }
    return { observedRead: added + singleAccountReadReviewInventory.length, added, scanCode: lastConversationSweepCode };
  }

  async function findConversationByDigest(chatDigest) {
    const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
    const scroller = conversationScrollContainer();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const item = rows[rowIndex];
      const identity = stableIdentity(item);
      if (identity && await digest(identity) === chatDigest) {
        await rememberConversationLocator(item, scroller, rowIndex);
        return item;
      }
    }
    return null;
  }

  async function rememberConversationLocator(item, scroller, rowIndex) {
    const identity = stableIdentity(item);
    if (!identity) return;
    const chatDigest = await digest(identity);
    const maxTop = scroller instanceof HTMLElement ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
    const ratio = maxTop > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / maxTop)) : 0;
    singleAccountConversationLocators.delete(chatDigest);
    singleAccountConversationLocators.set(chatDigest, { ratio, rowIndex: Math.max(0, rowIndex), updatedAt: Date.now() });
    while (singleAccountConversationLocators.size > 1000) singleAccountConversationLocators.delete(singleAccountConversationLocators.keys().next().value);
  }

  async function findConversationAtLocatorHint(chatDigest) {
    const hint = singleAccountConversationLocators.get(chatDigest);
    const scroller = hint ? conversationScrollContainer() : null;
    if (!hint || !scroller) return null;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.round(maxTop * hint.ratio);
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await delay(180);
    const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
    const preferred = rows[hint.rowIndex];
    const ordered = preferred ? [preferred, ...rows.filter((row) => row !== preferred)] : rows;
    for (const row of ordered) {
      const identity = stableIdentity(row);
      if (identity && await digest(identity) === chatDigest) {
        await rememberConversationLocator(row, scroller, rows.indexOf(row));
        traceAutoReply('CONVERSATION_LOCATOR_HIT', { chatDigest, outcome: 'SUCCESS', reason: '已通过持久化会话定位标识直接跳转，并完成稳定 ID 复核。' });
        return row;
      }
    }
    return null;
  }

  function conversationScrollContainer() {
    const row = [...document.querySelectorAll(SELECTORS.conversation)].find((item) => visible(item));
    let node = row?.parentElement || null;
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (isUsableConversationScroller(node)) {
        reportConversationScrollDom(node, /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)
          ? 'ancestor' : 'ancestor-scrolltop');
        return node;
      }
    }
    const candidates = [...document.querySelectorAll(
      '.geek-list, .geek-list-wrap, .user-list, .conversation-list, .chat-list, [class*="geek-list"], [class*="user-list"], [class*="conversation-list"], [class*="chat-list"]',
    )].filter((candidate) => candidate instanceof HTMLElement && visible(candidate));
    const found = candidates.find((candidate) => isUsableConversationScroller(candidate)) || null;
    reportConversationScrollDom(found, found ? 'list-fallback' : 'not-found');
    return found;
  }

  function isUsableConversationScroller(node) {
    if (!(node instanceof HTMLElement) || !visible(node)
        || node.scrollHeight <= node.clientHeight + 24 || node.clientHeight < 120) return false;
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) return true;
    // BOSS 有时用 overflow:hidden 渲染虚拟列表，并在容器上自行处理滚轮。
    // 与 CSS 字面值相比，scrollTop 是否可写更能说明该节点能否安全扫描。
    const original = node.scrollTop;
    const maxTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const probe = original < maxTop ? Math.min(maxTop, original + 1) : Math.max(0, original - 1);
    if (probe === original) return maxTop > 0;
    node.scrollTop = probe;
    const writable = node.scrollTop !== original;
    node.scrollTop = original;
    return writable;
  }

  function activateConversationListForAutomation(scroller, reason) {
    if (!(scroller instanceof HTMLElement)) return;
    const now = Date.now();
    if (now - lastMouseInConversationListAt < LIST_POINTER_IDLE_FOCUS_MS
        || now - lastConversationListActivationAt < LIST_POINTER_IDLE_FOCUS_MS) return;
    lastConversationListActivationAt = now;
    const active = document.activeElement;
    const userEditing = active instanceof HTMLElement
      && (active.matches('input, textarea, [contenteditable="true"]') || active.isContentEditable)
      && compact(active.textContent || active.value || '').length > 0;
    if (!userEditing) {
      if (!scroller.hasAttribute('tabindex')) scroller.setAttribute('tabindex', '-1');
      try { scroller.focus({ preventScroll: true }); } catch { /* 直接 DOM 滚动仍可继续 */ }
    }
    const rect = scroller.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.min(rect.width / 2, 120));
    const clientY = Math.round(rect.top + Math.min(rect.height / 2, 160));
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
      scroller.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
    }
    traceAutoReply('LIST_SCROLL_FOCUSED', {
      outcome: 'INFO',
      reason: `${reason}；已激活会话列表滚动焦点，后续使用 DOM 直接滚动，不依赖物理鼠标位置。`,
    });
  }

  function describeDomNode(node) {
    if (!(node instanceof Element)) return '未找到';
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${String(node.id).replace(/[^\w-]/g, '')}` : '';
    const classes = [...node.classList].filter(Boolean).slice(0, 8).map((name) => `.${String(name).replace(/[^\w-]/g, '')}`).join('');
    const role = node.getAttribute('role');
    const aria = node.getAttribute('aria-label');
    const title = node.getAttribute('title');
    const attrs = [role ? ` role="${role}"` : '', aria ? ` aria-label="${aria}"` : '', title ? ` title="${title}"` : ''].join('');
    return `<${tag}${id}${classes}${attrs}>`;
  }

  function reportConversationScrollDom(node, source) {
    if (!singleAccountAutoReplyEnabled) return;
    const style = node instanceof Element ? getComputedStyle(node) : null;
    const metrics = node instanceof HTMLElement
      ? `scrollTop=${Math.round(node.scrollTop)}, clientHeight=${Math.round(node.clientHeight)}, scrollHeight=${Math.round(node.scrollHeight)}, overflowY=${style?.overflowY || 'unknown'}`
      : '未获取滚动尺寸';
    const reason = node
      ? `会话滚动容器 DOM=${describeDomNode(node)}；${metrics}；来源=${source}`
      : '未找到会话滚动容器 DOM；已跳过全量滚动，当前只使用可见会话。';
    const key = `${source}|${describeDomNode(node)}|${metrics}`;
    const now = Date.now();
    if (key === lastConversationDomProbeKey && now - lastConversationDomProbeAt < 10_000) return;
    lastConversationDomProbeKey = key;
    lastConversationDomProbeAt = now;
    traceAutoReply('LIST_SCROLL_DOM', {
      outcome: node ? 'INFO' : 'WAITING',
      reason,
    });
  }

  async function scanConversationPages(matcher, options = {}) {
    const scroller = conversationScrollContainer();
    if (!scroller) return { match: null, complete: false };
    activateConversationListForAutomation(scroller, '鼠标超过 10 秒未停留在会话列表');
    const originalTop = scroller.scrollTop;
    const step = Math.max(120, Math.floor(scroller.clientHeight * .75));
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const positions = [];
    const nominalPageCount = Math.max(1, Math.ceil(maxTop / step));
    const pageCount = Math.min(80, nominalPageCount);
    for (let index = 0; index <= pageCount; index++) positions.push(Math.round(maxTop * index / pageCount));
    const uniquePositions = [...new Set(positions)];
    const scanKey = options.scanKey || 'DEFAULT';
    const cursor = conversationScanCursors.get(scanKey);
    // BOSS may increase scrollHeight as it virtualizes rows. Continue at the
    // same approximate fraction instead of restarting at the top indefinitely.
    const startIndex = cursor?.scroller === scroller
      ? Math.min(uniquePositions.length - 1, Math.floor(cursor.fraction * uniquePositions.length)) : 0;
    const startedAt = Date.now();
    let firstMatch = null;
    let firstMatchTop = originalTop;
    let nextIndex = startIndex;
    let complete = false;
    try {
      for (; nextIndex < uniquePositions.length; nextIndex++) {
        if (nextIndex > startIndex && (nextIndex - startIndex >= LIST_SCAN_MAX_POSITIONS_PER_TURN
            || Date.now() - startedAt >= LIST_SCAN_MAX_TURN_MS)) break;
        const top = uniquePositions[nextIndex];
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await delay(120);
        const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          await rememberConversationLocator(row, scroller, rowIndex);
          const match = await matcher(row);
          if (match && !firstMatch) {
            firstMatch = match;
            firstMatchTop = top;
          }
          if (match && options.stopOnMatch !== false) {
            conversationScanCursors.delete(scanKey);
            scroller.scrollTop = top;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            return { match, complete: true };
          }
        }
      }
      complete = nextIndex >= uniquePositions.length;
      if (complete) conversationScanCursors.delete(scanKey);
      else conversationScanCursors.set(scanKey, {
        scroller, fraction: nextIndex / uniquePositions.length,
      });
      if (firstMatch && options.keepMatchPosition) {
        scroller.scrollTop = firstMatchTop;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      if (!complete && singleAccountAutoReplyEnabled) traceAutoReply('LIST_SCAN_PARTIAL', {
        outcome: 'WAITING',
        reason: `本轮只读扫描 ${nextIndex - startIndex} 个滚动位置；已让出页面执行权，下一轮从 ${Math.round(nextIndex / uniquePositions.length * 100)}% 继续，并优先检查待发送任务。`,
      });
      return { match: firstMatch, complete };
    } finally {
      if (!firstMatch || options.restorePosition === true) {
        scroller.scrollTop = originalTop;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      if (singleAccountAutoReplyEnabled) await persistSingleAccountBaseline();
    }
  }

  async function findConversationByDigestDeep(chatDigest) {
    const hinted = await findConversationAtLocatorHint(chatDigest);
    if (hinted) return { item: hinted, complete: true };
    const result = await scanConversationPages(async (item) => {
      const identity = stableIdentity(item);
      return identity && await digest(identity) === chatDigest ? item : null;
    }, { scanKey: `TARGET_${chatDigest}` });
    return { item: result.match, complete: result.complete };
  }

  async function locateConversation(chatDigest) {
    if (!/^[a-f0-9]{64}$/.test(chatDigest || '')) return blocked('INVALID_TARGET', '定位目标无效。');
    let target = await findConversationByDigest(chatDigest);
    let deepLookup = null;
    if (!target) {
      deepLookup = await findConversationByDigestDeep(chatDigest);
      target = deepLookup.item;
    }
    if (!target) return blocked(deepLookup?.complete === false ? 'CONVERSATION_SCAN_IN_PROGRESS' : 'CONVERSATION_NOT_VISIBLE',
      deepLookup?.complete === false ? '正在分段扫描会话列表，请稍后重试定位。' : '当前会话列表中未找到目标，可能已不在已加载范围。');
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.click();
    await delay(260);
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    const identity = selected && stableIdentity(selected);
    if (!identity || await digest(identity) !== chatDigest) return blocked('TARGET_NOT_SELECTED', '目标会话点击后未能确认选中状态。');
    return { ok: true, reason: '已准确定位并打开 BOSS 会话。' };
  }

  async function findNewOrChangedUnreadConversationDeep() {
    const result = await scanConversationPages(async (item) => {
      if (!hasUnread(item)) return null;
      const identity = stableIdentity(item);
      if (!identity) return null;
      const chatDigest = await digest(identity);
      const signature = await unreadRowSignature(item);
      if (pendingReplyCoversUnreadRow(chatDigest, signature)) return null;
      return !singleAccountUnreadBaseline.has(chatDigest) || singleAccountUnreadBaseline.get(chatDigest) !== signature
        ? { item, chatDigest } : null;
    }, { scanKey: 'CHANGED_UNREAD' });
    return { ...(result.match || { item: null, chatDigest: null }), scanComplete: result.complete };
  }

  function readyTaskAgeMs(task, now = Date.now()) {
    const backendReadyAt = Date.parse(task?.updatedAt || '');
    const firstSeenAt = Number(task?.readyDiscoveredAt || 0);
    const startedAt = Number.isFinite(backendReadyAt) ? backendReadyAt : firstSeenAt || now;
    return Math.max(0, now - startedAt);
  }

  function markReadyTaskDiscovered(task) {
    if (!task) return;
    task.readyDiscoveredAt = Number(task.readyDiscoveredAt || Date.now());
    if (task.readyDiscoveryLogged) return;
    task.readyDiscoveryLogged = true;
    traceAutoReply(task.recoveredSend ? 'READY_TASK_RECOVERED' : 'READY_TASK_DISCOVERED', {
      chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'SEND',
      outcome: 'SUCCESS', reason: task.recoveredSend
        ? `已从后端恢复待发送结果，当前等待 ${Math.ceil(readyTaskAgeMs(task) / 1_000)} 秒；提升为页面最高优先级。`
        : 'AI 已生成可发送结果，提升为页面最高优先级。',
    });
  }

  function rememberPendingReply(result, snapshot, pendingRowSignature, now = Date.now()) {
    const existing = singleAccountPendingReplies.get(result.taskId);
    if (existing) return existing; // Preserve poll deadline, retry backoff and SEND lane.
    const task = {
      taskId: result.taskId, chatDigest: snapshot.chatDigest, messageDigest: snapshot.messageDigest,
      resumeReceipt: result.resumeReceipt === true,
      pendingRowSignature: result.pendingRowSignature || pendingRowSignature,
      nextPollAt: result.recovered ? 0 : now + 500, holdStartedAt: now,
    };
    singleAccountPendingReplies.set(result.taskId, task);
    enqueuePipelineTask(result.taskId, 'ANALYSIS');
    return task;
  }

  async function nextReadyInboundReply(preferredTaskId = null, { includeRetryable = true } = {}) {
    const now = Date.now();
    const preferredTask = preferredTaskId ? singleAccountPendingReplies.get(preferredTaskId) : null;
    // Backend tasks can reach a terminal state between polls. Remove their
    // lane ids before building the next polling batch so stale ids do not keep
    // the scheduler waking up and re-scanning the same work forever.
    const liveTaskIds = new Set(singleAccountPendingReplies.keys());
    for (let index = singleAccountPipelineQueue.length - 1; index >= 0; index -= 1) {
      if (!liveTaskIds.has(singleAccountPipelineQueue[index].taskId)) singleAccountPipelineQueue.splice(index, 1);
    }
    const orderedTaskIds = preferredTask
      ? [preferredTaskId]
      : [...orderedPipelineTaskIds(),
        ...singleAccountPendingReplies.keys()];
    const seenTaskIds = new Set();
    const entries = orderedTaskIds
      .filter((taskId) => taskId && !seenTaskIds.has(taskId) && seenTaskIds.add(taskId))
      .map((taskId) => [taskId, singleAccountPendingReplies.get(taskId)])
      .filter((entry) => entry[1]);
    for (const [taskId, task] of entries) {
      if (!includeRetryable && task.retryable === true) continue;
      if (Number(task.nextPollAt || 0) > now) continue;
      task.nextPollAt = now + 1_000;
      try {
        const result = await send({ type: 'BRIDGE_POLL_INBOUND_REPLY', payload: task });
        if (!result?.ok) {
          traceAutoReply('AI_POLL_ERROR', { chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'ANALYSIS', outcome: 'FAILED', reason: result?.error || 'AI 任务查询失败，稍后重试。' });
          task.nextPollAt = now + 5_000;
          continue;
        }
        if (result.status === 'RETRY_WAIT') {
          enqueuePipelineTask(task.taskId, 'ANALYSIS');
          const nextAttemptAt = Date.parse(result.nextAttemptAt || '');
          const waitMs = Number.isFinite(nextAttemptAt) ? Math.max(1_000, nextAttemptAt - Date.now()) : 5_000;
          traceAutoReply('AI_RETRY_SCHEDULED', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
            queueLane: 'ANALYSIS',
            attempt: Number.isInteger(result.attemptCount) ? result.attemptCount : null,
            outcome: 'WAITING',
            reason: `${result.resultReason || result.lastErrorCode || 'AI 输出暂不可用'}；将在 ${Math.ceil(waitMs / 1_000)} 秒后重试。`,
          });
          task.nextPollAt = Date.now() + Math.min(waitMs, 5_000);
          continue;
        }
        if (result.status === 'COMPLETED' && ['SUCCEEDED', 'UNKNOWN'].includes(result.sendStatus)) {
          removePipelineTask(task.taskId);
          const sent = result.sendStatus === 'SUCCEEDED';
          traceAutoReply(sent ? 'AI_TASK_ALREADY_SENT' : 'AI_TASK_SEND_TERMINAL', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'TERMINAL',
            outcome: sent ? 'SUCCESS' : 'UNKNOWN',
            reason: result.sendResultReason || (sent
              ? '后端已确认该任务发送成功，已清理插件残留等待记录。'
              : '该任务发送结果已冻结，禁止自动重发。'),
          });
          return { terminalTask: task, terminalOutcome: sent ? 'SENT' : 'UNKNOWN',
            terminalReason: result.sendResultReason || (sent ? '后端已确认发送成功。' : '发送结果已冻结。'),
            terminalSkipUnreadBaseline: true, terminalSkipSelectedMessageBaseline: true };
        }
        if (result.status === 'COMPLETED' && result.sendStatus === 'CLAIMED') {
          enqueuePipelineTask(task.taskId, 'SEND');
          traceAutoReply('AI_SEND_RECEIPT_WAITING', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
            queueLane: 'SEND',
            outcome: 'WAITING', reason: '发送租约已被领取，等待页面回执或租约超时。',
          });
          task.nextPollAt = now + 2_000;
          continue;
        }
        if (task.retryable === true && ['COMPLETED', 'FAILED'].includes(result.status)
            && ['FAILED', 'SKIPPED'].includes(result.sendStatus)) {
          enqueuePipelineTask(task.taskId, 'REVALIDATION');
          traceAutoReply('AI_RETRY_READY', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
            queueLane: 'REVALIDATION',
            attempt: Number.isInteger(result.attemptCount) ? result.attemptCount : null,
            outcome: 'WAITING',
            reason: '库存任务处于不可直接发送终态，等待重新读取当前会话后执行一次安全复核。',
          });
          return { retryTask: task, failure: result };
        }
        if (result.status === 'COMPLETED' && ['FAILED', 'SKIPPED'].includes(result.sendStatus)
            && task.retryable !== true && result.decision?.replyAllowed) {
          removePipelineTask(task.taskId);
          traceAutoReply('AI_TASK_SEND_TERMINAL', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'TERMINAL',
            outcome: result.sendStatus === 'FAILED' ? 'FAILED' : 'SKIPPED',
            reason: result.sendResultReason || '该 AI 回复已终止发送，已清理插件残留等待记录。',
          });
          return { terminalTask: task,
            terminalOutcome: result.sendStatus === 'FAILED' ? 'UNKNOWN' : 'SILENT',
            terminalReason: result.sendResultReason || '该 AI 回复已终止发送。',
            terminalSkipUnreadBaseline: true, terminalSkipSelectedMessageBaseline: true };
        }
        if (result.status === 'CANCELLED' || result.status === 'FAILED'
            || (result.status === 'COMPLETED' && !result.decision?.replyAllowed)) {
          const terminalReason = result.reason || result.decision?.reason || result.resultReason
            || (result.status === 'CANCELLED' ? 'AI 任务已取消或过期。' : 'AI 判定无需回复。');
          const failed = result.status === 'FAILED';
          if (task.retryable === true) {
            enqueuePipelineTask(task.taskId, 'REVALIDATION');
            traceAutoReply('AI_RETRY_READY', { chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'REVALIDATION', attempt: Number.isInteger(result.attemptCount) ? result.attemptCount : null, outcome: 'WAITING', reason: `未回复任务已达到二次复核条件，等待重新定位会话并采集最新正文：${terminalReason}` });
            return { retryTask: task, failure: result };
          }
          traceAutoReply(failed ? 'AI_FINAL_FAILED' : 'SAFETY_SILENT', { chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'TERMINAL', attempt: Number.isInteger(result.attemptCount) ? result.attemptCount : null, outcome: failed ? 'FAILED' : 'SKIPPED', reason: terminalReason });
          removePipelineTask(task.taskId);
          const retryableSilent = !failed && result.retryEligible === true;
          if (retryableSilent) traceAutoReply('AI_RETRY_PENDING', {
            chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
            queueLane: 'REVALIDATION',
            attempt: Number.isInteger(result.attemptCount) ? result.attemptCount : null,
            outcome: 'WAITING', reason: '旧版终态任务属于 AI 输出质量问题，保留未读基线等待重新分析。',
          });
          return { terminalTask: task, terminalOutcome: failed ? 'UNKNOWN' : 'SILENT',
            terminalReason, terminalSkipUnreadBaseline: retryableSilent };
        }
        if (result.status === 'COMPLETED' && result.decision?.replyAllowed && result.decision?.content) {
          enqueuePipelineTask(task.taskId, 'SEND');
          markReadyTaskDiscovered(task);
          return { task, decision: result.decision };
        }
        enqueuePipelineTask(task.taskId, 'ANALYSIS');
        traceAutoReply('AI_POLL_WAITING', { chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'ANALYSIS', outcome: 'WAITING', reason: `AI 任务状态=${result.status || 'QUEUED'}。` });
      } catch (_error) {
        traceAutoReply('AI_POLL_ERROR', { chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId, queueLane: 'ANALYSIS', outcome: 'FAILED', reason: 'AI 任务查询异常，稍后重试。' });
        task.nextPollAt = now + 5_000;
      }
    }
    return null;
  }

  async function refreshDeferredReplyRevalidations() {
    // 每十秒读取一次后端的安全候选清单。后端会先确认当前账号没有
    // 正常排队、模型处理中或等待退避的新任务，才返回库存复核候选项。
    // 真正重入队前仍会重新定位、重读正文并校验摘要。
    if (Date.now() < singleAccountRetryRefreshAt) return;
    singleAccountRetryRefreshAt = Date.now() + 10_000;
    const pending = await send({ type: 'BRIDGE_GET_PENDING_INBOUND_REPLIES' });
    if (!pending?.ok) {
      traceAutoReply('DEFERRED_REVALIDATION_FETCH_FAILED', {
        outcome: 'WAITING', reason: pending?.error || '库存安全复核清单暂时读取失败，10 秒后重试。',
      });
      return;
    }
    if (pending.retryableError) {
      traceAutoReply('DEFERRED_REVALIDATION_FETCH_FAILED', {
        outcome: 'WAITING', reason: `库存安全复核清单读取失败：${pending.retryableError}；10 秒后重试。`,
      });
    }
    let added = 0;
    for (const task of Array.isArray(pending?.tasks) ? pending.tasks : []) {
      const activeReady = (task?.recoveredSend === true || task?.queueLane === 'SEND') && task?.retryable !== true;
      const deferredUntil = Number(singleAccountRetryLocateDeferrals.get(task?.taskId) || 0);
      if (deferredUntil && deferredUntil <= Date.now()) singleAccountRetryLocateDeferrals.delete(task.taskId);
      if (!task?.taskId || deferredUntil > Date.now()
          || singleAccountPendingReplies.has(task.taskId)) continue;
      if (activeReady) singleAccountRetryLocateDeferrals.delete(task.taskId);
      const restored = { ...task, nextPollAt: 0,
        readyDiscoveredAt: Number.isFinite(Date.parse(task.updatedAt || ''))
          ? Date.parse(task.updatedAt) : Date.now() };
      singleAccountPendingReplies.set(task.taskId, restored);
      enqueuePipelineTask(task.taskId, activeReady ? 'SEND' : 'REVALIDATION');
      if (activeReady) markReadyTaskDiscovered(restored);
      added += 1;
    }
    if (added) traceAutoReply('DEFERRED_REVALIDATION_READY', {
      outcome: 'WAITING', reason: `发现 ${added} 条长时间无新消息且此前未回复的库存会话，开始逐条重新读取正文并安全二次复核。`,
    });
  }

  function traceLifecycle(outcome) {
    if (['WAITING', 'BLOCKED'].includes(outcome)) return 'WAITING';
    if (['SENT', 'SKIPPED', 'UNKNOWN', 'STOPPED'].includes(outcome)) return 'DONE';
    return 'PROCESSING';
  }

  function traceAutoReply(stage, fields = {}) {
    const now = Date.now();
    if (!['LOOP_BUSY', 'AUTO_REPLY_WATCHDOG_WAKE', 'AUTO_REPLY_WATCHDOG_COOLDOWN'].includes(stage)) {
      autoReplyWatchdogLastProgressAt = now;
    }
    const reason = compact(fields.reason || '').slice(0, 220);
    const key = [stage, fields.chatDigest || '', fields.messageDigest || '', reason].join('|');
    if (key === lastAutoReplyTraceKey && now - lastAutoReplyTraceAt < 2_000) return;
    lastAutoReplyTraceKey = key;
    lastAutoReplyTraceAt = now;
    const payload = {
      stage,
      outcome: String(fields.outcome || 'INFO').slice(0, 24),
      lifecycle: traceLifecycle(String(fields.outcome || 'INFO').slice(0, 24)),
      runId: autoReplyTraceRunId || null,
      chatDigest: fields.chatDigest || null,
      messageDigest: fields.messageDigest || null,
      taskId: fields.taskId || null,
      queueLane: ['SCAN', 'ANALYSIS', 'SEND', 'REVALIDATION', 'TERMINAL'].includes(fields.queueLane) ? fields.queueLane : null,
      queuePosition: Number.isInteger(fields.queuePosition) ? fields.queuePosition : null,
      attempt: Number.isInteger(fields.attempt) ? fields.attempt : null,
      elapsedMs: Number.isFinite(fields.elapsedMs) ? fields.elapsedMs : autoReplyTraceRunStartedAt ? now - autoReplyTraceRunStartedAt : null,
      reason,
      occurredAt: new Date(now).toISOString(),
    };
    const details = [
      payload.lifecycle,
      payload.outcome !== 'INFO' ? payload.outcome : '',
      payload.queuePosition != null ? `队列#${payload.queuePosition}` : '',
      payload.attempt != null ? `第${payload.attempt}次` : '',
      payload.taskId ? `任务=${payload.taskId.slice(0, 8)}` : '',
      payload.queueLane ? `队列=${payload.queueLane}` : '',
      payload.elapsedMs != null ? `${Math.round(payload.elapsedMs)}ms` : '',
      reason,
    ].filter(Boolean).join(' · ');
    const tone = ['FAILED', 'BLOCKED', 'STOPPED', 'UNKNOWN'].includes(payload.outcome) ? 'error'
      : ['SUCCESS', 'SENT', 'CONFIRMED'].includes(payload.outcome) ? 'success' : 'info';
    showResumeCaptureStatus(`自动回复 ${stage}${details ? `：${details}` : ''}`, tone);
    void send({ type: 'BRIDGE_AUTO_REPLY_TRACE', payload }).catch(() => {});
  }

  function scheduleSingleAccountAutoReply(delay) {
    if (!singleAccountAutoReplyEnabled) return;
    const dueAt = Date.now() + Math.max(0, Number(delay) || 0);
    if (singleAccountAutoReplyTimer && singleAccountAutoReplyDueAt <= dueAt) return;
    if (singleAccountAutoReplyTimer) clearTimeout(singleAccountAutoReplyTimer);
    singleAccountAutoReplyDueAt = dueAt;
    singleAccountAutoReplyTimer = setTimeout(() => {
      singleAccountAutoReplyTimer = null;
      singleAccountAutoReplyDueAt = 0;
      void processNextUnreadConversation();
    }, Math.max(0, dueAt - Date.now()));
  }

  function clearSingleAccountAutoReplyTimer() {
    if (singleAccountAutoReplyTimer) clearTimeout(singleAccountAutoReplyTimer);
    singleAccountAutoReplyTimer = null;
    singleAccountAutoReplyDueAt = 0;
  }

  function ensureAutoReplyWakeWatchdog() {
    if (autoReplyWakeWatchdogTimer) return;
    autoReplyWakeWatchdogTimer = setInterval(() => {
      if (!singleAccountAutoReplyEnabled || collecting || transcriptCaptureInProgress
          || singleAccountAutoReplyTimer) return;
      const now = Date.now();
      const busyStalled = autoReplyBusy && autoReplyTraceRunStartedAt > 0
        && now - autoReplyTraceRunStartedAt >= AUTO_REPLY_STALL_THRESHOLD_MS;
      const stalled = autoReplyWatchdogLastProgressAt > 0
        && now - autoReplyWatchdogLastProgressAt >= AUTO_REPLY_STALL_THRESHOLD_MS;
      if ((stalled || busyStalled) && document.visibilityState === 'visible'
          && !resumeAttachmentProcessing && !findVisibleResumeDialog()) {
        if (autoReplyWatchdogRecoveryCount >= AUTO_REPLY_WATCHDOG_MAX_RECOVERIES) {
          traceAutoReply('AUTO_REPLY_WATCHDOG_BLOCKED', {
            outcome: 'STOPPED',
            reason: `已连续自动恢复 ${autoReplyWatchdogRecoveryCount} 次仍没有调度进展，达到安全上限，已停止自动重启并转人工处理。`,
          });
          singleAccountAutoReplyEnabled = false;
          clearSingleAccountAutoReplyTimer();
          return;
        }
        if (now - autoReplyWatchdogRecoveryAt < AUTO_REPLY_WATCHDOG_COOLDOWN_MS) {
          traceAutoReply('AUTO_REPLY_WATCHDOG_COOLDOWN', {
            outcome: 'WAITING',
            reason: `上次自动恢复后仍未恢复，冷却剩余 ${Math.ceil((AUTO_REPLY_WATCHDOG_COOLDOWN_MS - (now - autoReplyWatchdogRecoveryAt)) / 1_000)} 秒；保持当前值守状态，不重复初始化。`,
          });
          scheduleSingleAccountAutoReply(5_000);
          return;
        }
        autoReplyWatchdogRecoveryCount += 1;
        autoReplyWatchdogRecoveryAt = now;
        traceAutoReply('AUTO_REPLY_WATCHDOG_RECOVERY', {
          outcome: 'WAITING',
          reason: busyStalled
            ? '当前自动回复阶段超过 90 秒没有返回，执行一次等价于关闭再开启今日值守的自愈重启。'
            : '调度超过 90 秒没有进展，执行一次等价于关闭再开启今日值守的自愈重启。',
        });
        autoReplyWatchdogLastProgressAt = now;
        // The old run is considered abandoned at this point. Its finally
        // block is generation-guarded, so releasing the local lock lets the
        // freshly restored run take over instead of waiting on a hung Promise.
        autoReplyBusy = false;
        autoReplyTraceRunStartedAt = 0;
        void setSingleAccountAutoReply(false).then(() => setSingleAccountAutoReply(true, true)).catch(() => {
          singleAccountAutoReplyEnabled = false;
        });
        return;
      }
      if (autoReplyBusy) return;
      traceAutoReply('AUTO_REPLY_WATCHDOG_WAKE', {
        outcome: 'WAITING',
        reason: '自动回复循环当前没有运行中的任务或调度计时器，已执行一次自检唤醒。',
      });
      scheduleSingleAccountAutoReply(300);
    }, AUTO_REPLY_WAKE_WATCHDOG_MS);
  }

  function isFatalAutoReplyPageState(page) {
    return ['RISK_OR_VERIFICATION', 'LOGIN_REQUIRED'].includes(page?.code);
  }

  async function haltSingleAccountAutoReply(state) {
    traceAutoReply('AUTO_REPLY_STOPPED', { outcome: 'STOPPED', reason: state });
    singleAccountAutoReplyEnabled = false;
    singleAccountActiveChatDigest = null;
    clearInterval(autoReplyWakeWatchdogTimer);
    autoReplyWakeWatchdogTimer = null;
    clearSingleAccountAutoReplyTimer();
    await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE', payload: {
      state, disable: true, observedAt: new Date().toISOString(),
    } });
  }

  async function reportSingleAccountResult(selected, outcome, reason, options = {}) {
    const result = await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_RESULT', payload: {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
      outcome, reason: compact(reason).slice(0, 300), occurredAt: new Date().toISOString(),
    } });
    if (!result?.ok) throw new Error(result?.error || '自动回复终态未能写入插件状态。');
    if (result?.shouldStop) {
      singleAccountAutoReplyEnabled = false;
      clearInterval(autoReplyWakeWatchdogTimer);
      autoReplyWakeWatchdogTimer = null;
      clearSingleAccountAutoReplyTimer();
    }
    if (!options.skipUnreadBaseline) {
      const matchingItem = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible)
        .find((item) => stableIdentity(item) && item.matches(SELECTORS.selectedConversation));
      if (matchingItem && await digest(stableIdentity(matchingItem)) === selected.chatDigest) {
        singleAccountUnreadBaseline.set(selected.chatDigest, await unreadRowSignature(matchingItem));
      }
    }
    if (!options.skipSelectedMessageBaseline) {
      singleAccountSelectedMessageBaseline.set(selected.chatDigest, selected.messageDigest);
    }
    await persistSingleAccountBaseline();
    if (options.archiveCurrent !== false) {
      await archiveCurrentConversation(selected, outcome, reason);
    }
  }

  async function archiveCurrentConversation(selected, outcome, reason) {
    const selectedRow = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    const selectedIdentity = selectedRow && stableIdentity(selectedRow);
    const selectedChatDigest = selectedIdentity ? await digest(selectedIdentity) : null;
    if (selectedChatDigest !== selected.chatDigest) {
      traceAutoReply('TRANSCRIPT_SYNC_SKIPPED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'BLOCKED',
        reason: '处理终态已记录，但当前选中会话与任务不一致，已禁止导入错误聊天记录。',
      });
      return false;
    }
    traceAutoReply('TRANSCRIPT_SYNC_STARTED', {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'INFO',
      reason: `会话已进入${outcome}终态，保持页面锁并冻结当前聊天记录。`,
    });
    try {
      const captured = await collectCurrentTranscript();
      if (!captured?.ok || captured.transcript?.chatDigest !== selected.chatDigest) {
        throw new Error(captured?.reason || '冻结后的聊天记录与当前处理会话不一致。');
      }
      const transcript = captured.transcript;
      traceAutoReply('TRANSCRIPT_CAPTURED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'SUCCESS',
        reason: `已冻结 ${Number(transcript.messageCount || 0)} 条消息，后台开始同步；页面锁现在可以安全释放。`,
      });
      const transcriptImportStartedAt = Date.now();
      void send({ type: 'BRIDGE_IMPORT_CAPTURED_TRANSCRIPT', transcript }).then((result) => {
        if (!result?.ok) throw new Error(result?.error || '聊天记录同步未返回成功结果。');
        const synced = result.transcriptSync || {};
        const failures = [synced.importError && `示例库：${synced.importError}`,
          synced.timelineImportError && `沟通时间线：${synced.timelineImportError}`].filter(Boolean);
        const exampleImport = synced.import || {};
        const timelineImport = synced.timelineImport || {};
        const syncSummary = `沟通时间线新增 ${Number(timelineImport.created || 0)}、重复 ${Number(timelineImport.duplicates || 0)}、跳过 ${Number(timelineImport.skipped || 0)}；示例库新增 ${Number(exampleImport.created || 0)}、重复 ${Number(exampleImport.duplicates || 0)}、跳过 ${Number(exampleImport.skipped || 0)}`;
        traceAutoReply(failures.length ? 'TRANSCRIPT_SYNC_PARTIAL' : 'TRANSCRIPT_SYNC_COMPLETED', {
          chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
          outcome: failures.length ? 'FAILED' : 'SUCCESS',
          elapsedMs: Date.now() - transcriptImportStartedAt,
          reason: failures.length
            ? `处理结果已保留，但聊天记录仅部分同步：${failures.join('；')}`
            : `${syncSummary}；本次冻结 ${Number(synced.messageCount || 0)} 条消息。`,
        });
      }).catch((error) => traceAutoReply('TRANSCRIPT_SYNC_FAILED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'FAILED',
        elapsedMs: Date.now() - transcriptImportStartedAt,
        reason: `处理终态已保留，后台聊天记录同步失败：${compact(error?.message || error || '未知错误').slice(0, 220)}`,
      }));
      return true;
    } catch (error) {
      traceAutoReply('TRANSCRIPT_SYNC_FAILED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'FAILED',
        reason: `处理终态已保留，聊天记录同步失败：${compact(error?.message || error || '未知错误').slice(0, 220)}`,
      });
      return false;
    }
  }

  async function enqueueLatestInboundAfterStaleTask(target, latest, staleTask) {
    const signature = target instanceof HTMLElement ? await unreadRowSignature(target) : null;
    singleAccountConversationQueue = singleAccountConversationQueue
      .filter((item) => item.chatDigest !== latest.chatDigest);
    singleAccountConversationQueue.unshift({
      chatDigest: latest.chatDigest,
      signature,
      expectedMessageDigest: latest.messageDigest,
      forcedLatestInbound: true,
    });
    singleAccountUnreadBaseline.delete(latest.chatDigest);
    singleAccountSelectedMessageBaseline.delete(latest.chatDigest);
    singleAccountBacklogSeen.delete(latest.chatDigest);
    await persistSingleAccountBaseline();
    traceAutoReply('LATEST_INBOUND_REQUEUED', {
      chatDigest: latest.chatDigest,
      messageDigest: latest.messageDigest,
      taskId: staleTask?.taskId,
      queuePosition: 1,
      outcome: 'SUCCESS',
      reason: '旧任务已作废；稳定复核确认最新一条仍来自候选人，已强制放回队首重新生成独立任务。',
    });
  }

  async function queueResumeAttachmentReceipt(selected, resumeIntakeId) {
    const conversationSignals = { ...(selected.conversationSignals || {}), resumeReceived: true };
    const result = await send({ type: 'BRIDGE_DECIDE_INBOUND_REPLY', payload: {
      chatDigest: selected.chatDigest,
      messageDigest: selected.messageDigest,
      // The backend uses the controlled context marker to select the
      // post-import receipt wording. The real attachment remains the target
      // digest, so the send lease is still bound to the actual BOSS message.
      messageText: '简历附件已发送',
      conversationContext: RESUME_ATTACHMENT_RECEIPT_CONTEXT,
      purpose: 'RESUME_RECEIPT',
      resumeIntakeId,
      messageAt: selected.messageAt,
      selectedUnread: selected.selectedUnread,
      conversationSignals,
      observedAt: new Date().toISOString(),
      continuous: true,
      resumeReceipt: true,
    } });
    if (!result?.ok) {
      traceAutoReply('RESUME_RECEIPT_QUEUE_FAILED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, queueLane: 'TERMINAL',
        outcome: 'FAILED', reason: result?.error || '简历已提取，但收件确认回复未能进入发送队列。',
      });
      return { queued: false, duplicate: false, error: result?.error || '简历收件确认入队失败。' };
    }
    if (result.pending && result.taskId) {
      singleAccountPendingReplies.set(result.taskId, {
        taskId: result.taskId, chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
        resumeReceipt: true, nextPollAt: Date.now() + 300, holdStartedAt: Date.now(),
      });
      enqueuePipelineTask(result.taskId, 'ANALYSIS');
      singleAccountPendingChatDigest = selected.chatDigest;
      traceAutoReply('RESUME_RECEIPT_QUEUED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, taskId: result.taskId, queueLane: 'ANALYSIS',
        outcome: 'WAITING', reason: '简历提取成功，已锁定当前会话；等待 AI 生成收件确认后立即发送。',
      });
      return { queued: true, duplicate: false };
    }
    if (result.decision?.category === 'DUPLICATE') {
      traceAutoReply('RESUME_RECEIPT_DUPLICATE', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, queueLane: 'TERMINAL',
        outcome: 'SKIPPED', reason: '该简历附件消息已经登记过收件确认，禁止重复发送。',
      });
      return { queued: false, duplicate: true };
    }
    traceAutoReply('RESUME_RECEIPT_QUEUE_REJECTED', {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
      outcome: 'FAILED', reason: result.decision?.reason || '简历收件确认未返回可发送任务。',
    });
    return { queued: false, duplicate: false, error: result.decision?.reason || '简历收件确认未返回可发送任务。' };
  }

  async function classifyResumeAttachmentContext(selected) {
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    const lastMessage = active
      ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
      : null;
    const attachmentText = compact(lastMessage?.textContent || selected.messageText || '简历附件').slice(0, 500);
    const attachmentFingerprint = await digest(`${selected.chatDigest}|${selected.messageDigest}|${attachmentText}`);
    traceAutoReply('RESUME_CONTEXT_CHECK_REQUESTED', {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'INFO',
      reason: '先将当前附件和最近对话交给 AI 只读判断，不打开、不提取、不生成回复。',
    });
    const result = await send({ type: 'BRIDGE_CLASSIFY_RESUME_ATTACHMENT', payload: {
      chatDigest: selected.chatDigest,
      messageDigest: selected.messageDigest,
      direction: selected.direction,
      messageAt: selected.messageAt,
      messageText: selected.messageText || attachmentText,
      conversationContext: selected.conversationContext || '',
      conversationSignals: selected.conversationSignals,
      attachmentFingerprint,
      observedAt: new Date().toISOString(),
    } });
    if (!result?.ok) {
      traceAutoReply('RESUME_CONTEXT_CHECK_FAILED', {
        chatDigest: selected.chatDigest, messageDigest: selected.messageDigest, outcome: 'WAITING',
        reason: result?.error || 'AI 简历事件判断暂不可用，保留当前会话等待下一轮。',
      });
      return { ok: false, allow: false, reason: result?.error || 'AI 简历事件判断暂不可用。' };
    }
    const classification = String(result.classification || 'UNCERTAIN').toUpperCase();
    const confidence = Number(result.confidence || 0);
    const allow = classification === 'NEW_RESUME' && confidence >= 0.82;
    traceAutoReply('RESUME_CONTEXT_CLASSIFIED', {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
      outcome: allow ? 'SUCCESS' : 'SKIPPED', confidence,
      reason: `${classification}：${result.reason || '未提供原因'}${allow ? '；满足新简历阈值，允许打开' : '；不满足新简历安全阈值，不打开附件'}`,
    });
    return { ok: true, allow, classification, confidence, reason: result.reason || '当前附件未确认是本轮新简历。' };
  }

  async function receiptInboundReplySend(lease, outcome, afterShape, reason) {
    const afterStateDigest = await digest(afterShape);
    const receiptDigest = await digest(`${lease.beforeStateDigest}|${afterStateDigest}|${outcome}`);
    return send({ type: 'BRIDGE_RECEIPT_INBOUND_REPLY_SEND', payload: {
      leaseToken: lease.leaseToken, outcome, beforeStateDigest: lease.beforeStateDigest,
      afterStateDigest, receiptDigest, reason: compact(reason).slice(0, 300),
    } });
  }

  async function clearPendingSendReconciliation(taskId) {
    singleAccountUnknownReconciliations.delete(taskId);
    await send({ type: 'BRIDGE_CLEAR_SEND_RECONCILIATION', taskId }).catch(() => {});
  }

  async function reconcileRecoveredUnknownSend() {
    const now = Date.now();
    for (const task of singleAccountUnknownReconciliations.values()) {
      if (Number(task.expiresAt) <= now) {
        await clearPendingSendReconciliation(task.taskId);
        traceAutoReply('SEND_RECOVERY_EXPIRED', {
          chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
          queueLane: 'TERMINAL', outcome: 'UNKNOWN',
          reason: '发送后只读复核期限已过；仍无法确认的任务保持 UNKNOWN，绝不重新点击发送。',
        });
      }
    }
    const task = [...singleAccountUnknownReconciliations.values()]
      .find((item) => Number(item.nextCheckAt || 0) <= now);
    if (!task) return false;
    task.nextCheckAt = now + 10_000;
    let target = await findConversationByDigest(task.chatDigest);
    if (!target) {
      const deepLookup = await findConversationByDigestDeep(task.chatDigest);
      target = deepLookup.item;
      if (!target) {
        if (!deepLookup.complete) task.nextCheckAt = now + LIST_SCAN_CONTINUE_DELAY_MS;
        traceAutoReply('SEND_RECOVERY_TARGET_WAITING', {
          chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
          queueLane: 'TERMINAL', outcome: 'WAITING',
          reason: deepLookup.complete
            ? '只读复核暂未定位原会话，保留 UNKNOWN 并继续处理其他会话。'
            : '只读复核正在分段定位原会话；本轮不点击发送。',
        });
        return !deepLookup.complete;
      }
    }
    try {
      const selected = await collectStableAutoReplySnapshot(target, task.chatDigest);
      const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
      const last = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible)
        .filter((item) => directionOf(item)).at(-1) : null;
      const identity = last && stableIdentity(last);
      const identityDigest = identity ? await digest(identity) : null;
      const claimedMinute = Math.floor(Date.parse(task.claimedAt || '') / 60_000);
      const outboundMinute = Math.floor(Date.parse(selected?.messageAt || '') / 60_000);
      const exactNewOutbound = selected?.ok && selected.chatDigest === task.chatDigest
        && selected.messageDigest !== task.messageDigest && selected.direction === 'OUTBOUND'
        && last && directionOf(last) === 'OUTBOUND'
        && task.outboundBeforeIdentitiesComplete === true
        && identityDigest && !task.outboundBeforeIdentityDigests.includes(identityDigest)
        && await digest(cleanOutboundReplyText(last)) === task.replyDigest
        && Number.isFinite(claimedMinute) && Number.isFinite(outboundMinute)
        && outboundMinute >= claimedMinute;
      if (!exactNewOutbound) {
        traceAutoReply('SEND_RECOVERY_UNRESOLVED', {
          chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
          queueLane: 'TERMINAL', outcome: 'UNKNOWN',
          reason: '重启后仍缺少同会话、新出站身份、相同正文和发送时间的完整证据；保持结果不明，不重发。',
        });
        return true;
      }
      const result = await send({ type: 'BRIDGE_RECONCILE_INBOUND_REPLY_SEND', payload: {
        leaseToken: task.leaseToken, chatDigest: task.chatDigest, messageDigest: task.messageDigest,
        outboundMessageDigest: selected.messageDigest, outboundTextDigest: task.replyDigest,
        outboundAt: selected.messageAt, observedAt: new Date().toISOString(),
      } });
      if (result?.status === 'SUCCEEDED') {
        await clearPendingSendReconciliation(task.taskId);
        traceAutoReply('SEND_RECOVERED_AFTER_RESTART', {
          chatDigest: task.chatDigest, messageDigest: task.messageDigest, taskId: task.taskId,
          queueLane: 'TERMINAL', outcome: 'SUCCESS',
          reason: '重启后只读复核确认相同正文的新出站消息，后端已将 UNKNOWN 调整为成功；未再次点击发送。',
        });
      }
      return true;
    } finally {
      singleAccountPendingChatDigest = null;
    }
  }

  function cleanOutboundReplyText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(`${SELECTORS.messageTime}, script, style, input, textarea, button, .message-card-buttons, .message-status, .message-read-status, [class*="delivery"], [class*="read-status"], [class*="send-status"], [aria-label*="送达"], [title*="送达"]`).forEach((item) => item.remove());
    return cleanConversationMessageText(clone.textContent || '');
  }

  async function prepareAutoReplyCycle() {
    if (document.visibilityState !== 'visible') {
      traceAutoReply('PAGE_HIDDEN_PAUSED', {
        outcome: 'WAITING', reason: '当前 BOSS 页面处于隐藏或最小化状态，已保留队列且暂停页面写操作。',
      });
      return { ready: false, delay: 5_000 };
    }
    const page = classifyPage();
    if (!page.ok) {
      const reason = page.reason || '当前页面存在登录、验证或风险状态。';
      if (isFatalAutoReplyPageState(page)) {
        traceAutoReply('PAGE_BLOCKED', { reason, outcome: 'BLOCKED' });
        await haltSingleAccountAutoReply(`持续回复已停止：${reason}`);
        return { ready: false, stopped: true };
      }
      traceAutoReply('PAGE_WAITING', { reason, outcome: 'WAITING' });
      return { ready: false, delay: 3_000 };
    }
    // A previous resume import may have left a modal/iframe on top of the
    // conversation page. Close only the currently visible, known resume
    // preview before reading controls or selecting the next queue target.
    if (!await ensureResumePreviewClosedForAutoReply()) {
      if (!resumePdfForwardInFlight && resumePdfBackendRequestsInFlight.size === 0) {
        resumePreviewCloseFirstFailureAt ||= Date.now();
        resumePreviewCloseAttempts += 1;
        if (resumePreviewCloseAttempts >= 5
            && Date.now() - resumePreviewCloseFirstFailureAt >= 30_000) {
          await haltSingleAccountAutoReply('持续回复已暂停：简历预览连续 30 秒无法确认关闭。请 HR 检查并关闭预览；确认页面正常后关闭再开启今日值守。');
          return { ready: false, stopped: true };
        }
      }
      traceAutoReply('RESUME_PREVIEW_CLOSE_WAITING', {
        outcome: 'WAITING', reason: '简历预览暂未确认关闭，保留挂机状态，稍后重试，不停止整个自动回复。',
      });
      return { ready: false, delay: 3_000 };
    }
    resumePreviewCloseFirstFailureAt = 0;
    resumePreviewCloseAttempts = 0;
    const currentControls = findReplyControls();
    if (currentControls.editor && readEditorText(currentControls.editor).trim()) {
      traceAutoReply('EDITOR_WAITING', { reason: '当前输入框已有内容，为避免覆盖 HR 草稿，等待输入框恢复为空。', outcome: 'WAITING' });
      return { ready: false, delay: 3_000 };
    }
    await refreshDeferredReplyRevalidations();
    return { ready: true };
  }

  async function collectStableAutoReplySnapshot(target, expectedChatDigest) {
    singleAccountPendingChatDigest = expectedChatDigest;
    const hasTargetRow = target instanceof HTMLElement;
    const switchedConversation = hasTargetRow && !target.matches(SELECTORS.selectedConversation);
    if (switchedConversation) target.click();
    await delay(switchedConversation ? 650 : 120);
    const first = hasTargetRow
      ? await collectTargetBoundConversation(target, expectedChatDigest)
      : await collectExpectedActiveConversation(expectedChatDigest);
    await delay(350);
    const second = hasTargetRow
      ? await collectTargetBoundConversation(target, expectedChatDigest)
      : await collectExpectedActiveConversation(expectedChatDigest);
    if (!first.ok || !second.ok || first.chatDigest !== expectedChatDigest || second.chatDigest !== expectedChatDigest || !sameConversationMessage(first, second)) {
      traceAutoReply('SNAPSHOT_UNSTABLE', {
        chatDigest: expectedChatDigest,
        messageDigest: second?.messageDigest || first?.messageDigest || null,
        outcome: 'WAITING',
        reason: !first.ok || !second.ok ? '当前会话读取失败。' : first.chatDigest !== expectedChatDigest || second.chatDigest !== expectedChatDigest ? '会话摘要与目标不一致。' : '连续两次消息摘要不一致，等待页面稳定。',
      });
      return null;
    }
    traceAutoReply('SNAPSHOT_STABLE', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SUCCESS', reason: `已完成两次一致复核，方向=${second.direction || 'UNKNOWN'}。` });
    return second;
  }

  async function processNextUnreadConversation() {
    if (!singleAccountAutoReplyEnabled) return;
    autoReplyWatchdogLastProgressAt = Date.now();
    if (transcriptCaptureInProgress) {
      traceAutoReply('TRANSCRIPT_CAPTURE_HOLD', {
        outcome: 'WAITING', reason: '当前正在只读采集完整聊天记录，暂不切换会话或触发简历处理。',
      });
      return scheduleSingleAccountAutoReply(1_000);
    }
    if (autoReplyBusy || collecting) {
      traceAutoReply('LOOP_BUSY', { reason: collecting ? '页面快照采集中' : '上一轮自动回复尚未结束', outcome: 'WAITING' });
      return scheduleSingleAccountAutoReply(1_000);
    }
    autoReplyBusy = true;
    const runGeneration = autoReplyGeneration;
    autoReplyTraceRunStartedAt = Date.now();
    autoReplyTraceRunId = `${autoReplyTraceRunStartedAt.toString(36)}-${++autoReplyTraceRunSequence}`;
    try {
      const preparation = await prepareAutoReplyCycle();
      if (!preparation.ready) {
        if (!preparation.stopped) scheduleSingleAccountAutoReply(preparation.delay || 3_000);
        return;
      }
      // Keep the conversation that created an AI task open until the decision
      // is ready. This avoids navigating away and later trying to rediscover a
      // virtualized BOSS row. A bounded hold prevents one slow AI task from
      // blocking the account forever.
      const heldTask = singleAccountPendingChatDigest
        ? [...singleAccountPendingReplies.values()].find((task) => task.retryable !== true
          && task.chatDigest === singleAccountPendingChatDigest) || null
        : null;
      let heldReadyReply = null;
      if (heldTask) {
        heldTask.holdStartedAt = Number(heldTask.holdStartedAt || Date.now());
        const heldForMs = Date.now() - heldTask.holdStartedAt;
        const current = await collectExpectedActiveConversation(heldTask.chatDigest);
        const currentStillHeld = current.ok && current.chatDigest === heldTask.chatDigest
          && singleAccountActiveChatDigest === heldTask.chatDigest;
        if (!currentStillHeld) {
          traceAutoReply('CURRENT_CONVERSATION_HOLD_LOST', {
            chatDigest: heldTask.chatDigest, messageDigest: heldTask.messageDigest, taskId: heldTask.taskId,
            outcome: 'WAITING', reason: '当前页面已不再是 AI 任务的原会话，已解除原地等待；任务仍保留在后端待安全定位。',
          });
          singleAccountPendingChatDigest = null;
        } else if (heldForMs < CURRENT_CONVERSATION_AI_HOLD_MS) {
          heldReadyReply = await nextReadyInboundReply(heldTask.taskId);
          if (!heldReadyReply) {
            if (singleAccountPendingReplies.has(heldTask.taskId)) {
              traceAutoReply('CURRENT_CONVERSATION_WAITING_AI', {
                chatDigest: heldTask.chatDigest, messageDigest: heldTask.messageDigest, taskId: heldTask.taskId,
                outcome: 'WAITING', reason: `当前会话已锁定，原地等待 AI 结果（${Math.ceil(heldForMs / 1_000)} 秒）；不扫描、不切换其他会话。`,
              });
              return scheduleSingleAccountAutoReply(700);
            }
            singleAccountPendingChatDigest = null;
            return scheduleSingleAccountAutoReply(200);
          }
          traceAutoReply('CURRENT_CONVERSATION_AI_READY', {
            chatDigest: heldTask.chatDigest, messageDigest: heldTask.messageDigest, taskId: heldTask.taskId,
            outcome: 'SUCCESS', reason: 'AI 已返回结果，当前会话未切换，立即进入发送前稳定复核。',
          });
        } else {
          traceAutoReply('CURRENT_CONVERSATION_HOLD_TIMEOUT', {
            chatDigest: heldTask.chatDigest, messageDigest: heldTask.messageDigest, taskId: heldTask.taskId,
            outcome: 'WAITING', reason: 'AI 等待超过 45 秒，已释放页面会话锁；后端任务仍保留，后续只会在重新稳定定位后发送。',
          });
          singleAccountPendingChatDigest = null;
        }
      }
      // A completed AI result is the highest-priority page operation. Poll
      // active tasks before scanning unread rows, then locate and revalidate
      // their original conversation. Historical retry inventory remains behind
      // real-time unread so it cannot monopolize the page.
      const priorityReadyReply = heldReadyReply
        || await nextReadyInboundReply(null, { includeRetryable: false });
      // BOSS immediately clears the unread badge when a message arrives in the
      // conversation that is already open. Detect that changed detail first;
      // otherwise a list-only scan sees zero unread rows and silently misses it.
      const changedCurrent = priorityReadyReply ? { item: null, snapshot: null } : await findChangedCurrentConversation();
      // 没有可发送结果时，实时未读仍优先于库存二次复核。旧失败任务会触发
      // 深度列表定位，如果先处理库存，新到消息会表现为“列表一直滚动但不打开”。
      let realtimeUnread = priorityReadyReply ? null : changedCurrent.item
        ? { item: changedCurrent.item, chatDigest: changedCurrent.snapshot.chatDigest, currentPane: true,
          readReview: changedCurrent.readReview === true }
        : await findNewOrChangedUnreadConversation();
      const hasDeferredInventory = [...singleAccountPendingReplies.values()].some((task) => task.retryable === true);
      if (!realtimeUnread?.item && hasDeferredInventory && Date.now() - lastDeepConversationScanAt >= DEEP_SCAN_COOLDOWN_MS) {
        lastDeepConversationScanAt = Date.now();
        realtimeUnread = await findNewOrChangedUnreadConversationDeep();
      }
      const realtimeTarget = realtimeUnread?.item || null;
      if (realtimeTarget) traceAutoReply(realtimeUnread.currentPane ? 'CURRENT_CONVERSATION_CHANGED' : 'REALTIME_UNREAD_PRIORITY', {
        chatDigest: realtimeUnread.chatDigest, outcome: 'SUCCESS',
        reason: realtimeUnread.currentPane
          ? '当前已打开会话出现新的候选人消息，不依赖未读角标，优先进入分析。'
          : '发现新到或内容已变化的未读会话，优先于历史库存复核立即读取。',
      });
      // UNKNOWN is terminal and must never be resent.  Its delayed, read-only
      // reconciliation is deliberately placed behind current READY/unread
      // work so a virtualized list cannot monopolise the reply loop.
      const hasActiveReplyWork = pipelineQueueFor('SEND').length > 0
        || pipelineQueueFor('ANALYSIS').length > 0;
      if (!priorityReadyReply && !realtimeTarget && !hasActiveReplyWork
          && singleAccountUnknownReconciliations.size > 0) {
        await reconcileRecoveredUnknownSend();
      }
      const readyReply = priorityReadyReply || (realtimeTarget ? null : await nextReadyInboundReply());
      if (readyReply?.terminalTask) {
        const terminalTask = readyReply.terminalTask;
        const terminalReason = readyReply.terminalReason || 'AI 任务已进入终态。';
        try {
          // The backend has already recorded the final send outcome. Do not
          // scroll to, open, or archive a possibly different current chat.
          await reportSingleAccountResult(terminalTask, readyReply.terminalOutcome || 'SILENT', terminalReason, {
            skipUnreadBaseline: true, skipSelectedMessageBaseline: true, archiveCurrent: false,
          });
          removePendingPipelineTask(terminalTask.taskId);
          if (singleAccountPendingChatDigest === terminalTask.chatDigest) singleAccountPendingChatDigest = null;
          traceAutoReply('AI_TASK_TERMINAL_CLEARED', {
            chatDigest: terminalTask.chatDigest, messageDigest: terminalTask.messageDigest,
            taskId: terminalTask.taskId, queueLane: 'TERMINAL', outcome: 'SUCCESS',
            reason: '后端终态已同步到插件并移出本地队列；未定位会话、未触发发送。',
          });
        } catch (error) {
          terminalTask.nextPollAt = Date.now() + 5_000;
          traceAutoReply('RESULT_REPORT_FAILED', {
            chatDigest: terminalTask.chatDigest, messageDigest: terminalTask.messageDigest,
            taskId: terminalTask.taskId, queueLane: 'TERMINAL', outcome: 'FAILED',
            reason: `终态同步失败，已保留任务退避重试：${String(error?.message || error || '未知错误')}`,
          });
        }
        return scheduleSingleAccountAutoReply(500);
      }
      const retryTask = readyReply?.retryTask || null;
      const prioritizedTask = readyReply?.task || retryTask || null;
      const readyTask = readyReply?.task || null;
      if (readyTask) {
        markReadyTaskDiscovered(readyTask);
        traceAutoReply('READY_DISPATCH_STARTED', {
          chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
          outcome: 'INFO', reason: `待发送结果已优先调度，当前等待 ${Math.ceil(readyTaskAgeMs(readyTask) / 1_000)} 秒；暂停扫描新未读。`,
        });
      }
      if (!realtimeTarget && !readyReply && singleAccountPendingReplies.size > 0
          && singleAccountConversationQueue.length === 0) {
        const nextPollAt = Math.min(...[...singleAccountPendingReplies.values()].map((task) => Number(task.nextPollAt || 0)).filter((value) => Number.isFinite(value)));
        const waitMs = Number.isFinite(nextPollAt) ? Math.max(1_000, Math.min(5_000, nextPollAt - Date.now())) : 2_000;
        traceAutoReply('QUEUE_WINDOW_WAITING_AI', {
          queueLane: 'ANALYSIS',
          outcome: 'WAITING',
          reason: `当前扫描队列已清空，分析 ${pipelineQueueFor('ANALYSIS').length}、发送 ${pipelineQueueFor('SEND').length}、复核 ${pipelineQueueFor('REVALIDATION').length}；仍有 ${singleAccountPendingReplies.size} 个 AI 任务未完成，不开启下一轮列表扫描，${Math.ceil(waitMs / 1_000)} 秒后继续轮询。`,
        });
        return scheduleSingleAccountAutoReply(waitMs);
      }
      const selectedItem = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
      const currentConversationAffinity = Boolean(prioritizedTask && heldReadyReply
        && singleAccountPendingChatDigest === prioritizedTask.chatDigest
        && singleAccountActiveChatDigest === prioritizedTask.chatDigest);
      let target = realtimeTarget;
      if (!target && prioritizedTask && !currentConversationAffinity) {
        target = await findConversationByDigest(prioritizedTask.chatDigest);
        if (!target && readyTask) traceAutoReply('READY_VISIBLE_LOOKUP_MISS', {
          chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
          outcome: 'WAITING', reason: '当前可见会话行中未找到待发送目标，准备使用持久化定位提示和深度扫描。',
        });
      }
      if (!target && currentConversationAffinity && selectedItem) {
        const selectedIdentity = stableIdentity(selectedItem);
        if (selectedIdentity && await digest(selectedIdentity) === prioritizedTask.chatDigest) target = selectedItem;
      }
      let readReviewTarget = realtimeUnread?.readReview === true;
      let queuedCandidate = null;
      if (prioritizedTask && !target && !currentConversationAffinity) {
        if (readyTask) {
          const now = Date.now();
          const wakeDue = readyTaskAgeMs(readyTask, now) >= READY_SEND_WAKE_AFTER_MS
            && now - Number(readyTask.lastWakeAt || 0) >= READY_SEND_WAKE_INTERVAL_MS;
          if (wakeDue) {
            readyTask.lastWakeAt = now;
            readyTask.wakeAttempts = Number(readyTask.wakeAttempts || 0) + 1;
            const scroller = conversationScrollContainer();
            if (scroller) activateConversationListForAutomation(scroller, '长时间 READY 主动唤醒');
            traceAutoReply('READY_RELOCATION_WAKE', {
              queueLane: 'SEND',
              chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
              attempt: readyTask.wakeAttempts, outcome: 'WAITING',
              reason: `待发送已等待 ${Math.ceil(readyTaskAgeMs(readyTask, now) / 1_000)} 秒，主动激活会话列表并重新执行定位。`,
            });
          }
          traceAutoReply('READY_DEEP_SCAN_STARTED', {
            queueLane: 'SEND',
            chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
            outcome: 'INFO', reason: '开始按定位提示与全量虚拟列表重新查找待发送会话。',
          });
        }
        const deepLookup = await findConversationByDigestDeep(prioritizedTask.chatDigest);
        target = deepLookup.item;
        if (!target && !deepLookup.complete) {
          traceAutoReply('READY_DEEP_SCAN_CONTINUING', {
            queueLane: 'SEND', chatDigest: prioritizedTask.chatDigest,
            messageDigest: prioritizedTask.messageDigest, taskId: prioritizedTask.taskId,
            outcome: 'WAITING', reason: '待发送目标的只读定位仍在分段扫描中；让出页面执行权，下一轮优先继续定位。',
          });
          return scheduleSingleAccountAutoReply(LIST_SCAN_CONTINUE_DELAY_MS);
        }
        if (readyTask) traceAutoReply(target ? 'READY_DEEP_SCAN_MATCHED' : 'READY_DEEP_SCAN_MISS', {
          queueLane: 'SEND',
          chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
          outcome: target ? 'SUCCESS' : 'WAITING', reason: target
            ? '深度扫描已重新定位待发送会话，继续执行稳定快照复核。'
            : '本轮已遍历当前可加载会话列表，仍未找到待发送目标。',
        });
      }
      let queuedDecision = target || currentConversationAffinity ? readyReply?.decision || null : null;
      let queuedTask = target || currentConversationAffinity ? prioritizedTask : null;
      if (readyTask && (target || currentConversationAffinity)) {
        readyTask.locateFailures = 0;
        readyTask.firstLocateFailureAt = null;
        traceAutoReply('READY_TARGET_LOCATED', {
          queueLane: 'SEND',
          chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
          outcome: 'SUCCESS', reason: currentConversationAffinity
            ? '待发送任务仍绑定当前会话，无需切换页面。'
            : '已定位待发送任务对应会话，下一步进行两次稳定快照复核。',
        });
      }
      if (prioritizedTask && !target && !currentConversationAffinity) {
        const now = Date.now();
        prioritizedTask.locateFailures = Number(prioritizedTask.locateFailures || 0) + 1;
        prioritizedTask.firstLocateFailureAt = prioritizedTask.firstLocateFailureAt || now;
        const waitedMs = now - prioritizedTask.firstLocateFailureAt;
        if (!retryTask && (prioritizedTask.locateFailures >= READY_SEND_MAX_LOCATE_FAILURES
            || waitedMs >= READY_SEND_MAX_WAIT_MS)) {
          removePendingPipelineTask(prioritizedTask.taskId, prioritizedTask.chatDigest);
          singleAccountRetryLocateDeferrals.set(prioritizedTask.taskId, now + RETRY_TARGET_DEFER_MS);
          traceAutoReply('READY_TARGET_DEFERRED', {
            queueLane: 'SEND', chatDigest: prioritizedTask.chatDigest,
            messageDigest: prioritizedTask.messageDigest, taskId: prioritizedTask.taskId,
            attempt: prioritizedTask.locateFailures, outcome: 'SKIPPED',
            reason: `待发送会话连续 ${prioritizedTask.locateFailures} 次无法定位，已等待 ${Math.ceil(waitedMs / 1_000)} 秒；任务转人工处理并释放主循环。`,
          });
          await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE', payload: {
            state: '待发送会话暂时无法定位，已转人工处理；其他会话继续运行。',
            disable: false, observedAt: new Date().toISOString(),
          } }).catch(() => {});
          return scheduleSingleAccountAutoReply(300);
        }
        if (!retryTask) {
          prioritizedTask.nextPollAt = now + READY_SEND_RELOCATE_DELAY_MS;
          traceAutoReply('READY_RELOCATE_SCHEDULED', {
            chatDigest: prioritizedTask.chatDigest, messageDigest: prioritizedTask.messageDigest,
            taskId: prioritizedTask.taskId, attempt: prioritizedTask.locateFailures, outcome: 'WAITING',
            reason: `待发送任务尚未定位，${READY_SEND_RELOCATE_DELAY_MS / 1_000} 秒后主动重试；不会进入历史任务的 5 分钟冷却。`,
          });
          return scheduleSingleAccountAutoReply(READY_SEND_RELOCATE_DELAY_MS);
        }
        if (prioritizedTask.locateFailures >= RETRY_TARGET_MAX_LOCATE_FAILURES || waitedMs >= RETRY_TARGET_MAX_WAIT_MS) {
          removePendingPipelineTask(prioritizedTask.taskId, prioritizedTask.chatDigest);
          singleAccountRetryLocateDeferrals.set(prioritizedTask.taskId, now + RETRY_TARGET_DEFER_MS);
          traceAutoReply('AI_RETRY_TARGET_DEFERRED', {
            queueLane: 'REVALIDATION',
            chatDigest: prioritizedTask.chatDigest, messageDigest: prioritizedTask.messageDigest, taskId: prioritizedTask.taskId,
            attempt: prioritizedTask.locateFailures, outcome: 'WAITING',
            reason: '历史失败复核任务连续无法定位原会话，已冷却 5 分钟并释放队首；任务仍在后端保留。',
          });
          return scheduleSingleAccountAutoReply(300);
        }
        traceAutoReply('AI_RETRY_TARGET_NOT_FOUND', {
          queueLane: 'REVALIDATION',
          chatDigest: prioritizedTask.chatDigest, messageDigest: prioritizedTask.messageDigest, taskId: prioritizedTask.taskId,
          attempt: prioritizedTask.locateFailures, outcome: 'WAITING', reason: '当前列表深度扫描仍未定位到历史复核会话，保留任务退避后再定位。',
        });
        return scheduleSingleAccountAutoReply(3_000);
      }
      if (!target && !currentConversationAffinity && singleAccountPendingChatDigest && selectedItem) {
        const selectedIdentity = stableIdentity(selectedItem);
        if (selectedIdentity && await digest(selectedIdentity) === singleAccountPendingChatDigest) target = selectedItem;
      }
      let refill = null;
      let queueRetryDelay = 1_000;
      let queueHeadPending = false;
      if (!target && !queuedTask) {
        singleAccountPendingChatDigest = null;
        if (singleAccountConversationQueue.length === 0) {
          // Only open a new bounded scan window after the previous FIFO window
          // has been fully consumed. The scan itself starts by moving the
          // conversation list's real scroll container.
      traceAutoReply('QUEUE_WINDOW_SCAN_STARTED', {
            queueLane: 'SCAN',
            outcome: 'INFO', reason: '当前队列已清空，先滚动扫描未读；若无未读，再复核已读但最后一条可能来自候选人的会话。',
          });
          refill = await refillSingleAccountConversationQueue();
          singleAccountQueueWindowInitialized = !['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN', 'PARTIAL'].includes(refill?.scanCode);
          traceAutoReply('QUEUE_WINDOW_SCAN_COMPLETED', {
            queueLane: 'SCAN',
            outcome: ['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN', 'PARTIAL'].includes(refill?.scanCode) ? 'WAITING' : 'INFO',
            reason: `${refill?.scanCode === 'PARTIAL' ? '本轮分段扫描暂见' : '本轮发现'} ${refill?.observedUnread ?? 0} 条未读，已读安全复核入队 ${refill?.readReviewAdded ?? 0} 条，总新增 ${refill?.added ?? 0} 条，当前扫描队列 ${refill?.queueLength ?? 0} 条；分析 ${pipelineQueueFor('ANALYSIS').length}，发送 ${pipelineQueueFor('SEND').length}，复核 ${pipelineQueueFor('REVALIDATION').length}。`,
          });
        } else {
          refill = { observedUnread: null, added: 0, queueLength: singleAccountConversationQueue.length, skipped: 'QUEUE_ACTIVE' };
          traceAutoReply('QUEUE_WINDOW_ACTIVE', {
            queueLane: 'SCAN',
            queuePosition: 1, outcome: 'INFO',
            reason: `当前队列仍有 ${singleAccountConversationQueue.length} 条，完成本批处理前不重新扫描会话列表。`,
          });
        }
        queuedCandidate = singleAccountConversationQueue[0];
        queueHeadPending = Boolean(queuedCandidate);
        if (queuedCandidate) {
          const locateFailures = Number(queuedCandidate.locateFailures || 0);
          traceAutoReply('QUEUE_PEEK', {
            queueLane: 'SCAN',
            chatDigest: queuedCandidate.chatDigest, queuePosition: 1, attempt: locateFailures + 1, outcome: 'INFO',
            reason: locateFailures ? `第 ${locateFailures + 1} 次定位队首会话。`
              : queuedCandidate.readReview ? '开始定位队首已读未回安全复核会话。' : '开始定位队首未读会话。',
          });
          target = await findConversationByDigest(queuedCandidate.chatDigest);
          // A queued item may have come from a virtualized list and no longer
          // be present in the current DOM. Always escalate a queue miss to a
          // full list scan; the retry backoff below prevents a tight loop.
          if (!target) {
            lastDeepConversationScanAt = Date.now();
            const deepLookup = await findConversationByDigestDeep(queuedCandidate.chatDigest);
            target = deepLookup.item;
            if (!target && !deepLookup.complete) {
              traceAutoReply('QUEUE_TARGET_SCAN_CONTINUING', {
                chatDigest: queuedCandidate.chatDigest, queuePosition: 1, outcome: 'WAITING',
                reason: '队首会话仍在分段定位中；不累计定位失败次数，下一轮先检查待发送任务。',
              });
              return scheduleSingleAccountAutoReply(LIST_SCAN_CONTINUE_DELAY_MS);
            }
          }
          if (target) {
            singleAccountConversationQueue.shift();
            queuedCandidate.locateFailures = 0;
            readReviewTarget = queuedCandidate.readReview === true;
            traceAutoReply('TARGET_SELECTED', { chatDigest: queuedCandidate.chatDigest, queueLane: 'SCAN', queuePosition: 1, outcome: 'SUCCESS', reason: '已从扫描预取队列定位会话。' });
          } else {
            const now = Date.now();
            queuedCandidate.locateFailures = locateFailures + 1;
            queuedCandidate.firstLocateFailureAt = queuedCandidate.firstLocateFailureAt || now;
            const waitedMs = now - queuedCandidate.firstLocateFailureAt;
            queueRetryDelay = Math.min(QUEUE_TARGET_RETRY_MAX_MS,
              QUEUE_TARGET_RETRY_BASE_MS * (2 ** Math.max(0, queuedCandidate.locateFailures - 1)));
            const visibleRows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible).length;
            const reason = `队首会话暂未出现在当前 DOM（可见会话 ${visibleRows} 条），已完成第 ${queuedCandidate.locateFailures} 次深度定位。`;
            if (queuedCandidate.locateFailures >= QUEUE_TARGET_MAX_LOCATE_FAILURES || waitedMs >= QUEUE_TARGET_MAX_WAIT_MS) {
              singleAccountConversationQueue.shift();
              queueHeadPending = false;
              // Allow the next full scan to enqueue it again if it is still unread.
              singleAccountBacklogSeen.delete(queuedCandidate.chatDigest);
              traceAutoReply('QUEUE_DROPPED', {
                chatDigest: queuedCandidate.chatDigest, queuePosition: 1, attempt: queuedCandidate.locateFailures, outcome: 'SKIPPED',
                reason: `${reason} 已等待 ${Math.ceil(waitedMs / 1_000)} 秒，暂时移出队首；后续全量扫描仍会重新发现未读。`,
              });
            } else {
              traceAutoReply('QUEUE_TARGET_NOT_FOUND', {
                chatDigest: queuedCandidate.chatDigest, queuePosition: 1, attempt: queuedCandidate.locateFailures, outcome: 'WAITING',
                reason: `${reason} ${Math.ceil(queueRetryDelay / 1_000)} 秒后退避重试。`,
              });
            }
          }
        }
        if (!target && !queueHeadPending) {
          const candidate = await findNewOrChangedUnreadConversation();
          if (candidate.error) {
            traceAutoReply('UNREAD_SCAN_WAITING', { outcome: 'WAITING', reason: candidate.error });
            return scheduleSingleAccountAutoReply(1_500);
          }
          target = candidate.item;
        }
        if (!target && Date.now() - lastDeepConversationScanAt >= DEEP_SCAN_COOLDOWN_MS) {
          lastDeepConversationScanAt = Date.now();
          const deepCandidate = await findNewOrChangedUnreadConversationDeep();
          target = deepCandidate?.item || null;
        }
        }
        if (!target) {
          if (['SCROLLER_NOT_FOUND', 'PAGE_NOT_READY', 'PREVIEW_OPEN'].includes(refill?.scanCode)) {
            queueRetryDelay = Math.max(queueRetryDelay, LIST_DOM_RETRY_DELAY_MS);
          }
          if (refill?.scanCode === 'PARTIAL') queueRetryDelay = LIST_SCAN_CONTINUE_DELAY_MS;
          if (refill?.readReviewSkipped === 'COOLDOWN') {
            queueRetryDelay = Math.max(queueRetryDelay, 3_000);
          }
          const observed = refill?.observedUnread == null
            ? (refill?.skipped === 'PREFETCH_WINDOW_FULL' ? '未扫描（预取窗口已满）'
              : refill?.skipped === 'QUEUE_ACTIVE' ? '未扫描（当前队列未清空）'
                : refill?.scanCode === 'PAGE_NOT_READY' ? '未扫描（页面未就绪）'
                  : refill?.scanCode === 'SCROLLER_NOT_FOUND' ? '未扫描（滚动容器缺失）' : '未知')
            : `${refill.observedUnread} 条`;
          const readReviewState = refill?.readReviewSkipped === 'COOLDOWN'
            ? '；已读未回复核处于 30 秒冷却窗口'
            : refill?.readReviewAdded ? `；已读未回复核入队 ${refill.readReviewAdded} 条` : '';
          traceAutoReply(refill?.scanCode === 'PARTIAL' ? 'SCAN_CONTINUING' : 'SCAN_EMPTY', { outcome: 'WAITING', reason: `${refill?.scanCode === 'PARTIAL' ? '本段暂见' : '扫描到'}未读 ${observed}，新增入队 ${refill?.added ?? 0} 条，当前队列 ${refill?.queueLength ?? singleAccountConversationQueue.length} 条${readReviewState}；${refill?.scanCode === 'PARTIAL' ? '列表尚未扫完，先检查待发送任务，' : '未找到可定位目标，'}${queueRetryDelay / 1_000} 秒后继续。` });
          return scheduleSingleAccountAutoReply(queueRetryDelay);
        }
      const identity = target instanceof HTMLElement ? stableIdentity(target) : '';
      if (!identity && !currentConversationAffinity) {
        traceAutoReply('TARGET_WAITING', { outcome: 'WAITING', reason: '未读会话暂时没有稳定 DOM 身份，跳过本轮并等待列表重绘。' });
        return scheduleSingleAccountAutoReply(1_500);
      }
      const expectedChatDigest = currentConversationAffinity ? prioritizedTask.chatDigest : await digest(identity);
      traceAutoReply('TARGET_SELECTED', { chatDigest: expectedChatDigest, outcome: 'SUCCESS', reason: currentConversationAffinity
        ? 'AI 生成期间会话未切换，已继续锁定当前消息面板。'
        : '已锁定当前处理会话。' });
      if (readyTask) traceAutoReply('READY_SNAPSHOT_REVALIDATION_STARTED', {
        chatDigest: readyTask.chatDigest, messageDigest: readyTask.messageDigest, taskId: readyTask.taskId,
        outcome: 'INFO', reason: '开始核对选中会话、最新消息摘要和消息方向；通过前不会申请发送租约。',
      });
      const second = await collectStableAutoReplySnapshot(target, expectedChatDigest);
      if (!second) return scheduleSingleAccountAutoReply(1_500);
      if (second.direction === 'OUTBOUND') {
        const pendingTasks = [...new Map([retryTask, queuedTask]
          .filter((task) => task?.taskId)
          .map((task) => [task.taskId, task])).values()];
        for (const task of pendingTasks) {
          if (task.messageDigest !== second.messageDigest) {
            try {
              await collectAndPublish(true, true);
              const discarded = await send({ type: 'BRIDGE_DISCARD_STALE_INBOUND_REPLY', payload: {
                taskId: task.taskId, chatDigest: task.chatDigest,
                messageDigest: task.messageDigest, currentMessageDigest: second.messageDigest,
                currentMessageAt: second.messageAt, currentMessageText: second.messageText,
                currentDirection: 'OUTBOUND', selectedUnread: false,
                conversationSignals: second.conversationSignals,
              } });
              if (!discarded?.ok) throw new Error(discarded?.error || '后端未确认旧任务作废');
            } catch (error) {
              singleAccountRetryLocateDeferrals.set(task.taskId, Date.now() + RETRY_TARGET_DEFER_MS);
              traceAutoReply('HR_REPLIED_TASK_RETIRE_FAILED', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: task.taskId,
                outcome: 'WAITING', reason: `HR 已回复，但旧待发送任务暂未能作废：${String(error?.message || error || '未知错误')}`,
              });
            }
          }
          removePendingPipelineTask(task.taskId);
          await reportSingleAccountResult(task, 'SILENT', 'HR 已在候选人回复后发出新消息，旧 AI 回复已安全作废。', {
            skipUnreadBaseline: true, skipSelectedMessageBaseline: true,
          });
        }
        singleAccountSelectedMessageBaseline.set(second.chatDigest, second.messageDigest);
        if (target instanceof HTMLElement) {
          singleAccountUnreadBaseline.set(second.chatDigest, await unreadRowSignature(target));
        }
        await persistSingleAccountBaseline();
        singleAccountPendingChatDigest = null;
        traceAutoReply('HR_LAST_MESSAGE_CONFIRMED', {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SKIPPED',
          reason: '稳定复核确认最后一条来自 HR；会话已回复，已终止旧任务并记录当前基线。',
        });
        return scheduleSingleAccountAutoReply(200);
      }
      if (readReviewTarget && !retryTask && !queuedTask) {
        const messageAt = Date.parse(second.messageAt);
        if (!Number.isFinite(messageAt) || Date.now() - messageAt > READ_REPLY_REVIEW_MAX_AGE_MS) {
          singleAccountSelectedMessageBaseline.set(second.chatDigest, second.messageDigest);
          if (target instanceof HTMLElement) {
            singleAccountUnreadBaseline.set(second.chatDigest, await unreadRowSignature(target));
          }
          await persistSingleAccountBaseline();
          singleAccountPendingChatDigest = null;
          traceAutoReply('READ_UNREPLIED_REVIEW_TOO_OLD', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SKIPPED',
            reason: '最后一条确认来自候选人，但已超过 30 天后端安全时间窗；已完成复核但不对历史会话自动补发。',
          });
          return scheduleSingleAccountAutoReply(200);
        }
        traceAutoReply('READ_UNREPLIED_REVIEW_INBOUND', {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SUCCESS',
          reason: '已读会话连续两次稳定确认最后一条来自候选人；正在补写最新列表与详情观测，再进入同一套 AI 和发送安全校验。',
        });
        await collectAndPublish(true, true);
      }
      if (retryTask) {
        if (second.messageDigest !== retryTask.messageDigest) {
          traceAutoReply('AI_RETRY_SKIPPED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: retryTask.taskId, outcome: 'SKIPPED', reason: '历史失败任务对应的消息摘要已变化，禁止使用旧任务重试。' });
          let staleTaskRetired = false;
          try {
            const discarded = await send({ type: 'BRIDGE_DISCARD_STALE_INBOUND_REPLY', payload: {
              taskId: retryTask.taskId, chatDigest: retryTask.chatDigest,
              messageDigest: retryTask.messageDigest, currentMessageDigest: second.messageDigest,
              currentMessageAt: second.messageAt, currentMessageText: second.messageText,
              selectedUnread: second.selectedUnread,
              conversationSignals: second.conversationSignals,
            } });
            if (!discarded?.ok) throw new Error(discarded?.error || '后端未确认旧任务作废');
            staleTaskRetired = true;
          } catch (error) {
            traceAutoReply('AI_RETRY_RETIRE_FAILED', {
              chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: retryTask.taskId,
              outcome: 'WAITING', reason: `旧任务未能写入作废回执：${String(error?.message || error || '未知错误')}`,
            });
          }
          if (!staleTaskRetired) {
            retryTask.nextPollAt = Date.now() + 3_000;
            singleAccountPendingChatDigest = null;
            return scheduleSingleAccountAutoReply(3_000);
          }
          removePendingPipelineTask(retryTask.taskId);
          await reportSingleAccountResult(retryTask, 'SILENT', '历史失败任务对应的消息已经变化，旧 AI 结果已作废。', {
            skipUnreadBaseline: true,
            skipSelectedMessageBaseline: true,
          });
          await enqueueLatestInboundAfterStaleTask(target, second, retryTask);
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(100);
        }
        const activeConversationForRetry = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const stableLastMessageForRetry = activeConversationForRetry
          ? [...activeConversationForRetry.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
          : null;
        const retryHasAttachment = Boolean(stableLastMessageForRetry?.querySelector('.message-card-wrap, .hyperLink, video, audio, [class*="attachment"], [class*="resume"]'));
        if (second.direction !== 'INBOUND' || !second.messageText || retryHasAttachment) {
          traceAutoReply('AI_RETRY_SKIPPED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: retryTask.taskId, outcome: 'SKIPPED', reason: retryHasAttachment ? '当前消息包含附件，交由简历链路处理，不重试文本回复。' : '当前消息不是可安全重试的候选人纯文本。' });
          removePendingPipelineTask(retryTask.taskId);
          await reportSingleAccountResult(second, 'SILENT', retryHasAttachment ? '当前消息包含附件，旧 AI 回复失败任务未重试。' : '当前消息不是候选人纯文本，旧 AI 回复失败任务未重试。');
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(300);
        }
        const retryResult = await send({ type: 'BRIDGE_RETRY_FAILED_INBOUND_REPLY', payload: {
          taskId: retryTask.taskId, chatDigest: second.chatDigest, messageDigest: second.messageDigest,
          messageText: second.messageText, conversationContext: second.conversationContext,
          messageAt: second.messageAt, selectedUnread: second.selectedUnread,
          conversationSignals: second.conversationSignals, observedAt: new Date().toISOString(),
        } });
        if (!retryResult?.ok) {
          const permanent = /(?:TARGET_CHANGED|DETAIL_REQUIRED|JOB_|RETRY_NOT_ALLOWED|RETRY_INPUT_INVALID|INTERVIEW_COMPLETED|OBSERVATION_NOT_FOUND|RETRY_READ_REQUIRED)/.test(`${retryResult?.code || ''} ${retryResult?.error || ''}`);
          traceAutoReply('AI_RETRY_REJECTED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: retryTask.taskId, outcome: permanent ? 'SKIPPED' : 'WAITING', reason: retryResult?.error || '安全重试请求暂未完成，保留任务等待下一轮。' });
          if (permanent) {
            removePendingPipelineTask(retryTask.taskId);
            await reportSingleAccountResult(second, 'SILENT', retryResult?.error || '当前会话未通过安全重试校验，旧任务未重试。');
          } else {
            retryTask.nextPollAt = Date.now() + 5_000;
          }
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(permanent ? 300 : 5_000);
        }
        retryTask.retryable = false;
        retryTask.nextPollAt = Date.now() + 500;
        enqueuePipelineTask(retryTask.taskId, 'ANALYSIS');
        traceAutoReply('AI_RETRY_REQUEUED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: retryTask.taskId, queueLane: 'ANALYSIS', outcome: 'SUCCESS', reason: '已使用当前会话最新正文重新进入 AI 队列；等待重新分析，不直接发送。' });
        if (![...singleAccountPendingReplies.values()].some((task) => task.retryable !== true
            && task.chatDigest === second.chatDigest)) {
          singleAccountPendingChatDigest = null;
        }
        return scheduleSingleAccountAutoReply(300);
      }
      if (queuedTask && second.messageDigest !== queuedTask.messageDigest) {
        traceAutoReply('STALE_TASK', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId, outcome: 'SKIPPED', reason: 'AI 分析期间候选人发送了新消息，旧任务已作废。' });
        let staleTaskRetired = false;
        try {
          const discarded = await send({ type: 'BRIDGE_DISCARD_STALE_INBOUND_REPLY', payload: {
            taskId: queuedTask.taskId, chatDigest: queuedTask.chatDigest,
            messageDigest: queuedTask.messageDigest, currentMessageDigest: second.messageDigest,
            currentMessageAt: second.messageAt, currentMessageText: second.messageText,
            selectedUnread: second.selectedUnread,
            conversationSignals: second.conversationSignals,
          } });
          if (!discarded?.ok) throw new Error(discarded?.error || '后端未确认旧任务作废');
          staleTaskRetired = true;
        } catch (error) {
          traceAutoReply('STALE_TASK_RETIRE_FAILED', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId,
            outcome: 'WAITING', reason: `旧任务尚未完成作废，保留等待重试：${String(error?.message || error || '未知错误')}`,
          });
        }
        if (!staleTaskRetired) {
          queuedTask.nextPollAt = Date.now() + 3_000;
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(3_000);
        }
        removePendingPipelineTask(queuedTask.taskId);
        // The visible row now contains a newer candidate message. Do not mark
        // that newer row as handled, otherwise the next scan would suppress it.
        await reportSingleAccountResult(queuedTask, 'SILENT', '候选人在 AI 分析期间发来了新消息，旧结果已作废且未发送。', {
          skipUnreadBaseline: true,
          skipSelectedMessageBaseline: true,
        });
        await enqueueLatestInboundAfterStaleTask(target, second, queuedTask);
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(100);
      }
      const activeConversation = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
      const stableLastMessage = activeConversation
        ? [...activeConversation.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
        : null;
      const containsStructuredAttachment = Boolean(stableLastMessage?.querySelector('.message-card-wrap, .hyperLink, video, audio, [class*="attachment"], [class*="resume"]'));
      const resumeReceiptTask = queuedTask?.resumeReceipt === true;
      if (!resumeReceiptTask && (second.direction !== 'INBOUND' || !second.messageText || containsStructuredAttachment)) {
        if (second.direction === 'INBOUND' && containsStructuredAttachment) {
          traceAutoReply('ATTACHMENT_DETECTED', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SUCCESS',
            reason: '当前最后一条稳定确认是候选人附件，直接进入简历导入；重复简历和收件回复由摘要去重与后置上下文校验处理。',
          });
          // Only the current stable attachment message can arm capture. A
          // historical resumeReceived signal never opens an old attachment.
          resumeCaptureRequest = { chatDigest: second.chatDigest, messageDigest: second.messageDigest };
          resumeAttachmentEpoch += 1;
          resumeAttachmentProcessing = true;
          resumePreviewOpenPending = true;
          resumePreviewOpenAttempts = 0;
          lastResumePdfImportOutcome = null;
          showResumeCaptureStatus('挂机：检测到候选人附件，锁定当前会话并开始简历处理。');
          scheduleResumeCardScan(0);
          try {
            const deadline = Date.now() + RESUME_ATTACHMENT_WAIT_MS;
            for (let attempt = 0; Date.now() < deadline; attempt++) {
              await delay(500);
              const outcome = lastResumePdfImportOutcome;
              if (outcome?.chatDigest === second.chatDigest) break;
              if (attempt === 8 || attempt === 20 || attempt === 35) scheduleResumeCardScan(0);
            }
            if (lastResumePdfImportOutcome?.chatDigest !== second.chatDigest
                && (resumePdfForwardInFlight || resumePdfBackendRequestsInFlight.size > 0)) {
              traceAutoReply('RESUME_UPLOAD_TERMINAL_WAITING', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING',
                reason: 'PDF 已捕获且正在上传后端；继续保持当前会话和预览，等待有界上传请求返回明确终态。',
              });
              if (resumePdfForwardInFlight) await resumePdfForwardInFlight.catch(() => null);
              await waitForResumePdfBackendTerminal();
            }
            if (lastResumePdfImportOutcome?.chatDigest !== second.chatDigest) {
              // Invalidate a late PDF capture before releasing the page lock.
              resumeAttachmentEpoch += 1;
              lastResumePdfImportOutcome = { ok: false, chatDigest: second.chatDigest, error: `简历捕获等待超过 ${Math.round(RESUME_ATTACHMENT_WAIT_MS / 1_000)} 秒，已释放自动回复队列。` };
              traceAutoReply('ATTACHMENT_TIMEOUT', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'FAILED', reason: lastResumePdfImportOutcome.error });
            }
          } catch (error) {
            resumeAttachmentEpoch += 1;
            lastResumePdfImportOutcome = { ok: false, chatDigest: second.chatDigest, error: `简历处理异常：${String(error?.message || error || '未知错误')}` };
            showResumeCaptureStatus(lastResumePdfImportOutcome.error, 'error');
          } finally {
            // Never leave the whole auto-reply loop locked by a failed DOM/API await.
            resumePreviewOpenPending = false;
            resumePreviewOpenAttempts = 0;
            clearTimeout(resumeCardScanTimer);
            resumeCardScanTimer = null;
            resumeAttachmentProcessing = false;
          }
          const outcome = lastResumePdfImportOutcome;
          traceAutoReply('ATTACHMENT_RESULT', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: outcome?.ok ? 'SUCCESS' : 'FAILED', reason: outcome?.ok ? `简历导入完成，AI 状态=${outcome.analysisStatus || '处理中'}。` : `简历导入未完成：${outcome?.error || '等待超时'}。` });
          // A timeout or backend failure can happen before the PDF forwarder
          // reaches its normal cleanup path. Release the current preview
          // before the queue advances, otherwise the modal blocks all later
          // list/detail observations.
          if (findVisibleResumeDialog()) {
            const previewClosed = await ensureResumePreviewClosedForAutoReply(second.chatDigest);
            if (!previewClosed) {
              traceAutoReply('RESUME_PREVIEW_CLOSE_WAITING', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING',
                reason: '简历处理后的预览窗口暂未确认关闭，等待下一轮自动重试。',
              });
              resumeCaptureRequest = null;
              return scheduleSingleAccountAutoReply(3_000);
            }
            if (outcome?.chatDigest === second.chatDigest && outcome.error === '简历已导入，但预览窗口未确认关闭') {
              outcome.ok = true;
              outcome.error = '';
            }
          }
          if (outcome?.chatDigest === second.chatDigest && outcome.ok) {
            const receiptSnapshot = await collectStableResumeReceiptSnapshot(second.chatDigest);
            if (!receiptSnapshot) {
              traceAutoReply('RESUME_RECEIPT_SNAPSHOT_UNSTABLE', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest,
                outcome: 'WAITING', reason: '简历导入成功，但关闭预览后的末条消息未稳定保持为该简历附件；不使用旧摘要创建回执。',
              });
              await reportSingleAccountResult(second, 'SILENT', '简历已导入；收件回执等待最新会话稳定后由消息链路继续处理。', {
                skipUnreadBaseline: true, skipSelectedMessageBaseline: true,
              });
            } else {
              if (receiptSnapshot.messageDigest !== second.messageDigest) traceAutoReply('RESUME_RECEIPT_DIGEST_REFRESHED', {
                chatDigest: second.chatDigest, messageDigest: receiptSnapshot.messageDigest,
                outcome: 'SUCCESS', reason: 'BOSS 简历卡片重绘后摘要已变化，已改用关闭预览后的稳定摘要创建收件回执。',
              });
              const receipt = await queueResumeAttachmentReceipt(receiptSnapshot, outcome.intakeId);
              if (receipt.duplicate) {
                await reportSingleAccountResult(receiptSnapshot, 'SILENT', '该简历附件消息已经登记过收件确认，未重复发送。');
              } else if (!receipt.queued) {
                await reportSingleAccountResult(receiptSnapshot, 'SILENT',
                  `候选人附件简历已导入，但收件确认未入队：${receipt.error || '未知原因'}。`);
              }
            }
          } else {
            await reportSingleAccountResult(second, 'SILENT',
              `候选人附件不需要文本回复；简历导入${outcome?.error ? `未完成：${outcome.error}` : '等待超时，已保留状态供后续重试'}。`);
          }
          resumeCaptureRequest = null;
        } else {
          traceAutoReply('NON_TEXT_MESSAGE', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SKIPPED', reason: '最后一条内容不是可安全处理的候选人纯文本。' });
          await reportSingleAccountResult(second, 'SILENT', '最后一条内容不是可安全处理的候选人纯文本，未回复。');
        }
        if (![...singleAccountPendingReplies.values()].some((task) => task.retryable !== true
            && task.chatDigest === second.chatDigest)) {
          singleAccountPendingChatDigest = null;
        }
        return scheduleSingleAccountAutoReply(1_500);
      }
      if (second.conversationSignals?.interviewScheduled === true) {
        traceAutoReply('INTERVIEW_HANDOFF', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SKIPPED', reason: '该会话已约面试，交由 HR 跟进。' });
        await reportSingleAccountResult(second, 'SILENT', '该会话已约面试，后续消息交由 HR 跟进，不再自动回复。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      const controls = findReplyControls();
      if (!controls.editor || readEditorText(controls.editor).trim()) {
        traceAutoReply(queuedTask ? 'READY_EDITOR_WAITING' : 'EDITOR_WAITING', {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null,
          outcome: 'WAITING', reason: !controls.editor
            ? '待发送会话已定位，但暂未找到可见回复输入框，3 秒后保持原任务重新读取 DOM。'
            : '回复输入框已有内容，为避免覆盖 HR 草稿，保持待发送任务并等待输入框恢复为空。',
        });
        return scheduleSingleAccountAutoReply(3_000);
      }
      if (queuedTask) traceAutoReply('READY_EDITOR_CONFIRMED', {
        chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId,
        outcome: 'SUCCESS', reason: '已确认唯一可写回复输入框为空，准备申请一次性发送租约。',
      });
      let decision = queuedDecision;
      if (!decision) {
        const pending = [...singleAccountPendingReplies.values()].find(task =>
          task.chatDigest === second.chatDigest && task.messageDigest === second.messageDigest);
        if (pending) {
          traceAutoReply('AI_EXISTING_TASK_WAITING', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: pending.taskId,
            outcome: 'WAITING', reason: '同一消息已有任务，保留查询时间；下一轮优先查询结果，不重复提交分析。',
          });
          return scheduleSingleAccountAutoReply(Math.max(100, Math.min(5_000,
            Number(pending.nextPollAt || 0) - Date.now())));
        }
        traceAutoReply('AI_REQUESTED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, queueLane: 'ANALYSIS', outcome: 'INFO', reason: '已向后端提交候选人消息分析请求。' });
        const selectedRowAtQueue = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
        const pendingRowSignature = selectedRowAtQueue && hasUnread(selectedRowAtQueue)
          ? await unreadRowSignature(selectedRowAtQueue) : null;
        const replyResult = await send({ type: 'BRIDGE_DECIDE_INBOUND_REPLY', payload: {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, messageText: second.messageText,
          conversationContext: second.conversationContext,
          messageAt: second.messageAt, selectedUnread: second.selectedUnread,
          conversationSignals: second.conversationSignals, observedAt: new Date().toISOString(), continuous: true,
          pendingRowSignature,
        } });
        if (!replyResult?.ok) {
          const bridgeConflict = /^(?:INBOUND_REPLY_(?:SNAPSHOT_STALE|DETAIL_REQUIRED|TARGET_CHANGED)|OBSERVATION_)/.test(replyResult?.code || '')
            || /最新稳定列表|会话快照|观测/.test(replyResult?.error || '');
          traceAutoReply(bridgeConflict ? 'BRIDGE_OBSERVATION_CONFLICT' : 'AI_REQUEST_FAILED', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest,
            outcome: bridgeConflict ? 'WAITING' : 'FAILED', reason: `${replyResult?.code ? `[${replyResult.code}] ` : ''}${replyResult?.error || '扩展后台未返回有效 AI 分析结果。'}`,
          });
          if (bridgeConflict) {
            // Refresh the authoritative two-pass snapshot before retrying. The
            // backend still enforces device/detail freshness; this only repairs
            // a stale bridge observation and never bypasses that gate.
            traceAutoReply('BRIDGE_REFRESH_REQUESTED', {
              chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING', reason: '快照冲突，先重新采集稳定会话列表和详情。',
            });
            try {
              const refreshStarted = !collecting && !autoReplyArm;
              await collectAndPublish(true, true);
              traceAutoReply('BRIDGE_REFRESH_COMPLETED', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: refreshStarted ? 'INFO' : 'WAITING', reason: refreshStarted ? '已执行稳定快照刷新，下一轮将重新提交分析。' : '页面快照当前被其他只读任务占用，下一轮继续刷新。',
              });
            } catch (refreshError) {
              traceAutoReply('BRIDGE_REFRESH_FAILED', {
                chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING', reason: `稳定快照刷新失败：${String(refreshError?.message || refreshError || '未知错误')}`,
              });
            }
            return scheduleSingleAccountAutoReply(1_500);
          }
          return scheduleSingleAccountAutoReply(5_000);
        }
        if (replyResult.processing) {
          const waitMs = Math.min(10_000, Math.max(1_000, Number(replyResult.retryAfterMs || 2_000)));
          traceAutoReply(replyResult.processingState === 'WAITING_SEND' ? 'MESSAGE_SEND_RECOVERY_WAITING' : 'MESSAGE_CLAIM_RECOVERY_WAITING', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING',
            reason: replyResult.processingState === 'WAITING_SEND'
              ? '该消息已生成回复但尚未确认发送，正在恢复后端待发送任务，不视为已完成。'
              : '该消息上一轮领取尚未完成任务绑定，保留消息并等待安全恢复。',
          });
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(waitMs);
        }
        if (replyResult.pending && replyResult.taskId) {
          rememberPendingReply(replyResult, second, pendingRowSignature);
          const keepCurrentConversation = replyResult.resumeReceipt === true;
          singleAccountPendingChatDigest = keepCurrentConversation ? second.chatDigest : null;
          const processingCount = singleAccountPendingReplies.size;
          traceAutoReply(replyResult.recovered ? 'AI_TASK_RECOVERED' : 'AI_QUEUED', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: replyResult.taskId,
            queueLane: 'ANALYSIS',
            queuePosition: processingCount, outcome: 'WAITING',
            reason: keepCurrentConversation
              ? `简历收件回复正在生成（AI 并发任务 ${processingCount}/3），保持当前会话以优先发送。`
              : `AI 并发处理中（${processingCount}/3）；当前会话快照已冻结，继续提交预取窗口中的其他消息。`,
          });
          return scheduleSingleAccountAutoReply(100);
        }
        decision = replyResult.decision;
        traceAutoReply(decision?.replyAllowed ? 'AI_READY' : 'SAFETY_SILENT', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, queueLane: decision?.replyAllowed ? 'SEND' : 'TERMINAL', outcome: decision?.replyAllowed ? 'SUCCESS' : 'SKIPPED', reason: decision?.replyAllowed ? 'AI 返回允许生成回复。' : decision?.reason || 'AI 返回无需自动回复。' });
      }
      if (!singleAccountAutoReplyEnabled) {
        traceAutoReply('STOPPED_BEFORE_SEND', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'STOPPED', reason: 'HR 在 AI 判定期间停止了自动回复。' });
        await reportSingleAccountResult(second, 'SILENT', 'HR 已在判定期间停止持续回复，未写入或发送。');
        singleAccountPendingChatDigest = null;
        return;
      }
      if (!decision?.replyAllowed || !decision.content) {
        if (decision?.category === 'DISABLED') {
          traceAutoReply('DECISION_BLOCKED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'BLOCKED', reason: decision.reason || '安全限制已触发。' });
          return void await haltSingleAccountAutoReply(`持续回复已停止：${decision.reason || '安全限制已触发。'}`);
        }
        if (decision?.category === 'RATE_LIMIT') {
          traceAutoReply('DECISION_RATE_LIMIT_WAITING', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'WAITING', reason: decision.reason || '触发频率限制，60 秒后继续。' });
          return scheduleSingleAccountAutoReply(60_000);
        }
        traceAutoReply('DECISION_SILENT', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'SKIPPED', reason: decision?.reason || '消息不符合自动回复条件。' });
        if (decision?.category !== 'DUPLICATE') {
          const reason = decision?.reason || '消息不符合自动回复条件。';
          // This synchronous branch is only used for terminal pre-checks; AI
          // failures return a task status with an explicit retryEligible flag.
          await reportSingleAccountResult(second, 'SILENT', reason);
        } else if (decision.terminal === true) {
          // The message was already claimed in a previous run. Persist the
          // current message and row signatures for every entry path so the
          // active conversation does not loop on the same terminal result.
          singleAccountSelectedMessageBaseline.set(second.chatDigest, second.messageDigest);
          if (target instanceof HTMLElement) {
            singleAccountUnreadBaseline.set(second.chatDigest, await unreadRowSignature(target));
          }
          await persistSingleAccountBaseline();
        }
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      let sendLease = null;
      if (queuedTask) {
        if (queuedTask.recoveredSend === true) {
          traceAutoReply('RECOVERED_SEND_SNAPSHOT_REFRESH', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId,
            outcome: 'WAITING', reason: '后端待发送任务已恢复；先刷新当前列表与详情观测，再申请一次性发送租约。',
          });
          await collectAndPublish(true, true);
          await waitForCollectionIdle(2_500);
        }
        traceAutoReply('SEND_LEASE_REQUESTED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId, queueLane: 'SEND', outcome: 'INFO', reason: '已向后端申请一次性发送租约。' });
        const beforeStateDigest = await digest(`${second.chatDigest}|${second.messageDigest}|EMPTY_EDITOR|READY_TO_FILL`);
        const claim = await send({ type: 'BRIDGE_CLAIM_INBOUND_REPLY_SEND', payload: {
          taskId: queuedTask.taskId, chatDigest: second.chatDigest,
          messageDigest: second.messageDigest, beforeStateDigest, messageAt: second.messageAt,
          messageText: second.messageText, selectedUnread: second.selectedUnread,
          conversationSignals: second.conversationSignals,
          observedAt: new Date().toISOString(),
        } });
        if (!claim?.available || !claim.leaseToken || !claim.content || !claim.replyDigest) {
          const claimReason = claim?.reason || claim?.error || '后端未返回可用发送租约。';
          traceAutoReply('SEND_LEASE_UNAVAILABLE', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId, queueLane: 'SEND', outcome: claim?.status === 'READY' || claim?.ok === false ? 'WAITING' : 'BLOCKED', reason: claimReason });
          if (claim?.ok === false) {
            queuedTask.nextPollAt = Date.now() + 5_000;
            singleAccountPendingChatDigest = null;
            return scheduleSingleAccountAutoReply(5_000);
          }
          if (claim?.status === 'READY') {
            const rateLimited = String(claim.reason || '').includes('发送安全上限');
            queuedTask.nextPollAt = Date.now() + (rateLimited ? 60_000 : 10_000);
            await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE', payload: {
              state: claim.reason || '后端自动发送总开关已关闭，任务继续保留等待。',
              disable: false, observedAt: new Date().toISOString(),
            } });
            singleAccountPendingChatDigest = null;
            return scheduleSingleAccountAutoReply(5_000);
          }
          removePendingPipelineTask(queuedTask.taskId);
          await reportSingleAccountResult(second, claim?.status === 'SKIPPED' ? 'SILENT' : 'UNKNOWN', claim?.reason || 'AI 回复发送租约不可用，已禁止重试。');
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(1_000);
        }
        if (await digest(claim.content) !== claim.replyDigest) {
          traceAutoReply('LEASE_CONTENT_MISMATCH', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask.taskId, queueLane: 'SEND', outcome: 'FAILED', reason: '租约回复内容摘要不一致，已禁止写入和发送。' });
          sendLease = { ...claim, beforeStateDigest };
          await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|CONTENT_DIGEST_MISMATCH`, '租约回复内容摘要不一致，未写入且未发送。');
          removePendingPipelineTask(queuedTask.taskId);
          await reportSingleAccountResult(second, 'SILENT', '租约内容校验失败，未发送。');
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(1_000);
        }
        sendLease = { ...claim, beforeStateDigest };
        decision = { ...decision, content: claim.content };
      }
      const replyText = compact(decision.content);
      if (!replyText || replyText.length > 200) {
        traceAutoReply('REPLY_INVALID', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'FAILED', reason: '后端返回的回复为空或超过 200 字。' });
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|INVALID_REPLY_LENGTH`, '租约内容为空或超过 200 字，未发送。');
        await reportSingleAccountResult(second, 'SILENT', '后端没有返回可发送的安全短回复。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      writeEditorText(controls.editor, replyText);
      await delay(350);
      if (readEditorText(controls.editor).trim() !== replyText) {
        traceAutoReply('DRAFT_FILL_FAILED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null, queueLane: 'SEND', outcome: 'FAILED', reason: '安全短回复未稳定写入输入框。' });
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|DRAFT_FILL_FAILED`, '安全短回复未稳定写入，未发送。');
        await reportSingleAccountResult(second, 'SILENT', '安全短回复未稳定写入，已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(2_000);
      }
      traceAutoReply('DRAFT_FILLED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null, queueLane: 'SEND', outcome: 'SUCCESS', reason: '安全短回复已稳定写入输入框。' });
      let filledControls = findReplyControls();
      for (let attempt = 0; attempt < 5 && (!filledControls.sendButton || filledControls.sendButtonCount !== 1); attempt++) {
        await delay(200);
        filledControls = findReplyControls();
      }
      const beforeSend = await collectSelectedConversation();
      if (filledControls.editor !== controls.editor || !filledControls.sendButton || filledControls.sendButtonCount !== 1
          || !beforeSend.ok || beforeSend.chatDigest !== second.chatDigest
          || beforeSend.messageDigest !== second.messageDigest || beforeSend.direction !== 'INBOUND') {
        traceAutoReply('PRE_SEND_BLOCKED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'BLOCKED', reason: !filledControls.sendButton || filledControls.sendButtonCount !== 1 ? '写入草稿后未找到唯一可用发送按钮。' : '发送前会话或消息状态发生变化。' });
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|PRE_SEND_REVALIDATION_FAILED`, '发送前页面或会话状态变化，未点击发送。');
        await reportSingleAccountResult(second, 'SILENT', '发送前页面或会话状态发生变化，已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(2_000);
      }
      if (!singleAccountAutoReplyEnabled) {
        traceAutoReply('STOPPED_BEFORE_SEND', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, outcome: 'STOPPED', reason: '发送前自动回复开关已关闭。' });
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|STOPPED_BEFORE_SEND`, 'HR 在发送前停止持续回复，未点击发送。');
        await reportSingleAccountResult(second, 'SILENT', 'HR 已在发送前停止持续回复，草稿已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return;
      }
      traceAutoReply('PRE_SEND_REVALIDATED', {
        chatDigest: second.chatDigest, messageDigest: second.messageDigest,
        taskId: queuedTask?.taskId || null, queueLane: 'SEND', outcome: 'SUCCESS',
        reason: '发送前已重新核对会话摘要、最新消息摘要、候选人方向与唯一发送按钮。',
      });
      const activeBeforeClick = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
      const receiptAnchors = activeBeforeClick ? readConversationTurns(activeBeforeClick).slice(-3) : [];
      const outboundBeforeClick = activeBeforeClick
        ? [...activeBeforeClick.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item) === 'OUTBOUND')
        : [];
      const outboundBeforeIdentities = new Set(outboundBeforeClick.map(stableIdentity).filter(Boolean));
      const outboundBeforeCount = outboundBeforeClick.length;
      if (sendLease && queuedTask) {
        const staged = await send({ type: 'BRIDGE_STAGE_SEND_RECONCILIATION', payload: {
          taskId: queuedTask.taskId, leaseToken: sendLease.leaseToken,
          chatDigest: second.chatDigest, messageDigest: second.messageDigest,
          replyDigest: await digest(replyText), outboundBeforeCount,
          outboundBeforeIdentitiesComplete: outboundBeforeIdentities.size === outboundBeforeCount
            && outboundBeforeCount <= 100,
          outboundBeforeIdentityDigests: await Promise.all(
            [...outboundBeforeIdentities].slice(-100).map((identity) => digest(identity))),
        } });
        if (!staged?.ok || !staged.task) {
          writeEditorText(controls.editor, '');
          await receiptInboundReplySend(sendLease, 'FAILED',
            `${second.chatDigest}|${second.messageDigest}|SEND_EVIDENCE_NOT_PERSISTED`,
            '发送前证据未能持久化，未点击发送。');
          traceAutoReply('SEND_EVIDENCE_BLOCKED', {
            chatDigest: second.chatDigest, messageDigest: second.messageDigest,
            taskId: queuedTask.taskId, queueLane: 'SEND', outcome: 'BLOCKED',
            reason: '发送前无法保存重启后复核证据，已清空草稿且未点击。',
          });
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(2_000);
        }
        singleAccountUnknownReconciliations.set(queuedTask.taskId, { ...staged.task, nextCheckAt: Date.now() + 10_000 });
      }
      filledControls.sendButton.click();
      traceAutoReply('SEND_CLICKED', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null, queueLane: 'SEND', outcome: 'INFO', reason: '已点击唯一可用发送按钮，开始等待页面回执。' });
      let confirmed = false;
      let confirmationMode = 'STRICT';
      let confirmationDiagnostic = `发送前出站消息=${outboundBeforeCount}`;
      for (let attempt = 0; attempt < 28; attempt++) {
        await delay(attempt < 8 ? 250 : 500);
        const current = await collectPostSendConversation(second.chatDigest, activeBeforeClick, receiptAnchors);
        if (current.ok && current.chatDigest !== second.chatDigest) {
          confirmationDiagnostic = '等待回执期间选中会话发生变化';
          break;
        }
        if (!current.ok) {
          confirmationDiagnostic = `第 ${attempt + 1} 次复核时会话详情暂不可读（${current.code || 'UNKNOWN'}）`;
          continue;
        }
        const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const messages = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)) : [];
        const outbound = messages.filter((item) => directionOf(item) === 'OUTBOUND');
        const last = messages.at(-1) || null;
        const nextControls = findReplyControls();
        const editorCleared = Boolean(nextControls.editor && !readEditorText(nextControls.editor).trim());
        const lastOutbound = outbound.at(-1);
        const lastOutboundIdentity = lastOutbound && stableIdentity(lastOutbound);
        const exactNewOutbound = current.direction === 'OUTBOUND'
          && current.messageDigest !== second.messageDigest
          && lastOutbound && cleanOutboundReplyText(lastOutbound) === replyText
          && ((lastOutboundIdentity && !outboundBeforeIdentities.has(lastOutboundIdentity))
            || outbound.length > outboundBeforeCount);
        confirmationDiagnostic = `出站消息=${outbound.length}/${outboundBeforeCount}，输入框=${editorCleared ? '空' : '非空'}，最后方向=${directionOf(last) || 'UNKNOWN'}，消息摘要变化=${current.messageDigest !== second.messageDigest}`;
        if (editorCleared && exactNewOutbound) {
          confirmed = true;
          confirmationMode = 'OUTBOUND_DELTA';
          break;
        }
      }
      let receipt = sendLease ? await receiptInboundReplySend(sendLease, confirmed ? 'SUCCEEDED' : 'UNKNOWN',
        `${second.chatDigest}|${second.messageDigest}|${confirmed ? 'OUTBOUND_CONFIRMED' : 'SEND_RESULT_UNCONFIRMED'}|${await digest(replyText)}`,
        confirmed ? '页面已确认输入框清空且出现新增的相同出站回复。'
          : `已点击一次发送，但页面结果无法确认；禁止重试。${confirmationDiagnostic}`) : null;
      // A lost bridge response must not leave the backend lease CLAIMED for
      // the full 45-second expiry window. Retry the idempotent receipt once;
      // this never retries the BOSS send click itself.
      if (sendLease && !confirmed && !receipt?.status) {
        await delay(300);
        const retryReceipt = await receiptInboundReplySend(sendLease, 'UNKNOWN',
          `${second.chatDigest}|${second.messageDigest}|SEND_RESULT_UNCONFIRMED|${await digest(replyText)}`,
          `SEND_CONFIRMATION_UNKNOWN：回执响应超时，已重试一次回执提交。${confirmationDiagnostic}`);
        if (retryReceipt?.status) receipt = retryReceipt;
      }
      if (sendLease && receipt?.status !== 'SUCCEEDED') {
        confirmed = false;
        traceAutoReply('SEND_RECONCILIATION_STARTED', {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null,
          queueLane: 'SEND', outcome: 'WAITING',
          reason: '页面回执尚未明确成功，延迟复核同一会话是否出现与租约正文完全一致的新出站消息。',
        });
        traceAutoReply('SEND_RECONCILIATION_DEFERRED', {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null,
          queueLane: 'REVALIDATION', outcome: 'WAITING',
          reason: '已提交 UNKNOWN 终态；延迟只读复核移到低优先级队列，不再占用当前发送循环。',
        });
      }
      if (sendLease && confirmed && queuedTask) await clearPendingSendReconciliation(queuedTask.taskId);
      traceAutoReply(confirmed ? 'SEND_CONFIRMED' : 'SEND_UNKNOWN', { chatDigest: second.chatDigest, messageDigest: second.messageDigest, taskId: queuedTask?.taskId || null, queueLane: 'SEND', outcome: confirmed ? 'SUCCESS' : 'UNKNOWN', reason: confirmed
        ? confirmationMode === 'DELAYED_EXACT' ? '延迟复核确认新增的相同出站消息。' : '页面已确认新增的相同出站消息。'
        : `已点击发送，但页面未能确认结果；为避免重复发送不会重试。${confirmationDiagnostic}` });
      await reportSingleAccountResult(second, confirmed ? 'SENT' : 'UNKNOWN', confirmed
        ? `已识别为${decision.category}并发送一条岗位事实回复。`
        : `SEND_CONFIRMATION_UNKNOWN：已点击一次发送，但页面结果无法确认；该消息不会自动重试。${confirmationDiagnostic}`);
      singleAccountPendingChatDigest = null;
      if (queuedTask) removePendingPipelineTask(queuedTask.taskId, queuedTask.chatDigest);
      scheduleSingleAccountAutoReply(2_000);
    } catch (error) {
      singleAccountPendingChatDigest = null;
      traceAutoReply('LOOP_EXCEPTION', { outcome: 'FAILED', reason: String(error?.message || error || '未知异常') });
      try {
        await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE', payload: {
          state: `持续回复本轮出现可恢复异常：${compact(error?.message || error || '未知错误').slice(0, 220)}，稍后继续扫描。`,
          disable: false, observedAt: new Date().toISOString(),
        } });
      } catch (_stateError) {
        // Keep the page loop alive even if the diagnostic state cannot be sent.
      }
      scheduleSingleAccountAutoReply(3_000);
    } finally {
      autoReplyBusy = false;
      autoReplyTraceRunId = '';
      autoReplyTraceRunStartedAt = 0;
      if (runGeneration === autoReplyGeneration
          && singleAccountAutoReplyEnabled && !singleAccountAutoReplyTimer) scheduleSingleAccountAutoReply(2_000);
    }
  }

  async function collectAndPublish(reportNonChat, allowDuringAutoReply = false) {
    if (collecting) return;
    if (autoReplyArm) return;
    if (autoReplyBusy && !allowDuringAutoReply) { scheduleCollect(800); return; }
    collecting = true;
    try {
      const page = classifyPage();
      if (!page.ok) {
        if (reportNonChat || ['RISK_OR_VERIFICATION', 'LOGIN_REQUIRED'].includes(page.code)) {
          await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: page });
        }
        return;
      }
      const first = await collectSnapshot();
      if (!first.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: first });
      await delay(900);
      const second = await collectSnapshot();
      if (!second.ok) return void await send({ type: 'BRIDGE_PAGE_BLOCKED', payload: second });
      if (first.signature !== second.signature) return;
      const firstSelected = await collectSelectedConversation();
      await delay(250);
      const secondSelected = await collectSelectedConversation();
      const stableSelected = firstSelected.ok && secondSelected.ok && firstSelected.signature === secondSelected.signature ? secondSelected : null;
      const selected = stableSelected && second.entries.some((entry) => entry.chatDigest === stableSelected.chatDigest) ? stripSelected(stableSelected) : null;
      const detailStatus = selected
        ? { code: 'VERIFIED', reason: '当前会话详情已稳定识别。' }
        : stableSelected
          ? { code: 'SELECTED_NOT_IN_LIST', reason: '当前会话不属于本次稳定列表，等待再次确认。' }
          : !firstSelected.ok
            ? { code: firstSelected.code, reason: firstSelected.reason }
            : !secondSelected.ok
              ? { code: secondSelected.code, reason: secondSelected.reason }
              : { code: 'DETAIL_CHANGED', reason: '当前会话详情仍在变化，等待稳定。' };
      await send({ type: 'BRIDGE_PAGE_SNAPSHOT', payload: { pageState: 'CHAT_PAGE_READY', entries: second.entries, selected, detailStatus } });
    } finally {
      collecting = false;
    }
  }

  async function collectJobsAndPublish(allowEmbeddedJobList, refreshRequested = false) {
    if (collecting) return { ok: false, error: '页面正在生成另一份稳定快照，请稍后重试。' };
    collecting = true;
    try {
      const page = classifyJobPage(allowEmbeddedJobList);
      if (!page.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: page }); return { ok: false, error: page.reason }; }
      const collectCurrentJobPage = isJobDetailPage() ? collectJobDetailSnapshot : collectJobSnapshot;
      const first = await collectCurrentJobPage();
      if (!first.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: first }); return { ok: false, error: first.reason }; }
      await delay(900);
      const second = await collectCurrentJobPage();
      if (!second.ok) { await send({ type: 'BRIDGE_JOB_BLOCKED', payload: second }); return { ok: false, error: second.reason }; }
      if (first.signature !== second.signature) return { ok: false, error: '职位列表仍在变化，请等待页面稳定后重试。' };
      const response = await send({ type: 'BRIDGE_JOB_SNAPSHOT', payload: { pageState: 'JOB_MANAGEMENT_READY', entries: second.entries, observedAt: new Date().toISOString(), scope: second.scope, authoritative: second.authoritative, refreshRequested } });
      scheduleJobClosureConfirmation(second, response);
      return response?.ok ? response : { ok: false, pageMatched: true, error: response?.error || '本地服务未接受职位快照。' };
    } finally { collecting = false; }
  }

  function scheduleJobClosureConfirmation(snapshot, response) {
    if (response?.skipped) return;
    if (!snapshot.authoritative || !response?.ok) {
      clearTimeout(jobConfirmationTimer);
      jobConfirmationTimer = null;
      pendingJobConfirmationSignature = '';
      return;
    }
    if (pendingJobConfirmationSignature === snapshot.signature) {
      pendingJobConfirmationSignature = '';
      return;
    }
    clearTimeout(jobConfirmationTimer);
    pendingJobConfirmationSignature = snapshot.signature;
    jobConfirmationTimer = setTimeout(() => {
      jobConfirmationTimer = null;
      if (!document.hidden && pendingJobConfirmationSignature === snapshot.signature) void collectJobsAndPublish(false);
    }, 12_000);
  }

  async function collectReplyReadiness() {
    if (collecting) return { ok: false, error: '页面正在生成只读快照，请稍后重试。' };
    collecting = true;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const page = classifyPage();
        if (!page.ok) return { ok: false, error: page.reason };
        const selected = await collectSelectedConversation();
        if (!selected.ok) return { ok: false, error: selected.reason };
        const { editor, sendButton } = findReplyControls();
        if (!editor || !visible(editor) || editor.disabled || editor.getAttribute('aria-disabled') === 'true') return { ok: false, error: '当前会话未找到可见的 BOSS 回复编辑器（#boss-chat-editor-input），已停止验收。' };
        const controlShape = [editor.id || 'fallback-editor', editor.tagName, editor.getAttribute('role') || '', editor.getAttribute('contenteditable') || '', sendButton ? `${sendButton.tagName}:发送` : 'ENTER_TO_SEND'].join('|');
        samples.push({ chatDigest: selected.chatDigest, controlDigest: await digest(controlShape) });
        if (cycle < 2) await delay(400);
      }
      if (!samples.every((item) => item.chatDigest === samples[0].chatDigest && item.controlDigest === samples[0].controlDigest)) {
        return { ok: false, error: '当前会话或回复入口在检查期间发生变化，已停止验收。' };
      }
      return { ok: true, readiness: { actionType: 'SEND_MESSAGE', chatDigest: samples[0].chatDigest, controlDigest: samples[0].controlDigest, pageState: 'CHAT_PAGE_READY', selectedConversationVerified: true, hasRiskOrVerification: false, stableCycles: 3 } };
    } finally { collecting = false; }
  }

  async function fillTestDraft() {
    if (collecting) return { ok: false, error: '页面正在生成只读快照，请稍后重试。' };
    collecting = true;
    try {
      const page = classifyPage();
      if (!page.ok) return { ok: false, error: page.reason };
      const first = await collectSelectedConversation();
      if (!first.ok) return { ok: false, error: first.reason };
      if (first.selectedUnread) return { ok: false, error: '当前会话仍标记为未读；草稿测试只允许已读会话。' };
      const firstControls = findReplyControls();
      if (!firstControls.editor) return { ok: false, error: '当前会话未找到可见且可编辑的回复输入框。' };
      if (readEditorText(firstControls.editor).trim()) return { ok: false, error: '当前输入框已有内容，为避免覆盖 HR 草稿已停止写入。' };
      const firstControlDigest = await digest(replyControlShape(firstControls));

      await delay(400);
      const second = await collectSelectedConversation();
      if (!second.ok || second.signature !== first.signature || second.selectedUnread) {
        return { ok: false, error: '当前会话状态在检查期间发生变化，已停止草稿写入。' };
      }
      const secondControls = findReplyControls();
      if (!secondControls.editor || readEditorText(secondControls.editor).trim()) {
        return { ok: false, error: '回复输入框在检查期间发生变化或已有内容，已停止草稿写入。' };
      }
      const secondControlDigest = await digest(replyControlShape(secondControls));
      if (firstControlDigest !== secondControlDigest) return { ok: false, error: '回复入口结构仍在变化，已停止草稿写入。' };

      writeEditorText(secondControls.editor, TEST_DRAFT_TEXT);
      await delay(250);
      const filledText = readEditorText(secondControls.editor).trim();
      if (filledText !== TEST_DRAFT_TEXT) return { ok: false, error: '页面未稳定保留测试草稿；未触发发送。' };
      const after = await collectSelectedConversation();
      if (!after.ok || after.chatDigest !== second.chatDigest || after.selectedUnread) {
        return { ok: false, error: '草稿写入后会话状态发生变化；未触发发送，请由 HR 检查页面。' };
      }
      return {
        ok: true,
        draftTest: {
          actionType: 'DRAFT_FILL_TEST', chatDigest: second.chatDigest, controlDigest: secondControlDigest,
          draftDigest: await digest(TEST_DRAFT_TEXT), filledLength: TEST_DRAFT_TEXT.length,
          selectedUnread: false, stableCycles: 2, sendTriggered: false,
        },
      };
    } finally { collecting = false; }
  }

  async function prepareCurrentSendTest() {
    if (!await waitForCollectionIdle(4_000)) return { ok: false, error: '页面只读快照持续占用超过 4 秒，未准备新的发送测试。' };
    collecting = true;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 2; cycle++) {
        const page = classifyPage();
        if (!page.ok) return { ok: false, error: page.reason };
        const selected = await collectSelectedConversation();
        if (!selected.ok) return { ok: false, error: selected.reason };
        if (selected.selectedUnread) return { ok: false, error: '当前会话仍标记为未读；发送测试只允许已读会话。' };
        const controls = findReplyControls();
        if (!controls.editor || readEditorText(controls.editor).trim()) return { ok: false, error: '当前会话输入框不是空白状态，禁止准备新的发送测试。' };
        samples.push({ chatDigest: selected.chatDigest, signature: selected.signature, controlDigest: await digest(replyControlShape(controls)) });
        if (cycle === 0) await delay(400);
      }
      if (!samples.every((sample) => sample.chatDigest === samples[0].chatDigest && sample.signature === samples[0].signature && sample.controlDigest === samples[0].controlDigest)) {
        return { ok: false, error: '当前会话或回复入口在准备期间发生变化，未开放发送测试。' };
      }
      return { ok: true, context: { actionType: 'CURRENT_SEND_TEST_PREPARATION', chatDigest: samples[0].chatDigest, controlDigest: samples[0].controlDigest, selectedUnread: false, editorEmpty: true, repeatManuallyAuthorized: true, stableCycles: 2 } };
    } finally { collecting = false; }
  }

  async function sendCurrentTestDraft(expectedChatDigest) {
    // Opening the extension while the page observer is finishing its regular
    // read-only snapshot must not make the one-shot test fail spuriously.
    // This wait happens strictly before any send checks or click; it is not a
    // retry after a send attempt.
    if (!await waitForCollectionIdle(4_000)) {
      return { ok: false, error: '页面只读快照持续占用超过 4 秒，已停止发送测试；未点击发送。' };
    }
    collecting = true;
    let clickTriggered = false;
    let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const page = classifyPage();
        if (!page.ok) return { ok: false, error: page.reason };
        const selected = await collectSelectedConversation();
        if (!selected.ok) return { ok: false, error: selected.reason };
        if (!/^[a-f0-9]{64}$/.test(expectedChatDigest || '') || selected.chatDigest !== expectedChatDigest) return { ok: false, error: '当前会话与本次准备授权不一致，已停止发送测试。' };
        if (selected.selectedUnread) return { ok: false, error: '当前会话仍标记为未读；单次发送测试只允许已读会话。' };
        const controls = findReplyControls();
        if (!controls.editor || !controls.sendButton || controls.sendButtonCount !== 1) return { ok: false, error: `当前会话没有唯一、可见且可用的“发送”按钮，已停止测试。${controls.actionLabels.length ? ` 当前会话可识别操作：${controls.actionLabels.join('、')}` : ' 当前未找到带可访问标签的操作按钮。'}` };
        if (readEditorText(controls.editor).trim() !== TEST_DRAFT_TEXT) return { ok: false, error: '当前输入框不是固定测试草稿，禁止发送其他内容。' };
        samples.push({ selected, controls, controlDigest: await digest(replyControlShape(controls)) });
        if (cycle < 2) await delay(400);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.chatDigest === first.selected.chatDigest
        && sample.selected.signature === first.selected.signature
        && sample.controlDigest === first.controlDigest
        && sample.controls.editor === first.controls.editor
        && sample.controls.sendButton === first.controls.sendButton)) {
        return { ok: false, error: '当前会话或发送控件在确认期间发生变化，已停止测试。' };
      }
      const draftDigest = await digest(TEST_DRAFT_TEXT);
      const beforeStateDigest = await digest(`${first.selected.chatDigest}|${first.controlDigest}|${draftDigest}|READY`);
      evidence = { chatDigest: first.selected.chatDigest, controlDigest: first.controlDigest, draftDigest, beforeStateDigest };
      first.controls.sendButton.click();
      clickTriggered = true;

      let confirmed = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await delay(500);
        const selected = await collectSelectedConversation();
        if (!selected.ok || selected.chatDigest !== first.selected.chatDigest) break;
        const controls = findReplyControls();
        const editorEmpty = Boolean(controls.editor) && !readEditorText(controls.editor).trim();
        const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const messages = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible) : [];
        const last = messages.filter((item) => directionOf(item)).at(-1);
        const outboundTextMatches = directionOf(last) === 'OUTBOUND' && compact(last?.textContent).includes(compact(TEST_DRAFT_TEXT));
        if (editorEmpty && outboundTextMatches) { confirmed = true; break; }
      }
      const outcome = confirmed ? 'SUCCEEDED' : 'UNKNOWN';
      return { ok: true, sendTest: { actionType: 'CURRENT_TEST_DRAFT_SEND', outcome, ...evidence,
        afterStateDigest: await digest(`${first.selected.chatDigest}|${first.controlDigest}|${outcome}`),
        clickTriggered: true, retryTriggered: false } };
    } catch (error) {
      if (!clickTriggered) throw error;
      const fallback = evidence || { chatDigest: '0'.repeat(64), controlDigest: '0'.repeat(64), draftDigest: await digest(TEST_DRAFT_TEXT), beforeStateDigest: '0'.repeat(64) };
      return { ok: true, sendTest: { actionType: 'CURRENT_TEST_DRAFT_SEND', outcome: 'UNKNOWN', ...fallback,
        afterStateDigest: await digest(`${fallback.chatDigest}|UNKNOWN`), clickTriggered: true, retryTriggered: false } };
    } finally { collecting = false; }
  }

  async function waitForCollectionIdle(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (collecting && Date.now() < deadline) await delay(100);
    return !collecting;
  }

  async function prepareApprovedDraftFill() {
    if (collecting) return { ok: false, error: '页面正在生成只读快照，请稍后重试。' };
    collecting = true;
    try {
      const first = await collectDraftFillContext();
      if (!first.ok) return first;
      await delay(400);
      const second = await collectDraftFillContext();
      if (!second.ok) return second;
      if (first.chatDigest !== second.chatDigest || first.controlDigest !== second.controlDigest) {
        return { ok: false, error: '当前会话或回复入口仍在变化，已停止读取后台草稿。' };
      }
      return { ok: true, context: { actionType: 'APPROVED_DRAFT_FILL', chatDigest: second.chatDigest, controlDigest: second.controlDigest, latestDirection: second.latestDirection, editorEmpty: true, stableCycles: 2 } };
    } finally { collecting = false; }
  }

  async function fillApprovedDraft(payload) {
    if (collecting) return { ok: false, error: '页面正在生成只读快照，请稍后重试。' };
    collecting = true;
    try {
      const content = String(payload?.content || '').trim();
      if (!/^[a-f0-9]{64}$/.test(payload?.chatDigest || '') || !/^[a-f0-9]{64}$/.test(payload?.controlDigest || '') || !/^[a-f0-9]{64}$/.test(payload?.draftDigest || '')) return { ok: false, error: '后台草稿摘要无效。' };
      if (!content || content.length > 2000 || await digest(content) !== payload.draftDigest) return { ok: false, error: '后台草稿正文与审核摘要不一致。' };
      const context = await collectDraftFillContext();
      if (!context.ok) return context;
      if (context.chatDigest !== payload.chatDigest || context.controlDigest !== payload.controlDigest) return { ok: false, error: '当前会话或回复入口与后台填入凭据不一致。' };
      const beforeStateDigest = await digest(`${context.chatDigest}|${context.controlDigest}|EMPTY`);
      writeEditorText(context.editor, content);
      await delay(250);
      if (readEditorText(context.editor).trim() !== content) return { ok: false, error: '页面未稳定保留已审核草稿；未触发发送。' };
      const selectedAfter = await collectSelectedConversation();
      if (!selectedAfter.ok || selectedAfter.chatDigest !== context.chatDigest || selectedAfter.direction !== 'INBOUND') return { ok: false, error: '草稿填入后会话状态发生变化；未触发发送。' };
      const afterStateDigest = await digest(`${context.chatDigest}|${context.controlDigest}|${payload.draftDigest}`);
      return { ok: true, result: { actionType: 'APPROVED_DRAFT_FILL', chatDigest: context.chatDigest, controlDigest: context.controlDigest, draftDigest: payload.draftDigest, beforeStateDigest, afterStateDigest, receiptDigest: await digest(`${beforeStateDigest}|${afterStateDigest}|FILLED`), outcome: 'FILLED', sendTriggered: false } };
    } finally { collecting = false; }
  }

  async function collectDraftFillContext() {
    const page = classifyPage();
    if (!page.ok) return { ok: false, error: page.reason };
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: false, error: selected.reason };
    if (selected.direction !== 'INBOUND') return { ok: false, error: '当前会话最后一条消息不是候选人来信，已停止填入。' };
    const controls = findReplyControls();
    if (!controls.editor) return { ok: false, error: '当前会话未找到可见且可编辑的回复输入框。' };
    if (readEditorText(controls.editor).trim()) return { ok: false, error: '当前输入框已有内容，为避免覆盖 HR 草稿已停止填入。' };
    return { ok: true, chatDigest: selected.chatDigest, latestDirection: selected.direction, controlDigest: await digest(replyControlShape(controls)), editor: controls.editor };
  }

  function findReplyControls() {
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    const replyRoot = active?.closest('[class*="conversation"], [class*="chat"]') || active?.parentElement?.parentElement || active;
    const editor = (replyRoot?.querySelector('#boss-chat-editor-input') || document.querySelector('#boss-chat-editor-input'))
      || (replyRoot && [...replyRoot.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
        .find((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'));
    let sendButtons = [];
    const editorContainer = editor?.closest('.conversation-editor');
    const verifiedBossSendButtons = [...(editorContainer?.querySelectorAll('.submit-content > .submit.active') || [])]
      .filter((node) => visible(node)
        && getComputedStyle(node).cursor === 'pointer'
        && !node.classList.contains('disabled')
        && !node.closest('[aria-disabled="true"], .disabled')
        && /^发送(?:消息)?$/.test(controlLabel(node)));
    if (verifiedBossSendButtons.length > 0) sendButtons = verifiedBossSendButtons;
    let buttonScope = editor?.parentElement || null;
    let matchedButtonScope = null;
    for (let depth = 0; sendButtons.length === 0 && buttonScope && depth < 8; depth++, buttonScope = buttonScope.parentElement) {
      const matches = [...buttonScope.querySelectorAll('button, [role="button"]')]
        .filter((node) => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && /^发送(?:消息)?$/.test(controlLabel(node)));
      if (matches.length > 0) { sendButtons = matches; matchedButtonScope = buttonScope; break; }
    }
    const diagnosticScope = editorContainer?.closest('.conversation-operate') || matchedButtonScope || findControlScope(editor);
    const actionLabels = [...(diagnosticScope?.querySelectorAll('button, [role="button"], a, [tabindex], .operate-btn, .submit') || [])]
      .map((node) => knownActionLabel(node, controlLabel(node))).filter(Boolean);
    return { editor, sendButton: sendButtons.length === 1 ? sendButtons[0] : null, sendButtonCount: sendButtons.length, actionLabels: [...new Set(actionLabels)].slice(0, 20) };
  }

  async function inspectCurrentConversationControls() {
    const page = classifyPage();
    if (!page.ok) return { ok: false, error: page.reason };
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: false, error: selected.reason };
    const { editor } = findReplyControls();
    if (!editor || !visible(editor)) return { ok: false, error: '当前会话未找到可见回复输入框，无法限定功能键扫描范围。' };
    const scope = findControlScope(editor);
    if (!scope) return { ok: false, error: '当前会话未找到稳定的回复工具栏作用域。' };
    const selector = 'button, [role="button"], a, input, textarea, [tabindex], [class*="btn"], [class*="button"], [class*="send"], [class*="submit"], [class*="confirm"], [class*="toolbar"], [class*="action"], [class*="operate"]';
    const structural = [...scope.querySelectorAll(selector)];
    const pointerControls = [...scope.querySelectorAll('*')].filter((node) => node instanceof HTMLElement && getComputedStyle(node).cursor === 'pointer');
    const dialogs = visibleDialogs();
    const interviewOverlaySelector = '.datepicker-pannel .cell, .datepicker-pannel .picker-header > *, .time-select-container [class*="option"], .time-select-container [class*="item"], .selectjob [class*="option"], .selectjob [class*="item"], .interview-contact [class*="option"], .interview-contact [class*="item"]';
    const dialogControls = dialogs.flatMap((dialog) => [dialog, ...dialog.querySelectorAll(selector),
      ...(dialog.matches('.interview-invite-dialog-ui') ? dialog.querySelectorAll(interviewOverlaySelector) : []),
      ...[...dialog.querySelectorAll('*')].filter((node) => node instanceof HTMLElement && getComputedStyle(node).cursor === 'pointer')]);
    const candidates = [...new Set([scope, ...structural, ...pointerControls, ...dialogControls])].filter((node) => node instanceof HTMLElement && visible(node)).slice(0, 120);
    const editorReport = await describeControl(editor);
    const controls = await Promise.all(candidates.map(describeControl));
    const activeConversation = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    const resumeCandidateNodes = activeConversation ? [...activeConversation.querySelectorAll(
      'button, a, [role="button"], [class*="resume"], [class*="attachment"], [class*="file"], [class*="pdf"], [class*="preview"], [class*="download"]'
    )].filter((node) => node instanceof HTMLElement && visible(node)).filter((node) => {
      const shape = `${node.className || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('aria-label') || ''} ${compact(node.textContent)}`.toLowerCase();
      return /(简历|附件|pdf|在线简历|预览|下载|resume|attachment|file|preview|download)/i.test(shape);
    }).slice(0, 80) : [];
    const resumeCandidates = await Promise.all(resumeCandidateNodes.map(async (node) => {
      const report = await describeControl(node);
      const shape = `${node.className || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('aria-label') || ''} ${compact(node.textContent)}`;
      const hints = [
        /简历|resume/i.test(shape) ? 'RESUME' : null,
        /附件|attachment|file/i.test(shape) ? 'ATTACHMENT' : null,
        /pdf/i.test(shape) ? 'PDF' : null,
        /预览|查看|preview/i.test(shape) ? 'PREVIEW' : null,
        /下载|download/i.test(shape) ? 'DOWNLOAD' : null,
      ].filter(Boolean);
      return { ...report, hints };
    }));
    const observedAt = new Date().toISOString();
    const reportDigest = await digest(JSON.stringify([selected.chatDigest, editorReport.fingerprint, ...controls.map((item) => item.fingerprint), ...resumeCandidates.map((item) => item.fingerprint)]));
    return { ok: true, diagnostic: { actionType: 'CURRENT_CONTROL_DOM_DIAGNOSTIC', pageState: 'CHAT_PAGE_READY', chatDigest: selected.chatDigest,
      observedAt, rawContentIncluded: false, truncated: candidates.length >= 120 || resumeCandidateNodes.length >= 80,
      editor: editorReport, controls, resumeCandidates, reportDigest } };
  }

  function findResumeCardNode(buttonNode) {
    let el = buttonNode;
    for (let i = 0; i < 8 && el && el !== document.body; i++) {
      const cls = (el.className || '').toString().toLowerCase();
      if (/(?:message-card|hyperlink|attachment|resume)[\w-]*/i.test(cls) && el.children.length >= 1) return el;
      el = el.parentElement;
    }
    return buttonNode.closest('.message-card-wrap, .hyperLink, [class*="attachment-wrap"]');
  }

  async function recordResumePreviewControl(node) {
    try {
      const card = findResumeCardNode(node);
      if (card) {
        const cardHTML = card.outerHTML.slice(0, 3000);
        showResumeCaptureStatus('简历卡片 DOM（可选中复制）：\n' + cardHTML + (card.outerHTML.length > 3000 ? '\n…（已截断至 3000 字符）' : ''));
      }
      const clickedControl = await describeControl(node);
      const selected = await collectSelectedConversation();
      const { editor } = findReplyControls();
      if (!selected.ok || !editor || !visible(editor)) return;
      const editorReport = await describeControl(editor);
      const observedAt = new Date().toISOString();
      const reportDigest = await digest(JSON.stringify([selected.chatDigest, clickedControl.fingerprint, observedAt]));
      await send({ type: 'BRIDGE_RESUME_PREVIEW_CLICK_DIAGNOSTIC', payload: {
        actionType: 'CURRENT_CONTROL_DOM_DIAGNOSTIC', pageState: 'CHAT_PAGE_READY', chatDigest: selected.chatDigest,
        observedAt, rawContentIncluded: false, truncated: false, editor: editorReport,
        controls: [clickedControl], resumeCandidates: [{ ...clickedControl, hints: ['RESUME', 'ATTACHMENT', 'PDF', 'PREVIEW'] }], reportDigest,
      } });
      void recordResumePreviewSurface(selected.chatDigest, editorReport, clickedControl);
    } catch {
      // 诊断记录不得阻断 HR 的原始点击行为。
    }
  }

  async function recordResumePreviewSurface(chatDigest, editorReport, clickedControl) {
    let importTriggered = false;
    let attachmentViewRequested = false;
    for (const wait of [500, 1200, 2500, 4000, 6000]) {
      await delay(wait);
      const selected = await collectSelectedConversation();
      if (!selected.ok || selected.chatDigest !== chatDigest) return;
      if (!attachmentViewRequested && !findVisibleResumePdfFrame()) {
        const fileControls = [...document.querySelectorAll('a.resume-btn-file, .resume-file-content .btn')]
          .filter((node) => node instanceof HTMLElement && visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
        if (fileControls.length === 1) {
          attachmentViewRequested = true;
          fileControls[0].click();
          await send({ type: 'BRIDGE_VISIBLE_RESUME_IMPORT_STATUS', payload: {
            chatDigest, state: '已识别附件简历入口，正在加载 PDF 预览…', observedAt: new Date().toISOString(),
          } });
          await delay(700);
        }
      }
      const selector = 'iframe, embed, object, canvas, [role="dialog"], [class*="pdf"], [class*="preview"], [class*="resume"], [class*="viewer"]';
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => node instanceof HTMLElement && visible(node))
        .filter((node) => {
          if (['IFRAME','EMBED','OBJECT','CANVAS'].includes(node.tagName)) return true;
          const shape = `${node.className || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('aria-label') || ''}`;
          return /(pdf|preview|resume|viewer|简历|预览)/i.test(shape);
        }).slice(0, 79);
      if (!nodes.length) continue;
      const reports = await Promise.all(nodes.map(async (node) => {
        const report = await describeControl(node);
        const shape = `${node.tagName} ${node.className || ''} ${node.getAttribute('type') || ''}`;
        const hints = [
          /resume|简历/i.test(shape) ? 'RESUME' : null,
          /pdf|application\/pdf/i.test(shape) ? 'PDF' : null,
          /preview|viewer|dialog/i.test(shape) || ['IFRAME','EMBED','OBJECT','CANVAS'].includes(node.tagName) ? 'PREVIEW' : null,
          /download|下载/i.test(shape) ? 'DOWNLOAD' : null,
        ].filter(Boolean);
        return { ...report, hints };
      }));
      const observedAt = new Date().toISOString();
      const reportDigest = await digest(JSON.stringify([chatDigest, clickedControl.fingerprint, ...reports.map((item) => item.fingerprint)]));
      await send({ type: 'BRIDGE_RESUME_PREVIEW_CLICK_DIAGNOSTIC', payload: {
        actionType: 'CURRENT_CONTROL_DOM_DIAGNOSTIC', pageState: 'CHAT_PAGE_READY', chatDigest,
        observedAt, rawContentIncluded: false, truncated: nodes.length >= 79, editor: editorReport,
        controls: [clickedControl], resumeCandidates: [{ ...clickedControl, hints: ['RESUME','ATTACHMENT','PDF','PREVIEW'] }, ...reports], reportDigest,
      } });
      // 预览正文由 BOSS 异步渲染。正文稳定后主动提交一次当前会话，
      // 避免普通 DOM 快照去重把“附件已展开”误判成无变化而漏掉导入。
      if (!importTriggered && (findVisibleResumeRoot() || findVisibleResumePdfFrame())) {
        const capture = await collectVisibleResumeText();
        if (capture.ok) {
          importTriggered = true;
          showResumeCaptureStatus('在线简历正文提取成功，正在提交后端处理。', 'success');
          await collectAndPublish(true);
          void pollResumeBackendStatus();
        } else {
          const pdfCapture = await collectVisibleResumePdf();
          if (pdfCapture.ok) {
            importTriggered = true;
            await collectAndPublish(true);
            const response = await sendResumePdfCaptureToBackend(pdfCapture.resume);
            showResumeImportResult(response);
            if (resumeAttachmentProcessing) {
              await waitForResumePdfBackendTerminal();
              const previewClosed = await ensureResumePreviewClosedForAutoReply(chatDigest, { importTerminal: true });
              lastResumePdfImportOutcome = response?.ok && previewClosed
                ? { ok: true, chatDigest, intakeId: response.intakeId || '', analysisStatus: response.analysisStatus || '' }
                : { ok: false, chatDigest, error: response?.ok ? '简历已导入，但预览窗口未确认关闭' : response?.error || '后端导入失败' };
            }
          } else {
            if (resumePdfForwardInFlight) {
              showResumeCaptureStatus('iframe 已取得 PDF，等待主导入链路完成，不启动重复备用抓取。');
              const forwarded = await Promise.race([
                resumePdfForwardInFlight,
                delay(12_000).then(() => null),
              ]);
              if (forwarded?.ok) {
                importTriggered = true;
                continue;
              }
              showResumeCaptureStatus('主导入链路仍在等待会话稳定，保留本轮预览继续复核。');
              continue;
            }
            await collectAndPublish(true);
            const fetched = await send({ type: 'BRIDGE_FETCH_VISIBLE_RESUME_MAIN_WORLD', payload: { chatDigest } });
            if (fetched?.ok) {
              importTriggered = true;
              showResumeImportResult(fetched);
            } else {
              showResumeCaptureStatus(`简历提取失败：${fetched?.error || pdfCapture.error}`, 'error');
              await send({ type: 'BRIDGE_VISIBLE_RESUME_IMPORT_STATUS', payload: {
                chatDigest, state: `PDF 尚未导入：${fetched?.error || pdfCapture.error}`, observedAt: new Date().toISOString(),
              } });
              // 预览可能仍在加载，保留 importTriggered=false，继续下一轮等待。
            }
          }
        }
      }
    }
  }

  async function prepareActionLeaseContext() {
    if (document.visibilityState !== 'visible') return { ok: false, error: '当前 BOSS 沟通页不可见，不领取页面写动作。' };
    if (collecting) return { ok: false, error: '页面正在生成稳定快照，暂不领取写动作。' };
    const samples = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const selected = await collectSelectedConversation();
      if (!selected.ok) return selected;
      if (selected.selectedUnread) return { ok: false, error: '当前会话尚未稳定转为已读，不领取写动作。' };
      samples.push({ selected });
      if (cycle < 2) await delay(350);
    }
    const first = samples[0];
    if (!samples.every((sample) => sample.selected.signature === first.selected.signature)) {
      return { ok: false, error: '当前会话未连续稳定，不领取写动作。' };
    }
    return { ok: true, context: { targetDigest: first.selected.chatDigest,
      messageDigest: first.selected.messageDigest, direction: first.selected.direction,
      actionTypes: ['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE'],
      observedAt: new Date().toISOString(), stableCycles: 3 } };
  }

  async function executeActionLease(lease) {
    if (!lease || !['SEND_MESSAGE', 'REQUEST_RESUME', 'EXCHANGE_WECHAT', 'EXCHANGE_PHONE'].includes(lease.actionType)
        || !/^[a-f0-9]{64}$/.test(lease.targetDigest || '')
        || !Number.isFinite(Date.parse(lease.leaseUntil)) || Date.parse(lease.leaseUntil) <= Date.now()) {
      return { ok: false, error: '页面动作租约无效或已过期。' };
    }
    if (lease.actionType === 'SEND_MESSAGE') return executeSendMessageLease(lease);
    if (lease.actionType === 'EXCHANGE_WECHAT' || lease.actionType === 'EXCHANGE_PHONE') return executeContactExchangeLease(lease);
    return executeResumeRequestLease(lease);
  }

  async function executeResumeRequestLease(lease) {
    if (document.visibilityState !== 'visible') return { ok: false, error: '当前 BOSS 沟通页不可见，未执行租约。' };
    if (collecting) return { ok: false, error: '页面正在生成稳定快照，未执行租约。' };
    collecting = true;
    let clickTriggered = false;
    let confirmTriggered = false;
    let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const selected = await collectSelectedConversation();
        if (!selected.ok || selected.chatDigest !== lease.targetDigest || selected.selectedUnread) {
          return { ok: false, error: '租约目标与当前已读会话不一致，未点击“求简历”。' };
        }
        const target = findCurrentActionControl('求简历');
        if (!target.ok) return target;
        const controlDigest = await digest(actionControlShape(target.node, '求简历'));
        samples.push({ selected, node: target.node, controlDigest });
        if (cycle < 2) await delay(300);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.signature === first.selected.signature && sample.node === first.node && sample.controlDigest === first.controlDigest)) {
        return { ok: false, error: '租约执行前会话或“求简历”入口发生变化，未点击。' };
      }
      const beforeStateDigest = await digest(`${lease.targetDigest}|${first.selected.messageDigest}|${first.controlDigest}|REQUEST_RESUME|READY`);
      evidence = { chatDigest: lease.targetDigest, messageDigest: first.selected.messageDigest, controlDigest: first.controlDigest, beforeStateDigest };
      first.node.click();
      clickTriggered = true;
      let confirmation = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        await delay(250);
        const found = findResumeConfirmation();
        if (found.ok) { confirmation = found; break; }
      }
      if (!confirmation) return await unknownResumeLeaseResult(evidence, 'REQUEST_RESUME_CONFIRMATION_NOT_FOUND', clickTriggered, confirmTriggered);
      const confirmationDigest = await digest(resumeConfirmationShape(confirmation));
      const selectedBeforeConfirm = await collectSelectedConversation();
      if (!selectedBeforeConfirm.ok || selectedBeforeConfirm.chatDigest !== lease.targetDigest || selectedBeforeConfirm.messageDigest !== first.selected.messageDigest) {
        return await unknownResumeLeaseResult(evidence, 'CONVERSATION_CHANGED_BEFORE_CONFIRMATION', clickTriggered, confirmTriggered);
      }
      confirmation.confirm.click();
      confirmTriggered = true;
      let succeeded = false;
      let afterShape = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        await delay(300);
        const selectedAfter = await collectSelectedConversation();
        const currentConfirmation = findResumeConfirmation(true);
        const currentAction = findCurrentActionControl('求简历', true);
        const messageChanged = selectedAfter.ok && selectedAfter.chatDigest === lease.targetDigest && selectedAfter.messageDigest !== first.selected.messageDigest;
        const actionUnavailable = !currentAction.ok || currentAction.unavailable;
        afterShape = `${selectedAfter.ok ? selectedAfter.messageDigest : 'unreadable'}|${currentConfirmation.ok ? 'confirmation-visible' : 'confirmation-closed'}|${actionUnavailable ? 'action-unavailable' : 'action-ready'}`;
        if (!currentConfirmation.ok && (messageChanged || actionUnavailable)) { succeeded = true; break; }
      }
      const outcome = succeeded ? 'SUCCEEDED' : 'UNKNOWN';
      const afterStateDigest = await digest(`${lease.targetDigest}|${confirmationDigest}|${outcome}|${afterShape}`);
      return { ok: true, result: { actionType: 'REQUEST_RESUME', outcome, ...evidence, afterStateDigest,
        receiptDigest: await digest(`${evidence.beforeStateDigest}|${afterStateDigest}|${outcome}`), clickTriggered, confirmTriggered,
        retryTriggered: false, reason: succeeded ? '已向当前匹配会话发出一次简历请求，页面状态已变化。' : '已点击求简历并确认，但页面结果无法明确验证；已停止且不会重试。' } };
    } catch (error) {
      if (!clickTriggered) throw error;
      return await unknownResumeLeaseResult(evidence, 'PAGE_EXECUTION_INTERRUPTED', clickTriggered, confirmTriggered);
    } finally { collecting = false; }
  }

  async function executeSendMessageLease(lease) {
    const content = String(lease.payload || '').trim();
    if (!content || content.length > 2000) return { ok: false, error: '已审核回复内容为空或超出限制，未执行发送。' };
    if (document.visibilityState !== 'visible') return { ok: false, error: '当前 BOSS 沟通页不可见，未执行租约。' };
    if (collecting) return { ok: false, error: '页面正在生成稳定快照，未执行租约。' };
    collecting = true;
    let clickTriggered = false;
    let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const selected = await collectSelectedConversation();
        if (!selected.ok || selected.chatDigest !== lease.targetDigest || selected.selectedUnread) return { ok: false, error: '租约目标与当前已读会话不一致，未发送消息。' };
        const controls = findReplyControls();
        if (!controls.editor) return { ok: false, error: '当前会话未找到可见且可编辑的回复输入框，未执行发送。' };
        if (readEditorText(controls.editor).trim()) return { ok: false, error: '当前回复框已有内容，为避免覆盖 HR 草稿，未执行发送。' };
        samples.push({ selected, controls, editorDigest: await digest(replyEditorShape(controls.editor)) });
        if (cycle < 2) await delay(300);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.signature === first.selected.signature
        && sample.controls.editor === first.controls.editor
        && sample.editorDigest === first.editorDigest)) return { ok: false, error: '发送前会话或回复编辑器发生变化，未执行发送。' };
      writeEditorText(first.controls.editor, content);
      await delay(250);
      if (readEditorText(first.controls.editor).trim() !== content) return { ok: false, error: '页面未稳定保留已审核回复，未点击发送。' };

      // BOSS 在编辑器为空时会隐藏或禁用发送按钮。必须先写入内容，
      // 再等待按钮进入唯一、可见且可用状态；这与人工发送测试的顺序一致。
      let filledControls = findReplyControls();
      for (let attempt = 0; attempt < 6 && (!filledControls.sendButton || filledControls.sendButtonCount !== 1); attempt++) {
        await delay(200);
        filledControls = findReplyControls();
      }
      if (filledControls.editor !== first.controls.editor || !filledControls.sendButton || filledControls.sendButtonCount !== 1) {
        writeEditorText(first.controls.editor, '');
        return { ok: false, error: '草稿已写入，但发送按钮未进入唯一可用状态；已清空草稿且未发送。' };
      }
      const beforeSend = await collectSelectedConversation();
      if (!beforeSend.ok || beforeSend.chatDigest !== lease.targetDigest
          || beforeSend.messageDigest !== first.selected.messageDigest || beforeSend.selectedUnread
          || readEditorText(filledControls.editor).trim() !== content) {
        writeEditorText(first.controls.editor, '');
        return { ok: false, error: '草稿写入后目标会话或消息状态发生变化；已清空草稿且未发送。' };
      }
      const controlDigest = await digest(replyControlShape(filledControls));
      const beforeStateDigest = await digest(`${lease.targetDigest}|${first.selected.messageDigest}|${controlDigest}|${await digest(content)}|SEND_MESSAGE|READY`);
      evidence = { chatDigest: lease.targetDigest, messageDigest: first.selected.messageDigest, controlDigest, beforeStateDigest };
      filledControls.sendButton.click(); clickTriggered = true;
      let succeeded = false; let afterShape = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        await delay(350);
        const selectedAfter = await collectSelectedConversation();
        const controlsAfter = findReplyControls();
        const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const messages = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible) : [];
        const last = messages.filter((item) => directionOf(item)).at(-1);
        const matches = directionOf(last) === 'OUTBOUND' && compact(last?.textContent).includes(compact(content));
        afterShape = `${selectedAfter.ok ? selectedAfter.messageDigest : 'unreadable'}|${controlsAfter.editor ? readEditorText(controlsAfter.editor).trim().length : -1}|${matches}`;
        if (selectedAfter.ok && selectedAfter.chatDigest === lease.targetDigest && controlsAfter.editor && !readEditorText(controlsAfter.editor).trim() && matches) { succeeded = true; break; }
      }
      return await actionLeaseResult('SEND_MESSAGE', evidence, succeeded ? 'SUCCEEDED' : 'UNKNOWN', clickTriggered, false, afterShape,
        succeeded ? '已向当前匹配会话发送一次经 HR 确认的安全回复，页面状态已变化。' : '已点击发送，但页面结果无法明确验证；已停止且不会重试。');
    } catch (error) {
      if (!clickTriggered) throw error;
      return actionLeaseResult('SEND_MESSAGE', evidence, 'UNKNOWN', true, false, 'PAGE_EXECUTION_INTERRUPTED', '发送后页面通信中断；结果不明，已停止且不会重试。');
    } finally { collecting = false; }
  }

  async function executeContactExchangeLease(lease) {
    const label = lease.actionType === 'EXCHANGE_WECHAT' ? '换微信' : '换电话';
    if (document.visibilityState !== 'visible') return { ok: false, error: '当前 BOSS 沟通页不可见，未执行租约。' };
    if (collecting) return { ok: false, error: '页面正在生成稳定快照，未执行租约。' };
    collecting = true; let clickTriggered = false; let confirmTriggered = false; let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const selected = await collectSelectedConversation();
        if (!selected.ok || selected.chatDigest !== lease.targetDigest || selected.selectedUnread) return { ok: false, error: `租约目标与当前已读会话不一致，未点击“${label}”。` };
        const target = findCurrentActionControl(label); if (!target.ok) return target;
        samples.push({ selected, node: target.node, controlDigest: await digest(actionControlShape(target.node, label)) });
        if (cycle < 2) await delay(300);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.signature === first.selected.signature && sample.node === first.node && sample.controlDigest === first.controlDigest)) return { ok: false, error: `联系方式交换前会话或“${label}”入口发生变化，未点击。` };
      const beforeStateDigest = await digest(`${lease.targetDigest}|${first.selected.messageDigest}|${first.controlDigest}|${lease.actionType}|READY`);
      evidence = { chatDigest: lease.targetDigest, messageDigest: first.selected.messageDigest, controlDigest: first.controlDigest, beforeStateDigest };
      first.node.click(); clickTriggered = true;
      let confirmation = null;
      for (let attempt = 0; attempt < 8; attempt++) { await delay(250); const found = findExchangeConfirmation(label); if (found.ok) { confirmation = found; break; } }
      if (!confirmation) return actionLeaseResult(lease.actionType, evidence, 'UNKNOWN', clickTriggered, confirmTriggered, 'CONFIRMATION_NOT_FOUND', `已点击“${label}”，但没有找到唯一确认层；已停止且不会重试。`);
      const selectedBeforeConfirm = await collectSelectedConversation();
      if (!selectedBeforeConfirm.ok || selectedBeforeConfirm.chatDigest !== lease.targetDigest || selectedBeforeConfirm.messageDigest !== first.selected.messageDigest) return actionLeaseResult(lease.actionType, evidence, 'UNKNOWN', clickTriggered, confirmTriggered, 'TARGET_CHANGED', '确认前目标会话发生变化；已停止且不会重试。');
      confirmation.confirm.click(); confirmTriggered = true;
      let succeeded = false; let afterShape = '';
      for (let attempt = 0; attempt < 10; attempt++) { await delay(300); const selectedAfter = await collectSelectedConversation(); const current = findExchangeConfirmation(label, true); const action = findCurrentActionControl(label, true); afterShape = `${selectedAfter.ok ? selectedAfter.messageDigest : 'unreadable'}|${current.ok}|${action.ok ? action.unavailable : 'missing'}`; if (selectedAfter.ok && selectedAfter.chatDigest === lease.targetDigest && !current.ok && (!action.ok || action.unavailable)) { succeeded = true; break; } }
      return actionLeaseResult(lease.actionType, evidence, succeeded ? 'SUCCEEDED' : 'UNKNOWN', clickTriggered, confirmTriggered, afterShape,
        succeeded ? `已对当前匹配会话完成一次“${label}”，页面状态已变化。` : `已点击并确认“${label}”，但页面结果无法明确验证；已停止且不会重试。`);
    } catch (error) {
      if (!clickTriggered) throw error;
      return actionLeaseResult(lease.actionType, evidence, 'UNKNOWN', true, confirmTriggered, 'PAGE_EXECUTION_INTERRUPTED', '联系方式交换后页面通信中断；结果不明，已停止且不会重试。');
    } finally { collecting = false; }
  }

  async function actionLeaseResult(actionType, evidence, outcome, clickTriggered, confirmTriggered, afterShape, reason) {
    const safe = evidence || { chatDigest: '0'.repeat(64), messageDigest: '0'.repeat(64), controlDigest: '0'.repeat(64), beforeStateDigest: '0'.repeat(64) };
    const afterStateDigest = await digest(`${safe.chatDigest}|${actionType}|${outcome}|${afterShape}`);
    return { ok: true, result: { actionType, outcome, ...safe, afterStateDigest, receiptDigest: await digest(`${safe.beforeStateDigest}|${afterStateDigest}|${outcome}`), clickTriggered, confirmTriggered, retryTriggered: false, reason } };
  }

  async function unknownResumeLeaseResult(evidence, code, clickTriggered, confirmTriggered) {
    const safeEvidence = evidence || { chatDigest: '0'.repeat(64), messageDigest: '0'.repeat(64), controlDigest: '0'.repeat(64), beforeStateDigest: '0'.repeat(64) };
    const afterStateDigest = await digest(`${safeEvidence.chatDigest}|REQUEST_RESUME|UNKNOWN|${code}`);
    return { ok: true, result: { actionType: 'REQUEST_RESUME', outcome: 'UNKNOWN', ...safeEvidence, afterStateDigest,
      receiptDigest: await digest(`${safeEvidence.beforeStateDigest}|${afterStateDigest}|UNKNOWN`), clickTriggered,
      confirmTriggered, retryTriggered: false, reason: `${code}；结果不明，已停止且不会重试。` } };
  }

  function findResumeConfirmation(allowUnavailable = false) {
    const { editor } = findReplyControls();
    const scope = editor?.closest('.conversation-operate');
    if (!scope) return { ok: false, error: '当前回复框不属于已验证的会话功能区。' };
    const owners = [...scope.querySelectorAll('.toolbar-box-right .operate-exchange-left .operate-icon-item')]
      .filter((node) => knownActionLabel(node.querySelector(':scope > .operate-btn'), controlLabel(node.querySelector(':scope > .operate-btn'))) === '求简历');
    if (owners.length !== 1) return { ok: false, error: '当前会话没有唯一的“求简历”操作容器。' };
    const localScopes = [owners[0], ...visibleDialogs().filter((dialog) => compact(dialog.textContent).includes('简历'))];
    const candidates = [...new Set(localScopes.flatMap((root) => [...root.querySelectorAll('button, [role="button"], .boss-btn, .card-btn')]))].filter(visible);
    const confirms = candidates.filter((node) => ['确定', '确认'].includes(knownActionLabel(node, controlLabel(node))));
    const cancels = candidates.filter((node) => ['取消', '暂不'].includes(knownActionLabel(node, controlLabel(node))));
    if (confirms.length !== 1 || cancels.length !== 1) return { ok: false, error: '“求简历”确认层没有唯一且语义明确的确认/取消按钮。' };
    const confirm = confirms[0];
    const unavailable = getComputedStyle(confirm).cursor !== 'pointer' || confirm.classList.contains('disabled') || Boolean(confirm.closest('[aria-disabled="true"], .disabled'));
    if (unavailable && !allowUnavailable) return { ok: false, error: '“求简历”确认按钮不可用。' };
    return { ok: true, owner: owners[0], confirm, cancel: cancels[0], unavailable };
  }

  function resumeConfirmationShape(controls) {
    return ['求简历', safeClassTokens(controls.owner).join('.'), safeClassTokens(controls.confirm).join('.'), safeClassTokens(controls.cancel).join('.'), '确认', '取消'].join('|');
  }

  async function testCurrentActionEntry(action) {
    const labels = { REQUEST_RESUME: '求简历', EXCHANGE_PHONE: '换电话', EXCHANGE_WECHAT: '换微信', INTERVIEW: '约面试' };
    const label = labels[action];
    if (!label) return { ok: false, error: '不支持的当前会话操作入口。' };
    if (collecting) return { ok: false, error: '页面正在生成其他稳定快照，请稍后重试。' };
    collecting = true;
    let clickTriggered = false;
    let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const page = classifyPage();
        if (!page.ok) return { ok: false, error: page.reason };
        const selected = await collectSelectedConversation();
        if (!selected.ok) return { ok: false, error: selected.reason };
        if (selected.selectedUnread) return { ok: false, error: `当前会话仍标记为未读；${label}入口测试只允许已读测试会话。` };
        const target = findCurrentActionControl(label);
        if (!target.ok) return { ok: false, error: target.error };
        const controlDigest = await digest(actionControlShape(target.node, label));
        samples.push({ selected, node: target.node, controlDigest });
        if (cycle < 2) await delay(400);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.chatDigest === first.selected.chatDigest && sample.selected.signature === first.selected.signature && sample.node === first.node && sample.controlDigest === first.controlDigest)) {
        return { ok: false, error: `当前会话或“${label}”入口在确认期间发生变化，已停止测试。` };
      }
      const beforeDialogs = visibleDialogs().map(dialogShape).join('|');
      const beforeStateDigest = await digest(`${first.selected.chatDigest}|${action}|${first.controlDigest}|${beforeDialogs}`);
      evidence = { action, chatDigest: first.selected.chatDigest, controlDigest: first.controlDigest, beforeStateDigest };
      first.node.click();
      clickTriggered = true;
      let outcome = 'UNKNOWN';
      let afterShape = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        await delay(400);
        const dialogs = visibleDialogs().map(dialogShape).join('|');
        const current = findCurrentActionControl(label, true);
        afterShape = `${dialogs}|${current.ok ? actionControlShape(current.node, label) : current.error}`;
        if (dialogs && dialogs !== beforeDialogs) { outcome = 'DIALOG_OPENED'; break; }
        const currentDigest = current.ok ? await digest(actionControlShape(current.node, label)) : null;
        if (!current.ok || current.node !== first.node || currentDigest !== first.controlDigest || current.unavailable) { outcome = 'STATE_CHANGED'; break; }
      }
      return { ok: true, actionTest: { actionType: 'CURRENT_ACTION_ENTRY_TEST', outcome, ...evidence,
        afterStateDigest: await digest(`${evidence.chatDigest}|${action}|${outcome}|${afterShape}`), clickTriggered: true, retryTriggered: false } };
    } catch (error) {
      if (!clickTriggered) throw error;
      const fallback = evidence || { action, chatDigest: '0'.repeat(64), controlDigest: '0'.repeat(64), beforeStateDigest: '0'.repeat(64) };
      return { ok: true, actionTest: { actionType: 'CURRENT_ACTION_ENTRY_TEST', outcome: 'UNKNOWN', ...fallback,
        afterStateDigest: await digest(`${fallback.chatDigest}|${action}|UNKNOWN`), clickTriggered: true, retryTriggered: false } };
    } finally { collecting = false; }
  }

  async function confirmCurrentExchange(action) {
    const labels = { EXCHANGE_PHONE: '换电话', EXCHANGE_WECHAT: '换微信' };
    const label = labels[action];
    if (!label) return { ok: false, error: '不支持的联系方式二级确认测试。' };
    if (collecting) return { ok: false, error: '页面正在生成其他稳定快照，请稍后重试。' };
    collecting = true;
    let clickTriggered = false;
    let evidence = null;
    try {
      const samples = [];
      for (let cycle = 0; cycle < 3; cycle++) {
        const page = classifyPage();
        if (!page.ok) return { ok: false, error: page.reason };
        const selected = await collectSelectedConversation();
        if (!selected.ok || selected.selectedUnread) return { ok: false, error: `当前会话不满足“${label}”二级确认测试条件。` };
        const controls = findExchangeConfirmation(label);
        if (!controls.ok) return { ok: false, error: controls.error };
        const controlDigest = await digest(exchangeConfirmationShape(controls, label));
        samples.push({ selected, ...controls, controlDigest });
        if (cycle < 2) await delay(400);
      }
      const first = samples[0];
      if (!samples.every((sample) => sample.selected.chatDigest === first.selected.chatDigest && sample.selected.signature === first.selected.signature
        && sample.confirm === first.confirm && sample.cancel === first.cancel && sample.controlDigest === first.controlDigest)) {
        return { ok: false, error: `当前会话或“${label}”二级确认层发生变化，已停止测试。` };
      }
      const beforeStateDigest = await digest(`${first.selected.chatDigest}|${action}|${first.controlDigest}|CONFIRM_READY`);
      evidence = { action, chatDigest: first.selected.chatDigest, controlDigest: first.controlDigest, beforeStateDigest };
      first.confirm.click();
      clickTriggered = true;
      let outcome = 'UNKNOWN';
      let afterShape = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        await delay(400);
        const current = findExchangeConfirmation(label, true);
        afterShape = current.ok ? exchangeConfirmationShape(current, label) : current.error;
        if (!current.ok || current.confirm !== first.confirm || current.unavailable) { outcome = 'STATE_CHANGED'; break; }
      }
      return { ok: true, exchangeConfirm: { actionType: 'CURRENT_EXCHANGE_CONFIRMATION_TEST', outcome, ...evidence,
        afterStateDigest: await digest(`${evidence.chatDigest}|${action}|${outcome}|${afterShape}`), clickTriggered: true, retryTriggered: false } };
    } catch (error) {
      if (!clickTriggered) throw error;
      const fallback = evidence || { action, chatDigest: '0'.repeat(64), controlDigest: '0'.repeat(64), beforeStateDigest: '0'.repeat(64) };
      return { ok: true, exchangeConfirm: { actionType: 'CURRENT_EXCHANGE_CONFIRMATION_TEST', outcome: 'UNKNOWN', ...fallback,
        afterStateDigest: await digest(`${fallback.chatDigest}|${action}|UNKNOWN`), clickTriggered: true, retryTriggered: false } };
    } finally { collecting = false; }
  }

  function findExchangeConfirmation(label, allowUnavailable = false) {
    const { editor } = findReplyControls();
    const scope = editor?.closest('.conversation-operate');
    if (!scope) return { ok: false, error: '当前回复框不属于已验证的会话功能区。' };
    const owners = [...scope.querySelectorAll('.toolbar-box-right .operate-exchange-left .operate-icon-item')]
      .filter((node) => knownActionLabel(node.querySelector(':scope > .operate-btn'), controlLabel(node.querySelector(':scope > .operate-btn'))) === label);
    if (owners.length !== 1) return { ok: false, error: `当前会话没有唯一属于“${label}”的操作容器。` };
    const confirms = [...owners[0].querySelectorAll('.exchange-tooltip .btn-box > .boss-btn-primary.boss-btn')].filter(visible);
    const cancels = [...owners[0].querySelectorAll('.exchange-tooltip .btn-box > .boss-btn-outline.boss-btn')].filter(visible);
    if (confirms.length !== 1 || cancels.length !== 1 || !['确定', '确认'].includes(knownActionLabel(confirms[0], controlLabel(confirms[0]))) || knownActionLabel(cancels[0], controlLabel(cancels[0])) !== '取消') {
      return { ok: false, error: `“${label}”二级确认层没有唯一且语义明确的确定/取消按钮。` };
    }
    const confirm = confirms[0]; const cancel = cancels[0];
    const unavailable = getComputedStyle(confirm).cursor !== 'pointer' || confirm.classList.contains('disabled') || Boolean(confirm.closest('[aria-disabled="true"], .disabled'));
    if (unavailable && !allowUnavailable) return { ok: false, error: `“${label}”二级确定按钮不可用。` };
    return { ok: true, owner: owners[0], confirm, cancel, unavailable };
  }

  function exchangeConfirmationShape(controls, label) {
    return [label, controls.owner.tagName, safeClassTokens(controls.confirm).join('.'), safeClassTokens(controls.cancel).join('.'), '确定', '取消'].join('|');
  }

  function findCurrentActionControl(label, allowUnavailable = false) {
    const { editor } = findReplyControls();
    const scope = editor?.closest('.conversation-operate');
    if (!scope) return { ok: false, error: '当前回复框不属于已验证的会话功能区。' };
    const matches = [...scope.querySelectorAll('.toolbar-box-right .operate-exchange-left .operate-btn')]
      .filter((node) => visible(node) && knownActionLabel(node, controlLabel(node)) === label);
    if (matches.length !== 1) return { ok: false, error: `当前会话没有唯一的“${label}”入口。` };
    let node = matches[0];
    if (label === '约面试') {
      const interviewTargets = [...node.querySelectorAll(':scope > .interview')]
        .filter((candidate) => visible(candidate) && getComputedStyle(candidate).cursor === 'pointer');
      if (interviewTargets.length !== 1) return { ok: false, error: '当前会话没有唯一、可见且可点击的“约面试”内部入口。' };
      node = interviewTargets[0];
    }
    const unavailable = node.classList.contains('disabled') || Boolean(node.closest('[aria-disabled="true"], .disabled')) || getComputedStyle(node).cursor !== 'pointer';
    if (unavailable && !allowUnavailable) return { ok: false, error: `当前会话的“${label}”入口不可用，已停止测试。` };
    return { ok: true, node, unavailable };
  }

  function actionControlShape(node, label) {
    return [node.tagName, safeClassTokens(node).join('.'), label, node.closest('.operate-btn')?.tagName || '', node.closest('.operate-icon-item')?.tagName || '', node.getAttribute('data-v-9c639358') !== null ? 'phone-scope' : 'generic-scope'].join('|');
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"], .boss-dialog, .dialog-container, .modal, .modal-container')].filter((node) => node instanceof HTMLElement && visible(node));
  }

  function dialogShape(node) {
    const rect = node.getBoundingClientRect();
    return `${node.tagName}:${safeClassTokens(node).join('.')}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }

  function findControlScope(editor) {
    let node = editor?.parentElement || null;
    let fallback = node;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      fallback = node;
      const count = node.querySelectorAll('button, [role="button"], [tabindex], [class*="btn"], [class*="send"], [class*="toolbar"], [class*="operate"]').length;
      if (count >= 3) return node;
    }
    return fallback;
  }

  async function describeControl(node) {
    const rawLabel = controlLabel(node).slice(0, 160);
    const known = knownActionLabel(node, rawLabel);
    const ownerButton = node.closest('.operate-icon-item')?.querySelector(':scope > .operate-btn');
    const ownerAction = ownerButton && ownerButton !== node ? knownActionLabel(ownerButton, controlLabel(ownerButton).slice(0, 160)) : null;
    const rect = node.getBoundingClientRect();
    const classes = safeClassTokens(node);
    const interviewField = classifyInterviewField(node);
    const iconNode = node.querySelector?.('svg, i, [class*="icon"]');
    const ancestors = [];
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) ancestors.push(`${parent.tagName.toLowerCase()}${safeClassTokens(parent).map((item) => `.${item}`).join('')}`.slice(0, 240));
    const shape = [node.tagName, classes.join('.'), node.getAttribute('role') || '', node.getAttribute('type') || '', node.getAttribute('aria-label') || '', node.getAttribute('title') || '', known || '', Math.round(rect.width), Math.round(rect.height), ancestors.join('>')].join('|');
    return { fingerprint: await digest(shape), tag: node.tagName, classes, role: safeAttribute(node, 'role'), type: safeAttribute(node, 'type'),
      ariaLabel: safeKnownLabel(node.getAttribute('aria-label')), title: safeKnownLabel(node.getAttribute('title')), tabIndex: node.tabIndex,
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true' || node.classList.contains('disabled') || node.closest('[aria-disabled="true"], .disabled')), visible: visible(node), width: Math.round(rect.width), height: Math.round(rect.height),
      cursor: getComputedStyle(node).cursor.slice(0, 30), knownAction: known === '发送消息' ? '发送' : known, labelDigest: rawLabel ? await digest(rawLabel) : null,
      ownerAction: ['求简历', '换电话', '换微信', '约面试'].includes(ownerAction) ? ownerAction : null,
      interviewField: interviewField?.role || null, selected: interviewField?.selected ?? null,
      dataAttributeNames: [...node.attributes].map((item) => item.name).filter((name) => name.startsWith('data-')).slice(0, 20),
      icon: iconNode ? `${iconNode.tagName.toLowerCase()}${safeClassTokens(iconNode).map((item) => `.${item}`).join('')}`.slice(0, 160) : null, ancestors };
  }

  function classifyInterviewField(node) {
    const dialog = node.closest('.interview-invite-dialog-ui');
    if (!dialog) return null;
    if (node.matches('.selectjob .ui-select-selection')) return { role: 'JOB', selected: null };
    if (node.matches('.interview-address input')) return { role: 'ADDRESS', selected: null };
    if (node.matches('.contact-form-item textarea')) return { role: 'NOTE', selected: null };
    if (node.matches('.interview-datetime-fields .ui-date-picker-v2 input')) return { role: 'DATE', selected: null };
    if (node.matches('.interview-datetime-fields .time-select')) return { role: 'TIME', selected: null };
    if (node.matches('.radio-group-v2 > .radio-item')) return { role: 'MODE_OPTION', selected: node.classList.contains('radio-checked') };
    if (node.matches('.interview-contact > .ui-dropmenu-label')) return { role: 'CONTACT', selected: null };
    if (node.matches('.interview-btns > .btn-outline-v2')) return { role: 'CANCEL', selected: null };
    if (node.matches('.interview-btns > .btn-sure-v2')) return { role: 'SEND', selected: null };
    return null;
  }

  function safeClassTokens(node) {
    return [...(node?.classList || [])].filter((item) => /^[a-zA-Z0-9_-]{1,80}$/.test(item)).slice(0, 12);
  }

  function safeAttribute(node, name) {
    const value = compact(node?.getAttribute?.(name));
    return /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value : null;
  }

  function safeKnownLabel(value) {
    return normalizeKnownActionLabel(compact(value));
  }

  function knownActionLabel(node, rawLabel) {
    if (!node) return null;
    const exact = normalizeKnownActionLabel(rawLabel);
    if (exact) return exact;
    if (!node.matches('.operate-btn, .submit, .boss-btn, .card-btn, button, [role="button"]') || rawLabel.length > 40) return null;
    const matched = ['查看电话', '查看面试', '求简历', '接收简历', '换电话', '换微信', '约面试', '不合适', '发送', '确认', '确定', '取消', '暂不']
      .find((label) => rawLabel.includes(label));
    return normalizeKnownActionLabel(matched);
  }

  function normalizeKnownActionLabel(label) {
    if (!label) return null;
    if (label === '发送消息') return '发送';
    if (label === '查看电话') return '换电话';
    if (label === '查看面试') return '约面试';
    return ['发送', '求简历', '接收简历', '换电话', '换微信', '约面试', '不合适', '确认', '确定', '取消', '暂不'].includes(label) ? label : null;
  }

  function replyControlShape({ editor, sendButton }) {
    return [editor?.id || 'fallback-editor', editor?.tagName || '', editor?.getAttribute('role') || '',
      editor?.getAttribute('contenteditable') || '', sendButton ? `${sendButton.tagName}:${safeClassTokens(sendButton).join('.')}:发送` : 'ENTER_TO_SEND'].join('|');
  }

  function replyEditorShape(editor) {
    return [editor?.id || 'fallback-editor', editor?.tagName || '', editor?.getAttribute('role') || '',
      editor?.getAttribute('contenteditable') || '', safeClassTokens(editor).join('.')].join('|');
  }

  function controlLabel(node) {
    return compact(node?.textContent) || compact(node?.getAttribute?.('aria-label')) || compact(node?.getAttribute?.('title')) || compact(node?.getAttribute?.('data-tooltip'));
  }

  function readEditorText(editor) {
    if (!editor) return '';
    if ('value' in editor && typeof editor.value === 'string') return editor.value;
    return editor.innerText || editor.textContent || '';
  }

  function writeEditorText(editor, text) {
    if ('value' in editor && typeof editor.value === 'string') {
      const prototype = editor.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(editor, text); else editor.value = text;
    } else {
      editor.replaceChildren(document.createTextNode(text));
    }
    editor.focus({ preventScroll: true });
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function isJobDetailPage() {
    return /\/web\/chat\/job\/(?:edit|detail)(?:[/?#]|$)/i.test(location.pathname)
      || Boolean(findJobDetailRoot());
  }

  async function collectJobDetailSnapshot() {
    const root = findJobDetailRoot();
    if (!root || !visible(root)) return blocked('JOB_DETAIL_NOT_FOUND', '当前职位详情尚未加载完成。');
    const rowValue = (label) => {
      const row = [...root.querySelectorAll('.form-row')].find((item) => compact(item.querySelector('.title')?.textContent).includes(label));
      if (row) {
        const control = row.querySelector('input:not([type="hidden"]), textarea');
        if (control && compact(control.value)) return compact(control.value);
        const selected = compact(row.querySelector('.ui-select-selected-value, .content')?.textContent);
        if (selected) return selected;
      }
      return semanticFieldValue(root, label);
    };
    const title = compact(root.querySelector("input[name='jobName'], .job-name input, input[placeholder*='职位名称']")?.value) || rowValue('职位名称');
    if (!title || title.length < 2) return blocked('JOB_TITLE_MISSING', '职位详情没有可识别的职位名称。');
    const descriptionNode = root.querySelector('.performance-row textarea, textarea[maxlength="5000"], textarea');
    const description = cleanMultiline(descriptionNode?.value).slice(0, 10000);
    const recruitmentType = compact(root.querySelector('.recruitment-type-wrap .ui-select-selected-value')?.textContent) || rowValue('招聘类型');
    const jobCategory = compact(root.querySelector("input[name='jobCategory']")?.value)
      || compact(root.querySelector('.job-category-tag-container')?.innerText) || rowValue('职位类型');
    const overseasRequirement = compact(root.querySelector('.overseas-entry-container .chose-item.active')?.textContent) || rowValue('是否驻外');
    const experienceRaw = compact(root.querySelector('.job-experience-row .ui-select-selected-value')?.textContent) || rowValue('经验');
    const experienceRequirement = matchText(experienceRaw, /(?:经验不限|不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上|以内)?)/);
    const educationRaw = rowValue('学历');
    const educationRequirement = matchText(educationRaw, /(?:学历不限|不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/);
    const salaryValues = [...root.querySelectorAll('.scope-selecter .scope-select .ui-select-selected-value')].map((node) => compact(node.textContent)).filter(Boolean);
    const salaryRaw = salaryValues.length >= 2 ? `${salaryValues[0]}-${salaryValues[1]}` : (rowValue('薪资详情') || salaryValues.join('-'));
    const salaryDisplay = matchText(salaryRaw, /\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk](?:\s*[·x×]\s*\d{2}\s*薪)?/);
    const salary = parseSalary(salaryDisplay);
    const salaryMonthsText = compact(root.querySelector('.salaryMonth-select .ui-select-selected-value')?.textContent) || rowValue('薪数');
    const salaryMonthsMatch = salaryMonthsText.match(/(?:^|\D)(1[2-6])(?:\D|$)/);
    const salaryMonths = salaryMonthsMatch ? Number(salaryMonthsMatch[1]) : null;
    const jobKeywords = [...root.querySelectorAll('.job-skill-content .job-skill-item, .job-skill-content .skill-tag, .job-skill-content .tag')]
      .map((node) => compact(node.textContent)).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join('｜').slice(0, 500);
    const workAddress = compact(root.querySelector('.job-address input.ipt, .job-address input')?.value) || rowValue('工作地址') || rowValue('工作地点');
    const workTime = rowValue('工作时间') || rowValue('上班时间') || rowValue('工作时段');
    const benefits = rowValue('福利待遇') || rowValue('福利') || rowValue('薪资福利');
    const sourceDigest = await digest(`detail:${location.pathname}:${new URLSearchParams(location.search).get('encryptId') || title}`);
    const values = [title, recruitmentType, description, jobCategory, overseasRequirement, experienceRequirement,
      educationRequirement, salaryDisplay, salaryMonths, jobKeywords, workAddress, workTime, benefits];
    const entry = {
      sourceDigest, title, location: null, salaryDisplay: salaryDisplay || null,
      salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths,
      experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null,
      description: description || null, recruitmentType: recruitmentType || null, jobCategory: jobCategory || null,
      overseasRequirement: overseasRequirement || null, jobKeywords: jobKeywords || null, workAddress: workAddress || null,
      workTime: workTime || null, benefits: benefits || null,
      completeness: values.filter(Boolean).length, platformStatus: 'UNKNOWN',
    };
    const signature = Object.values(entry).map((value) => value ?? '').join('|');
    return { ok: true, entries: [entry], signature, scope: 'SINGLE_JOB', authoritative: false };
  }

  function findJobDetailRoot() {
    const fixed = document.querySelector('.job-edit-container.edit-job, .job-edit-container');
    if (fixed && visible(fixed)) return fixed;
    if (!/\/web\/chat\/job\/(?:edit|detail)(?:[/?#]|$)/i.test(location.pathname)) return null;
    const descriptions = [...document.querySelectorAll('textarea')].filter(visible);
    for (const description of descriptions) {
      let node = description.parentElement;
      for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
        const text = compact(node.innerText || node.textContent);
        const inputs = node.querySelectorAll('input:not([type="hidden"]), textarea, [class*="select"]');
        if (text.includes('职位基本信息') && text.includes('职位要求') && inputs.length >= 5) return node;
      }
    }
    return null;
  }

  function semanticFieldValue(root, label) {
    const candidates = [...root.querySelectorAll('label, span, div')]
      .filter((node) => visible(node) && compact(node.textContent).replace(/[：:]/g, '') === label.replace(/[：:]/g, ''));
    for (const labelNode of candidates) {
      let row = labelNode.parentElement;
      for (let depth = 0; row && depth < 5 && root.contains(row); depth++, row = row.parentElement) {
        const control = row.querySelector('input:not([type="hidden"]), textarea');
        const value = compact(control?.value);
        if (value) return value;
        const selected = [...row.querySelectorAll('.ui-select-selected-value, [class*="selected-value"], [class*="chose-item"].active, [class*="radio"].active')]
          .map((node) => compact(node.textContent)).find(Boolean);
        if (selected) return selected;
      }
    }
    return '';
  }

  function classifyPage() {
    const safety = classifySafety();
    if (!safety.ok) return safety;
    const text = document.body?.innerText || '';
    if (!CHAT_URL.test(location.pathname)) return blocked('NOT_CHAT_PAGE', '当前不在 BOSS 沟通页，不会自动跳转。');
    if (!text.trim()) return blocked('PAGE_LOADING', 'BOSS 沟通页仍在加载。');
    return { ok: true };
  }

  function classifyJobPage(allowEmbeddedJobList) {
    const safety = classifySafety();
    if (!safety.ok) return safety;
    const text = document.body?.innerText || '';
    const routeLooksRelevant = /(?:job|position)/i.test(location.pathname) && !CHAT_URL.test(location.pathname);
    const headingLooksRelevant = ['职位管理', '我的职位', '职位列表'].some((term) => text.includes(term));
    const embeddedList = allowEmbeddedJobList && document.querySelector('.job-jobInfo-warp');
    if (!routeLooksRelevant && !headingLooksRelevant && !embeddedList) return blocked('NOT_JOB_MANAGEMENT_PAGE', '当前不是 BOSS 职位管理页；扩展不会自动跳转。');
    if (!text.trim()) return blocked('PAGE_LOADING', 'BOSS 职位管理页仍在加载。');
    return { ok: true };
  }

  function classifySafety() {
    const text = document.body?.innerText || '';
    const hasAny = (terms) => terms.some((term) => text.includes(term));
    if (hasAny(['安全验证', '账号异常', '风险验证', '滑动验证', '访问受限'])) return blocked('RISK_OR_VERIFICATION', '检测到 BOSS 验证或风险提示，等待 HR 处理。');
    if (hasAny(['扫码登录', '账号登录', '登录BOSS直聘', '请先登录'])) return blocked('LOGIN_REQUIRED', 'BOSS 登录已失效或尚未完成。');
    return { ok: true };
  }

  async function collectJobSnapshot() {
    const items = findJobCards();
    if (!items.length) return blocked('JOB_LIST_NOT_FOUND', '当前页面未找到具备稳定标识的可见职位卡片，已停止采集。');
    if (items.length > 200) return blocked('JOB_LIST_TOO_LARGE', '当前职位数量超过单次安全上限。');
    const entries = [];
    const seenSources = new Set();
    for (const item of items) {
      const allText = compact(item.textContent).slice(0, 3000);
      const title = firstText(item, JOB_SELECTORS.title, 120) || deriveJobTitle(item);
      if (!title || title.length < 2) return blocked('JOB_TITLE_MISSING', '职位卡片没有可识别标题，已停止采集。');
      const meta = [...item.querySelectorAll('.job-main-info-wrapper .info-labels span')].map((node) => compact(node.textContent)).filter(Boolean);
      const metaText = meta.join(' ');
      const salaryDisplay = firstText(item, JOB_SELECTORS.salary, 120) || matchText(metaText || allText, /(?:\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk](?:\s*[·x×]\s*\d{2}\s*薪)?|\d{1,3}\s*[Kk]以上)/);
      const salary = parseSalary(salaryDisplay);
      const location = firstText(item, JOB_SELECTORS.location, 120) || matchText(metaText || allText, /(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)(?:[·\-][\u4e00-\u9fa5]{1,10})?/);
      const experienceRequirement = firstText(item, JOB_SELECTORS.experience, 80) || matchText(metaText || allText, /(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)/);
      const educationRequirement = firstText(item, JOB_SELECTORS.education, 80) || matchText(metaText || allText, /(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/);
      const publicIdentity = [location, salaryDisplay, experienceRequirement, educationRequirement].filter(Boolean);
      const identity = stableJobIdentity(item) || (publicIdentity.length >= 2 ? `derived:${title}|${publicIdentity.join('|')}` : '');
      if (!identity) return blocked('JOB_ID_MISSING', '职位卡片既没有稳定 DOM ID，也没有足够公开字段生成稳定摘要。');
      const sourceDigest = await digest(identity);
      if (seenSources.has(sourceDigest)) continue;
      seenSources.add(sourceDigest);
      const description = firstText(item, JOB_SELECTORS.description, 10000);
      const values = [title, location, salaryDisplay, experienceRequirement, educationRequirement, description];
      entries.push({ sourceDigest, title, location: location || null, salaryDisplay: salaryDisplay || null, salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths: salary.months, experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null, description: description || null, completeness: values.filter(Boolean).length, platformStatus: platformJobStatus(item) });
    }
    if (!entries.length) return blocked('JOB_LIST_EMPTY_AFTER_DEDUP', '职位行去重后没有可同步数据。');
    const scope = selectedJobListScope();
    const authoritative = scope === 'OPEN_JOBS' && entries.every((entry) => entry.platformStatus === 'OPEN') && completeVisibleJobList(entries.length);
    const signature = `${scope}:${authoritative}|${entries.map((entry) => `${entry.sourceDigest}:${entry.title}:${entry.platformStatus}:${entry.location || ''}:${entry.salaryDisplay || ''}:${entry.experienceRequirement || ''}:${entry.educationRequirement || ''}:${entry.description || ''}`).join('|')}`;
    return { ok: true, entries, signature, scope, authoritative };
  }

  function platformJobStatus(root) {
    if (hasExactVisibleText(root, '已关闭') || hasExactVisibleText(root, '重新开放') || hasExactVisibleText(root, '开放职位')) return 'CLOSED';
    if (hasExactVisibleText(root, '关闭') || hasExactVisibleText(root, '开放中') || hasExactVisibleText(root, '招聘中')) return 'OPEN';
    return 'UNKNOWN';
  }

  function selectedJobListScope() {
    const selected = [...document.querySelectorAll('[aria-selected="true"], [role="tab"].active, .tab-item.active, .ui-tab-item.active, .tabs-item.active')]
      .filter(visible).map((node) => compact(node.textContent)).join(' ');
    if (/(已关闭|关闭中|已下架)/.test(selected)) return 'CLOSED_JOBS';
    if (/(招聘中|开放中|在招|发布中)/.test(selected)) return 'OPEN_JOBS';
    return 'MIXED';
  }

  function completeVisibleJobList(visibleCount) {
    const nextButtons = [...document.querySelectorAll('[aria-label*="下一页"], .btn-next, .pagination-next, [class*="pager"] [class*="next"]')].filter(visible);
    const hasEnabledNext = nextButtons.some((node) => !node.disabled && node.getAttribute('aria-disabled') !== 'true' && !node.classList.contains('disabled'));
    if (hasEnabledNext) return false;
    const text = compact(document.body?.innerText);
    const declared = [...text.matchAll(/(?:共|全部)\s*(\d{1,3})\s*(?:个|条)?\s*职位/g)].map((match) => Number(match[1])).find((value) => value > 0);
    return declared === undefined || declared === visibleCount;
  }

  function findJobCards() {
    for (const selector of JOB_SELECTORS.cards) {
      const exactKnownRow = selector.startsWith('.job-jobInfo-warp');
      const items = [...document.querySelectorAll(selector)].filter(visible).filter((item) => exactKnownRow || stableJobIdentity(item));
      if (items.length) {
        const unique = new Map();
        for (const [index, item] of items.entries()) {
          const key = stableJobIdentity(item) || `known-row:${index}`;
          unique.set(key, unique.get(key) || item);
        }
        return [...unique.values()].slice(0, 201);
      }
    }
    return findSemanticJobRows().slice(0, 201);
  }

  function findSemanticJobRows() {
    const edits = [...document.querySelectorAll('a, button, span, div')]
      .filter((node) => visible(node) && compact(node.textContent) === '编辑');
    const rows = new Set();
    for (const edit of edits) {
      let node = edit.parentElement;
      for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const text = compact(node.innerText || node.textContent);
        if (rect.width >= 500 && rect.height >= 55 && rect.height <= 260 && hasExactVisibleText(node, '关闭') && looksLikeJobPublicText(text)) {
          rows.add(node);
          break;
        }
      }
    }
    return [...rows].filter(visible);
  }

  function hasExactVisibleText(root, expected) {
    return [...root.querySelectorAll('a, button, span, div')].some((node) => visible(node) && compact(node.textContent) === expected);
  }

  function looksLikeJobPublicText(text) {
    const patterns = [
      /\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk]/,
      /(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)/,
      /(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?/,
      /(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)/,
      /(?:全职|兼职|实习)/,
    ];
    return patterns.filter((pattern) => pattern.test(text)).length >= 2;
  }

  function deriveJobTitle(root) {
    const lines = String(root.innerText || '').split(/\n+/).map(compact).filter(Boolean);
    return (lines.find((line) => line.length >= 2 && line.length <= 120
      && !['编辑', '关闭', '开放中', '待开放', '已关闭', '全职', '兼职', '实习'].includes(line)
      && !/^(?:\d+|看过我|沟通过|感兴趣|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?到期)$/.test(line)
      && !looksLikePureJobMeta(line)) || '').slice(0, 120);
  }

  function looksLikePureJobMeta(line) {
    return /^(?:(?:北京|上海|天津|重庆|广州|深圳|杭州|南京|苏州|成都|武汉|西安|长沙|郑州|厦门|合肥|青岛|济南|无锡|宁波|东莞|佛山)|(?:经验不限|应届生|在校生|\d{1,2}(?:-\d{1,2})?年(?:以上)?)|(?:学历不限|初中及以下|中专\/中技|高中|大专|本科|硕士|博士)(?:及以上)?|\d{1,3}(?:\.\d+)?\s*[-–~至]\s*\d{1,3}(?:\.\d+)?\s*[Kk])$/.test(line);
  }

  function stableJobIdentity(item) {
    const allowed = /^(data-(?:job-id|position-id|encrypt-id|security-id|id))$/i;
    for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || '').trim();
        if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
      }
    }
    const link = item.matches('a[href]') ? item : item.querySelector('a[href*="job"],a[href*="position"]');
    if (!link) return '';
    try { const url = new URL(link.href, location.origin); return `${url.pathname}${url.search}`; } catch { return ''; }
  }

  function firstText(root, selectors, max) {
    for (const selector of selectors) {
      const value = compact([...root.querySelectorAll(selector)].find(visible)?.textContent);
      if (value) return value.slice(0, max);
    }
    return '';
  }

  function compact(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  const UNREAD_INDICATOR_SELECTORS = [
    '.badge-count', '[class*="badge-count"]', '[class*="unread"]',
    '[class*="new-msg"]', '[class*="red-point"]', '[aria-label*="未读"]', '[title*="未读"]',
  ];
  function findUnreadNode(item) {
    if (item.matches('[data-unread="true"], [aria-label*="未读"], [title*="未读"]')) return item;
    for (const selector of UNREAD_INDICATOR_SELECTORS) {
      const node = item.querySelector(selector);
      if (node && visible(node)) return node;
    }
    return null;
  }
  function hasUnread(item) { return Boolean(findUnreadNode(item)); }
  function cleanMultiline(value) { return String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim(); }
  function matchText(value, pattern) { return compact(value.match(pattern)?.[0]); }
  function parseSalary(value) {
    const match = String(value || '').match(/(\d{1,3}(?:\.\d+)?)\s*[-–~至]\s*(\d{1,3}(?:\.\d+)?)\s*[Kk]/);
    const months = Number(String(value || '').match(/(?:[·x×]\s*)?(\d{2})\s*薪/)?.[1]);
    return { min: match ? Math.max(1, Math.round(Number(match[1]))) : null, max: match ? Math.max(1, Math.round(Number(match[2]))) : null, months: months >= 12 && months <= 16 ? months : null };
  }

  async function collectSnapshot() {
    const items = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible).slice(0, 201);
    if (!items.length) return blocked('CHAT_LIST_NOT_FOUND', '当前页面未找到可见会话列表。');
    if (items.length > 200) return blocked('CHAT_LIST_TOO_LARGE', '当前会话数量超过安全上限。');
    const entries = [];
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return blocked('CHAT_ID_MISSING', '会话列表没有稳定 DOM ID，已禁止猜测会话身份。');
      const preview = textOf(item, SELECTORS.preview);
      const job = textOf(item, SELECTORS.job);
      const time = textOf(item, SELECTORS.time);
      const unreadNode = findUnreadNode(item);
      const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
      entries.push({
        chatDigest: await digest(identity), previewDigest: preview ? await digest(preview) : null,
        jobDigest: job ? await digest(job) : null, jobTitle: job ? job.slice(0, 120) : null,
        timeDigest: time ? await digest(time) : null, unreadCount,
      });
    }
    const signature = entries.map((entry) => `${entry.chatDigest}:${entry.unreadCount}:${entry.previewDigest || ''}:${entry.jobDigest || ''}:${entry.timeDigest || ''}`).join('|');
    return { ok: true, entries, signature };
  }

  async function collectPostSendConversation(expectedChatDigest, originalPanel, anchors) {
    const selected = await collectSelectedConversation();
    if (selected.ok) return selected; // A different selected chat must never use the fallback.
    if (selected.code !== 'NO_SELECTED_CONVERSATION') return selected;
    const panels = [...document.querySelectorAll(SELECTORS.activeConversation)].filter(visible);
    if (panels.length !== 1 || panels[0] !== originalPanel || !originalPanel.isConnected
        || anchors.length === 0) return selected;
    const currentTurns = readConversationTurns(originalPanel);
    // Panel continuity alone is insufficient: BOSS can reuse its container for another chat.
    // Require the original message nodes AND their identities/content/directions in order.
    let previousIndex = -1;
    for (const anchor of anchors) {
      const index = currentTurns.findIndex(turn => turn.node === anchor.node
        && turn.identity === anchor.identity && turn.rawText === anchor.rawText
        && turn.direction === anchor.direction);
      if (index <= previousIndex) return selected;
      previousIndex = index;
    }
    return collectActiveConversationDetail(expectedChatDigest, false);
  }

  async function collectSelectedConversation() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '当前没有 HR 手动打开的会话。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话没有稳定 DOM ID。');
    const chatDigest = await digest(identity);
    const result = await collectActiveConversationDetail(chatDigest, hasUnread(selected));
    if (result.ok) singleAccountActiveChatDigest = chatDigest;
    return result;
  }

  async function collectTargetBoundConversation(target, expectedChatDigest) {
    const selected = await collectSelectedConversation();
    if (selected.ok && selected.chatDigest === expectedChatDigest) return selected;
    if (!(target instanceof HTMLElement)) return selected;
    const identity = stableIdentity(target);
    if (!identity || await digest(identity) !== expectedChatDigest) return selected;
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    const last = active
      ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
      : null;
    const rowPreview = compact(textOf(target, SELECTORS.preview));
    const detailText = compact(last?.textContent || '');
    // BOSS may virtualize the selected row or temporarily remove its selected
    // class while leaving the correct detail pane visible. Only bind the
    // already-clicked target when a non-trivial row preview is present in the
    // active pane's last message; short/common text is never used as identity.
    const previewMatches = rowPreview.length >= 4
      && detailText.length >= rowPreview.length
      && detailText.includes(rowPreview);
    if (!last || !previewMatches) return selected;
    const result = await collectActiveConversationDetail(expectedChatDigest, hasUnread(target));
    if (result.ok) {
      singleAccountActiveChatDigest = expectedChatDigest;
      traceAutoReply('TARGET_BOUND_BY_PREVIEW', {
        chatDigest: expectedChatDigest, messageDigest: result.messageDigest,
        outcome: 'SUCCESS', reason: '选中行被虚拟列表重绘，已通过目标行摘要与右侧末条消息一致性安全绑定。',
      });
    }
    return result;
  }

  async function collectKnownActiveConversation() {
    if (!singleAccountActiveChatDigest) {
      return blocked('ACTIVE_CONVERSATION_UNBOUND', '当前消息面板还没有与已验证的会话绑定。');
    }
    return collectActiveConversationDetail(singleAccountActiveChatDigest, false);
  }

  async function collectExpectedActiveConversation(expectedChatDigest) {
    const selected = await collectSelectedConversation();
    if (selected.ok) return selected;
    if (expectedChatDigest && singleAccountActiveChatDigest === expectedChatDigest) {
      return collectKnownActiveConversation();
    }
    return selected;
  }

  async function collectActiveConversationDetail(chatDigest, selectedUnread) {
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息容器尚未就绪。');
    const turns = readConversationTurns(active);
    const last = turns.at(-1);
    if (!last) return blocked('LAST_MESSAGE_NOT_FOUND', '当前会话没有可识别的最后消息。');
    const { direction, messageAt } = last;
    const content = last.rawText;
    if (!messageAt) return blocked('TIME_UNRECOGNISED', '当前会话最后消息时间无法解析。');
    const messageDigest = await digest(last.identity);
    const conversationSignals = collectConversationSignals();
    const signalSignature = Object.values(conversationSignals).map((value) => value ? '1' : '0').join('');
    const messageText = content ? compact(content).slice(0, 1000) : null;
    const contextLines = turns.slice(-13, -1)
      .map((item) => {
        const text = item.rawText.slice(0, 300);
        if (!text) return null;
        return `${item.direction === 'INBOUND' ? '候选人' : 'HR'}：${text}`;
      }).filter(Boolean);
    while (contextLines.length > 1 && contextLines.join('\n').length > 2400) contextLines.shift();
    const conversationContext = contextLines.join('\n');
    return { ok: true, chatDigest, messageDigest, direction, messageAt, selectedUnread, conversationSignals, messageText, conversationContext, signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}:${signalSignature}` };
  }

  // Use the same identity for the latest-message snapshot and the full BOSS
  // transcript. The old transcript fallback included the chat id and array
  // index while the snapshot did not, creating two IDs for one real turn.
  function readConversationTurns(active) {
    const timeline = [...active.querySelectorAll(`${SELECTORS.messageTime}, ${SELECTORS.message}`)];
    const turns = [];
    let currentTime = '';
    for (const node of timeline) {
      if (node.matches(SELECTORS.messageTime)) {
        currentTime = compact(node.textContent || '').slice(0, 40);
        continue;
      }
      if (!visible(node) || node.parentElement?.closest(SELECTORS.message)) continue;
      const direction = directionOf(node);
      if (!direction) continue;
      const timeLabel = compact(node.querySelector(SELECTORS.messageTime)?.textContent || currentTime).slice(0, 40);
      const messageAt = parseTime(timeLabel);
      const rawText = cleanConversationMessageText(node.textContent || '');
      const mediaShape = [...node.querySelectorAll('img, video, audio, svg')]
        .map((item) => item.tagName.toLowerCase()).join(',') || 'non-text';
      const stable = stableIdentity(node);
      const derived = `derived:${direction}:${messageAt}:${rawText || mediaShape}`;
      turns.push({ node, direction, timeLabel, messageAt, rawText, stable, derived });
    }
    const totals = new Map();
    for (const turn of turns) if (!turn.stable) totals.set(turn.derived, (totals.get(turn.derived) || 0) + 1);
    const occurrences = new Map();
    return turns.map((turn) => {
      if (turn.stable) return { ...turn, identity: turn.stable };
      const occurrence = (occurrences.get(turn.derived) || 0) + 1;
      occurrences.set(turn.derived, occurrence);
      return { ...turn, identity: totals.get(turn.derived) > 1 ? `${turn.derived}|occurrence:${occurrence}` : turn.derived };
    });
  }

  async function collectCurrentTranscript() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '请先在 BOSS 沟通页打开需要复制的会话。');
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息区域尚未加载完成，请稍后重试。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话缺少稳定标识，已停止复制以免读取错误会话。');
    transcriptCaptureInProgress = true;
    try {
      const scroller = findTranscriptScroller(active);
      const initialLastNode = readConversationTurns(active).at(-1)?.node || null;
      const initialLastText = cleanConversationMessageText(initialLastNode?.textContent || '');
      const distanceFromBottom = scroller ? scroller.scrollHeight - scroller.scrollTop : 0;
      let stableRounds = 0;
      let previousShape = '';
      let reachedBeginning = !scroller;
      for (let attempt = 0; scroller && attempt < 18; attempt++) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await delay(350);
        const count = active.querySelectorAll(SELECTORS.message).length;
        const shape = `${count}:${scroller.scrollHeight}`;
        stableRounds = shape === previousShape ? stableRounds + 1 : 0;
        previousShape = shape;
        if (scroller.scrollTop <= 2 && stableRounds >= 3) { reachedBeginning = true; break; }
      }

      const coveredLatest = !scroller || (initialLastNode && active.contains(initialLastNode)
        && cleanConversationMessageText(initialLastNode.textContent || '') === initialLastText);
      const records = readConversationTurns(active).map((turn) => ({
        speaker: turn.direction === 'INBOUND' ? '候选人' : 'HR', direction: turn.direction,
        time: turn.timeLabel, messageIdentity: turn.identity,
        messageAt: turn.messageAt || null, text: transcriptMessageText(turn.node), node: turn.node,
      })).filter((record) => record.text);
      const firstCapturedNode = records[0]?.node || null;
      const firstCapturedText = cleanConversationMessageText(firstCapturedNode?.textContent || '');
      if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight - distanceFromBottom);
      if (scroller) await delay(100);
      const coveredBeginning = !scroller || (firstCapturedNode && active.contains(firstCapturedNode)
        && cleanConversationMessageText(firstCapturedNode.textContent || '') === firstCapturedText);
      const selectedAfter = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
      if (!selectedAfter || stableIdentity(selectedAfter) !== identity) {
        return blocked('SELECTED_CONVERSATION_CHANGED', '读取期间当前会话发生变化，已停止复制以避免混入其他候选人的消息。');
      }
      if (!records.length) return blocked('TRANSCRIPT_EMPTY', '当前会话没有可复制的文字或附件记录。');

      const limited = records.slice(-1000);
      const chatDigest = await digest(identity);
      const turns = [];
      for (let index = 0; index < limited.length; index++) {
        const record = limited[index];
        turns.push({
          messageDigest: await digest(record.messageIdentity),
          direction: record.direction, messageAt: record.messageAt, content: record.text,
        });
      }
      const jobTitle = compact(selected.querySelector(SELECTORS.job)?.textContent || '').slice(0, 120);
      const lines = ['BOSS 当前会话记录（已脱敏）', jobTitle ? `岗位：${redactTranscript(jobTitle)}` : null,
        `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
      for (const record of limited) lines.push(`${record.time ? `[${record.time}] ` : ''}${record.speaker}：${record.text}`);
      const raw = lines.filter((line) => line !== null).join('\n');
      const text = raw.length > 120_000 ? raw.slice(raw.length - 120_000) : raw;
      return { ok: true, transcript: {
        text, messageCount: limited.length, chatDigest, jobTitle,
        turns,
        possiblyTruncated: !reachedBeginning || !coveredLatest || !coveredBeginning || records.length > limited.length || raw.length > text.length,
        redacted: true,
      } };
    } finally {
      transcriptCaptureInProgress = false;
    }
  }

  function findTranscriptScroller(active) {
    let node = active;
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 20 && /(auto|scroll)/.test(style.overflowY)) return node;
    }
    return active.scrollHeight > active.clientHeight + 20 ? active : null;
  }

  function transcriptMessageText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(`${SELECTORS.messageTime}, script, style, input, textarea, button, .message-card-buttons, .message-status, .message-read-status, [class*="delivery"], [class*="read-status"], [class*="send-status"], [aria-label*="送达"], [title*="送达"]`).forEach((item) => item.remove());
    const text = cleanConversationMessageText(clone.textContent || '').slice(0, 4000);
    if (text) return redactTranscript(text);
    if (node.querySelector('img')) return '[图片]';
    if (node.querySelector('video')) return '[视频]';
    if (node.querySelector('audio')) return '[语音]';
    if (node.querySelector('.message-card-wrap, .hyperLink, [class*="attachment"], [class*="resume"]')) return '[附件或简历]';
    return '';
  }

  // BOSS 将“送达/已读/发送中”等状态渲染在消息节点内部；这些是展示元数据，不是会话正文。
  function cleanConversationMessageText(value) {
    return compact(String(value || '').replace(/(?:^|[\s|｜·•])(?:已?送达|已读|未读|发送中|发送失败|发送成功)(?=$|[\s|｜·•])/g, ' '));
  }

  function redactTranscript(value) {
    return compact(value)
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号已脱敏]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已脱敏]')
      .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证号已脱敏]')
      .replace(/((?:微信|微 信|V信|wx)\s*[:：]?\s*)[A-Za-z][A-Za-z0-9_-]{5,19}/gi, '$1[微信号已脱敏]');
  }

  function collectConversationSignals() {
    const { editor } = findReplyControls();
    const scope = editor?.closest('.conversation-operate');
    const empty = {
      requestResumeAvailable: false, resumeReceived: false,
      exchangeWechatAvailable: false, exchangePhoneAvailable: false,
      wechatExchanged: false, phoneExchanged: false,
      scheduleInterviewAvailable: false, interviewScheduled: false,
    };
    if (!scope) return empty;
    const nodes = [...scope.querySelectorAll('.toolbar-box-right .operate-exchange-left .operate-btn, button, [role="button"], [class*="status"]')]
      .filter((node) => visible(node));
    const labels = nodes.map((node) => ({ node, label: compact(controlLabel(node)) }));
    const has = (...expected) => labels.some(({ label }) => expected.some((value) => label === value || label.startsWith(`${value} `)));
    const available = (...expected) => labels.some(({ node, label }) => expected.some((value) => label === value || label.startsWith(`${value} `)) && isAvailableAction(node));
    return {
      requestResumeAvailable: available('求简历'),
      resumeReceived: has('查看简历') || Boolean(findVisibleResumeRoot()) || Boolean(findResumeOpenControl()),
      exchangeWechatAvailable: available('换微信', '交换微信'),
      exchangePhoneAvailable: available('换电话', '交换电话'),
      wechatExchanged: has('查看微信'),
      phoneExchanged: has('查看电话'),
      scheduleInterviewAvailable: available('约面试'),
      interviewScheduled: has('面试时间已确认'),
    };
  }

  function findVisibleResumeRoot() {
    const dialog = [...document.querySelectorAll('.resume-common-dialog.search-resume, .resume-common-dialog')].find(visible);
    if (!dialog) return null;
    return [...dialog.querySelectorAll('.resume-detail.resume-detail-chat, .resume-content, .new-resume-online-main-ui')]
      .filter(visible)
      .sort((left, right) => String(right.innerText || '').length - String(left.innerText || '').length)[0] || null;
  }

  function findResumeOpenControl() {
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return null;
    const matches = [...active.querySelectorAll('button, a, [role="button"], .card-btn, .hyperLink, [class*="resume"], [class*="attachment"], [class*="file"], [class*="preview"]')]
      .filter(visible)
      .map((node) => ({ node, label: compact(controlLabel(node)), area: node.getBoundingClientRect().width * node.getBoundingClientRect().height }))
      .filter(({ node, label }) => /^(?:查看简历|点击预览附件简历|预览附件简历)$/.test(label) && label.length <= 80
        && isAvailableAction(node))
      .sort((left, right) => left.area - right.area);
    return matches[0]?.node || null;
  }

  async function openVisibleResume(expectedChatDigest) {
    const first = await collectExpectedActiveConversation(expectedChatDigest);
    if (!first.ok || first.chatDigest !== expectedChatDigest) return { ok: false, error: '当前选中会话与待接收简历不一致。' };
    if (findVisibleResumeRoot()) return { ok: true, alreadyOpen: true };
    const control = findResumeOpenControl();
    if (!control) return { ok: false, error: '当前会话尚未找到唯一可用的“查看简历”或“点击预览附件简历”入口。' };
    control.click();
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(300);
      const current = await collectExpectedActiveConversation(expectedChatDigest);
      if (!current.ok || current.chatDigest !== expectedChatDigest) return { ok: false, error: '打开简历后目标会话发生变化，已停止。' };
      if (findVisibleResumeRoot()) return { ok: true, alreadyOpen: false };
    }
    return { ok: false, error: '已打开一次“查看简历”，但在线简历正文未在限定时间内稳定呈现。' };
  }

  async function collectVisibleResumeText() {
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: false, error: selected.reason };
    const root = findVisibleResumeRoot();
    if (!root) return { ok: false, error: '请保持当前会话的在线简历弹窗打开。' };
    const copy = root.cloneNode(true);
    copy.querySelectorAll('script, style, button, input, textarea, .attachment-resume-btns, .close-btn, [role="button"]')
      .forEach((node) => node.remove());
    const resumeText = String(copy.textContent || '').replace(/\u00a0/g, ' ').replace(/[\t\x0B\f\r ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, 30000);
    if (resumeText.length < 100) return { ok: false, error: '在线简历正文尚未完整渲染。' };
    const textDigest = await digest(resumeText);
    const sourceEventDigest = await digest(`${selected.chatDigest}|${selected.messageDigest}|${textDigest}`);
    return { ok: true, resume: { actionType: 'VISIBLE_RESUME_TEXT_CAPTURE', chatDigest: selected.chatDigest,
      sourceEventDigest, textDigest, resumeText, resumeReceived: true } };
  }

  async function collectVisibleResumePdf() {
    const selected = await collectSelectedConversation();
    if (!selected.ok) return { ok: false, error: selected.reason };
    const iframe = findVisibleResumePdfFrame();
    if (!iframe) return { ok: false, error: '当前简历预览中没有找到 PDF 载体。' };
    const source = String(iframe.getAttribute('src') || iframe.src || '').trim();
    if (!source || !/^(?:blob:|https?:)/i.test(source)) return { ok: false, error: '当前 PDF 预览地址不可读取。' };
    let response;
    try { response = await fetch(source, { credentials: 'include', signal: AbortSignal.timeout(3_000) }); }
    catch { return { ok: false, error: '当前 PDF 资源无法从页面安全读取。' }; }
    if (!response.ok) return { ok: false, error: `当前 PDF 资源读取失败（HTTP ${response.status}）。` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 5 || buffer.byteLength > 8 * 1024 * 1024) return { ok: false, error: '当前 PDF 文件大小不在允许范围内。' };
    const bytes = new Uint8Array(buffer);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { ok: false, error: '当前预览资源不是有效 PDF 文件。' };
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const fileDigest = await digest(btoa(binary));
    const sourceEventDigest = await digest(`${selected.chatDigest}|${selected.messageDigest}|${fileDigest}`);
    return { ok: true, resume: { actionType: 'VISIBLE_RESUME_PDF_CAPTURE', chatDigest: selected.chatDigest,
      sourceEventDigest, fileDigest, fileBase64: btoa(binary), fileSize: bytes.length } };
  }

  function findVisibleResumePdfFrame() {
    return [...document.querySelectorAll('iframe.attachment-iframe, .attachment-view iframe')].find(visible) || null;
  }

  function findVisibleResumeDialog() {
    return [...document.querySelectorAll('.resume-common-dialog.search-resume, .resume-common-dialog, .attachment-view')]
      .find((node) => node instanceof HTMLElement && visible(node)) || null;
  }

  function resumeDialogDiagnostics() {
    const selectors = [
      '.resume-common-dialog.search-resume',
      '.resume-common-dialog',
      '.attachment-view',
      '.attachment-view iframe',
    ];
    const nodes = new Map();
    for (const selector of selectors) {
      for (const node of [...document.querySelectorAll(selector)].slice(0, 4)) {
        if (!(node instanceof Element)) continue;
        const selectorsForNode = nodes.get(node) || [];
        if (!selectorsForNode.includes(selector)) selectorsForNode.push(selector);
        nodes.set(node, selectorsForNode);
      }
    }
    const entries = [];
    for (const [node, matchedSelectors] of nodes) {
      if (!(node instanceof Element)) continue;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      entries.push(`${matchedSelectors.join('|')}#${resumeDialogDiagnosticId(node)}=${describeDomNode(node)} connected=${node.isConnected} visible=${visible(node)} display=${style.display} visibility=${style.visibility} opacity=${style.opacity} rect=${Math.round(rect.width)}x${Math.round(rect.height)}`);
      if (entries.length >= 6) return entries.join(' | ');
    }
    return entries.length ? entries.join(' | ') : '未找到预览候选节点';
  }

  function resumeDialogDiagnosticId(node) {
    if (!(node instanceof Element)) return 'none';
    let id = resumeDialogDiagnosticIds.get(node);
    if (!id) {
      resumeDialogDiagnosticSequence += 1;
      id = `rd${resumeDialogDiagnosticSequence}`;
      resumeDialogDiagnosticIds.set(node, id);
    }
    return id;
  }

  function isKnownResumeDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) return false;
    if (dialog.matches('.resume-common-dialog.search-resume, .resume-common-dialog')) return true;
    return dialog.matches('.attachment-view') && Boolean(findVisibleResumePdfFrame());
  }

  function reportResumeCloseDom(dialog, candidates, close) {
    const dialogDom = `${resumeDialogDiagnosticId(dialog)} ${describeDomNode(dialog)}`;
    const candidateDoms = (candidates || []).slice(0, 5).map((node) => `${resumeDialogDiagnosticId(node)} ${describeDomNode(node)}`).join(', ') || '无';
    const closeDom = close ? `${resumeDialogDiagnosticId(close)} ${describeDomNode(close)}` : '未找到';
    const reason = `简历预览容器 DOM=${dialogDom}；关闭按钮 DOM=${closeDom}；候选按钮=${candidateDoms}`;
    const now = Date.now();
    const key = `${dialogDom}|${closeDom}|${candidateDoms}`;
    if (key === lastResumeCloseDomProbeKey && now - lastResumeCloseDomProbeAt < 10_000) return;
    lastResumeCloseDomProbeKey = key;
    lastResumeCloseDomProbeAt = now;
    showResumeCaptureStatus(`DOM监测：${reason}`, close ? 'info' : 'error');
  }

  async function ensureResumePreviewClosedForAutoReply(expectedChatDigest = null, options = {}) {
    const dialog = findVisibleResumeDialog();
    if (!dialog) return true;
    if ((resumePdfForwardInFlight || resumePdfBackendRequestsInFlight.size > 0)
        && options.importTerminal !== true) {
      traceAutoReply('RESUME_PREVIEW_CLOSE_DEFERRED', {
        chatDigest: expectedChatDigest || singleAccountPendingChatDigest || null,
        outcome: 'WAITING',
        reason: 'PDF 仍在向后端传输，禁止关闭预览；等待上传返回明确成功或失败结果。',
      });
      return false;
    }
    const selected = await collectSelectedConversation();
    const fallbackChatDigest = expectedChatDigest || singleAccountPendingChatDigest || null;
    if ((!selected.ok && !isKnownResumeDialog(dialog)) || (selected.ok && expectedChatDigest && selected.chatDigest !== expectedChatDigest)) {
      const reason = !selected.ok ? (selected.reason || '当前会话不可识别') : '当前会话与预览来源不一致';
      traceAutoReply('RESUME_PREVIEW_CLOSE_BLOCKED', {
        chatDigest: selected.chatDigest || fallbackChatDigest,
        outcome: 'BLOCKED',
        reason: `检测到简历预览，但为避免误关其他会话窗口未执行关闭：${reason}。`,
      });
      return false;
    }
    const closeScope = selected.ok ? selected.chatDigest : fallbackChatDigest;
    const closed = await closeVisibleResumePreview(closeScope, { allowWithoutSelected: true });
    const remainingAfterClose = findVisibleResumeDialog();
    if (closed && !remainingAfterClose) {
      traceAutoReply('RESUME_PREVIEW_CLOSED', {
        chatDigest: closeScope,
        outcome: 'SUCCESS',
        reason: selected.ok ? '已关闭遗留简历预览并确认弹窗消失。' : '会话节点暂不可见，已基于已识别简历预览容器关闭并确认弹窗消失。',
      });
      return true;
    }
    if (closed && remainingAfterClose) {
      traceAutoReply('RESUME_PREVIEW_CLOSE_RECHECK', {
        chatDigest: closeScope,
        outcome: 'WAITING',
        reason: `关闭函数已返回成功，但复查仍命中预览节点：${resumeDialogDiagnostics()}`,
      });
    }
    // Some BOSS builds expose a close control only after the iframe finishes
    // mounting. One Escape fallback is safe here because the dialog was
    // already identified as the current resume preview.
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
    });
    const escapeTarget = remainingAfterClose || findVisibleResumeDialog() || dialog;
    escapeTarget.dispatchEvent(escapeEvent);
    document.dispatchEvent(escapeEvent);
    await delay(450);
    if (!findVisibleResumeDialog()) {
      traceAutoReply('RESUME_PREVIEW_CLOSED', {
        chatDigest: closeScope,
        outcome: 'SUCCESS',
        reason: '关闭按钮未即时生效，已通过一次 Escape 关闭并确认弹窗消失。',
      });
      return true;
    }
    traceAutoReply('RESUME_PREVIEW_CLOSE_BLOCKED', {
      chatDigest: closeScope,
      outcome: 'BLOCKED',
      reason: `关闭按钮与一次 Escape 均未使简历预览消失，已暂停切换会话；最终快照：${resumeDialogDiagnostics()}`,
    });
    return false;
  }

  let resumePdfForwardInFlight = null;
  let resumePdfForwardInFlightEpoch = null;
  const resumePdfBackendRequestsInFlight = new Set();
  let lastResumePdfForwardKey = '';
  let lastResumePdfForwardAt = 0;

  async function sendResumePdfCaptureToBackend(payload) {
    const request = send({ type: 'BRIDGE_VISIBLE_RESUME_PDF_CAPTURE', payload });
    resumePdfBackendRequestsInFlight.add(request);
    try {
      return await request;
    } finally {
      resumePdfBackendRequestsInFlight.delete(request);
    }
  }

  async function waitForResumePdfBackendTerminal() {
    while (resumePdfBackendRequestsInFlight.size > 0) {
      await Promise.allSettled([...resumePdfBackendRequestsInFlight]);
    }
  }

  async function forwardMainWorldResumePdf(data) {
    // Receiving the PDF proves that the preview is already open. Revoke the
    // one-shot permission immediately so a BOSS card re-render cannot make a
    // delayed scan click a newly-created preview control and reopen the modal.
    resumePreviewOpenPending = false;
    clearTimeout(resumeCardScanTimer);
    resumeCardScanTimer = null;
    const captureKey = `${data?.fileSize || 0}:${String(data?.fileBase64 || '').slice(0, 96)}`;
    const captureEpoch = resumeAttachmentEpoch;
    if (resumePdfForwardInFlight && resumePdfForwardInFlightEpoch === captureEpoch) {
      showResumeCaptureStatus('content：PDF 正在发送中，忽略重复捕获。');
      return resumePdfForwardInFlight;
    }
    if (captureKey === lastResumePdfForwardKey && Date.now() - lastResumePdfForwardAt < 10_000) {
      showResumeCaptureStatus('content：同一份 PDF 已提交，忽略重复捕获。');
      return;
    }
    lastResumePdfForwardKey = captureKey;
    lastResumePdfForwardAt = Date.now();
    const run = forwardMainWorldResumePdfOnce(data, captureEpoch);
    const wrapped = run.finally(() => {
      if (resumePdfForwardInFlight === wrapped) {
        resumePdfForwardInFlight = null;
        resumePdfForwardInFlightEpoch = null;
      }
    });
    resumePdfForwardInFlight = wrapped;
    resumePdfForwardInFlightEpoch = captureEpoch;
    return resumePdfForwardInFlight;
  }

  async function forwardMainWorldResumePdfOnce(data, captureEpoch) {
    const isCurrentCapture = () => captureEpoch === resumeAttachmentEpoch;
    if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
    showResumeCaptureStatus('content：收到 PDF 数据，大小=' + (data.fileSize || '?') + ' bytes');
    if (typeof data.fileBase64 !== 'string' || !Number.isInteger(data.fileSize)
        || data.fileSize < 5 || data.fileSize > 8 * 1024 * 1024 || data.fileBase64.length > 12_000_000) {
      showResumeCaptureStatus('content：PDF 数据校验失败');
      return;
    }
    let selected = await collectExpectedActiveConversation(singleAccountPendingChatDigest);
    if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
    if (!selected.ok) {
      showResumeCaptureStatus('content：collectSelectedConversation 失败: ' + (selected.reason || 'unknown'));
      return;
    }
    showResumeCaptureStatus('content：会话识别成功，chatDigest=' + (selected.chatDigest || '').slice(0, 12));
    const fileDigest = await digest(data.fileBase64);
    let response = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
      await waitForCollectionIdle(2_500);
      // Resume processing runs while autoReplyBusy is held. Explicitly allow
      // this stability snapshot so the background runtime gets the current digest.
      await collectAndPublish(true, true);
      await waitForCollectionIdle(2_500);
      const refreshed = await collectExpectedActiveConversation(selected.chatDigest);
      if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
      if (!refreshed.ok || refreshed.chatDigest !== selected.chatDigest) {
        showResumeCaptureStatus(`content：第 ${attempt}/4 次等待会话摘要稳定，暂不提交 PDF。`);
        if (attempt === 4) {
          response = { ok: false, error: '当前 PDF 与预览中的稳定会话不一致，已停止导入。' };
          break;
        }
        await delay(attempt * 600);
        continue;
      }
      selected = refreshed;
      const sourceEventDigest = await digest(`${selected.chatDigest}|${selected.messageDigest}|${fileDigest}`);
      const payload = {
        actionType: 'VISIBLE_RESUME_PDF_CAPTURE', chatDigest: selected.chatDigest,
        sourceEventDigest, fileDigest, fileBase64: data.fileBase64, fileSize: data.fileSize,
      };
      showResumeCaptureStatus(`content：正在发送 PDF 到后端（第 ${attempt}/4 次）...`);
      response = await sendResumePdfCaptureToBackend(payload);
      if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
      if (response?.ok) break;
      const reason = String(response?.error || '');
      if (!/稳定|会话|观测|通信失败|无响应/.test(reason) || attempt === 4) break;
      showResumeCaptureStatus(`后端尚未就绪，将自动重试：${reason}`);
      await delay(attempt * 600);
    }
    if (!isCurrentCapture()) return { ok: false, error: '本轮简历处理已超时，已取消后续页面操作。' };
    showResumeImportResult(response);
    const previewClosed = await ensureResumePreviewClosedForAutoReply(selected.chatDigest, { importTerminal: true });
    lastResumePdfImportOutcome = response?.ok && previewClosed
      ? { ok: true, chatDigest: selected.chatDigest, intakeId: response.intakeId || '', analysisStatus: response.analysisStatus || '' }
      : { ok: false, chatDigest: selected.chatDigest, error: response?.ok ? '简历已导入，但预览窗口未确认关闭' : response?.error || '后端导入失败' };
    return response;
  }

  function dispatchResumePreviewEscape(target) {
    const createEscapeEvent = () => new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
    });
    if (target && typeof target.dispatchEvent === 'function') target.dispatchEvent(createEscapeEvent());
    document.dispatchEvent(createEscapeEvent());
  }

  function findResumeCloseButton(dialog) {
    if (!(dialog instanceof HTMLElement)) return { candidates: [], close: null };
    const dialogRect = dialog.getBoundingClientRect();
    const candidates = [...dialog.querySelectorAll('.close-btn, .boss-popup__close, .dialog-close, [class*="close"], [aria-label="关闭"], [title="关闭"]')]
      .filter((node) => {
        if (!(node instanceof HTMLElement) || !visible(node) || !isAvailableAction(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width <= 72
          && rect.height <= 72
          && rect.right >= dialogRect.right - 120
          && rect.top <= dialogRect.top + 120;
      });
    const close = candidates.find((node) => {
      const label = compact(controlLabel(node));
      const cls = String(node.className || '');
      return /^(?:关闭|close)?$/i.test(label) || /(?:^|[-_])close(?:[-_]|$)/i.test(cls);
    }) || null;
    return { candidates, close };
  }

  async function closeVisibleResumePreview(expectedChatDigest, options = {}) {
    const dialog = findVisibleResumeDialog();
    if (!dialog) return true;
    const selected = await collectSelectedConversation();
    const canCloseWithoutSelected = Boolean(options.allowWithoutSelected && isKnownResumeDialog(dialog));
    if ((!selected.ok && !canCloseWithoutSelected) || (selected.ok && expectedChatDigest && selected.chatDigest !== expectedChatDigest)) {
      showResumeCaptureStatus('预览未关闭：当前会话已变化，禁止操作其他会话的弹窗。', 'error');
      return false;
    }
    if (!selected.ok && canCloseWithoutSelected) {
      showResumeCaptureStatus('当前会话节点暂不可见，已限定在已识别的简历预览容器内执行关闭。', 'info');
    }
    traceAutoReply('RESUME_PREVIEW_ESCAPE_ATTEMPT', {
      chatDigest: expectedChatDigest || null,
      outcome: 'INFO',
      reason: `首选 Escape 关闭；点击前快照：${resumeDialogDiagnostics()}`,
    });
    dispatchResumePreviewEscape(dialog);
    await delay(450);
    if (!findVisibleResumeDialog()) {
      showResumeCaptureStatus('简历预览已通过 Escape 自动关闭，可继续处理其他会话。', 'success');
      traceAutoReply('RESUME_PREVIEW_CLOSED', {
        chatDigest: expectedChatDigest || null,
        outcome: 'SUCCESS',
        reason: '首选 Escape 已关闭预览并确认弹窗消失。',
      });
      return true;
    }
    traceAutoReply('RESUME_PREVIEW_ESCAPE_PROBE', {
      chatDigest: expectedChatDigest || null,
      outcome: 'WAITING',
      reason: `Escape 后 450ms 仍检测到预览，进入关闭按钮兜底：${resumeDialogDiagnostics()}`,
    });
    const activeDialogBeforeButton = findVisibleResumeDialog() || dialog;
    const initialClose = findResumeCloseButton(activeDialogBeforeButton);
    const candidates = initialClose.candidates;
    const close = initialClose.close;
    reportResumeCloseDom(activeDialogBeforeButton, candidates, close);
    if (!close) {
      showResumeCaptureStatus('简历已导入，但未识别到唯一安全关闭按钮；保持当前预览并停止切换会话。', 'error');
      return false;
    }
    traceAutoReply('RESUME_PREVIEW_CLOSE_ATTEMPT', {
      chatDigest: expectedChatDigest || null,
      outcome: 'INFO',
      reason: `点击前快照：${resumeDialogDiagnostics()}`,
    });
    let activeDialog = activeDialogBeforeButton;
    let activeClose = close;
    let replacementCount = 0;
    activeClose.click();
    let absentDialogChecks = 0;
    let reappearedLogged = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(200);
      if (attempt === 0) {
        traceAutoReply('RESUME_PREVIEW_CLOSE_PROBE', {
          chatDigest: expectedChatDigest || null,
          outcome: 'WAITING',
          reason: `点击后 200ms 快照：${resumeDialogDiagnostics()}`,
        });
      }
      const remaining = findVisibleResumeDialog();
      if (remaining && remaining !== activeDialog) {
        traceAutoReply('RESUME_PREVIEW_REPLACED', {
          chatDigest: expectedChatDigest || null,
          outcome: 'WAITING',
          reason: `预览节点已替换：${resumeDialogDiagnosticId(activeDialog)} → ${resumeDialogDiagnosticId(remaining)}；第 ${replacementCount + 1} 次重新绑定。`,
        });
        if (replacementCount >= 2) break;
        const rebound = findResumeCloseButton(remaining);
        reportResumeCloseDom(remaining, rebound.candidates, rebound.close);
        if (!rebound.close) break;
        activeDialog = remaining;
        activeClose = rebound.close;
        replacementCount += 1;
        absentDialogChecks = 0;
        activeClose.click();
        continue;
      }
      const dialogGone = !visible(activeDialog) || !document.contains(activeDialog);
      if (dialogGone && !remaining) {
        absentDialogChecks += 1;
        if (absentDialogChecks >= 2) {
          showResumeCaptureStatus('简历预览已自动关闭，可继续处理其他会话。', 'success');
          return true;
        }
      } else {
        if (absentDialogChecks > 0 && remaining && !reappearedLogged) {
          reappearedLogged = true;
          traceAutoReply('RESUME_PREVIEW_REAPPEARED', {
            chatDigest: expectedChatDigest || null,
            outcome: 'WAITING',
            reason: `预览节点短暂消失后重新出现：${resumeDialogDiagnostics()}`,
          });
        }
        absentDialogChecks = 0;
      }
    }
    showResumeCaptureStatus('简历已导入，但预览关闭结果未确认；暂停切换以避免误操作。', 'error');
    return false;
  }

  function showResumeImportResult(response) {
    if (!response?.ok) {
      showResumeCaptureStatus('后端导入失败：' + (response?.error || '扩展后台无响应'), 'error');
      return;
    }
    const processingReason = response.failureReason || response.failureCode || '';
    const analysisReason = response.analysisFailureReason || response.analysisFailureCode || '';
    if (response.processingStatus === 'FAILED') {
      showResumeCaptureStatus('后端处理失败：' + (processingReason || '简历文件未能完成提取。'), 'error');
    } else {
      showResumeCaptureStatus(`简历提取成功：后端已${response.duplicate ? '识别为重复记录' : '接收并建立记录'}，处理状态 ${response.processingStatus || '已接收'}。`, 'success');
    }
    if (response.analysisStatus === 'SUCCEEDED') {
      showResumeCaptureStatus(`AI 分析成功：结果已保存${response.candidateName ? `，候选人 ${response.candidateName}` : ''}，记录 ${response.intakeId || '已建立'}。`, 'success');
    } else if (['FAILED', 'UNAVAILABLE', 'NOT_AUTHORIZED'].includes(response.analysisStatus)) {
      showResumeCaptureStatus(`AI 分析未完成：${analysisReason || response.analysisStatus}。`, 'error');
    } else {
      showResumeCaptureStatus(`后端已收到简历；AI 状态：${response.analysisStatus || '处理中'}${analysisReason ? `，原因：${analysisReason}` : ''}。`, 'info');
    }
  }

  async function pollResumeBackendStatus() {
    for (const wait of [1_000, 2_500, 5_000]) {
      await delay(wait);
      const response = await send({ type: 'BRIDGE_GET_STATUS' });
      const state = String(response?.status?.visibleResumeState || '');
      if (state) showResumeCaptureStatus('后端状态：' + state, /失败|未完成|尚未/.test(state) ? 'error' : /完成|已导入|已接收/.test(state) ? 'success' : 'info');
      if (/完成|失败|未完成/.test(state)) return;
    }
  }

  async function reportResumeDownloadDetected() {
    const selected = await collectSelectedConversation();
    if (!selected.ok) return;
    await send({ type: 'BRIDGE_VISIBLE_RESUME_IMPORT_STATUS', payload: {
      chatDigest: selected.chatDigest, state: '已识别简历下载操作，正在捕获真实 PDF 文件…', observedAt: new Date().toISOString(),
    } });
  }

  function ensureResumeCaptureStatusBar() {
    if (resumeCaptureStatusBar && document.body.contains(resumeCaptureStatusBar)) return;
    const mount = document.body || document.documentElement;
    if (!mount) {
      setTimeout(() => ensureResumeCaptureStatusBar(), 200);
      return;
    }
    resumeCaptureStatusBar = document.createElement('div');
    resumeCaptureStatusBar.id = '__recruitment_capture_status';
    const savedPos = (() => {
      try { return JSON.parse(localStorage.getItem('__recruitment_capture_pos')); } catch { return null; }
    })();
    const initTop = savedPos?.top ?? 60;
    const initLeft = savedPos?.left ?? null;
    resumeCaptureStatusBar.style.cssText = `position:fixed;top:${initTop}px;${initLeft !== null ? `left:${initLeft}px` : 'right:12px'};z-index:2147483647;width:min(280px,calc(100vw - 24px));max-height:60vh;background:rgba(15,23,42,.78);color:#fff;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid rgba(255,255,255,.10);border-radius:8px;box-shadow:0 4px 16px rgba(15,23,42,.15);overflow:hidden;user-select:text;`;
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);cursor:grab;user-select:none;';
    // 折叠/展开按钮
    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = resumeCaptureStatusCollapsed ? '▶' : '▼';
    collapseBtn.title = resumeCaptureStatusCollapsed ? '展开' : '折叠';
    collapseBtn.style.cssText = 'padding:2px 6px;font:10px/1 monospace;background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,.15);border-radius:4px;cursor:pointer;flex-shrink:0;';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resumeCaptureStatusCollapsed = !resumeCaptureStatusCollapsed;
      collapseBtn.textContent = resumeCaptureStatusCollapsed ? '▶' : '▼';
      collapseBtn.title = resumeCaptureStatusCollapsed ? '展开' : '折叠';
      resumeCaptureStatusLog.style.display = resumeCaptureStatusCollapsed ? 'none' : '';
      resumeCaptureStatusBar.style.maxHeight = resumeCaptureStatusCollapsed ? (header.offsetHeight + 2) + 'px' : '60vh';
    });
    const title = document.createElement('strong');
    title.textContent = '自动化运行日志';
    title.style.flex = '1';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制全部';
    copyBtn.style.cssText = 'padding:3px 8px;font:11px sans-serif;background:#2563eb;color:#fff;border:0;border-radius:5px;cursor:pointer;flex-shrink:0;';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(resumeCaptureStatusLog?.textContent || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制全部'; }, 1500);
    });
    header.append(collapseBtn, title, copyBtn);
    resumeCaptureStatusLog = document.createElement('div');
    resumeCaptureStatusLog.style.cssText = 'max-height:calc(60vh - 42px);overflow-y:auto;padding:8px 10px;white-space:pre-wrap;word-break:break-word;';
    if (resumeCaptureStatusCollapsed) resumeCaptureStatusLog.style.display = 'none';
    resumeCaptureStatusBar.append(header, resumeCaptureStatusLog);
    resumeCaptureCopyBtn = copyBtn;
    mount.appendChild(resumeCaptureStatusBar);
    // 如果之前折叠，调整 max-height
    if (resumeCaptureStatusCollapsed) {
      requestAnimationFrame(() => {
        resumeCaptureStatusBar.style.maxHeight = (header.offsetHeight + 2) + 'px';
      });
    }
    // ---- 拖拽逻辑 ----
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dragOrigLeft = 0, dragOrigTop = 0;
    const onMouseDown = (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      const rect = resumeCaptureStatusBar.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOrigLeft = rect.left;
      dragOrigTop = rect.top;
      resumeCaptureStatusBar.style.cursor = 'grabbing';
      resumeCaptureStatusBar.style.transition = 'none';
      resumeCaptureStatusBar.style.left = rect.left + 'px';
      resumeCaptureStatusBar.style.right = 'auto';
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const newLeft = Math.max(0, Math.min(window.innerWidth - 50, dragOrigLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 30, dragOrigTop + dy));
      resumeCaptureStatusBar.style.left = newLeft + 'px';
      resumeCaptureStatusBar.style.top = newTop + 'px';
    };
    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      resumeCaptureStatusBar.style.cursor = 'grab';
      resumeCaptureStatusBar.style.transition = '';
      const rect = resumeCaptureStatusBar.getBoundingClientRect();
      try { localStorage.setItem('__recruitment_capture_pos', JSON.stringify({ top: rect.top, left: rect.left })); } catch {}
    };
    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // 清理旧监听（在重新创建时）
    resumeCaptureStatusBar._cleanupDrag?.();
    resumeCaptureStatusBar._cleanupDrag = () => {
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  function showResumeCaptureStatus(text, tone = 'info') {
    ensureResumeCaptureStatusBar();
    if (!resumeCaptureStatusBar || !resumeCaptureStatusLog) return;
    const line = document.createElement('div');
    const inferredTone = tone === 'info' && /失败|异常|未找到|无法|停止|无响应/.test(text) ? 'error'
      : tone === 'info' && /成功|完成|已导入|已接收/.test(text) ? 'success' : tone;
    line.style.cssText = `padding:4px 0;border-bottom:1px solid rgba(255,255,255,.07);color:${inferredTone === 'error' ? '#fca5a5' : inferredTone === 'success' ? '#86efac' : '#e2e8f0'};`;
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + String(text);
    resumeCaptureStatusLog.appendChild(line);
    while (resumeCaptureStatusLog.children.length > 30) resumeCaptureStatusLog.firstChild.remove();
    resumeCaptureStatusLog.scrollTop = resumeCaptureStatusLog.scrollHeight;
  }

  function scheduleResumeCardScan(delay) {
    clearTimeout(resumeCardScanTimer);
    resumeCardScanTimer = setTimeout(async () => {
      if (transcriptCaptureInProgress || !singleAccountAutoReplyEnabled
          || !resumeAttachmentProcessing || !resumePreviewOpenPending) return;
      const bridge = await send({ type: 'BRIDGE_GET_STATUS' });
      if (!bridge?.ok) {
        showResumeCaptureStatus('状态检查失败：' + (bridge?.error || '扩展后台无响应'), 'error');
        return;
      }
      if (bridge.status?.enabled === false) {
        showResumeCaptureStatus('自动处理已停止：浏览器桥接当前处于暂停状态。', 'error');
        return;
      }
      if (transcriptCaptureInProgress || !singleAccountAutoReplyEnabled
          || !resumeAttachmentProcessing || !resumePreviewOpenPending) return;
      const raw = [...document.querySelectorAll('.message-card-wrap, .hyperLink, [class*="attachment-wrap"], [class*="resume-card"]')]
        .filter((n) => n instanceof HTMLElement);
      const cards = raw.filter((n) => visible(n));
      const uniqueCards = cards.filter((c, i) => !cards.some((p, j) => j !== i && p.contains(c)));
      const scanSignature = uniqueCards.map((card) => {
        const actionArea = card.querySelector('.message-card-buttons') || card;
        const labels = [...actionArea.querySelectorAll('.card-btn, button, [role="button"]')]
          .filter((btn) => btn instanceof HTMLElement && visible(btn))
          .map((btn) => `${compact(controlLabel(btn))}:${isAvailableAction(btn) ? 'ready' : 'disabled'}`)
          .join(',');
        return `${card.tagName}.${String(card.className || '').slice(0, 60)}|${labels}`;
      }).join('||');
      if (scanSignature === lastResumeCardScanSignature && Date.now() - lastResumeCardScanAt < 3_000) return;
      lastResumeCardScanSignature = scanSignature;
      lastResumeCardScanAt = Date.now();
      if (raw.length > 0) {
        showResumeCaptureStatus('原始匹配: ' + raw.length + ' 个, 可见: ' + cards.length + ' 个, 去重: ' + uniqueCards.length + ' 个');
        raw.forEach((n) => {
          if (!visible(n)) showResumeCaptureStatus('不可见: ' + n.tagName + '.' + (n.className || '').toString().slice(0, 60));
        });
      }
      if (uniqueCards.length > 0) {
        uniqueCards.forEach((card, i) => {
          const tag = card.tagName + '.' + (card.className || '').toString().slice(0, 60);
          showResumeCaptureStatus('卡片' + (i + 1) + ': ' + tag);
          autoClickResumeCard(card);
        });
      } else {
        showResumeCaptureStatus('未检测到简历卡片 DOM');
      }
    }, delay);
  }

  function autoClickResumeCard(card) {
    try {
      if (transcriptCaptureInProgress || !singleAccountAutoReplyEnabled
          || !resumeAttachmentProcessing || !resumePreviewOpenPending) {
        showResumeCaptureStatus('跳过点击: 当前没有经过上下文判定的本轮新简历处理许可');
        return;
      }
      if (resumeAttachmentProcessing && findVisibleResumeDialog()) {
        resumePreviewOpenPending = false;
        showResumeCaptureStatus('跳过点击: 简历预览已打开，等待提取和关闭');
        return;
      }
      const actionArea = card.querySelector('.message-card-buttons') || card;
      const buttons = [...actionArea.querySelectorAll('.card-btn, button, [role="button"]')]
        .filter((btn) => btn instanceof HTMLElement && visible(btn));
      const btnTexts = buttons.map((btn) => compact(controlLabel(btn))).filter(Boolean).join(', ');
      showResumeCaptureStatus('按钮候选: ' + (btnTexts || '无'));

      const previewBtn = buttons.find((btn) =>
        /^(?:点击预览附件简历|预览附件简历|预览简历|查看简历)$/.test(compact(controlLabel(btn)))
        && isAvailableAction(btn) && !clickedResumeCardControls.has(btn));
      if (previewBtn) {
        clickedResumeCardControls.add(previewBtn);
        resumePreviewOpenPending = false;
        resumePreviewOpenAttempts += 1;
        showResumeCaptureStatus('自动点击: ' + compact(controlLabel(previewBtn)));
        previewBtn.click();
        scheduleResumePreviewOpenRetry(previewBtn, resumeAttachmentEpoch);
        return;
      }

      const agreeBtn = buttons.find((btn) => /^同意$/.test(compact(controlLabel(btn)))
        && isAvailableAction(btn) && !clickedResumeCardControls.has(btn));
      if (agreeBtn) {
        clickedResumeCardControls.add(agreeBtn);
        showResumeCaptureStatus('自动点击: 同意接收简历，等待预览入口');
        agreeBtn.click();
        scheduleResumeCardScan(500);
        setTimeout(() => scheduleResumeCardScan(0), 1_500);
        setTimeout(() => scheduleResumeCardScan(0), 3_000);
        return;
      }

      showResumeCaptureStatus('跳过点击: 暂无可用的同意或预览按钮');
    } catch (error) {
      showResumeCaptureStatus('点击异常: ' + String(error?.message || error || '未知错误'));
    }
  }

  function scheduleResumePreviewOpenRetry(control, expectedEpoch) {
    setTimeout(() => {
      if (!singleAccountAutoReplyEnabled || !resumeAttachmentProcessing
          || resumeAttachmentEpoch !== expectedEpoch || lastResumePdfImportOutcome
          || resumePdfForwardInFlight || findVisibleResumeDialog()) return;
      if (resumePreviewOpenAttempts >= 3) {
        showResumeCaptureStatus('简历预览入口已点击 3 次仍未打开，停止重复点击并等待本轮超时处理。', 'error');
        return;
      }
      clickedResumeCardControls.delete(control);
      resumePreviewOpenPending = true;
      showResumeCaptureStatus(`简历预览第 ${resumePreviewOpenAttempts} 次点击未生效，准备有限重试。`);
      scheduleResumeCardScan(0);
    }, 1_500);
  }

  async function forwardResumeCaptureStatus(data) {
    if (typeof data.state !== 'string' || !data.state.trim()) return;
    showResumeCaptureStatus(data.state.trim());
    const selected = await collectSelectedConversation();
    if (!selected.ok || !/^[a-f0-9]{64}$/.test(selected.chatDigest || '')) return;
    await send({ type: 'BRIDGE_VISIBLE_RESUME_IMPORT_STATUS', payload: {
      chatDigest: selected.chatDigest, state: '[MAIN] ' + data.state.trim().slice(0, 200), observedAt: new Date().toISOString(),
    } });
  }

  function isAvailableAction(node) {
    return !node.disabled && node.getAttribute('aria-disabled') !== 'true'
      && !node.classList.contains('disabled') && !node.closest('[aria-disabled="true"], .disabled');
  }

  function stableIdentity(item) {
    const allowed = /^(data-(?:id|uid|geek-id|friend-id|user-id|conversation-id|encrypt-id|security-id))$/i;
    for (const node of [item, ...item.querySelectorAll('*')].slice(0, 100)) {
      for (const attribute of node.attributes || []) {
        const value = String(attribute.value || '').trim();
        if (allowed.test(attribute.name) && value) return `${attribute.name}:${value}`;
      }
    }
    return '';
  }

  function textOf(root, selector) { return String(root.querySelector(selector)?.textContent || '').trim(); }
  function visible(element) { if (!element) return false; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0; }
  function directionOf(item) { if (item.matches(SELECTORS.inbound) || item.querySelector(SELECTORS.inbound)) return 'INBOUND'; if (item.matches(SELECTORS.outbound) || item.querySelector(SELECTORS.outbound)) return 'OUTBOUND'; return ''; }
  async function digest(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join(''); }
  function parseTime(value) {
    const text = String(value || '').trim();
    const now = new Date(); let match = text.match(/^(?:(昨天)\s*)?(\d{1,2}):(\d{2})$/);
    if (match) { const date = new Date(now); date.setSeconds(0, 0); date.setHours(Number(match[2]), Number(match[3]), 0, 0); if (match[1]) date.setDate(date.getDate() - 1); else if (date.getTime() > now.getTime() + 60_000) date.setDate(date.getDate() - 1); return date.toISOString(); }
    match = text.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/);
    if (match) {
      const date = new Date(now); date.setFullYear(match[1] ? Number(match[1]) : now.getFullYear(), Number(match[2]) - 1, Number(match[3])); date.setHours(Number(match[4]), Number(match[5]), 0, 0); if (!match[1] && date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1); return date.toISOString();
    }
    const direct = Date.parse(text);
    return Number.isFinite(direct) ? new Date(direct).toISOString() : '';
  }
  function blocked(code, reason) { return { ok: false, code, reason }; }
  function stripSelected(value) { return { chatDigest: value.chatDigest, messageDigest: value.messageDigest, direction: value.direction, messageAt: value.messageAt, selectedUnread: value.selectedUnread, conversationSignals: value.conversationSignals, messageText: value.messageText || null, observedAt: new Date().toISOString(), resumeCaptureRequested: Boolean(resumeCaptureRequest && resumeCaptureRequest.chatDigest === value.chatDigest && resumeCaptureRequest.messageDigest === value.messageDigest) }; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function bridgeMessageTimeout(message) {
    const configured = BRIDGE_MESSAGE_TIMEOUTS[message?.type];
    return Number.isFinite(configured) ? configured : BRIDGE_MESSAGE_TIMEOUT_MS;
  }
  async function send(message) {
    const timeoutMs = bridgeMessageTimeout(message);
    try {
      const request = Promise.resolve().then(() => chrome.runtime.sendMessage(message));
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          ok: false,
          code: 'BRIDGE_MESSAGE_TIMEOUT',
          error: `扩展后台操作超过 ${Math.ceil(timeoutMs / 1_000)} 秒未返回；本轮已释放自动回复锁。`,
        }), timeoutMs);
      });
      try {
        return await Promise.race([request, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }
    catch (error) {
      return { ok: false, error: `扩展后台通信失败：${String(error?.message || error || '未知错误')}` };
    }
  }
})();

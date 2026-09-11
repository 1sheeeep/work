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
  const SINGLE_ACCOUNT_PREFETCH_LIMIT = 5;
  let collectTimer = null;
  let collecting = false;
  let autoReplyArm = null;
  let autoReplyTimer = null;
  let autoReplyBusy = false;
  let singleAccountAutoReplyEnabled = false;
  let singleAccountAutoReplyTimer = null;
  let singleAccountAutoReplyBusy = false;
  let dutyControlTimer = null;
  let singleAccountPendingChatDigest = null;
  let singleAccountUnreadBaseline = new Map();
  let singleAccountSelectedMessageBaseline = new Map();
  let singleAccountPendingReplies = new Map();
  let singleAccountConversationQueue = [];
  let singleAccountBacklogMode = false;
  let singleAccountBacklogSeen = new Map();
  let lastDeepConversationScanAt = 0;
  let jobConfirmationTimer = null;
  let pendingJobConfirmationSignature = '';
  let resumeCaptureStatusBar = null;
  let resumeCaptureCopyBtn = null;
  let resumeCaptureStatusLog = null;
  let resumeCardScanTimer = null;
  let resumeAttachmentProcessing = false;
  let lastResumePdfImportOutcome = null;
  let lastResumeCardScanSignature = '';
  let lastResumeCardScanAt = 0;
  const clickedResumeCardControls = new WeakSet();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['BRIDGE_COLLECT', 'BRIDGE_COLLECT_JOBS', 'BRIDGE_LOCATE_CONVERSATION', 'BRIDGE_CHECK_REPLY_READINESS', 'BRIDGE_INSPECT_CURRENT_CONTROLS', 'BRIDGE_COPY_CURRENT_TRANSCRIPT', 'BRIDGE_TEST_CURRENT_ACTION_ENTRY', 'BRIDGE_CONFIRM_CURRENT_EXCHANGE', 'BRIDGE_PREPARE_ACTION_LEASE', 'BRIDGE_EXECUTE_ACTION_LEASE', 'BRIDGE_FILL_TEST_DRAFT', 'BRIDGE_PREPARE_CURRENT_SEND_TEST', 'BRIDGE_SEND_CURRENT_TEST_DRAFT', 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY', 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_SET_SINGLE_ACCOUNT_AUTO_REPLY', 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL', 'BRIDGE_FILL_APPROVED_DRAFT', 'BRIDGE_COLLECT_VISIBLE_RESUME', 'BRIDGE_OPEN_VISIBLE_RESUME'].includes(message?.type)) return false;
    const task = message.type === 'BRIDGE_COLLECT_JOBS'
      ? collectJobsAndPublish(Boolean(message.allowEmbeddedJobList))
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
    const pageChanged = mutations.some((mutation) =>
      !(mutation.target instanceof Element && mutation.target.closest('#__recruitment_capture_status')));
    if (!pageChanged) return;
    scheduleCollect(1_200);
    scheduleAutoReplyCheck(500);
    scheduleSingleAccountAutoReply(300);
    scheduleResumeCardScan(1_000);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
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
  window.addEventListener('focus', () => scheduleCollect(500), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCollect(500); }, { passive: true });
  scheduleCollect(1_500);
  bootResumeCaptureStatusPanel();
  void restoreSingleAccountAutoReply();
  scheduleDutyControlSync(1_000);

  function bootResumeCaptureStatusPanel() {
    showResumeCaptureStatus('简历自动处理状态面板已启动，正在检查当前会话。', 'info');
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
    const wasEnabled = singleAccountAutoReplyEnabled;
    let initialUnreadCount = 0;
    singleAccountAutoReplyEnabled = enabled;
    if (!enabled) {
      singleAccountPendingChatDigest = null;
      singleAccountUnreadBaseline = new Map();
      singleAccountSelectedMessageBaseline = new Map();
      singleAccountPendingReplies = new Map();
      singleAccountConversationQueue = [];
      singleAccountBacklogMode = false;
      singleAccountBacklogSeen = new Map();
    } else if (!wasEnabled) {
      const saved = restore ? await send({ type: 'BRIDGE_GET_SINGLE_ACCOUNT_BASELINE' }) : null;
      const currentUnread = await collectUnreadBaseline();
      initialUnreadCount = currentUnread.size;
      singleAccountUnreadBaseline = restore && saved?.ok && saved.unread?.length
        ? new Map(saved.unread) : new Map();
      singleAccountSelectedMessageBaseline = saved?.ok && saved.selected?.length
        ? new Map(saved.selected) : new Map();
      if (!singleAccountSelectedMessageBaseline.size) {
        const selected = await collectSelectedConversation();
        if (selected.ok) singleAccountSelectedMessageBaseline.set(selected.chatDigest, selected.messageDigest);
      }
      const pending = await send({ type: 'BRIDGE_GET_PENDING_INBOUND_REPLIES' });
      singleAccountPendingReplies = new Map((pending?.tasks || []).map((task) => [task.taskId, { ...task, nextPollAt: 0 }]));
      singleAccountConversationQueue = [];
      // A manual enable starts one bounded backlog pass. A background restore
      // resumes only unseen/changed messages to avoid replaying old replies.
      singleAccountBacklogMode = !restore;
      singleAccountBacklogSeen = new Map();
      await persistSingleAccountBaseline();
    }
    clearTimeout(singleAccountAutoReplyTimer);
    singleAccountAutoReplyTimer = null;
    if (enabled) scheduleSingleAccountAutoReply(800);
    return { ok: true, enabled, baselineCount: singleAccountUnreadBaseline.size,
      initialUnreadCount: enabled && !restore ? initialUnreadCount : 0 };
  }

  async function persistSingleAccountBaseline() {
    if (!singleAccountAutoReplyEnabled) return;
    const unread = [...singleAccountUnreadBaseline.entries()].slice(-500);
    const selected = [...singleAccountSelectedMessageBaseline.entries()].slice(-500);
    singleAccountUnreadBaseline = new Map(unread);
    singleAccountSelectedMessageBaseline = new Map(selected);
    await send({ type: 'BRIDGE_SAVE_SINGLE_ACCOUNT_BASELINE', payload: {
      unread, selected,
    } });
  }

  async function collectUnreadBaseline() {
    const baseline = new Map();
    const items = [...document.querySelectorAll(SELECTORS.conversation)]
      .filter((item) => visible(item) && item.querySelector(SELECTORS.unread));
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) continue;
      const chatDigest = await digest(identity);
      baseline.set(chatDigest, await unreadRowSignature(item));
    }
    return baseline;
  }

  async function unreadRowSignature(item) {
    const preview = textOf(item, SELECTORS.preview);
    const unreadNode = item.querySelector(SELECTORS.unread);
    const unreadCount = unreadNode ? Math.max(1, Number(String(unreadNode.textContent || '').match(/\d+/)?.[0]) || 1) : 0;
    return digest(`${preview}|${unreadCount}`);
  }

  async function findNewOrChangedUnreadConversation() {
    const items = [...document.querySelectorAll(SELECTORS.conversation)]
      .filter((item) => visible(item) && item.querySelector(SELECTORS.unread));
    for (const item of items) {
      const identity = stableIdentity(item);
      if (!identity) return { error: '未读会话没有稳定 DOM 身份，禁止猜测目标。' };
      const chatDigest = await digest(identity);
      const signature = await unreadRowSignature(item);
      if (!singleAccountUnreadBaseline.has(chatDigest) || singleAccountUnreadBaseline.get(chatDigest) !== signature) {
        return { item, chatDigest };
      }
    }
    return { item: null, chatDigest: null };
  }

  async function refillSingleAccountConversationQueue() {
    if (singleAccountConversationQueue.length >= SINGLE_ACCOUNT_PREFETCH_LIMIT) return;
    const queued = new Set(singleAccountConversationQueue.map((item) => item.chatDigest));
    const items = [...document.querySelectorAll(SELECTORS.conversation)]
      .filter((item) => visible(item) && item.querySelector(SELECTORS.unread));
    for (const item of items) {
      if (singleAccountConversationQueue.length >= SINGLE_ACCOUNT_PREFETCH_LIMIT) break;
      const identity = stableIdentity(item);
      if (!identity) continue;
      const chatDigest = await digest(identity);
      if (queued.has(chatDigest)) continue;
      const signature = await unreadRowSignature(item);
      const known = singleAccountUnreadBaseline.get(chatDigest);
      if (singleAccountBacklogMode) {
        if (singleAccountBacklogSeen.get(chatDigest) === signature) continue;
        singleAccountBacklogSeen.set(chatDigest, signature);
      } else if (known && known === signature) continue;
      singleAccountConversationQueue.push({ chatDigest, signature });
      queued.add(chatDigest);
    }
  }

  async function findConversationByDigest(chatDigest) {
    for (const item of [...document.querySelectorAll(SELECTORS.conversation)].filter(visible)) {
      const identity = stableIdentity(item);
      if (identity && await digest(identity) === chatDigest) return item;
    }
    return null;
  }

  function conversationScrollContainer() {
    const row = [...document.querySelectorAll(SELECTORS.conversation)].find((item) => visible(item));
    let node = row?.parentElement || null;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 24 && /(auto|scroll)/.test(style.overflowY)) return node;
    }
    return null;
  }

  async function scanConversationPages(matcher) {
    const scroller = conversationScrollContainer();
    if (!scroller) return null;
    const originalTop = scroller.scrollTop;
    const step = Math.max(120, Math.floor(scroller.clientHeight * .75));
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const positions = [];
    for (let top = 0; top < maxTop && positions.length < 40; top += step) positions.push(top);
    positions.push(maxTop);
    let matched = false;
    try {
      for (const top of [...new Set(positions)]) {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await delay(120);
        const rows = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible);
        for (const row of rows) {
          const match = await matcher(row);
          if (match) { matched = true; return match; }
        }
      }
      return null;
    } finally {
      if (!matched) {
        scroller.scrollTop = originalTop;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }
  }

  async function findConversationByDigestDeep(chatDigest) {
    const found = await scanConversationPages(async (item) => {
      const identity = stableIdentity(item);
      return identity && await digest(identity) === chatDigest ? item : null;
    });
    return found;
  }

  async function locateConversation(chatDigest) {
    if (!/^[a-f0-9]{64}$/.test(chatDigest || '')) return blocked('INVALID_TARGET', '定位目标无效。');
    let target = await findConversationByDigest(chatDigest);
    if (!target) target = await findConversationByDigestDeep(chatDigest);
    if (!target) return blocked('CONVERSATION_NOT_VISIBLE', '当前会话列表中未找到目标，可能已不在已加载范围。');
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    target.click();
    await delay(260);
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    const identity = selected && stableIdentity(selected);
    if (!identity || await digest(identity) !== chatDigest) return blocked('TARGET_NOT_SELECTED', '目标会话点击后未能确认选中状态。');
    return { ok: true, reason: '已准确定位并打开 BOSS 会话。' };
  }

  async function findNewOrChangedUnreadConversationDeep() {
    return scanConversationPages(async (item) => {
      if (!item.querySelector(SELECTORS.unread)) return null;
      const identity = stableIdentity(item);
      if (!identity) return null;
      const chatDigest = await digest(identity);
      const signature = await unreadRowSignature(item);
      return !singleAccountUnreadBaseline.has(chatDigest) || singleAccountUnreadBaseline.get(chatDigest) !== signature
        ? { item, chatDigest } : null;
    });
  }

  async function nextReadyInboundReply() {
    const now = Date.now();
    for (const [taskId, task] of singleAccountPendingReplies) {
      if (Number(task.nextPollAt || 0) > now) continue;
      task.nextPollAt = now + 1_000;
      try {
        const result = await send({ type: 'BRIDGE_POLL_INBOUND_REPLY', payload: task });
        if (!result?.ok) { task.nextPollAt = now + 5_000; continue; }
        if (result.status === 'CANCELLED' || result.status === 'FAILED'
            || (result.status === 'COMPLETED' && !result.decision?.replyAllowed)) {
          singleAccountPendingReplies.delete(taskId);
          continue;
        }
        if (result.status === 'COMPLETED' && result.decision?.replyAllowed && result.decision?.content) {
          return { task, decision: result.decision };
        }
      } catch (_error) {
        task.nextPollAt = now + 5_000;
      }
    }
    return null;
  }

  function scheduleSingleAccountAutoReply(delay) {
    if (!singleAccountAutoReplyEnabled || singleAccountAutoReplyTimer) return;
    singleAccountAutoReplyTimer = setTimeout(() => {
      singleAccountAutoReplyTimer = null;
      void processNextUnreadConversation();
    }, delay);
  }

  async function haltSingleAccountAutoReply(state) {
    singleAccountAutoReplyEnabled = false;
    clearTimeout(singleAccountAutoReplyTimer);
    singleAccountAutoReplyTimer = null;
    await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_STATE', payload: {
      state, disable: true, observedAt: new Date().toISOString(),
    } });
  }

  async function reportSingleAccountResult(selected, outcome, reason) {
    const result = await send({ type: 'BRIDGE_SINGLE_ACCOUNT_AUTO_REPLY_RESULT', payload: {
      chatDigest: selected.chatDigest, messageDigest: selected.messageDigest,
      outcome, reason: compact(reason).slice(0, 300), occurredAt: new Date().toISOString(),
    } });
    if (result?.shouldStop) {
      singleAccountAutoReplyEnabled = false;
      clearTimeout(singleAccountAutoReplyTimer);
      singleAccountAutoReplyTimer = null;
    }
    const matchingItem = [...document.querySelectorAll(SELECTORS.conversation)].filter(visible)
      .find((item) => stableIdentity(item) && item.matches(SELECTORS.selectedConversation));
    if (matchingItem && await digest(stableIdentity(matchingItem)) === selected.chatDigest && matchingItem.querySelector(SELECTORS.unread)) {
      singleAccountUnreadBaseline.set(selected.chatDigest, await unreadRowSignature(matchingItem));
    } else {
      singleAccountUnreadBaseline.delete(selected.chatDigest);
    }
    singleAccountSelectedMessageBaseline.set(selected.chatDigest, selected.messageDigest);
    await persistSingleAccountBaseline();
  }

  async function receiptInboundReplySend(lease, outcome, afterShape, reason) {
    const afterStateDigest = await digest(afterShape);
    const receiptDigest = await digest(`${lease.beforeStateDigest}|${afterStateDigest}|${outcome}`);
    return send({ type: 'BRIDGE_RECEIPT_INBOUND_REPLY_SEND', payload: {
      leaseToken: lease.leaseToken, outcome, beforeStateDigest: lease.beforeStateDigest,
      afterStateDigest, receiptDigest, reason: compact(reason).slice(0, 300),
    } });
  }

  async function processNextUnreadConversation() {
    if (!singleAccountAutoReplyEnabled) return;
    if (singleAccountAutoReplyBusy || autoReplyBusy || collecting) return scheduleSingleAccountAutoReply(1_000);
    singleAccountAutoReplyBusy = true;
    autoReplyBusy = true;
    try {
      const page = classifyPage();
      if (!page.ok) return void await haltSingleAccountAutoReply(`持续回复已停止：${page.reason || '当前页面存在登录、验证或风险状态。'}`);
      const currentControls = findReplyControls();
      if (currentControls.editor && readEditorText(currentControls.editor).trim()) {
        return void await haltSingleAccountAutoReply('持续回复已停止：当前输入框已有内容，为避免覆盖 HR 草稿未切换会话。');
      }
      const readyReply = await nextReadyInboundReply();
      const selectedItem = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
      let target = readyReply ? await findConversationByDigest(readyReply.task.chatDigest) : null;
      if (readyReply && !target) target = await findConversationByDigestDeep(readyReply.task.chatDigest);
      let queuedDecision = target ? readyReply.decision : null;
      let queuedTask = target ? readyReply.task : null;
      if (!target && singleAccountPendingChatDigest && selectedItem) {
        const selectedIdentity = stableIdentity(selectedItem);
        if (selectedIdentity && await digest(selectedIdentity) === singleAccountPendingChatDigest) target = selectedItem;
      }
      if (!target && !queuedTask && selectedItem) {
        const currentSelected = await collectSelectedConversation();
        if (currentSelected.ok) {
          const baselineMessageDigest = singleAccountSelectedMessageBaseline.get(currentSelected.chatDigest);
          if (baselineMessageDigest && baselineMessageDigest !== currentSelected.messageDigest && currentSelected.direction === 'INBOUND') {
            target = selectedItem;
          } else if (!baselineMessageDigest || baselineMessageDigest !== currentSelected.messageDigest) {
            singleAccountSelectedMessageBaseline.set(currentSelected.chatDigest, currentSelected.messageDigest);
          }
        }
      }
      if (!target && !queuedTask) {
        singleAccountPendingChatDigest = null;
        await refillSingleAccountConversationQueue();
        const queuedCandidate = singleAccountConversationQueue.shift();
        if (queuedCandidate) {
          target = await findConversationByDigest(queuedCandidate.chatDigest);
          if (!target && Date.now() - lastDeepConversationScanAt >= 15_000) {
            lastDeepConversationScanAt = Date.now();
            target = await findConversationByDigestDeep(queuedCandidate.chatDigest);
          }
        }
        if (!target) {
          const candidate = await findNewOrChangedUnreadConversation();
          if (candidate.error) return void await haltSingleAccountAutoReply(`持续回复已停止：${candidate.error}`);
          target = candidate.item;
        }
        if (!target && Date.now() - lastDeepConversationScanAt >= 15_000) {
          lastDeepConversationScanAt = Date.now();
          const deepCandidate = await findNewOrChangedUnreadConversationDeep();
          target = deepCandidate?.item || null;
        }
      }
      if (!target) return scheduleSingleAccountAutoReply(1_000);
      const identity = stableIdentity(target);
      if (!identity) return void await haltSingleAccountAutoReply('持续回复已停止：未读会话没有稳定 DOM 身份，禁止猜测目标。');
      const expectedChatDigest = await digest(identity);
      singleAccountPendingChatDigest = expectedChatDigest;
      const switchedConversation = !target.matches(SELECTORS.selectedConversation);
      if (switchedConversation) target.click();
      await delay(switchedConversation ? 650 : 120);
      const first = await collectSelectedConversation();
      await delay(350);
      const second = await collectSelectedConversation();
      if (!first.ok || !second.ok || first.chatDigest !== expectedChatDigest || second.chatDigest !== expectedChatDigest || first.signature !== second.signature) {
        return scheduleSingleAccountAutoReply(1_500);
      }
      if (queuedTask && second.messageDigest !== queuedTask.messageDigest) {
        try {
          await send({ type: 'BRIDGE_DISCARD_STALE_INBOUND_REPLY', payload: {
            taskId: queuedTask.taskId, chatDigest: queuedTask.chatDigest,
            messageDigest: queuedTask.messageDigest, currentMessageDigest: second.messageDigest,
            currentMessageAt: second.messageAt, selectedUnread: second.selectedUnread,
            conversationSignals: second.conversationSignals,
          } });
        } catch (_error) {
          // Backend keeps the task non-sendable by target digest; the operations page exposes any residual READY item.
        }
        singleAccountPendingReplies.delete(queuedTask.taskId);
        await reportSingleAccountResult(queuedTask, 'SILENT', '候选人在 AI 分析期间发来了新消息，旧结果已作废且未发送。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(300);
      }
      const activeConversation = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
      const stableLastMessage = activeConversation
        ? [...activeConversation.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1)
        : null;
      const containsStructuredAttachment = Boolean(stableLastMessage?.querySelector('.message-card-wrap, .hyperLink, video, audio, [class*="attachment"], [class*="resume"]'));
      if (second.direction !== 'INBOUND' || !second.messageText || containsStructuredAttachment) {
        if (second.direction === 'INBOUND' && containsStructuredAttachment) {
          resumeAttachmentProcessing = true;
          lastResumePdfImportOutcome = null;
          showResumeCaptureStatus('挂机：检测到候选人附件，锁定当前会话并开始简历处理。');
          scheduleResumeCardScan(0);
          try {
            for (let attempt = 0; attempt < 50; attempt++) {
              await delay(500);
              const outcome = lastResumePdfImportOutcome;
              if (outcome?.chatDigest === second.chatDigest) break;
              if (attempt === 8 || attempt === 20 || attempt === 35) scheduleResumeCardScan(0);
            }
          } catch (error) {
            lastResumePdfImportOutcome = { ok: false, chatDigest: second.chatDigest, error: `简历处理异常：${String(error?.message || error || '未知错误')}` };
            showResumeCaptureStatus(lastResumePdfImportOutcome.error, 'error');
          } finally {
            // Never leave the whole auto-reply loop locked by a failed DOM/API await.
            resumeAttachmentProcessing = false;
          }
          const outcome = lastResumePdfImportOutcome;
          await reportSingleAccountResult(second, 'SILENT', outcome?.chatDigest === second.chatDigest && outcome.ok
            ? `候选人附件简历已导入，记录 ${outcome.intakeId || '已建立'}，AI 状态 ${outcome.analysisStatus || '处理中'}。`
            : `候选人附件不需要文本回复；简历导入${outcome?.error ? `未完成：${outcome.error}` : '等待超时，已保留状态供后续重试'}。`);
          if (outcome?.chatDigest === second.chatDigest && /预览窗口未确认关闭/.test(outcome.error || '')) {
            return void await haltSingleAccountAutoReply('挂机已暂停：简历虽然已导入，但预览窗口没有确认关闭，请人工关闭后重新开启挂机。');
          }
        } else {
          await reportSingleAccountResult(second, 'SILENT', '最后一条内容不是可安全处理的候选人纯文本，未回复。');
        }
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      if (second.conversationSignals?.interviewScheduled === true) {
        await reportSingleAccountResult(second, 'SILENT', '该会话已约面试，后续消息交由 HR 跟进，不再自动回复。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      const controls = findReplyControls();
      if (!controls.editor || readEditorText(controls.editor).trim()) {
        return void await haltSingleAccountAutoReply('持续回复已停止：目标会话输入框不可用或已有内容，未发送。');
      }
      let decision = queuedDecision;
      if (!decision) {
        const replyResult = await send({ type: 'BRIDGE_DECIDE_INBOUND_REPLY', payload: {
          chatDigest: second.chatDigest, messageDigest: second.messageDigest, messageText: second.messageText,
          conversationContext: second.conversationContext,
          messageAt: second.messageAt, selectedUnread: second.selectedUnread,
          conversationSignals: second.conversationSignals, observedAt: new Date().toISOString(), continuous: true,
        } });
        if (!replyResult?.ok) return scheduleSingleAccountAutoReply(5_000);
        if (replyResult.pending && replyResult.taskId) {
          singleAccountPendingReplies.set(replyResult.taskId, {
            taskId: replyResult.taskId, chatDigest: second.chatDigest, messageDigest: second.messageDigest, nextPollAt: Date.now() + 500,
          });
          const selectedRow = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
          if (selectedRow?.querySelector(SELECTORS.unread)) singleAccountUnreadBaseline.set(second.chatDigest, await unreadRowSignature(selectedRow));
          singleAccountSelectedMessageBaseline.set(second.chatDigest, second.messageDigest);
          await persistSingleAccountBaseline();
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(300);
        }
        decision = replyResult.decision;
      }
      if (!singleAccountAutoReplyEnabled) {
        await reportSingleAccountResult(second, 'SILENT', 'HR 已在判定期间停止持续回复，未写入或发送。');
        singleAccountPendingChatDigest = null;
        return;
      }
      if (!decision?.replyAllowed || !decision.content) {
        if (decision?.category === 'RATE_LIMIT' || decision?.category === 'DISABLED') {
          return void await haltSingleAccountAutoReply(`持续回复已停止：${decision.reason || '安全限制已触发。'}`);
        }
        if (decision?.category !== 'DUPLICATE') await reportSingleAccountResult(second, 'SILENT', decision?.reason || '消息不符合自动回复条件。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      let sendLease = null;
      if (queuedTask) {
        const beforeStateDigest = await digest(`${second.chatDigest}|${second.messageDigest}|EMPTY_EDITOR|READY_TO_FILL`);
        const claim = await send({ type: 'BRIDGE_CLAIM_INBOUND_REPLY_SEND', payload: {
          taskId: queuedTask.taskId, chatDigest: second.chatDigest,
          messageDigest: second.messageDigest, beforeStateDigest, messageAt: second.messageAt,
          selectedUnread: second.selectedUnread, conversationSignals: second.conversationSignals,
          observedAt: new Date().toISOString(),
        } });
        if (!claim?.available || !claim.leaseToken || !claim.content || !claim.replyDigest) {
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
          singleAccountPendingReplies.delete(queuedTask.taskId);
          await reportSingleAccountResult(second, claim?.status === 'SKIPPED' ? 'SILENT' : 'UNKNOWN', claim?.reason || 'AI 回复发送租约不可用，已禁止重试。');
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(1_000);
        }
        if (await digest(claim.content) !== claim.replyDigest) {
          sendLease = { ...claim, beforeStateDigest };
          await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|CONTENT_DIGEST_MISMATCH`, '租约回复内容摘要不一致，未写入且未发送。');
          singleAccountPendingReplies.delete(queuedTask.taskId);
          await reportSingleAccountResult(second, 'SILENT', '租约内容校验失败，未发送。');
          singleAccountPendingChatDigest = null;
          return scheduleSingleAccountAutoReply(1_000);
        }
        sendLease = { ...claim, beforeStateDigest };
        decision = { ...decision, content: claim.content };
      }
      const replyText = compact(decision.content);
      if (!replyText || replyText.length > 200) {
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|INVALID_REPLY_LENGTH`, '租约内容为空或超过 200 字，未发送。');
        await reportSingleAccountResult(second, 'SILENT', '后端没有返回可发送的安全短回复。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(1_500);
      }
      writeEditorText(controls.editor, replyText);
      await delay(350);
      if (readEditorText(controls.editor).trim() !== replyText) {
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|DRAFT_FILL_FAILED`, '安全短回复未稳定写入，未发送。');
        await reportSingleAccountResult(second, 'SILENT', '安全短回复未稳定写入，已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(2_000);
      }
      let filledControls = findReplyControls();
      for (let attempt = 0; attempt < 5 && (!filledControls.sendButton || filledControls.sendButtonCount !== 1); attempt++) {
        await delay(200);
        filledControls = findReplyControls();
      }
      const beforeSend = await collectSelectedConversation();
      if (filledControls.editor !== controls.editor || !filledControls.sendButton || filledControls.sendButtonCount !== 1
          || !beforeSend.ok || beforeSend.chatDigest !== second.chatDigest
          || beforeSend.messageDigest !== second.messageDigest || beforeSend.direction !== 'INBOUND') {
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|PRE_SEND_REVALIDATION_FAILED`, '发送前页面或会话状态变化，未点击发送。');
        await reportSingleAccountResult(second, 'SILENT', '发送前页面或会话状态发生变化，已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return scheduleSingleAccountAutoReply(2_000);
      }
      if (!singleAccountAutoReplyEnabled) {
        writeEditorText(controls.editor, '');
        if (sendLease) await receiptInboundReplySend(sendLease, 'FAILED', `${second.chatDigest}|${second.messageDigest}|STOPPED_BEFORE_SEND`, 'HR 在发送前停止持续回复，未点击发送。');
        await reportSingleAccountResult(second, 'SILENT', 'HR 已在发送前停止持续回复，草稿已清空且未发送。');
        singleAccountPendingChatDigest = null;
        return;
      }
      filledControls.sendButton.click();
      let confirmed = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await delay(500);
        const current = await collectSelectedConversation();
        if (!current.ok || current.chatDigest !== second.chatDigest) break;
        const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
        const last = active ? [...active.querySelectorAll(SELECTORS.message)].filter(visible).filter((item) => directionOf(item)).at(-1) : null;
        const nextControls = findReplyControls();
        if (nextControls.editor && !readEditorText(nextControls.editor).trim()
            && directionOf(last) === 'OUTBOUND' && compact(last?.textContent).includes(replyText)) { confirmed = true; break; }
      }
      if (sendLease) await receiptInboundReplySend(sendLease, confirmed ? 'SUCCEEDED' : 'UNKNOWN',
        `${second.chatDigest}|${second.messageDigest}|${confirmed ? 'OUTBOUND_CONFIRMED' : 'SEND_RESULT_UNCONFIRMED'}|${await digest(replyText)}`,
        confirmed ? '页面已确认输入框清空且最后一条为相同出站回复。' : '已点击一次发送，但页面结果无法确认；禁止重试。');
      await reportSingleAccountResult(second, confirmed ? 'SENT' : 'UNKNOWN', confirmed
        ? `已识别为${decision.category}并发送一条岗位事实回复。`
        : '已点击一次发送，但页面结果无法确认；该消息不会自动重试。');
      singleAccountPendingChatDigest = null;
      if (queuedTask) singleAccountPendingReplies.delete(queuedTask.taskId);
      scheduleSingleAccountAutoReply(2_000);
    } finally {
      singleAccountAutoReplyBusy = false;
      autoReplyBusy = false;
      if (singleAccountAutoReplyEnabled && !singleAccountAutoReplyTimer) scheduleSingleAccountAutoReply(2_000);
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

  async function collectJobsAndPublish(allowEmbeddedJobList) {
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
      const response = await send({ type: 'BRIDGE_JOB_SNAPSHOT', payload: { pageState: 'JOB_MANAGEMENT_READY', entries: second.entries, observedAt: new Date().toISOString(), scope: second.scope, authoritative: second.authoritative } });
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
            showResumeImportResult(await send({ type: 'BRIDGE_VISIBLE_RESUME_PDF_CAPTURE', payload: pdfCapture.resume }));
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
    const sourceDigest = await digest(`detail:${location.pathname}:${new URLSearchParams(location.search).get('encryptId') || title}`);
    const values = [title, recruitmentType, description, jobCategory, overseasRequirement, experienceRequirement,
      educationRequirement, salaryDisplay, salaryMonths, jobKeywords, workAddress];
    const entry = {
      sourceDigest, title, location: null, salaryDisplay: salaryDisplay || null,
      salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths,
      experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null,
      description: description || null, recruitmentType: recruitmentType || null, jobCategory: jobCategory || null,
      overseasRequirement: overseasRequirement || null, jobKeywords: jobKeywords || null, workAddress: workAddress || null,
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
      const unreadNode = item.querySelector(SELECTORS.unread);
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

  async function collectSelectedConversation() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '当前没有 HR 手动打开的会话。');
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息容器尚未就绪。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话没有稳定 DOM ID。');
    const messages = [...active.querySelectorAll(SELECTORS.message)].filter(visible);
    const last = messages.filter((item) => directionOf(item)).at(-1);
    if (!last) return blocked('LAST_MESSAGE_NOT_FOUND', '当前会话没有可识别的最后消息。');
    const direction = directionOf(last);
    const content = String(last.textContent || '').trim();
    const timeline = [...active.querySelectorAll(`${SELECTORS.messageTime}, ${SELECTORS.message}`)];
    const lastIndex = timeline.indexOf(last);
    const precedingTime = timeline.slice(0, Math.max(0, lastIndex)).reverse().find((item) => item.matches(SELECTORS.messageTime));
    const messageAt = parseTime(String(last.querySelector(SELECTORS.messageTime)?.textContent || precedingTime?.textContent || '').trim());
    if (!messageAt) return blocked('TIME_UNRECOGNISED', '当前会话最后消息时间无法解析。');
    const chatDigest = await digest(identity);
    const mediaShape = [...last.querySelectorAll('img, video, audio, svg')].map((node) => node.tagName.toLowerCase()).join(',') || 'non-text';
    const messageDigest = await digest(stableIdentity(last) || `derived:${direction}:${messageAt}:${content || mediaShape}`);
    const selectedUnread = Boolean(selected.querySelector(SELECTORS.unread));
    const conversationSignals = collectConversationSignals();
    const signalSignature = Object.values(conversationSignals).map((value) => value ? '1' : '0').join('');
    const messageText = direction === 'INBOUND' && content ? compact(content).slice(0, 1000) : null;
    const conversationContext = messages.filter((item) => directionOf(item)).slice(-7, -1)
      .map((item) => {
        const text = compact(item.textContent).slice(0, 300);
        if (!text) return null;
        return `${directionOf(item) === 'INBOUND' ? '候选人' : 'HR'}：${text}`;
      }).filter(Boolean).join('\n').slice(0, 2400);
    return { ok: true, chatDigest, messageDigest, direction, messageAt, selectedUnread, conversationSignals, messageText, conversationContext, signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}:${signalSignature}` };
  }

  async function collectCurrentTranscript() {
    const selected = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selected) return blocked('NO_SELECTED_CONVERSATION', '请先在 BOSS 沟通页打开需要复制的会话。');
    const active = [...document.querySelectorAll(SELECTORS.activeConversation)].find(visible);
    if (!active) return blocked('MESSAGE_CONTAINER_NOT_FOUND', '当前会话消息区域尚未加载完成，请稍后重试。');
    const identity = stableIdentity(selected);
    if (!identity) return blocked('CHAT_ID_MISSING', '当前会话缺少稳定标识，已停止复制以免读取错误会话。');

    const scroller = findTranscriptScroller(active);
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

    const timeline = [...active.querySelectorAll(`${SELECTORS.messageTime}, ${SELECTORS.message}`)];
    const records = [];
    let currentTime = '';
    for (const node of timeline) {
      if (node.matches(SELECTORS.messageTime)) {
        currentTime = compact(node.textContent || '').slice(0, 40);
        continue;
      }
      const direction = directionOf(node);
      if (!direction) continue;
      const text = transcriptMessageText(node);
      if (!text) continue;
      const ownTime = compact(node.querySelector(SELECTORS.messageTime)?.textContent || '').slice(0, 40);
      records.push({ speaker: direction === 'INBOUND' ? '候选人' : 'HR', time: ownTime || currentTime, text });
    }
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight - distanceFromBottom);
    const selectedAfter = [...document.querySelectorAll(SELECTORS.selectedConversation)].find(visible);
    if (!selectedAfter || stableIdentity(selectedAfter) !== identity) {
      return blocked('SELECTED_CONVERSATION_CHANGED', '读取期间当前会话发生变化，已停止复制以避免混入其他候选人的消息。');
    }
    if (!records.length) return blocked('TRANSCRIPT_EMPTY', '当前会话没有可复制的文字或附件记录。');

    const limited = records.slice(-1000);
    const jobTitle = compact(selected.querySelector(SELECTORS.job)?.textContent || '').slice(0, 120);
    const lines = ['BOSS 当前会话记录（已脱敏）', jobTitle ? `岗位：${redactTranscript(jobTitle)}` : null,
      `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const record of limited) lines.push(`${record.time ? `[${record.time}] ` : ''}${record.speaker}：${record.text}`);
    const raw = lines.filter((line) => line !== null).join('\n');
    const text = raw.length > 120_000 ? raw.slice(raw.length - 120_000) : raw;
    return { ok: true, transcript: {
      text, messageCount: limited.length,
      possiblyTruncated: !reachedBeginning || records.length > limited.length || raw.length > text.length,
      redacted: true,
    } };
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
    clone.querySelectorAll(`${SELECTORS.messageTime}, script, style, input, textarea, button, .message-card-buttons`).forEach((item) => item.remove());
    const text = compact(clone.textContent || '').slice(0, 4000);
    if (text) return redactTranscript(text);
    if (node.querySelector('img')) return '[图片]';
    if (node.querySelector('video')) return '[视频]';
    if (node.querySelector('audio')) return '[语音]';
    if (node.querySelector('.message-card-wrap, .hyperLink, [class*="attachment"], [class*="resume"]')) return '[附件或简历]';
    return '';
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
    const matches = [...active.querySelectorAll('button, a, [role="button"], [class*="resume"], [class*="attachment"], [class*="file"], [class*="preview"]')]
      .filter(visible)
      .map((node) => ({ node, label: compact(controlLabel(node)), area: node.getBoundingClientRect().width * node.getBoundingClientRect().height }))
      .filter(({ node, label }) => /^(?:查看简历|点击预览附件简历|预览附件简历)$/.test(label) && label.length <= 80
        && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && getComputedStyle(node).cursor === 'pointer')
      .sort((left, right) => left.area - right.area);
    return matches[0]?.node || null;
  }

  async function openVisibleResume(expectedChatDigest) {
    const first = await collectSelectedConversation();
    if (!first.ok || first.chatDigest !== expectedChatDigest) return { ok: false, error: '当前选中会话与待接收简历不一致。' };
    if (findVisibleResumeRoot()) return { ok: true, alreadyOpen: true };
    const control = findResumeOpenControl();
    if (!control) return { ok: false, error: '当前会话尚未找到唯一可用的“查看简历”或“点击预览附件简历”入口。' };
    control.click();
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(300);
      const current = await collectSelectedConversation();
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

  let resumePdfForwardInFlight = null;
  let lastResumePdfForwardKey = '';
  let lastResumePdfForwardAt = 0;

  async function forwardMainWorldResumePdf(data) {
    scheduleResumeCardScan(500);
    const captureKey = `${data?.fileSize || 0}:${String(data?.fileBase64 || '').slice(0, 96)}`;
    if (resumePdfForwardInFlight) {
      showResumeCaptureStatus('content：PDF 正在发送中，忽略重复捕获。');
      return resumePdfForwardInFlight;
    }
    if (captureKey === lastResumePdfForwardKey && Date.now() - lastResumePdfForwardAt < 10_000) {
      showResumeCaptureStatus('content：同一份 PDF 已提交，忽略重复捕获。');
      return;
    }
    lastResumePdfForwardKey = captureKey;
    lastResumePdfForwardAt = Date.now();
    resumePdfForwardInFlight = forwardMainWorldResumePdfOnce(data).finally(() => { resumePdfForwardInFlight = null; });
    return resumePdfForwardInFlight;
  }

  async function forwardMainWorldResumePdfOnce(data) {
    showResumeCaptureStatus('content：收到 PDF 数据，大小=' + (data.fileSize || '?') + ' bytes');
    if (typeof data.fileBase64 !== 'string' || !Number.isInteger(data.fileSize)
        || data.fileSize < 5 || data.fileSize > 8 * 1024 * 1024 || data.fileBase64.length > 12_000_000) {
      showResumeCaptureStatus('content：PDF 数据校验失败');
      return;
    }
    let selected = await collectSelectedConversation();
    if (!selected.ok) {
      showResumeCaptureStatus('content：collectSelectedConversation 失败: ' + (selected.reason || 'unknown'));
      return;
    }
    showResumeCaptureStatus('content：会话识别成功，chatDigest=' + (selected.chatDigest || '').slice(0, 12));
    const fileDigest = await digest(data.fileBase64);
    let response = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await waitForCollectionIdle(2_500);
      // Resume processing runs while autoReplyBusy is held. Explicitly allow
      // this stability snapshot so the background runtime gets the current digest.
      await collectAndPublish(true, true);
      await waitForCollectionIdle(2_500);
      const refreshed = await collectSelectedConversation();
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
      response = await send({ type: 'BRIDGE_VISIBLE_RESUME_PDF_CAPTURE', payload });
      if (response?.ok) break;
      const reason = String(response?.error || '');
      if (!/稳定|会话|观测|通信失败|无响应/.test(reason) || attempt === 4) break;
      showResumeCaptureStatus(`后端尚未就绪，将自动重试：${reason}`);
      await delay(attempt * 600);
    }
    showResumeImportResult(response);
    const previewClosed = response?.ok ? await closeVisibleResumePreview(selected.chatDigest) : false;
    lastResumePdfImportOutcome = response?.ok && previewClosed
      ? { ok: true, chatDigest: selected.chatDigest, intakeId: response.intakeId || '', analysisStatus: response.analysisStatus || '' }
      : { ok: false, chatDigest: selected.chatDigest, error: response?.ok ? '简历已导入，但预览窗口未确认关闭' : response?.error || '后端导入失败' };
    return response;
  }

  async function closeVisibleResumePreview(expectedChatDigest) {
    const selected = await collectSelectedConversation();
    if (!selected.ok || selected.chatDigest !== expectedChatDigest) {
      showResumeCaptureStatus('预览未关闭：当前会话已变化，禁止操作其他会话的弹窗。', 'error');
      return false;
    }
    const dialog = [...document.querySelectorAll('.resume-common-dialog.search-resume, .resume-common-dialog, .attachment-view')]
      .find((node) => node instanceof HTMLElement && visible(node));
    if (!dialog) return true;
    const dialogRect = dialog.getBoundingClientRect();
    const candidates = [...dialog.querySelectorAll('.close-btn, .boss-popup__close, .dialog-close, [class*="close"], [aria-label="关闭"], [title="关闭"]')]
      .filter((node) => {
        if (!(node instanceof HTMLElement) || !visible(node) || !isAvailableAction(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width <= 72 && rect.height <= 72
          && rect.right >= dialogRect.right - 120 && rect.top <= dialogRect.top + 120;
      });
    const close = candidates.find((node) => {
      const label = compact(controlLabel(node));
      const cls = String(node.className || '');
      return /^(?:关闭|close)?$/i.test(label) || /(?:^|[-_])close(?:[-_]|$)/i.test(cls);
    });
    if (!close) {
      showResumeCaptureStatus('简历已导入，但未识别到唯一安全关闭按钮；保持当前预览并停止切换会话。', 'error');
      return false;
    }
    close.click();
    for (let attempt = 0; attempt < 15; attempt++) {
      await delay(200);
      if (!visible(dialog) || !document.contains(dialog)) {
        showResumeCaptureStatus('简历预览已自动关闭，可继续处理其他会话。', 'success');
        return true;
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
    resumeCaptureStatusBar.style.cssText = 'position:fixed;top:60px;right:12px;z-index:2147483647;width:min(280px,calc(100vw - 24px));max-height:60vh;background:rgba(15,23,42,.78);color:#fff;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid rgba(255,255,255,.10);border-radius:8px;box-shadow:0 4px 16px rgba(15,23,42,.15);overflow:hidden;user-select:text;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);';
    const title = document.createElement('strong');
    title.textContent = '简历自动处理';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制全部';
    copyBtn.style.cssText = 'padding:3px 8px;font:11px sans-serif;background:#2563eb;color:#fff;border:0;border-radius:5px;cursor:pointer;';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(resumeCaptureStatusLog?.textContent || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制全部'; }, 1500);
    });
    header.append(title, copyBtn);
    resumeCaptureStatusLog = document.createElement('div');
    resumeCaptureStatusLog.style.cssText = 'max-height:calc(60vh - 42px);overflow-y:auto;padding:8px 10px;white-space:pre-wrap;word-break:break-word;';
    resumeCaptureStatusBar.append(header, resumeCaptureStatusLog);
    resumeCaptureCopyBtn = copyBtn;
    mount.appendChild(resumeCaptureStatusBar);
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
      const bridge = await send({ type: 'BRIDGE_GET_STATUS' });
      if (!bridge?.ok) {
        showResumeCaptureStatus('状态检查失败：' + (bridge?.error || '扩展后台无响应'), 'error');
        return;
      }
      if (bridge.status?.enabled === false) {
        showResumeCaptureStatus('自动处理已停止：浏览器桥接当前处于暂停状态。', 'error');
        return;
      }
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
      if (autoReplyBusy && !resumeAttachmentProcessing) { showResumeCaptureStatus('跳过点击: 自动回复进行中'); return; }
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
        showResumeCaptureStatus('自动点击: ' + compact(controlLabel(previewBtn)));
        previewBtn.click();
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
    const direct = Date.parse(value); if (Number.isFinite(direct)) return new Date(direct).toISOString();
    const now = new Date(); let match = value.match(/^(?:(昨天)\s*)?(\d{1,2}):(\d{2})$/);
    if (match) { const date = new Date(now); date.setSeconds(0, 0); date.setHours(Number(match[2]), Number(match[3]), 0, 0); if (match[1]) date.setDate(date.getDate() - 1); else if (date.getTime() > now.getTime() + 60_000) date.setDate(date.getDate() - 1); return date.toISOString(); }
    match = value.match(/^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const date = new Date(now); date.setFullYear(match[1] ? Number(match[1]) : now.getFullYear(), Number(match[2]) - 1, Number(match[3])); date.setHours(Number(match[4]), Number(match[5]), 0, 0); if (!match[1] && date.getTime() > now.getTime() + 86_400_000) date.setFullYear(date.getFullYear() - 1); return date.toISOString();
  }
  function blocked(code, reason) { return { ok: false, code, reason }; }
  function stripSelected(value) { return { chatDigest: value.chatDigest, messageDigest: value.messageDigest, direction: value.direction, messageAt: value.messageAt, selectedUnread: value.selectedUnread, conversationSignals: value.conversationSignals, observedAt: new Date().toISOString() }; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function send(message) {
    try { return await chrome.runtime.sendMessage(message); }
    catch (error) {
      return { ok: false, error: `扩展后台通信失败：${String(error?.message || error || '未知错误')}` };
    }
  }
})();

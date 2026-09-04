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
  let collectTimer = null;
  let collecting = false;
  let autoReplyArm = null;
  let autoReplyTimer = null;
  let autoReplyBusy = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['BRIDGE_COLLECT', 'BRIDGE_COLLECT_JOBS', 'BRIDGE_CHECK_REPLY_READINESS', 'BRIDGE_INSPECT_CURRENT_CONTROLS', 'BRIDGE_TEST_CURRENT_ACTION_ENTRY', 'BRIDGE_CONFIRM_CURRENT_EXCHANGE', 'BRIDGE_FILL_TEST_DRAFT', 'BRIDGE_PREPARE_CURRENT_SEND_TEST', 'BRIDGE_SEND_CURRENT_TEST_DRAFT', 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY', 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST', 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL', 'BRIDGE_FILL_APPROVED_DRAFT'].includes(message?.type)) return false;
    const task = message.type === 'BRIDGE_COLLECT_JOBS'
      ? collectJobsAndPublish(Boolean(message.allowEmbeddedJobList))
      : message.type === 'BRIDGE_CHECK_REPLY_READINESS'
        ? collectReplyReadiness()
        : message.type === 'BRIDGE_INSPECT_CURRENT_CONTROLS'
          ? inspectCurrentConversationControls()
        : message.type === 'BRIDGE_TEST_CURRENT_ACTION_ENTRY'
          ? testCurrentActionEntry(message.action)
        : message.type === 'BRIDGE_CONFIRM_CURRENT_EXCHANGE'
          ? confirmCurrentExchange(message.action)
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
          : message.type === 'BRIDGE_PREPARE_APPROVED_DRAFT_FILL'
            ? prepareApprovedDraftFill()
            : message.type === 'BRIDGE_FILL_APPROVED_DRAFT' ? fillApprovedDraft(message.payload) : collectAndPublish(true);
    task.then((result) => sendResponse(result || { ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  const observer = new MutationObserver(() => { scheduleCollect(1_200); scheduleAutoReplyCheck(700); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
  window.addEventListener('focus', () => scheduleCollect(500), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCollect(500); }, { passive: true });
  scheduleCollect(1_500);

  function scheduleCollect(delay) {
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => void collectAndPublish(false), delay);
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
      const controls = findReplyControls();
      if (!controls.editor || readEditorText(controls.editor).trim()) return void finishAutoReplyTest('BLOCKED', '回复输入框不可用或已有内容，未发送。');
      writeEditorText(controls.editor, TEST_DRAFT_TEXT);
      await delay(300);
      if (readEditorText(controls.editor).trim() !== TEST_DRAFT_TEXT) return void finishAutoReplyTest('BLOCKED', '测试草稿未稳定写入，未发送。');
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
        if (currentControls.editor && !readEditorText(currentControls.editor).trim() && directionOf(last) === 'OUTBOUND' && compact(last?.textContent).includes(compact(TEST_DRAFT_TEXT))) { confirmed = true; break; }
      }
      await finishAutoReplyTest(confirmed ? 'SUCCEEDED' : 'UNKNOWN', confirmed ? '检测到候选人新消息后，固定测试草稿已自动发送一次。' : '已点击一次发送，但页面结果无法确认；不会重试。', armed.chatDigest);
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

  async function collectAndPublish(reportNonChat) {
    if (collecting) return;
    if (autoReplyArm) return;
    if (autoReplyBusy) { scheduleCollect(800); return; }
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
      const response = await send({ type: 'BRIDGE_JOB_SNAPSHOT', payload: { pageState: 'JOB_MANAGEMENT_READY', entries: second.entries, observedAt: new Date().toISOString() } });
      return response?.ok ? response : { ok: false, pageMatched: true, error: response?.error || '本地服务未接受职位快照。' };
    } finally { collecting = false; }
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
      .map(controlLabel).filter((label) => /^(?:发送(?:消息)?|求简历|接收简历|换电话|换微信|约面试|不合适)$/.test(label));
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
    const observedAt = new Date().toISOString();
    const reportDigest = await digest(JSON.stringify([selected.chatDigest, editorReport.fingerprint, ...controls.map((item) => item.fingerprint)]));
    return { ok: true, diagnostic: { actionType: 'CURRENT_CONTROL_DOM_DIAGNOSTIC', pageState: 'CHAT_PAGE_READY', chatDigest: selected.chatDigest,
      observedAt, rawContentIncluded: false, truncated: candidates.length >= 120, editor: editorReport, controls, reportDigest } };
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
    const label = compact(value);
    return /^(?:发送(?:消息)?|求简历|接收简历|换电话|换微信|约面试|不合适|确认|确定|取消|暂不)$/.test(label) ? label : null;
  }

  function knownActionLabel(node, rawLabel) {
    if (!node) return null;
    const exact = rawLabel.match(/^(发送(?:消息)?|求简历|接收简历|换电话|换微信|约面试|不合适)$/)?.[1];
    if (exact) return exact === '发送消息' ? '发送' : exact;
    if (!node.matches('.operate-btn, .submit, .boss-btn, .card-btn, button, [role="button"]') || rawLabel.length > 40) return null;
    return ['求简历', '接收简历', '换电话', '换微信', '约面试', '不合适', '发送', '确认', '确定', '取消', '暂不'].find((label) => rawLabel.includes(label)) || null;
  }

  function replyControlShape({ editor, sendButton }) {
    return [editor?.id || 'fallback-editor', editor?.tagName || '', editor?.getAttribute('role') || '',
      editor?.getAttribute('contenteditable') || '', sendButton ? `${sendButton.tagName}:${safeClassTokens(sendButton).join('.')}:发送` : 'ENTER_TO_SEND'].join('|');
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
      completeness: values.filter(Boolean).length,
    };
    const signature = Object.values(entry).map((value) => value ?? '').join('|');
    return { ok: true, entries: [entry], signature };
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
      entries.push({ sourceDigest, title, location: location || null, salaryDisplay: salaryDisplay || null, salaryMinK: salary.min, salaryMaxK: salary.max, salaryMonths: salary.months, experienceRequirement: experienceRequirement || null, educationRequirement: educationRequirement || null, description: description || null, completeness: values.filter(Boolean).length });
    }
    if (!entries.length) return blocked('JOB_LIST_EMPTY_AFTER_DEDUP', '职位行去重后没有可同步数据。');
    const signature = entries.map((entry) => `${entry.sourceDigest}:${entry.title}:${entry.location || ''}:${entry.salaryDisplay || ''}:${entry.experienceRequirement || ''}:${entry.educationRequirement || ''}:${entry.description || ''}`).join('|');
    return { ok: true, entries, signature };
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
    return { ok: true, chatDigest, messageDigest, direction, messageAt, selectedUnread, signature: `${chatDigest}:${messageDigest}:${direction}:${messageAt}:${selectedUnread}` };
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
  function stripSelected(value) { return { chatDigest: value.chatDigest, messageDigest: value.messageDigest, direction: value.direction, messageAt: value.messageAt, selectedUnread: value.selectedUnread, observedAt: new Date().toISOString() }; }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function send(message) { try { return await chrome.runtime.sendMessage(message); } catch { return null; } }
})();

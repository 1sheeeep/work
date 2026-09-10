const elements = Object.fromEntries(['stateBadge','summary','pairForm','accountName','totalCount','currentUnreadCount','trackedUnreadCount','reason','continuousReplyState','continuousReplyBadge','lastContinuousReply','detailState','lastSync','copyCurrentTranscript','jobState','lastJobSync','collectJobs','readinessState','lastReadiness','checkReadiness','controlDiagnosticState','lastControlDiagnostic','inspectControls','controlDiagnosticReport','copyControlDiagnostic','visibleResumeState','lastVisibleResume','recognizeCurrentResume','resumeStageBadge','resumeStepDetected','resumeStepImported','resumeStepAnalyzing','resumeStepCompleted','resumeRecovery','pluginVersion','actionTestState','lastActionTest','testRequestResume','testExchangePhone','testExchangeWechat','testInterview','exchangeConfirmState','lastExchangeConfirm','confirmExchangePhone','confirmExchangeWechat','productionActionState','lastProductionAction','draftTestState','lastDraftTest','fillTestDraft','sendTestState','lastSendTest','prepareCurrentSendTest','sendCurrentTestDraft','autoReplyTestResult','autoReplyTestState','autoReplyTestExpiry','autoReplyDiagnosticState','lastAutoReplyDiagnostic','diagnoseCurrentAutoReply','armCurrentAutoReplyTest','cancelCurrentAutoReplyTest','approvedDraftFillState','lastApprovedDraftFill','fillApprovedDraft','enabled','collect','forget','message','backendUrl','deviceName','pairingToken','pageContext','openConsole'].map((id) => [id, document.getElementById(id)]));

elements.pluginVersion.textContent = chrome.runtime.getManifest().version;

elements.pairForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await busy(event.submitter, async () => {
    const result = await send({ type: 'BRIDGE_PAIR', payload: { backendUrl: elements.backendUrl.value, deviceName: elements.deviceName.value, pairingToken: elements.pairingToken.value } });
    if (!result.ok) throw new Error(result.error);
    elements.pairingToken.value = '';
    render(result.status);
    show('配对成功，请打开 BOSS 沟通页并手动刷新一次。');
  });
});
elements.enabled.addEventListener('change', () => void act({ type: 'BRIDGE_SET_ENABLED', enabled: elements.enabled.checked }));
elements.collect.addEventListener('click', () => void busy(elements.collect, async () => { const result = await send({ type: 'BRIDGE_COLLECT_NOW' }); if (!result.ok) throw new Error(result.error); render(result.status); }));
elements.copyCurrentTranscript.addEventListener('click', () => void busy(elements.copyCurrentTranscript, async () => {
  show('正在加载当前会话、进行本机脱敏并同步至后端示例库，请稍候…');
  const result = await send({ type: 'BRIDGE_SYNC_CURRENT_TRANSCRIPT' });
  if (!result.ok) throw new Error(result.error);
  const synced = result.transcriptSync;
  await navigator.clipboard.writeText(synced.text);
  const suffix = synced.possiblyTruncated ? '；页面可能还有未加载的更早记录' : '';
  const imported = synced.import;
  if (synced.importError) {
    show(`已复制 ${synced.messageCount} 条记录；未导入后端：${synced.importError}${suffix}。`, true);
  } else if (imported) {
    show(`已复制 ${synced.messageCount} 条记录；后端导入成功（岗位：${imported.jobTitle}）：新增 ${imported.created} 条示例，重复 ${imported.duplicates} 条，跳过 ${imported.skipped} 条${suffix}。`);
  } else {
    show(`已复制 ${synced.messageCount} 条记录；后端导入状态未知，请查看后端日志。`, true);
  }
}, '同步中…'));
elements.collectJobs.addEventListener('click', () => void busy(elements.collectJobs, async () => {
  show('正在读取当前职位页并进行稳定性校验，请稍候…');
  const result = await send({ type: 'BRIDGE_COLLECT_JOBS_NOW' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.jobState);
}, '同步中…'));
elements.checkReadiness.addEventListener('click', () => void busy(elements.checkReadiness, async () => {
  show('正在连续检查当前会话和回复入口，不会读取或修改输入内容…');
  const result = await send({ type: 'BRIDGE_CHECK_REPLY_READINESS' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.readinessState);
}, '检查中…'));
elements.inspectControls.addEventListener('click', () => void busy(elements.inspectControls, async () => {
  show('正在只读识别当前会话输入区与功能键结构；不会点击或发送…');
  const result = await send({ type: 'BRIDGE_INSPECT_CURRENT_CONTROLS' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.controlDiagnosticState);
}, '识别中…'));
elements.copyControlDiagnostic.addEventListener('click', () => void busy(elements.copyControlDiagnostic, async () => {
  if (!elements.controlDiagnosticReport.value) throw new Error('请先点击“识别当前会话功能键 DOM”生成报告。');
  await navigator.clipboard.writeText(elements.controlDiagnosticReport.value);
  show('脱敏 DOM 报告已复制，可以直接发给我继续适配。');
}, '复制中…'));
elements.recognizeCurrentResume.addEventListener('click', () => void busy(elements.recognizeCurrentResume, async () => {
  show('正在识别当前会话中的 PDF 简历，打开预览后将直接进入现有 AI 分析流程…');
  const result = await send({ type: 'BRIDGE_RECOGNIZE_CURRENT_RESUME' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.visibleResumeState);
}, '识别中…'));
for (const [id, action, label] of [['testRequestResume', 'REQUEST_RESUME', '求简历'], ['testExchangePhone', 'EXCHANGE_PHONE', '查看电话'], ['testExchangeWechat', 'EXCHANGE_WECHAT', '换微信'], ['testInterview', 'INTERVIEW', '查看面试']]) {
  elements[id].addEventListener('click', () => void busy(elements[id], async () => {
    const confirmed = window.confirm(`确定只对当前已打开会话点击一次“${label}”入口吗？\n\n该操作可能直接向候选人发起请求，或打开平台设置界面。扩展不会切换会话、不会填写或确认二级界面、不会重试。`);
    if (!confirmed) { show('已取消，未执行任何页面操作。'); return; }
    show(`正在三轮核对当前会话和唯一“${label}”入口，最多点击一次…`);
    const result = await send({ type: 'BRIDGE_TEST_CURRENT_ACTION_ENTRY', action });
    if (!result.ok) throw new Error(result.error);
    render(result.status);
    show(result.status.actionTestState, result.actionTest?.outcome === 'UNKNOWN');
  }, '测试中…'));
}
for (const [id, action, label] of [['confirmExchangePhone', 'EXCHANGE_PHONE', '换电话'], ['confirmExchangeWechat', 'EXCHANGE_WECHAT', '换微信']]) {
  elements[id].addEventListener('click', () => void busy(elements[id], async () => {
    const confirmed = window.confirm(`确定在当前会话的“${label}”二级确认层中真实点击一次“确定”吗？\n\n该操作可能向候选人发起联系方式交换，无法保证撤回。扩展不会切换会话或重试。`);
    if (!confirmed) { show('已取消，未点击二级确定按钮。'); return; }
    const result = await send({ type: 'BRIDGE_CONFIRM_CURRENT_EXCHANGE', action });
    if (!result.ok) throw new Error(result.error);
    render(result.status); show(result.status.exchangeConfirmState, result.exchangeConfirm?.outcome === 'UNKNOWN');
  }, '确认中…'));
}
elements.fillTestDraft.addEventListener('click', () => void busy(elements.fillTestDraft, async () => {
  show('正在确认当前会话已读、输入框为空且回复入口稳定；只填草稿，不发送…');
  const result = await send({ type: 'BRIDGE_FILL_TEST_DRAFT' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.draftTestState);
}, '写入中…'));
elements.sendCurrentTestDraft.addEventListener('click', () => void busy(elements.sendCurrentTestDraft, async () => {
  const confirmed = window.confirm('确定发送当前已打开会话中的固定测试草稿吗？\n\n这会真实向当前候选人发送一条消息，且无法撤回。扩展不会切换或操作其他会话。');
  if (!confirmed) { show('已取消，未执行发送。'); return; }
  show('正在最后核对当前会话、固定草稿和唯一发送按钮；最多点击一次…');
  const result = await send({ type: 'BRIDGE_SEND_CURRENT_TEST_DRAFT' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.sendTestState, result.sendTest?.outcome !== 'SUCCEEDED');
}, '发送中…'));
elements.prepareCurrentSendTest.addEventListener('click', () => void busy(elements.prepareCurrentSendTest, async () => {
  const confirmed = window.confirm('确定为当前已打开的已读会话准备本轮发送测试吗？\n\n准备过程只读检查当前会话，不写入、不发送；同一会话可能再次收到固定测试消息，请确认这是你允许重复测试的会话。');
  if (!confirmed) { show('已取消，未改变发送测试锁。'); return; }
  show('正在确认当前会话已读、输入框为空且回复入口稳定…');
  const result = await send({ type: 'BRIDGE_PREPARE_CURRENT_SEND_TEST' });
  if (!result.ok) throw new Error(result.error);
  render(result.status); show(result.status.sendTestState);
}, '准备中…'));
elements.armCurrentAutoReplyTest.addEventListener('click', () => void busy(elements.armCurrentAutoReplyTest, async () => {
  const confirmed = window.confirm('确定对当前已打开的已读测试会话开启一次受限自动回复吗？\n\n系统会先判断最后一条求职者消息是否与当前岗位相关。仅当问题低风险且能由已审核岗位资料回答时，才会真实发送一条不超过 90 字的短回复；其他情况保持静默。消息发送后无法撤回，扩展不会切换其他会话。');
  if (!confirmed) { show('已取消，未开启自动触发。'); return; }
  const result = await send({ type: 'BRIDGE_ARM_CURRENT_AUTO_REPLY_TEST' });
  if (!result.ok) throw new Error(result.error);
  render(result.status); show(result.status.autoReplyTestState);
}, '开启中…'));
elements.diagnoseCurrentAutoReply.addEventListener('click', () => void busy(elements.diagnoseCurrentAutoReply, async () => {
  const result = await send({ type: 'BRIDGE_DIAGNOSE_CURRENT_AUTO_REPLY' });
  if (!result.ok) throw new Error(result.error);
  render(result.status); show(result.status.autoReplyDiagnosticState);
}, '诊断中…'));
elements.cancelCurrentAutoReplyTest.addEventListener('click', () => void busy(elements.cancelCurrentAutoReplyTest, async () => {
  const result = await send({ type: 'BRIDGE_CANCEL_CURRENT_AUTO_REPLY_TEST' });
  if (!result.ok) throw new Error(result.error);
  render(result.status); show(result.status.autoReplyTestState);
}, '取消中…'));
elements.fillApprovedDraft.addEventListener('click', () => void busy(elements.fillApprovedDraft, async () => {
  show('正在核对当前会话并领取 60 秒单次已审核草稿；只填入，不发送…');
  const result = await send({ type: 'BRIDGE_FILL_APPROVED_DRAFT' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.approvedDraftFillState);
}, '填入中…'));
elements.forget.addEventListener('click', () => void busy(elements.forget, async () => { const result = await send({ type: 'BRIDGE_FORGET_DEVICE' }); if (!result.ok) throw new Error(result.error); render(result.status); }));
elements.openConsole.addEventListener('click', () => void busy(elements.openConsole, async () => { const result = await send({ type: 'BRIDGE_OPEN_CONSOLE' }); if (!result.ok) throw new Error(result.error); }, '打开中…'));

void act({ type: 'BRIDGE_GET_STATUS' });
const statusRefreshTimer = setInterval(() => {
  if (document.visibilityState === 'visible') void act({ type: 'BRIDGE_GET_STATUS' }, false);
}, 1_000);
window.addEventListener('unload', () => clearInterval(statusRefreshTimer), { once: true });

async function act(message, reportError = true) {
  try { const result = await send(message); if (!result.ok) throw new Error(result.error); render(result.status); }
  catch (error) { if (reportError) show(error.message, true); }
}
async function send(message) { return chrome.runtime.sendMessage(message); }
async function busy(button, operation, busyText = '') { const original = button.textContent; button.disabled = true; if (busyText) button.textContent = busyText; try { await operation(); } catch (error) { show(error.message, true); } finally { button.disabled = button.dataset.locked === 'true'; button.textContent = original; } }
function render(status) {
  elements.summary.hidden = !status.paired; elements.pairForm.hidden = status.paired;
  if (!status.paired && status.backendUrl && !elements.backendUrl.value) elements.backendUrl.value = status.backendUrl;
  elements.accountName.textContent = status.accountName || '-'; elements.totalCount.textContent = status.total; elements.currentUnreadCount.textContent = status.currentUnread; elements.trackedUnreadCount.textContent = status.trackedUnread;
  elements.reason.textContent = status.reason; elements.detailState.textContent = `详情复核：${status.detailState}`; elements.lastSync.textContent = status.lastSyncAt ? `最近同步：${new Date(status.lastSyncAt).toLocaleString('zh-CN')}` : '尚未同步真实快照'; elements.enabled.checked = status.enabled;
  elements.continuousReplyState.textContent = status.singleAccountAutoReplyState;
  elements.continuousReplyBadge.textContent = status.singleAccountAutoReplyEnabled ? '运行中' : '已停止';
  elements.continuousReplyBadge.className = `badge ${status.singleAccountAutoReplyEnabled ? 'running' : 'paused'}`;
  elements.lastContinuousReply.textContent = status.lastSingleAccountAutoReplyAt ? `最近处理：${new Date(status.lastSingleAccountAutoReplyAt).toLocaleString('zh-CN')} · 已检查 ${status.singleAccountAutoReplyProcessedCount} 条` : '尚未处理消息';
  elements.jobState.textContent = status.jobState; elements.lastJobSync.textContent = status.lastJobSyncAt ? `最近职位同步：${new Date(status.lastJobSyncAt).toLocaleString('zh-CN')} · ${status.jobTotal} 个` : '尚未同步职位管理页';
  elements.readinessState.textContent = status.readinessState; elements.lastReadiness.textContent = status.lastReadinessAt ? `最近检查：${new Date(status.lastReadinessAt).toLocaleString('zh-CN')}` : '尚未形成人工验收证据';
  elements.controlDiagnosticState.textContent = status.controlDiagnosticState; elements.lastControlDiagnostic.textContent = status.lastControlDiagnosticAt ? `最近识别：${new Date(status.lastControlDiagnosticAt).toLocaleString('zh-CN')}` : '尚未生成脱敏结构报告';
  elements.controlDiagnosticReport.hidden = !status.controlDiagnostic; elements.copyControlDiagnostic.disabled = !status.controlDiagnostic;
  elements.controlDiagnosticReport.value = status.controlDiagnostic ? JSON.stringify(status.controlDiagnostic, null, 2) : '';
  elements.visibleResumeState.textContent = status.visibleResumeState;
  elements.lastVisibleResume.textContent = status.lastVisibleResumeAt ? `最近识别：${new Date(status.lastVisibleResumeAt).toLocaleString('zh-CN')}` : '尚未尝试识别 PDF 简历';
  renderResumePipeline(status.visibleResumeState);
  elements.actionTestState.textContent = status.actionTestState; elements.lastActionTest.textContent = status.lastActionTestAt ? `最近入口测试：${new Date(status.lastActionTestAt).toLocaleString('zh-CN')}` : '尚未点击操作入口';
  for (const [id, action] of [['testRequestResume', 'REQUEST_RESUME'], ['testExchangePhone', 'EXCHANGE_PHONE'], ['testExchangeWechat', 'EXCHANGE_WECHAT'], ['testInterview', 'INTERVIEW']]) { elements[id].dataset.locked = status.actionTestLocks?.[action] ? 'true' : 'false'; elements[id].disabled = status.actionTestLocks?.[action] === true; }
  elements.exchangeConfirmState.textContent = status.exchangeConfirmState; elements.lastExchangeConfirm.textContent = status.lastExchangeConfirmAt ? `最近二级测试：${new Date(status.lastExchangeConfirmAt).toLocaleString('zh-CN')}` : '尚未点击二级确定';
  elements.productionActionState.textContent = status.productionActionState; elements.lastProductionAction.textContent = status.lastProductionActionAt ? `最近自动动作：${new Date(status.lastProductionActionAt).toLocaleString('zh-CN')} · ${status.productionActionOutcome}` : '尚未领取生产动作租约';
  for (const [id, action] of [['confirmExchangePhone', 'EXCHANGE_PHONE'], ['confirmExchangeWechat', 'EXCHANGE_WECHAT']]) { elements[id].dataset.locked = status.exchangeConfirmLocks?.[action] ? 'true' : 'false'; elements[id].disabled = status.exchangeConfirmLocks?.[action] === true; }
  elements.draftTestState.textContent = status.draftTestState; elements.lastDraftTest.textContent = status.lastDraftTestAt ? `最近测试：${new Date(status.lastDraftTestAt).toLocaleString('zh-CN')}` : '尚未写入测试草稿';
  elements.sendTestState.textContent = status.sendTestState; elements.lastSendTest.textContent = status.lastSendTestAt ? `最近发送测试：${new Date(status.lastSendTestAt).toLocaleString('zh-CN')}` : '尚未发送测试草稿';
  elements.sendCurrentTestDraft.dataset.locked = status.sendTestLocked ? 'true' : 'false'; elements.sendCurrentTestDraft.disabled = status.sendTestLocked;
  elements.prepareCurrentSendTest.dataset.locked = status.sendTestPrepared ? 'true' : 'false'; elements.prepareCurrentSendTest.disabled = status.sendTestPrepared === true;
  elements.autoReplyTestState.textContent = status.autoReplyTestState;
  elements.autoReplyTestResult.textContent = `结果：${status.autoReplyTestOutcome} · ${status.autoReplyTestReason}`;
  elements.autoReplyDiagnosticState.textContent = status.autoReplyDiagnosticState;
  elements.lastAutoReplyDiagnostic.textContent = status.lastAutoReplyDiagnosticAt ? `诊断时间：${new Date(status.lastAutoReplyDiagnosticAt).toLocaleString('zh-CN')}` : '尚未诊断';
  elements.autoReplyTestExpiry.textContent = status.autoReplyTestArmed && status.autoReplyTestExpiresAt ? `最近方向检查：${status.autoReplyTestLastCheckedAt ? new Date(status.autoReplyTestLastCheckedAt).toLocaleTimeString('zh-CN') : '尚未完成'} · 自动结束：${new Date(status.autoReplyTestExpiresAt).toLocaleString('zh-CN')}` : (status.lastAutoReplyTestAt ? `最近结果：${new Date(status.lastAutoReplyTestAt).toLocaleString('zh-CN')}` : '尚未执行触发测试');
  elements.armCurrentAutoReplyTest.dataset.locked = (status.autoReplyTestArmed || status.singleAccountAutoReplyEnabled) ? 'true' : 'false'; elements.armCurrentAutoReplyTest.disabled = status.autoReplyTestArmed === true || status.singleAccountAutoReplyEnabled === true;
  elements.cancelCurrentAutoReplyTest.dataset.locked = status.autoReplyTestArmed ? 'false' : 'true'; elements.cancelCurrentAutoReplyTest.disabled = status.autoReplyTestArmed !== true;
  elements.approvedDraftFillState.textContent = status.approvedDraftFillState; elements.lastApprovedDraftFill.textContent = status.lastApprovedDraftFillAt ? `最近填入：${new Date(status.lastApprovedDraftFillAt).toLocaleString('zh-CN')}` : '尚未填入后台已审核草稿';
  elements.pageContext.textContent = ({ CHAT: '当前在 BOSS 沟通页', JOB_LIST: '当前在 BOSS 职位列表', JOB_DETAIL: '当前在 BOSS 职位详情', OTHER_BOSS: '当前在其他 BOSS 页面', NO_BOSS_PAGE: '未识别 BOSS 工作页面' })[status.pageContext] || '未识别 BOSS 工作页面';
  const running = status.state === 'RUNNING'; const paused = ['PAUSED','ERROR'].includes(status.state);
  elements.stateBadge.textContent = running ? '只读运行中' : paused ? '已暂停' : status.paired ? '已配对' : '未配对'; elements.stateBadge.className = `badge ${running ? 'running' : paused ? 'paused' : ''}`;
}
function renderResumePipeline(value) {
  const state = String(value || '');
  let stage = 0; let label = '等待识别'; let tone = 'idle';
  if (/已捕获|已识别|正在识别|等待导入|预览/.test(state)) { stage = 1; label = '已识别'; tone = 'waiting'; }
  if (/已接收|已导入|处理状态|分析中|正在分析/.test(state)) { stage = 2; label = '已导入'; tone = 'working'; }
  if (/分析中|正在分析/.test(state)) { stage = 3; label = 'AI 分析中'; tone = 'working'; }
  if (/已完成 AI 分析|SUCCEEDED|已完成/.test(state)) { stage = 4; label = '已完成'; tone = 'done'; }
  if (/失败|未完成|错误/.test(state)) tone = 'error';
  elements.resumeStageBadge.textContent = label;
  elements.resumeStageBadge.className = `resume-stage-badge ${tone}`;
  [elements.resumeStepDetected, elements.resumeStepImported, elements.resumeStepAnalyzing, elements.resumeStepCompleted]
    .forEach((node, index) => node.classList.toggle('active', index < stage));
  elements.resumeRecovery.textContent = tone === 'done'
    ? '分析结果已进入招聘值守台的“简历分析”页面。'
    : tone === 'error'
      ? '保持当前简历预览打开后重试；若提示无法读取 PDF，请点击预览器内的下载按钮。'
      : stage >= 2
        ? '正在处理，请保持 BOSS 页面打开，无需重复点击。'
        : '打开目标会话并点击 PDF 预览，插件会自动识别；也可以使用下方主按钮重试。';
}
function show(text, error = false) { elements.message.hidden = false; elements.message.textContent = text; elements.message.className = `message${error ? ' error' : ''}`; }

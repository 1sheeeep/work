const elements = Object.fromEntries(['stateBadge','enabledToggle','summary','pairForm','accountName','totalCount','currentUnreadCount','trackedUnreadCount','continuousReplyState','continuousReplyBadge','lastContinuousReply','humanTakeoverState','humanTakeoverToggle','detailState','lastSync','copyCurrentTranscript','jobState','lastJobSync','collectJobs','controlDiagnosticState','lastControlDiagnostic','inspectControls','controlDiagnosticReport','copyControlDiagnostic','pluginVersion','forget','message','saveBackendUrl','backendUrl','deviceName','pairingToken','pageContext','openConsole','collect'].map((id) => [id, document.getElementById(id)]));

elements.pluginVersion.textContent = chrome.runtime.getManifest().version;
elements.connectedBackend = document.getElementById('connectedBackend');
elements.switchConnection = document.getElementById('switchConnection');
elements.switchConnection.addEventListener('click', () => void busy(elements.switchConnection, async () => {
  if (!window.confirm('切换将停止本机旧账号自动回复并解除本机配对。请准备目标后台和账号的新接入码，是否继续？')) return;
  const result = await send({ type: 'BRIDGE_FORGET_DEVICE' });
  if (!result.ok) throw new Error(result.error);
  backendUrlDirty = false;
  elements.pairingToken.value = '';
  render(result.status);
  show('旧配对已解除。请确认后台地址，并使用目标账号的新接入码配对；同时确认 BOSS 登录账号一致。');
}));
let backendUrlDirty = false;
elements.backendUrl.addEventListener('input', () => { backendUrlDirty = true; });

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
elements.saveBackendUrl.addEventListener('click', () => void busy(elements.saveBackendUrl, async () => {
  const result = await send({ type: 'BRIDGE_SAVE_BACKEND_URL', payload: { backendUrl: elements.backendUrl.value } });
  if (!result.ok) throw new Error(result.error);
  backendUrlDirty = false;
  render(result.status);
  show('后台地址已保存；如切换环境，请使用对应后台的一次性接入码重新配对。');
}));
elements.enabledToggle.addEventListener('click', () => void busy(elements.enabledToggle, async () => {
  const enabled = elements.enabledToggle.dataset.enabled !== 'true';
  const result = await send({ type: 'BRIDGE_SET_ENABLED', enabled });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(enabled ? '插件已开启，恢复页面观测与自动化链路。' : '插件已关闭，已停止页面观测与自动化链路。');
}, '切换中…'));
elements.humanTakeoverToggle.addEventListener('click', () => void busy(elements.humanTakeoverToggle, async () => {
  const active = elements.humanTakeoverToggle.dataset.active !== 'true';
  const result = await send({ type: 'BRIDGE_SET_HUMAN_TAKEOVER', active });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(active
    ? '页面已交由 HR 操作；AI 任务和待发送队列保留，插件不会切换会话或自动发送。'
    : '已请求恢复自动值守；页面会先复核当前会话，再按原来的发送安全检查继续。');
}, '切换中…'));
elements.collect.addEventListener('click', () => void busy(elements.collect, async () => { const result = await send({ type: 'BRIDGE_COLLECT_NOW' }); if (!result.ok) throw new Error(result.error); render(result.status); }));
elements.copyCurrentTranscript.addEventListener('click', () => void busy(elements.copyCurrentTranscript, async () => {
  show('正在加载当前会话、进行本机脱敏并同步示例库与沟通时间线，请稍候…');
  const result = await send({ type: 'BRIDGE_SYNC_CURRENT_TRANSCRIPT' });
  if (!result.ok) throw new Error(result.error);
  const synced = result.transcriptSync;
  await navigator.clipboard.writeText(synced.text);
  const suffix = synced.possiblyTruncated ? '；页面可能还有未加载的更早记录' : '';
  const imported = synced.import;
  const timeline = synced.timelineImport;
  const exampleText = synced.importError ? `示例库导入失败：${synced.importError}`
    : imported ? `示例库新增 ${imported.created} 条，重复 ${imported.duplicates} 条，跳过 ${imported.skipped} 条`
      : '示例库导入状态未知';
  const timelineText = synced.timelineImportError ? `时间线导入失败：${synced.timelineImportError}`
    : timeline ? `时间线新增 ${timeline.created} 条，重复 ${timeline.duplicates} 条，跳过 ${timeline.skipped} 条`
      : '时间线导入状态未知';
  const failed = Boolean(synced.importError || synced.timelineImportError);
  show(`已复制 ${synced.messageCount} 条记录；${exampleText}；${timelineText}${suffix}。`, failed);
}, '同步中…'));
elements.collectJobs.addEventListener('click', () => void busy(elements.collectJobs, async () => {
  show('正在读取当前职位页并进行稳定性校验，请稍候…');
  const result = await send({ type: 'BRIDGE_COLLECT_JOBS_NOW' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.jobState);
}, '同步中…'));
elements.inspectControls.addEventListener('click', () => void busy(elements.inspectControls, async () => {
  show('正在只读识别当前会话输入区与功能键结构；不会点击或发送…');
  const result = await send({ type: 'BRIDGE_INSPECT_CURRENT_CONTROLS' });
  if (!result.ok) throw new Error(result.error);
  render(result.status);
  show(result.status.controlDiagnosticState);
}, '识别中…'));
elements.copyControlDiagnostic.addEventListener('click', () => void busy(elements.copyControlDiagnostic, async () => {
  if (!elements.controlDiagnosticReport.value) throw new Error('请先点击"识别当前会话功能键 DOM"生成报告。');
  await navigator.clipboard.writeText(elements.controlDiagnosticReport.value);
  show('脱敏 DOM 报告已复制，可以直接发给我继续适配。');
}, '复制中…'));
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
  elements.connectedBackend.textContent = status.backendUrl || '尚未设置';
  elements.switchConnection.hidden = !status.paired;
  elements.summary.hidden = !status.paired; elements.pairForm.hidden = status.paired;
  if (status.backendUrl && !backendUrlDirty && document.activeElement !== elements.backendUrl) {
    elements.backendUrl.value = status.backendUrl;
  }
  elements.accountName.textContent = status.accountName || '-'; elements.totalCount.textContent = status.total; elements.currentUnreadCount.textContent = status.currentUnread; elements.trackedUnreadCount.textContent = status.trackedUnread;
  const enabled = status.enabled !== false;
  elements.enabledToggle.hidden = !status.paired;
  elements.enabledToggle.dataset.enabled = String(enabled);
  elements.enabledToggle.setAttribute('aria-pressed', String(enabled));
  elements.enabledToggle.className = `plugin-toggle ${enabled ? 'enabled' : 'disabled'}`;
  elements.enabledToggle.textContent = enabled ? '插件已开启' : '插件已关闭';
  elements.enabledToggle.title = enabled ? '点击暂停插件观测与自动回复' : '点击恢复插件观测与自动回复';
  elements.detailState.textContent = `详情复核：${status.detailState}`; elements.lastSync.textContent = status.lastSyncAt ? `最近同步：${new Date(status.lastSyncAt).toLocaleString('zh-CN')}` : '尚未同步真实快照';
  elements.continuousReplyState.textContent = `${status.singleAccountTaskState || 'IDLE'} · ${status.singleAccountAutoReplyReason || '等待状态同步。'}`;
  elements.continuousReplyBadge.textContent = status.singleAccountAutoReplyEnabled ? '运行中' : '已停止';
  elements.continuousReplyBadge.className = `badge ${status.singleAccountAutoReplyEnabled ? 'running' : 'paused'}`;
  const humanTakeover = status.singleAccountHumanTakeover === true;
  elements.humanTakeoverToggle.hidden = !status.singleAccountAutoReplyEnabled;
  elements.humanTakeoverToggle.dataset.active = String(humanTakeover);
  elements.humanTakeoverToggle.setAttribute('aria-pressed', String(humanTakeover));
  elements.humanTakeoverToggle.textContent = humanTakeover ? '恢复自动值守' : '暂停自动操作';
  elements.humanTakeoverToggle.title = humanTakeover
    ? '恢复前需先关闭简历预览并停止页面操作；恢复后会重新复核会话'
    : '人事准备操作 BOSS 页面时，可主动让插件暂停点击、滚动、填字和发送';
  elements.humanTakeoverState.textContent = humanTakeover
    ? `HR 接管中：${status.singleAccountHumanTakeoverReason || '自动页面操作已暂停，后台任务保留。'}`
    : '检测到 HR 在 BOSS 沟通页操作时，自动点击与发送会暂停，任务不会丢失。';
  elements.lastContinuousReply.textContent = status.lastSingleAccountAutoReplyAt ? `最近处理：${new Date(status.lastSingleAccountAutoReplyAt).toLocaleString('zh-CN')} · 已检查 ${status.singleAccountAutoReplyProcessedCount} 条` : '尚未处理消息';
  elements.jobState.textContent = status.jobState; elements.lastJobSync.textContent = status.lastJobSyncAt ? `最近职位同步：${new Date(status.lastJobSyncAt).toLocaleString('zh-CN')} · ${status.jobTotal} 个` : '尚未同步职位管理页';
  elements.controlDiagnosticState.textContent = status.controlDiagnosticState; elements.lastControlDiagnostic.textContent = status.lastControlDiagnosticAt ? `最近识别：${new Date(status.lastControlDiagnosticAt).toLocaleString('zh-CN')}` : '尚未生成脱敏结构报告';
  elements.controlDiagnosticReport.hidden = !status.controlDiagnostic; elements.copyControlDiagnostic.disabled = !status.controlDiagnostic;
  elements.controlDiagnosticReport.value = status.controlDiagnostic ? JSON.stringify(status.controlDiagnostic, null, 2) : '';
  elements.pageContext.textContent = ({ CHAT: '当前在 BOSS 沟通页', JOB_LIST: '当前在 BOSS 职位列表', JOB_DETAIL: '当前在 BOSS 职位详情', OTHER_BOSS: '当前在其他 BOSS 页面', NO_BOSS_PAGE: '未识别 BOSS 工作页面' })[status.pageContext] || '未识别 BOSS 工作页面';
  const running = status.state === 'RUNNING'; const paused = ['PAUSED','ERROR'].includes(status.state);
  elements.stateBadge.textContent = running ? '只读运行中' : paused ? '已暂停' : status.paired ? '已配对' : '未配对'; elements.stateBadge.className = `badge ${running ? 'running' : paused ? 'paused' : ''}`;
}

function show(text, error = false) { elements.message.hidden = false; elements.message.textContent = text; elements.message.className = `message${error ? ' error' : ''}`; }

const elements = Object.fromEntries(['stateBadge','summary','pairForm','accountName','totalCount','currentUnreadCount','trackedUnreadCount','reason','lastSync','enabled','collect','forget','message','deviceName','pairingToken'].map((id) => [id, document.getElementById(id)]));

elements.pairForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await busy(event.submitter, async () => {
    const result = await send({ type: 'BRIDGE_PAIR', payload: { backendUrl: 'http://localhost:8088', deviceName: elements.deviceName.value, pairingToken: elements.pairingToken.value } });
    if (!result.ok) throw new Error(result.error);
    elements.pairingToken.value = '';
    render(result.status);
    show('配对成功，请打开 BOSS 沟通页并手动刷新一次。');
  });
});
elements.enabled.addEventListener('change', () => void act({ type: 'BRIDGE_SET_ENABLED', enabled: elements.enabled.checked }));
elements.collect.addEventListener('click', () => void busy(elements.collect, async () => { const result = await send({ type: 'BRIDGE_COLLECT_NOW' }); if (!result.ok) throw new Error(result.error); render(result.status); }));
elements.forget.addEventListener('click', () => void busy(elements.forget, async () => { const result = await send({ type: 'BRIDGE_FORGET_DEVICE' }); if (!result.ok) throw new Error(result.error); render(result.status); }));

void act({ type: 'BRIDGE_GET_STATUS' });

async function act(message) {
  try { const result = await send(message); if (!result.ok) throw new Error(result.error); render(result.status); }
  catch (error) { show(error.message, true); }
}
async function send(message) { return chrome.runtime.sendMessage(message); }
async function busy(button, operation) { button.disabled = true; try { await operation(); } catch (error) { show(error.message, true); } finally { button.disabled = false; } }
function render(status) {
  elements.summary.hidden = !status.paired; elements.pairForm.hidden = status.paired;
  elements.accountName.textContent = status.accountName || '-'; elements.totalCount.textContent = status.total; elements.currentUnreadCount.textContent = status.currentUnread; elements.trackedUnreadCount.textContent = status.trackedUnread;
  elements.reason.textContent = status.reason; elements.lastSync.textContent = status.lastSyncAt ? `最近同步：${new Date(status.lastSyncAt).toLocaleString('zh-CN')}` : '尚未同步真实快照'; elements.enabled.checked = status.enabled;
  const running = status.state === 'RUNNING'; const paused = ['PAUSED','ERROR'].includes(status.state);
  elements.stateBadge.textContent = running ? '只读运行中' : paused ? '已暂停' : status.paired ? '已配对' : '未配对'; elements.stateBadge.className = `badge ${running ? 'running' : paused ? 'paused' : ''}`;
}
function show(text, error = false) { elements.message.hidden = false; elements.message.textContent = text; elements.message.className = `message${error ? ' error' : ''}`; }

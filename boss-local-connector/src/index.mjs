import { parseArgs } from 'node:util';
import { loadConfig, connectorDataDirectory } from './lib/config.mjs';
import { cdpStatus, startAccountChrome } from './lib/chrome.mjs';
import { pairConnector, sendHeartbeat, syncUnreadObservations, verifySelectedConversation } from './lib/backend.mjs';
import { accountSafety, freezeAccount, inspectStateFileSecurity, loadState, recoverAccountMonitoring, saveDeviceCredentials } from './lib/state.mjs';
import { runConnectorPreflight } from './lib/preflight.mjs';
import { inspectAccountPage } from './lib/page-probe.mjs';
import { observeAccountSession } from './lib/conversation-monitor.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    account: { type: 'string', short: 'a' },
    'pairing-token': { type: 'string' },
    'chrome-path': { type: 'string' },
    'data-dir': { type: 'string' },
    'confirm-recovery': { type: 'boolean' },
  },
});

const command = positionals[0] ?? 'help';
if (command === 'help' || command === '--help') {
  printHelp();
  process.exit(0);
}

try {
  const dataDirectory = connectorDataDirectory(values['data-dir']);
  const config = await loadConfig(values.config, dataDirectory);
  const state = await loadState(dataDirectory);
  const selected = selectAccounts(config.accounts, values.account, ['start', 'status', 'observe', 'preflight'].includes(command));

  if (command === 'login') {
    for (const account of selected) {
      const result = await startAccountChrome(account, values['chrome-path']);
      console.log(`✓ ${account.label}：${result.reused ? '已复用独立 Chrome Profile' : '已启动独立 Chrome Profile'}，请在打开的窗口手动完成 BOSS 登录。`);
    }
  } else if (command === 'pair') {
    if (selected.length !== 1) throw new Error('配对时必须通过 --account 指定一个账号。');
    const pairingToken = values['pairing-token']?.trim();
    if (!pairingToken) throw new Error('请通过 --pairing-token 粘贴后台生成的一次性连接令牌。');
    const account = selected[0];
    await startAccountChrome(account, values['chrome-path']);
    const credentials = await pairConnector(config, account, pairingToken);
    await saveDeviceCredentials(dataDirectory, state, account, credentials);
    console.log(`✓ ${account.label} 已配对。本地凭据仅保存在 ${dataDirectory}，不会上传 BOSS Cookie 或密码。`);
  } else if (command === 'status') {
    await printStatus(selected, state);
  } else if (command === 'observe') {
    await Promise.all(selected.map((account) => heartbeatOne(config, state, account, dataDirectory)));
  } else if (command === 'preflight') {
    const report=await runConnectorPreflight({...config,accounts:selected},state,{stateFileSecurity:await inspectStateFileSecurity(dataDirectory),cdpProbe:cdpStatus});
    console.log(JSON.stringify(report,null,2));
    if(!report.readyForRealPageValidation)process.exitCode=2;
  } else if (command === 'recover') {
    if (selected.length !== 1 || !values['confirm-recovery']) throw new Error('恢复时必须指定一个账号并添加 --confirm-recovery，表示 HR 已人工处理登录或验证问题。');
    const account=selected[0];
    const inspections=[];
    for(let i=0;i<3;i+=1)inspections.push(await inspectAccountPage(account.cdpPort));
    if(!inspections.every(x=>x.code==='CHAT_PAGE_READY'))throw new Error('页面未连续三次稳定处于沟通页，账号继续冻结。');
    await recoverAccountMonitoring(dataDirectory,state,account.accountId,{humanConfirmed:true,pageState:'CHAT_PAGE_READY',hasRiskOrVerification:false,stableCycles:3});
    console.log(`✓ ${account.label} 已恢复为只监测状态；真实写能力仍保持关闭。`);
  } else if (command === 'start') {
    await run(selected, config, state, values['chrome-path']);
  } else {
    throw new Error(`未知命令：${command}`);
  }
} catch (error) {
  console.error(`连接器未启动：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function selectAccounts(accounts, requestedAccountId, allowMany) {
  const eligible = accounts.filter((account) => account.enabled);
  if (!requestedAccountId) {
    if (allowMany) return eligible;
    throw new Error('请通过 --account 指定账号 UUID。');
  }
  const account = accounts.find((item) => item.accountId === requestedAccountId.toLowerCase());
  if (!account) throw new Error('配置中未找到该 accountId。');
  if (!account.enabled) throw new Error(`账号「${account.label}」在配置中已禁用。`);
  return [account];
}

async function printStatus(accounts, state) {
  for (const account of accounts) {
    const inspection = await inspectAccountPage(account.cdpPort);
    const paired = Boolean(state.accounts[account.accountId]?.deviceToken);
    const safety=accountSafety(state,account.accountId);
    console.log(`${account.label}\n  Profile: ${account.profileKey}\n  页面状态: ${inspection.code}\n  状态说明: ${inspection.reason}\n  后台配对: ${paired ? '已配对' : '未配对'}\n  账号隔离: ${safety.state}${safety.stopCode?` (${safety.stopCode})`:''}`);
  }
}

async function run(accounts, config, state, chromePath) {
  if (accounts.length === 0) throw new Error('没有启用的账号。');
  console.log(`正在启动 ${accounts.length} 个独立账号 Profile；当前版本只同步脱敏未读快照，不读取消息正文，也不会发送内容。`);
  await Promise.all(accounts.map(async (account) => {
    await startAccountChrome(account, chromePath);
    await heartbeatOne(config, state, account, config.dataDirectory);
  }));
  const timer = setInterval(() => {
    Promise.all(accounts.map((account) => heartbeatOne(config, state, account, config.dataDirectory))).catch(() => {});
  }, config.heartbeatIntervalSeconds * 1_000);
  const stop = () => {
    clearInterval(timer);
    console.log('\n连接器已停止；Chrome Profile 保持打开，登录态不会导出。');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function heartbeatOne(config, state, account, dataDirectory) {
  const credentials = state.accounts[account.accountId];
  const session = await observeAccountSession(account.cdpPort);
  const inspection = session.inspection;
  if (!credentials?.deviceToken) {
    console.log(`! ${account.label} 未配对；请在后台生成连接令牌后执行 pair。`);
    return inspection;
  }
  try {
    if (['RISK_OR_VERIFICATION','LOGIN_REQUIRED'].includes(inspection.code)) await freezeAccount(dataDirectory,state,account.accountId,inspection.code);
    const safety=accountSafety(state,account.accountId);
    if(safety.state==='FROZEN'){
      const reason=`账号已持久化冻结：${safety.stopCode}；必须由 HR 人工确认恢复。`;
      await sendHeartbeat(config,account,credentials.deviceToken,'PAUSED',reason);
      console.log(`! ${account.label}：FROZEN · ${reason}`);
      return inspection;
    }
    let reason = inspection.reason;
    if (inspection.code === 'CHAT_PAGE_READY') {
      const observation = session.observation;
      if (observation.ok) {
        await syncUnreadObservations(config, credentials.deviceToken, observation.entries);
        reason = observation.reason;
        const selected = session.selected;
        if (selected.ok) {
          await verifySelectedConversation(config, credentials.deviceToken, selected.snapshot);
          reason += '；已只读复核 HR 当前打开的会话。';
        } else if (selected.code !== 'NO_SELECTED_CONVERSATION') {
          reason += `；${selected.reason}`;
        }
      } else {
        reason = observation.reason;
      }
    }
    await sendHeartbeat(config, account, credentials.deviceToken, inspection.runtimeState, reason);
    console.log(`· ${account.label}：${inspection.code} · ${reason}`);
  } catch (error) {
    console.error(`! ${account.label} 心跳失败：${error.message}`);
  }
  return inspection;
}

function printHelp() {
  console.log(`招聘系统本地 BOSS 连接器

用法：
  node src/index.mjs login  --config connector.config.json --account <账号 UUID>
  node src/index.mjs pair   --config connector.config.json --account <账号 UUID> --pairing-token <一次性令牌>
  node src/index.mjs start  --config connector.config.json
  node src/index.mjs status --config connector.config.json
  node src/index.mjs observe --config connector.config.json
  node src/index.mjs preflight --config connector.config.json
  node src/index.mjs recover --config connector.config.json --account <账号 UUID> --confirm-recovery

每个账号必须使用不同的 profileKey 和 cdpPort。连接器只启动可见 Chrome；它只同步会话未读计数和不可逆摘要，不读取或导出 Cookie、候选人姓名、消息正文，也不会处理验证码或发送消息。`);
}

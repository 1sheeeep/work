import { parseArgs } from 'node:util';
import { loadConfig, connectorDataDirectory, ConfigError } from './lib/config.mjs';
import { cdpStatus, startAccountChrome } from './lib/chrome.mjs';
import { pairConnector, sendHeartbeat } from './lib/backend.mjs';
import { loadState, saveDeviceCredentials } from './lib/state.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: 'string', short: 'c' },
    account: { type: 'string', short: 'a' },
    'pairing-token': { type: 'string' },
    'chrome-path': { type: 'string' },
    'data-dir': { type: 'string' },
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
  const selected = selectAccounts(config.accounts, values.account, command === 'start');

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
    const status = await cdpStatus(account.cdpPort);
    const paired = Boolean(state.accounts[account.accountId]?.deviceToken);
    console.log(`${account.label}\n  Profile: ${account.profileKey}\n  CDP: ${status.available ? '在线' : '未启动'}\n  BOSS 页面: ${status.zhipinPageOpen ? '已打开' : '未打开'}\n  后台配对: ${paired ? '已配对' : '未配对'}`);
  }
}

async function run(accounts, config, state, chromePath) {
  if (accounts.length === 0) throw new Error('没有启用的账号。');
  console.log(`正在启动 ${accounts.length} 个独立账号 Profile；当前版本只建立本地连接和安全心跳，不会读取消息或发送内容。`);
  await Promise.all(accounts.map(async (account) => {
    await startAccountChrome(account, chromePath);
    await heartbeatOne(config, state, account);
  }));
  const timer = setInterval(() => {
    Promise.all(accounts.map((account) => heartbeatOne(config, state, account))).catch(() => {});
  }, config.heartbeatIntervalSeconds * 1_000);
  const stop = () => {
    clearInterval(timer);
    console.log('\n连接器已停止；Chrome Profile 保持打开，登录态不会导出。');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function heartbeatOne(config, state, account) {
  const credentials = state.accounts[account.accountId];
  const local = await cdpStatus(account.cdpPort);
  if (!credentials?.deviceToken) {
    console.log(`! ${account.label} 未配对；请在后台生成连接令牌后执行 pair。`);
    return;
  }
  const reason = !local.available
    ? '本地 Chrome 未连接，已暂停'
    : !local.zhipinPageOpen
      ? 'BOSS 页面未打开，已暂停'
      : '连接已就绪；会话监测尚未启用，自动操作保持暂停';
  try {
    await sendHeartbeat(config, account, credentials.deviceToken, 'PAUSED', reason);
    console.log(`· ${account.label}：${reason}`);
  } catch (error) {
    console.error(`! ${account.label} 心跳失败：${error.message}`);
  }
}

function printHelp() {
  console.log(`招聘系统本地 BOSS 连接器

用法：
  node src/index.mjs login  --config connector.config.json --account <账号 UUID>
  node src/index.mjs pair   --config connector.config.json --account <账号 UUID> --pairing-token <一次性令牌>
  node src/index.mjs start  --config connector.config.json
  node src/index.mjs status --config connector.config.json

每个账号必须使用不同的 profileKey 和 cdpPort。连接器只启动可见 Chrome，不读取或导出 Cookie，也不会处理验证码。`);
}

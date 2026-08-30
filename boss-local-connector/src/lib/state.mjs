import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_FILE = 'connector-state.json';
let persistQueue = Promise.resolve();

export async function loadState(dataDirectory) {
  const path = join(dataDirectory, STATE_FILE);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.accounts !== 'object' || !parsed.accounts) {
      return { accounts: {} };
    }
    return { accounts: parsed.accounts };
  } catch (error) {
    if (error.code === 'ENOENT') return { accounts: {} };
    throw new Error(`无法读取本地连接器状态：${error.message}`);
  }
}

export async function inspectStateFileSecurity(dataDirectory) {
  try {
    const info=await stat(join(dataDirectory,STATE_FILE));
    const mode=info.mode&0o777;
    return { exists:true, mode:mode.toString(8).padStart(3,'0'), secure:process.platform==='win32'||(mode&0o077)===0 };
  } catch(error) {
    if(error.code==='ENOENT')return {exists:false,mode:null,secure:false};
    throw error;
  }
}

export async function saveDeviceCredentials(dataDirectory, state, account, credentials) {
  if (!credentials?.deviceId || !credentials?.deviceToken || credentials.accountId !== account.accountId) {
    throw new Error('后台返回的连接器凭据不完整或不属于当前账号。');
  }
  const runtimeSafety = state.accounts[account.accountId]?.runtimeSafety;
  state.accounts[account.accountId] = {
    deviceId: credentials.deviceId,
    deviceToken: credentials.deviceToken,
    accountName: credentials.accountName,
    pairedAt: new Date().toISOString(),
    ...(runtimeSafety ? { runtimeSafety } : {}),
  };
  await persistState(dataDirectory, state);
}

export function accountSafety(state, accountId) {
  return state.accounts[accountId]?.runtimeSafety ?? { state: 'MONITORING', stopCode: null, stoppedAt: null, recoveredAt: null };
}

export async function freezeAccount(dataDirectory, state, accountId, stopCode) {
  const entry = state.accounts[accountId];
  if (!entry?.deviceToken) throw new Error('账号尚未配对，无法记录冻结状态。');
  if (entry.runtimeSafety?.state === 'FROZEN' && entry.runtimeSafety.stopCode === stopCode) return accountSafety(state, accountId);
  entry.runtimeSafety = { state: 'FROZEN', stopCode, stoppedAt: new Date().toISOString(), recoveredAt: null };
  await persistState(dataDirectory, state);
  return accountSafety(state, accountId);
}

export async function recoverAccountMonitoring(dataDirectory, state, accountId, evidence) {
  const entry = state.accounts[accountId];
  if (entry?.runtimeSafety?.state !== 'FROZEN') throw new Error('账号当前没有被冻结。');
  if (!evidence?.humanConfirmed || evidence.pageState !== 'CHAT_PAGE_READY' || evidence.hasRiskOrVerification !== false || evidence.stableCycles < 3) throw new Error('人工恢复证据不足。');
  entry.runtimeSafety = { state: 'MONITORING', stopCode: null, stoppedAt: entry.runtimeSafety.stoppedAt, recoveredAt: new Date().toISOString() };
  await persistState(dataDirectory, state);
  return accountSafety(state, accountId);
}

async function persistState(dataDirectory, state) {
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const target = join(dataDirectory, STATE_FILE);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    try { await chmod(target, 0o600); } catch { /* Windows 不支持 POSIX 权限。 */ }
  });
  return persistQueue;
}

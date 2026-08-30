import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const STATE_FILE = 'connector-state.json';

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

export async function saveDeviceCredentials(dataDirectory, state, account, credentials) {
  if (!credentials?.deviceId || !credentials?.deviceToken || credentials.accountId !== account.accountId) {
    throw new Error('后台返回的连接器凭据不完整或不属于当前账号。');
  }
  state.accounts[account.accountId] = {
    deviceId: credentials.deviceId,
    deviceToken: credentials.deviceToken,
    accountName: credentials.accountName,
    pairedAt: new Date().toISOString(),
  };
  await persistState(dataDirectory, state);
}

async function persistState(dataDirectory, state) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const target = join(dataDirectory, STATE_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
  try {
    await chmod(target, 0o600);
  } catch {
    // Windows 不支持 POSIX 权限；状态仍只存放在当前操作系统用户目录。
  }
}

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class ConfigError extends Error {}

export function connectorDataDirectory(input) {
  const raw = input?.trim() || process.env.BOSS_CONNECTOR_DATA_DIR?.trim();
  return raw ? resolve(raw) : resolve(homedir(), '.recruitment-boss-connector');
}

export async function loadConfig(configPath, dataDirectory) {
  if (!configPath) throw new ConfigError('请通过 --config 指定连接器配置文件。');
  let raw;
  try {
    raw = await readFile(resolve(configPath), 'utf8');
  } catch (error) {
    throw new ConfigError(`无法读取连接器配置：${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError('连接器配置不是合法 JSON。');
  }
  return validateConfig(parsed, dataDirectory);
}

export function validateConfig(input, dataDirectory = connectorDataDirectory()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigError('连接器配置必须是 JSON 对象。');
  }
  const backendUrl = validateBackendUrl(input.backendUrl);
  const machineName = cleanRequired(input.machineName, 'machineName', 100);
  const heartbeatIntervalSeconds = positiveInteger(input.heartbeatIntervalSeconds ?? 30, 'heartbeatIntervalSeconds', 10, 300);
  if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
    throw new ConfigError('至少要配置一个 BOSS 账号。');
  }

  const accountIds = new Set();
  const profileKeys = new Set();
  const cdpPorts = new Set();
  const accounts = input.accounts.map((value, index) => {
    const prefix = `accounts[${index}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConfigError(`${prefix} 必须是对象。`);
    }
    const accountId = cleanRequired(value.accountId, `${prefix}.accountId`, 36).toLowerCase();
    if (!UUID.test(accountId)) throw new ConfigError(`${prefix}.accountId 必须是有效 UUID。`);
    const label = cleanRequired(value.label, `${prefix}.label`, 100);
    const profileKey = cleanRequired(value.profileKey, `${prefix}.profileKey`, 64).toLowerCase();
    if (!PROFILE_KEY.test(profileKey)) {
      throw new ConfigError(`${prefix}.profileKey 只能包含小写字母、数字、- 或 _，且不能以符号开头。`);
    }
    const cdpPort = positiveInteger(value.cdpPort, `${prefix}.cdpPort`, 1024, 65535);
    if (accountIds.has(accountId)) throw new ConfigError(`账号 ${label} 重复配置了相同 accountId。`);
    if (profileKeys.has(profileKey)) throw new ConfigError(`账号 ${label} 重复使用了 Chrome Profile「${profileKey}」。`);
    if (cdpPorts.has(cdpPort)) throw new ConfigError(`账号 ${label} 重复使用了 CDP 端口 ${cdpPort}。`);
    accountIds.add(accountId);
    profileKeys.add(profileKey);
    cdpPorts.add(cdpPort);
    return {
      accountId,
      label,
      profileKey,
      cdpPort,
      enabled: value.enabled !== false,
      profileDirectory: resolve(dataDirectory, 'profiles', profileKey),
    };
  });
  return { backendUrl, machineName, heartbeatIntervalSeconds, accounts, dataDirectory: resolve(dataDirectory) };
}

function validateBackendUrl(value) {
  const raw = cleanRequired(value, 'backendUrl', 300);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('backendUrl 必须是 http 或 https 地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError('backendUrl 只能填写不带账号、路径或参数的 http/https 服务根地址。');
  }
  return url.toString().replace(/\/$/, '');
}

function cleanRequired(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) throw new ConfigError(`${name} 为必填项。`);
  const cleaned = value.trim();
  if (cleaned.length > max) throw new ConfigError(`${name} 长度不能超过 ${max}。`);
  return cleaned;
}

function positiveInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} 必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}

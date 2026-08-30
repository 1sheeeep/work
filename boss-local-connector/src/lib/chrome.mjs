import { access, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const CHAT_URL = 'https://www.zhipin.com/web/chat/index';

export async function startAccountChrome(account, chromePath) {
  const existing = await cdpStatus(account.cdpPort);
  if (existing.available) return { started: false, reused: true, status: existing };

  await mkdir(account.profileDirectory, { recursive: true, mode: 0o700 });
  const executable = chromePath || await findChromeExecutable();
  if (!executable) {
    throw new Error('未找到 Chrome，请通过 --chrome-path 指定 Chrome 可执行文件。');
  }
  const child = spawn(executable, [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${account.cdpPort}`,
    `--user-data-dir=${account.profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    CHAT_URL,
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const status = await cdpStatus(account.cdpPort);
    if (status.available) return { started: true, reused: false, status };
    await wait(300);
  }
  throw new Error(`账号「${account.label}」的 Chrome 未在 20 秒内启动 CDP。请检查 Profile 是否被其他 Chrome 占用。`);
}

export async function cdpStatus(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return { available: false, zhipinPageOpen: false };
    const version = await response.json();
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const targets = pages.ok ? await pages.json() : [];
    return {
      available: typeof version.webSocketDebuggerUrl === 'string',
      zhipinPageOpen: Array.isArray(targets) && targets.some((target) => typeof target.url === 'string' && target.url.includes('zhipin.com')),
    };
  } catch {
    return { available: false, zhipinPageOpen: false };
  }
}

async function findChromeExecutable() {
  const candidates = platform() === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : platform() === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

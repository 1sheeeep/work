import { chromium } from "playwright-core";

const defaultAttempts = [
  { delay: 0, connectTimeout: 8000, preflightTimeout: 1800 },
  { delay: 800, connectTimeout: 12000, preflightTimeout: 2200 }
];

export async function connectOverCDPWithRetry(cdpUrl, options = {}) {
  const attempts = options.attempts || defaultAttempts;
  const connector = options.connector || ((url, connectOptions) => chromium.connectOverCDP(url, connectOptions));
  let lastError = null;
  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const current = attempts[attempt];
    if (current.delay > 0) await sleep(current.delay);
    try {
      await preflightCDP(cdpUrl, current.preflightTimeout || 1800);
      return await withTimeout(
        connector(cdpUrl, { timeout: current.connectTimeout }),
        current.connectTimeout + 1000,
        "cdp_handshake_timeout",
        `connectOverCDP did not finish within ${current.connectTimeout}ms`
      );
    } catch (error) {
      lastError = normalizeCDPError(error);
      if (!isTransientCDPConnectError(lastError.message)) throw lastError;
    }
  }
  throw normalizeCDPError(lastError || new Error("unknown CDP connection failure"));
}

export async function preflightCDP(cdpUrl, timeoutMs = 1800) {
  const base = String(cdpUrl || "").replace(/\/+$/, "");
  const version = await fetchCDPJSON(`${base}/json/version`, timeoutMs, "cdp_http_version_unavailable");
  const targets = await fetchCDPJSON(`${base}/json/list`, timeoutMs, "cdp_http_list_unavailable");
  if (!Array.isArray(targets)) {
    throw cdpError("cdp_http_list_invalid", "CDP /json/list did not return an array");
  }
  if (targets.length === 0) {
    throw cdpError("cdp_no_targets", "CDP /json/list returned no browser pages");
  }
  return {
    browser: version?.Browser || version?.browser || "",
    webSocketDebuggerUrl: version?.webSocketDebuggerUrl || "",
    targetCount: targets.length
  };
}

async function fetchCDPJSON(url, timeoutMs, code) {
  let response;
  try {
    response = await fetchWithTimeout(url, timeoutMs);
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : (error?.message || String(error));
    throw cdpError(code, `${url} failed: ${reason}`, error);
  }
  if (!response.ok) {
    throw cdpError(code, `${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw cdpError(code, `${url} returned invalid JSON`, error);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeout(promise, timeoutMs, code, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(cdpError(code, message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeCDPError(error) {
  if (error?.code && /^cdp_/i.test(error.code)) return error;
  const message = error?.message || String(error);
  if (/timeout/i.test(message) && /connectOverCDP|browserType|handshake|cdp/i.test(message)) {
    return cdpError("cdp_handshake_timeout", message, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function cdpError(code, message, cause) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function isTransientCDPConnectError(message = "") {
  return /cdp_|connectOverCDP|timeout|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|socket hang up|Target page, context or browser has been closed/i.test(String(message));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

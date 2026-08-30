export async function pairConnector(config, account, pairingToken) {
  return request(config.backendUrl, '/api/browser-runtime/pair', {
    method: 'POST',
    body: { pairingToken, deviceName: `${config.machineName} · ${account.label}` },
  });
}

export async function sendHeartbeat(config, account, deviceToken, state, reason) {
  return request(config.backendUrl, '/api/browser-runtime/heartbeat', {
    method: 'POST',
    token: deviceToken,
    body: { state, reason },
  });
}

async function request(backendUrl, path, options) {
  let response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Device ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    throw new Error(`无法连接招聘系统：${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `招聘系统返回 HTTP ${response.status}`);
  }
  return body;
}

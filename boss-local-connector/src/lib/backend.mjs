export async function pairConnector(config, account, pairingToken) {
  return request(config.backendUrl, '/api/local-connector/runtime/pair', {
    method: 'POST',
    body: { pairingToken, deviceName: `${config.machineName} · ${account.label}` },
  });
}

export async function sendHeartbeat(config, account, deviceToken, state, reason) {
  return request(config.backendUrl, '/api/local-connector/runtime/heartbeat', {
    method: 'POST',
    token: deviceToken,
    body: { state, reason },
  });
}

export async function syncUnreadObservations(config, deviceToken, entries) {
  return request(config.backendUrl, '/api/local-connector/runtime/unread-observations', {
    method: 'POST',
    token: deviceToken,
    body: { entries },
  });
}

export async function verifySelectedConversation(config, deviceToken, snapshot) {
  return request(config.backendUrl, '/api/local-connector/runtime/selected-conversation', {
    method: 'POST',
    token: deviceToken,
    body: snapshot,
  });
}

export async function reportValidationReadiness(config, deviceToken, readiness) {
  return request(config.backendUrl, '/api/local-connector/runtime/validation-readiness', {
    method: 'POST',
    token: deviceToken,
    body: readiness,
  });
}

export async function claimActionLease(config, deviceToken) {
  return request(config.backendUrl, '/api/local-connector/runtime/action-leases/claim', { method: 'POST', token: deviceToken });
}

export async function sendActionReceipt(config, deviceToken, receipt) {
  return request(config.backendUrl, '/api/local-connector/runtime/action-leases/receipt', { method: 'POST', token: deviceToken, body: receipt });
}

export async function reportOfflineDrill(config, deviceToken, report) {
  return request(config.backendUrl, '/api/local-connector/runtime/offline-drills', { method: 'POST', token: deviceToken, body: report });
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

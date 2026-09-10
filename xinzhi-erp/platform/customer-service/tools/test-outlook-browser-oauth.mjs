import http from "node:http";
import crypto from "node:crypto";

const clientId = process.env.OUTLOOK_CLIENT_ID;
const cdpPort = process.env.CDP_PORT || "12643";
const redirectUri = process.env.OUTLOOK_REDIRECT_URI || "http://localhost:8400/";
const localPort = new URL(redirectUri).port || "80";

if (!clientId) {
  console.error("OUTLOOK_CLIENT_ID is required.");
  process.exit(2);
}

function base64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpCall(ws, method, params = {}) {
  const id = ++cdpCall.nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cdpCall.pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    cdpCall.pending.set(id, { resolve, reject, timeout });
  });
}
cdpCall.nextId = 0;
cdpCall.pending = new Map();

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && cdpCall.pending.has(msg.id)) {
      const pending = cdpCall.pending.get(msg.id);
      cdpCall.pending.delete(msg.id);
      clearTimeout(pending.timeout);
      if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    }
  });
  return ws;
}

async function stripOriginForTokenEndpoint(ws) {
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method !== "Fetch.requestPaused") return;
    const params = msg.params;
    const headers = (params.request.headers || {});
    const continuedHeaders = Object.entries(headers)
      .filter(([name]) => !["origin", "referer"].includes(name.toLowerCase()))
      .map(([name, value]) => ({ name, value: String(value) }));
    cdpCall(ws, "Fetch.continueRequest", {
      requestId: params.requestId,
      headers: continuedHeaders,
    }).catch(() => {});
  });
  await cdpCall(ws, "Fetch.enable", {
    patterns: [
      {
        urlPattern: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        requestStage: "Request",
      },
    ],
  });
}

function tokenFormScript(code, verifier) {
  const fields = {
    client_id: clientId,
    scope: "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  };
  return `(() => {
    document.open();
    document.write("<!doctype html><meta charset='utf-8'><title>Outlook Token Exchange</title><body>Submitting token exchange...</body>");
    document.close();
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
    const fields = ${JSON.stringify(fields)};
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  })()`;
}

async function waitForBodyJson(ws, label) {
  for (let i = 0; i < 100; i++) {
    await delay(500);
    const result = await cdpCall(ws, "Runtime.evaluate", {
      expression: "document.body && document.body.innerText",
      returnByValue: true,
    });
    const text = result?.result?.value || "";
    if (!text.trim()) continue;
    try {
      return JSON.parse(text);
    } catch {
      if (text.includes("error") || text.includes("access_token") || text.length > 200) {
        throw new Error(`${label} returned non-JSON body: ${text.slice(0, 500)}`);
      }
    }
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchJsonIntoBody(ws, url, accessToken) {
  const script = `fetch(${JSON.stringify(url)}, {
    headers: { Authorization: ${JSON.stringify(`Bearer ${accessToken}`)} }
  })
  .then(async (response) => {
    const text = await response.text();
    document.open();
    document.write("<!doctype html><meta charset='utf-8'><body><pre></pre></body>");
    document.close();
    document.querySelector("pre").innerText = text || JSON.stringify({ error: "empty_response", status: response.status });
  })
  .catch((error) => {
    document.open();
    document.write("<!doctype html><meta charset='utf-8'><body><pre></pre></body>");
    document.close();
    document.querySelector("pre").innerText = JSON.stringify({ error: "fetch_failed", message: String(error) });
  })`;
  await cdpCall(ws, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
  });
}

function startCallbackServer() {
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, redirectUri);
    if (url.searchParams.get("error")) {
      rejectCode(new Error(`${url.searchParams.get("error")}: ${url.searchParams.get("error_description") || ""}`));
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>Outlook authorization failed.</h2>");
      return;
    }
    const code = url.searchParams.get("code");
    if (code) {
      resolveCode(code);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h2>Outlook authorization received.</h2><p>Keep this tab open; Codex is testing the API.</p>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<h2>Waiting for Outlook authorization...</h2>");
  });

  const listening = new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(Number(localPort), "127.0.0.1", resolve);
  });
  return { server, codePromise, listening };
}

const { verifier, challenge } = pkce();
const authParams = new URLSearchParams({
  client_id: clientId,
  response_type: "code",
  redirect_uri: redirectUri,
  response_mode: "query",
  scope: "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
  prompt: "select_account",
  code_challenge: challenge,
  code_challenge_method: "S256",
});
const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${authParams}`;

const callback = startCallbackServer();
await callback.listening;

const version = await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
const browserWs = await connect(version.webSocketDebuggerUrl);
const created = await cdpCall(browserWs, "Target.createTarget", { url: authUrl });
const targetId = created.targetId;

let pageWsUrl = "";
for (let i = 0; i < 20; i++) {
  const list = await getJson(`http://127.0.0.1:${cdpPort}/json`);
  const target = list.find((item) => item.id === targetId);
  if (target?.webSocketDebuggerUrl) {
    pageWsUrl = target.webSocketDebuggerUrl;
    break;
  }
  await delay(250);
}
if (!pageWsUrl) throw new Error("Could not find the authorization page target.");

const ws = await connect(pageWsUrl);
await cdpCall(ws, "Page.enable");
await cdpCall(ws, "Runtime.enable");
await cdpCall(ws, "Network.enable");

console.log("Authorization page opened in the configured browser. Approve it there.");
const code = await callback.codePromise;
console.log("Authorization code received. Exchanging token inside the configured browser session...");

await stripOriginForTokenEndpoint(ws);
await cdpCall(ws, "Runtime.evaluate", {
  expression: tokenFormScript(code, verifier),
  awaitPromise: true,
});

const token = await waitForBodyJson(ws, "token endpoint");
if (token.error) {
  console.log(JSON.stringify({
    ok: false,
    stage: "token",
    error: token.error,
    error_description: token.error_description,
  }, null, 2));
  process.exit(1);
}

await fetchJsonIntoBody(ws, "https://graph.microsoft.com/v1.0/me", token.access_token);
const me = await waitForBodyJson(ws, "Graph /me");

await fetchJsonIntoBody(
  ws,
  "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,receivedDateTime,from,subject,isRead",
  token.access_token
);
const messages = await waitForBodyJson(ws, "Graph /messages");

callback.server.close();

console.log(JSON.stringify({
  ok: true,
  signedInUser: {
    displayName: me.displayName,
    userPrincipalName: me.userPrincipalName,
    mail: me.mail,
  },
  refreshTokenReturned: Boolean(token.refresh_token),
  messageCount: Array.isArray(messages.value) ? messages.value.length : 0,
  messages: (messages.value || []).map((m) => ({
    receivedDateTime: m.receivedDateTime,
    from: m.from?.emailAddress?.address || "",
    subject: m.subject,
    isRead: m.isRead,
  })),
}, null, 2));

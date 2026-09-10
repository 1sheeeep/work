const cdpPort = process.env.CDP_PORT || "12643";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
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

async function evalValue(ws, expression) {
  const result = await cdpCall(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value;
}

const pages = await getJson(`http://127.0.0.1:${cdpPort}/json`);
const tokenPage = pages.find((p) => p.type === "page" && p.url.includes("/oauth2/v2.0/token"));
if (!tokenPage) throw new Error("No token endpoint page found.");

const ws = await connect(tokenPage.webSocketDebuggerUrl);
await cdpCall(ws, "Runtime.enable");

const body = await evalValue(ws, "document.body && document.body.innerText");
let token;
try {
  token = JSON.parse(body || "{}");
} catch {
  throw new Error(`Token page did not contain JSON: ${(body || "").slice(0, 200)}`);
}
if (token.error) {
  console.log(JSON.stringify({
    ok: false,
    stage: "token",
    error: token.error,
    error_description: token.error_description,
  }, null, 2));
  process.exit(1);
}
if (!token.access_token) throw new Error("No access_token found in token page.");

const fetchScript = (url) => `fetch(${JSON.stringify(url)}, {
  headers: { Authorization: ${JSON.stringify(`Bearer ${token.access_token}`)} }
}).then(r => r.text())`;

const meText = await evalValue(ws, fetchScript("https://graph.microsoft.com/v1.0/me"));
const messagesText = await evalValue(
  ws,
  fetchScript("https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,receivedDateTime,from,subject,isRead")
);

const me = JSON.parse(meText);
const messages = JSON.parse(messagesText);

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

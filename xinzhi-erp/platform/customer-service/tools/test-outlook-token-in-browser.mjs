const clientId = process.env.OUTLOOK_CLIENT_ID;
const authCode = process.env.OUTLOOK_AUTH_CODE;
const cdpPort = process.env.CDP_PORT || "12639";
const redirectUri = process.env.OUTLOOK_REDIRECT_URI || "http://localhost";
const localPort = Number(process.env.LOCAL_FORM_PORT || "8400");

if (!clientId || !authCode) {
  console.error("OUTLOOK_CLIENT_ID and OUTLOOK_AUTH_CODE are required.");
  process.exit(2);
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

function formSubmitScript() {
  const fields = {
    client_id: clientId,
    scope: "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send",
    code: authCode,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  return `(() => {
    document.open();
    document.write("<!doctype html><meta charset='utf-8'><title>Outlook Token Exchange</title><body>Submitting...</body>");
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
  for (let i = 0; i < 80; i++) {
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
      if (text.includes("error") || text.includes("access_token") || text.length > 100) {
        throw new Error(`${label} returned non-JSON body: ${text.slice(0, 500)}`);
      }
    }
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function navigateAndReadJson(ws, url) {
  await cdpCall(ws, "Page.navigate", { url });
  return waitForBodyJson(ws, url);
}

async function startLocalFormServer() {
  const http = await import("node:http");
  const page = `<!doctype html>
<meta charset="utf-8">
<title>Outlook Token Exchange</title>
<body>Submitting token exchange...</body>
<script>
${formSubmitScript()}
</script>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(page);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(localPort, "127.0.0.1", () => resolve(server));
  });
}

const version = await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
const browserWs = await connect(version.webSocketDebuggerUrl);
const created = await cdpCall(browserWs, "Target.createTarget", { url: "about:blank" });
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
if (!pageWsUrl) throw new Error("Could not find the created page target.");
const ws = await connect(pageWsUrl);

await cdpCall(ws, "Page.enable");
await cdpCall(ws, "Runtime.enable");
await cdpCall(ws, "Network.enable");

const formServer = await startLocalFormServer();
await cdpCall(ws, "Page.navigate", { url: `http://localhost:${localPort}/exchange` });

const token = await waitForBodyJson(ws, "token endpoint");
formServer.close();
if (token.error) {
  console.log(JSON.stringify({
    ok: false,
    stage: "token",
    error: token.error,
    error_description: token.error_description,
  }, null, 2));
  process.exit(1);
}

await cdpCall(ws, "Network.setExtraHTTPHeaders", {
  headers: { Authorization: `Bearer ${token.access_token}` },
});

const me = await navigateAndReadJson(ws, "https://graph.microsoft.com/v1.0/me");
const messages = await navigateAndReadJson(
  ws,
  "https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=id,receivedDateTime,from,subject,isRead"
);

const summary = {
  ok: true,
  signedInUser: {
    displayName: me.displayName,
    userPrincipalName: me.userPrincipalName,
    mail: me.mail,
    id: me.id,
  },
  refreshTokenReturned: Boolean(token.refresh_token),
  messageCount: Array.isArray(messages.value) ? messages.value.length : 0,
  messages: (messages.value || []).map((m) => ({
    receivedDateTime: m.receivedDateTime,
    from: m.from?.emailAddress?.address || "",
    subject: m.subject,
    isRead: m.isRead,
  })),
};

console.log(JSON.stringify(summary, null, 2));

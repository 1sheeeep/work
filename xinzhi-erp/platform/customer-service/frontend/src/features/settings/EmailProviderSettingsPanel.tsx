import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Copy, Mail, Plus, RefreshCw } from "lucide-react";
import { CuiqiuDomainSettings, CuiqiuDomainSettingsInput, PlatformAPI } from "../../api";
import { errorText } from "../shared/helpers";
import type { ToastMessage } from "../shared/types";

const emptyForm = (): CuiqiuDomainSettingsInput => ({
  domain: "",
  apiBase: "https://domain-open-api.cuiqiu.com",
  token: "",
  domainId: "",
  smtpHost: "domain-smtp.cuiqiu.com",
  smtpPort: 587,
  smtpMode: "starttls"
});

function formFromSettings(settings: CuiqiuDomainSettings): CuiqiuDomainSettingsInput {
  return {
    domain: settings.domain,
    apiBase: settings.apiBase,
    token: "",
    domainId: settings.domainId || "",
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpMode: settings.smtpMode
  };
}

function hasConnectionTest(settings: CuiqiuDomainSettings | null | undefined): settings is CuiqiuDomainSettings {
  return Boolean(settings?.lastTestedAt && !settings.lastTestedAt.startsWith("0001-"));
}

function hasWebhookVerification(settings: CuiqiuDomainSettings | null | undefined): settings is CuiqiuDomainSettings {
  return Boolean(settings?.webhookVerifiedAt && !settings.webhookVerifiedAt.startsWith("0001-"));
}

export function EmailProviderSettingsPanel(props: {
  api: PlatformAPI;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setToast: (value: ToastMessage) => void;
}) {
  const [items, setItems] = useState<CuiqiuDomainSettings[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("");
  const [form, setForm] = useState<CuiqiuDomainSettingsInput>(() => emptyForm());
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await props.api.listCuiqiuDomainSettings();
      setItems(next);
      setSelectedDomain((current) => {
        const selected = next.find((item) => item.domain === current) || next[0];
        if (selected) setForm(formFromSettings(selected));
        return selected?.domain || "";
      });
    } catch (error) {
      props.setToast({ tone: "error", text: `加载邮箱服务配置失败：${errorText(error)}` });
    } finally {
      setLoading(false);
    }
  }, [props.api, props.setToast]);

  useEffect(() => { void load(); }, [load]);

  const selected = items.find((item) => item.domain === selectedDomain) || null;

  function selectItem(item: CuiqiuDomainSettings) {
    setSelectedDomain(item.domain);
    setForm(formFromSettings(item));
  }

  function startNew() {
    setSelectedDomain("");
    setForm(emptyForm());
  }

  function update<K extends keyof CuiqiuDomainSettingsInput>(key: K, value: CuiqiuDomainSettingsInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    props.setBusy(true);
    try {
      const saved = await props.api.saveCuiqiuDomainSettings({
        ...form,
        domain: form.domain.trim().toLowerCase().replace(/^@/, ""),
        apiBase: form.apiBase.trim(),
        token: form.token.trim(),
        domainId: form.domainId?.trim(),
        smtpHost: form.smtpHost.trim()
      });
      setItems((current) => [...current.filter((item) => item.domain !== saved.domain), saved].sort((a, b) => a.domain.localeCompare(b.domain)));
      setSelectedDomain(saved.domain);
      setForm(formFromSettings(saved));
      props.setToast({ tone: "success", text: `@${saved.domain} 的邮箱服务配置已保存` });
    } catch (error) {
      props.setToast({ tone: "error", text: `保存邮箱服务配置失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function testConnection() {
    if (!selected?.domain) return;
    setTesting(true);
    try {
      const result = await props.api.testCuiqiuDomainSettings(selected.domain);
      props.setToast({ tone: "success", text: result.message });
      await load();
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
      await load();
    } finally {
      setTesting(false);
    }
  }

  async function copyWebhook() {
    if (!selected?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(selected.webhookUrl);
      props.setToast({ tone: "success", text: "邮件通知地址已复制" });
    } catch (error) {
      props.setToast({ tone: "error", text: `复制失败：${errorText(error)}` });
    }
  }

  return (
    <section className="platform-panel email-provider-settings-panel">
      <div className="panel-title email-provider-settings-heading">
        <div>
          <h2>邮箱服务</h2>
          <p>管理员按邮箱域名配置一次；店铺接入时只需填写邮箱账号和邮箱密码。</p>
        </div>
        <button type="button" className="primary" onClick={startNew} disabled={props.busy}><Plus size={16} /> 新增脆球域名</button>
      </div>

      <div className="email-provider-settings-layout">
        <aside className="email-provider-profile-list" aria-label="已配置邮箱域名">
          {loading ? <div className="email-provider-empty">正在加载配置…</div> : null}
          {!loading && items.length === 0 ? (
            <div className="email-provider-empty"><Mail size={24} /><strong>还没有域名配置</strong><span>在右侧填写脆球服务参数后保存。</span></div>
          ) : null}
          {items.map((item) => (
            <button type="button" key={item.domain} className={selectedDomain === item.domain ? "active" : ""} onClick={() => selectItem(item)}>
              <span><strong>@{item.domain}</strong><small>{item.smtpHost}:{item.smtpPort}</small></span>
              <em className={hasConnectionTest(item) ? (item.lastTestOk ? "success" : "error") : "muted"}>
                {hasConnectionTest(item) ? (item.lastTestOk ? "接收 API 正常" : "接收 API 异常") : "接收 API 待测试"}
              </em>
            </button>
          ))}
        </aside>

        <form className="email-provider-settings-form" onSubmit={(event) => void save(event)}>
          <div className="email-provider-form-section">
            <div><strong>域名匹配</strong><span>系统按邮箱账号中 @ 后面的域名自动匹配此配置。</span></div>
            <label><span>邮箱域名 <b>*</b></span><input value={form.domain} onChange={(event) => update("domain", event.target.value)} placeholder="例如：fastmo.cn" autoComplete="off" required readOnly={Boolean(selectedDomain)} /></label>
          </div>

          <div className="email-provider-form-section">
            <div><strong>接收 API</strong><span>Token 只写入服务器，保存后不会回显；留空会保留原 Token。</span></div>
            <div className="email-provider-form-grid">
              <label className="wide"><span>Open API 地址 <b>*</b></span><input type="url" value={form.apiBase} onChange={(event) => update("apiBase", event.target.value)} autoComplete="off" required /></label>
              <label className="wide"><span>Open API Token {!selected?.hasToken ? <b>*</b> : null}</span><input type="password" value={form.token} onChange={(event) => update("token", event.target.value)} placeholder={selected?.hasToken ? "已配置，留空则保留" : "粘贴 Token"} autoComplete="new-password" required={!selected?.hasToken} /></label>
              <label><span>Domain ID（可选）</span><input value={form.domainId || ""} onChange={(event) => update("domainId", event.target.value)} placeholder="用于限定域名" autoComplete="off" /></label>
            </div>
          </div>

          <div className="email-provider-form-section">
            <div><strong>发信 SMTP</strong><span>这里只配置服务器；每个邮箱自己的密码在店铺渠道中填写。</span></div>
            <div className="email-provider-form-grid">
              <label className="wide"><span>SMTP 主机 <b>*</b></span><input value={form.smtpHost} onChange={(event) => update("smtpHost", event.target.value)} placeholder="domain-smtp.cuiqiu.com" autoComplete="off" required /></label>
              <label><span>SMTP 端口 <b>*</b></span><input type="number" min={1} max={65535} value={form.smtpPort} onChange={(event) => update("smtpPort", Number(event.target.value))} required /></label>
              <label><span>加密方式 <b>*</b></span><select value={form.smtpMode} onChange={(event) => update("smtpMode", event.target.value as "tls" | "starttls")}><option value="tls">TLS（通常 465）</option><option value="starttls">STARTTLS（通常 587）</option></select></label>
            </div>
          </div>

          {selected?.webhookUrl ? (
            <div className="email-provider-webhook">
              <div><strong>实时邮件通知</strong><span>把地址配置到该域名的脆球邮件通知中，并在脆球后台点击一次“测试”。</span></div>
              <div className="email-provider-webhook-address"><input value={selected.webhookUrl} readOnly aria-label={`@${selected.domain} 邮件通知地址`} /><button type="button" onClick={() => void copyWebhook()}><Copy size={15} /> 复制</button></div>
              <div className={`email-provider-test-state ${hasWebhookVerification(selected) ? "success" : "muted"}`}>
                {hasWebhookVerification(selected) ? <CheckCircle2 size={16} /> : <Mail size={16} />}
                <span>{hasWebhookVerification(selected)
                  ? `通知已验证 · ${new Date(selected.webhookVerifiedAt!).toLocaleString()}`
                  : "通知待验证；邮箱接入不受影响，系统仍会定期增量补漏"}</span>
              </div>
            </div>
          ) : null}

          {hasConnectionTest(selected) ? (
            <div className={`email-provider-test-state ${selected.lastTestOk ? "success" : "error"}`}>
              {selected.lastTestOk ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              <span>接收 API 最近测试：{selected.lastTestOk ? "连接正常" : selected.lastTestError || "连接失败"} · {new Date(selected.lastTestedAt!).toLocaleString()}</span>
            </div>
          ) : null}

          <footer>
            <button type="button" onClick={() => void load()} disabled={loading || props.busy}><RefreshCw size={15} /> 刷新</button>
            {selected ? <button type="button" onClick={() => void testConnection()} disabled={testing || props.busy}>{testing ? "测试中…" : "测试接收 API"}</button> : null}
            <button type="submit" className="primary" disabled={props.busy}>{props.busy ? "保存中…" : "保存配置"}</button>
          </footer>
        </form>
      </div>
    </section>
  );
}

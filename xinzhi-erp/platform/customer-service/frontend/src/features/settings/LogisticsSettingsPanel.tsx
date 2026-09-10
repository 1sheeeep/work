import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleAlert, Copy, Mail, MessageSquareText, RefreshCw, Truck } from "lucide-react";
import { LogisticsSettings, PlatformAPI } from "../../api";
import { errorText } from "../shared/helpers";
import { ToastTone } from "../shared/types";

export function LogisticsSettingsPanel(props: {
  api: PlatformAPI;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [settings, setSettings] = useState<LogisticsSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(true);
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [gmailEnabled, setGmailEnabled] = useState(true);
  const [outlookEnabled, setOutlookEnabled] = useState(true);
  const [replyCooldownHours, setReplyCooldownHours] = useState(24);

  const load = useCallback(async () => {
    try {
      const value = await props.api.getLogisticsSettings();
      setSettings(value);
      setEnabled(value.enabled);
      setAutoDraftEnabled(value.autoDraftEnabled);
      setAutoSendEnabled(value.autoSendEnabled);
      setChatEnabled(value.chatEnabled);
      setGmailEnabled(value.gmailEnabled);
      setOutlookEnabled(value.outlookEnabled);
      setReplyCooldownHours(value.replyCooldownHours || 24);
      setApiKey("");
    } catch (error) {
      props.setToast({ tone: "error", text: `加载物流 API 配置失败：${errorText(error)}` });
    }
  }, [props.api, props.setToast]);

  useEffect(() => { void load(); }, [load]);

  const input = () => ({
    enabled,
    apiKey: apiKey.trim(),
    autoDraftEnabled,
    autoSendEnabled,
    chatEnabled,
    gmailEnabled,
    outlookEnabled,
    replyCooldownHours
  });

  async function save() {
    props.setBusy(true);
    try {
      const value = await props.api.saveLogisticsSettings(input());
      setSettings(value);
      setApiKey("");
      props.setToast({ tone: "success", text: "物流 API 配置已保存" });
    } catch (error) {
      props.setToast({ tone: "error", text: `保存物流 API 配置失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await props.api.testLogisticsSettings(input());
      props.setToast({ tone: "success", text: result.message });
      await load();
    } catch (error) {
      props.setToast({ tone: "error", text: `17TRACK 连接测试失败：${errorText(error)}` });
    } finally {
      setTesting(false);
    }
  }

  async function copyWebhook() {
    if (!settings?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(settings.webhookUrl);
      props.setToast({ tone: "success", text: "Webhook 地址已复制" });
    } catch {
      props.setToast({ tone: "error", text: "复制失败，请手动复制 Webhook 地址" });
    }
  }

  const ready = enabled && settings?.hasApiKey;
  const hasTestResult = Boolean(settings?.lastTestedAt && !settings.lastTestedAt.startsWith("0001-"));
  return (
    <section className="platform-panel ai-settings-panel logistics-settings-panel">
      <div className="panel-title ai-settings-heading">
        <div>
          <h2>物流 API</h2>
          <p>配置 17TRACK Standard，为客户即时查询提供最新节点，并在客服工作台展示完整物流轨迹。</p>
        </div>
        <span className={`connection-badge ${ready ? "connected" : "muted"}`}>
          {enabled ? (settings?.hasApiKey ? "已配置" : "缺少 API Key") : "已停用"}
        </span>
      </div>

      <div className="ai-settings-form">
        <div className="ai-provider-row">
          <div className="logistics-provider-name"><Truck size={18} /><div><span className="field-label">服务商</span><strong>17TRACK Standard</strong></div></div>
          <label className="ai-enable-control"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 启用物流查询</label>
        </div>

        <label>
          <span className="field-label">API 地址</span>
          <input value={settings?.baseUrl || "https://api.17track.net/track/v2.4"} readOnly />
          <small>使用 17TRACK v2.4 Standard 接口，不启用 Instant 查询。</small>
        </label>

        <label>
          <span className="field-label">API Key</span>
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? "已配置，留空则保留现有 API Key" : "填写 17TRACK API Key"} autoComplete="new-password" />
          <small>API Key 加密保存，保存后浏览器不会读取原文。</small>
        </label>

        <label>
          <span className="field-label">Webhook 地址</span>
          <div className="logistics-webhook-row">
            <input value={settings?.webhookUrl || "请先配置 PUBLIC_BASE_URL"} readOnly />
            <button type="button" className="icon-button" title="复制 Webhook 地址" onClick={() => void copyWebhook()} disabled={!settings?.webhookUrl}><Copy size={16} /></button>
          </div>
          <small>将此地址填写到 17TRACK Webhook 设置，用于异步更新共享物流缓存。</small>
        </label>

        <div className="logistics-automation-section">
          <div className="logistics-automation-heading">
            <div><Bot size={18} /><span><strong>物流自动应答</strong><small>识别客户物流咨询，查询最新轨迹并生成对应语言的回复。</small></span></div>
            <label className="ai-enable-control"><input type="checkbox" checked={autoDraftEnabled} onChange={(event) => setAutoDraftEnabled(event.target.checked)} /> 自动生成草稿</label>
          </div>

          <div className="logistics-channel-grid">
            <label><input type="checkbox" checked={chatEnabled} onChange={(event) => setChatEnabled(event.target.checked)} disabled={!autoDraftEnabled} /><MessageSquareText size={16} /> Chat</label>
            <label><input type="checkbox" checked={gmailEnabled} onChange={(event) => setGmailEnabled(event.target.checked)} disabled={!autoDraftEnabled} /><Mail size={16} /> Gmail</label>
            <label><input type="checkbox" checked={outlookEnabled} onChange={(event) => setOutlookEnabled(event.target.checked)} disabled={!autoDraftEnabled} /><Mail size={16} /> Outlook</label>
          </div>

          <div className="logistics-automation-controls">
            <label>
              <span className="field-label">同一会话触发间隔</span>
              <span className="logistics-cooldown-input"><input type="number" min={1} max={168} value={replyCooldownHours} onChange={(event) => setReplyCooldownHours(Math.min(168, Math.max(1, Number(event.target.value) || 24)))} disabled={!autoDraftEnabled} /> 小时</span>
            </label>
            <label className="ai-enable-control"><input type="checkbox" checked={autoSendEnabled} onChange={(event) => setAutoSendEnabled(event.target.checked)} disabled={!autoDraftEnabled} /> 自动发送</label>
          </div>
          <small className={autoSendEnabled ? "logistics-auto-send-warning active" : "logistics-auto-send-warning"}>{autoSendEnabled ? "自动发送已开启，仅明确匹配订单的低风险结果会直接回复客户。" : "自动发送默认关闭，草稿由客服确认后一键发送。"}</small>
        </div>

        {!settings?.encryptionConfigured ? <div className="inline-warning"><CircleAlert size={16} />服务器需要配置 AI_SETTINGS_ENCRYPTION_KEY 后才能安全保存 API Key。</div> : null}
        {hasTestResult && settings ? (
          <div className={`logistics-test-status ${settings.lastTestOk ? "success" : "error"}`}>
            {settings.lastTestOk ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
            最近测试：{settings.lastTestOk ? "连接正常" : "连接失败"} · {new Date(settings.lastTestedAt!).toLocaleString()}
          </div>
        ) : null}

        <div className="form-actions">
          <button type="button" onClick={() => void testConnection()} disabled={testing || props.busy || (!apiKey.trim() && !settings?.hasApiKey)}>
            <RefreshCw size={15} className={testing ? "spin" : ""} />
            {testing ? "正在测试..." : "测试连接"}
          </button>
          <button className="primary" type="button" onClick={() => void save()} disabled={props.busy || (enabled && !apiKey.trim() && !settings?.hasApiKey)}>{props.busy ? "保存中..." : "保存配置"}</button>
        </div>
      </div>
    </section>
  );
}

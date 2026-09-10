import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDot, Copy, ExternalLink, FileQuestion, FormInput, HelpCircle, Languages, Mail, MessageSquareText, PackageSearch, PieChart, Plus, RefreshCw, Send, Settings, ShieldCheck, Store, Truck, UserPlus, X } from "lucide-react";
import { AISettings, cleanBaseUrl, Conversation, KnowledgeEntry, Message, PlatformAPI, PlatformAPIError, ResponseMetrics, Shop, ShopifyConnectionStatus, ShopifyOrderSummary, ShopSource, User, UserRole } from "../../api";
import { Badge, Empty, Panel } from "../../components/ui";
import { DEFAULT_INSTANT_ANSWER, DEFAULT_WIDGET_LANGUAGE, SHOPIFY_STORE_ID_EXAMPLE, type InstantAnswerConfig, type Language, type ShopConfigMenuKey, type T, type ToastMessage, type ToastTone } from "../shared/types";
import { errorText, connectedShopChannelLabels, conversationStatusLabel, dateOnly, defaultShopifyInstallUrl, defaultShopifyOrderQuery, durationLabel, firstTracking, formatMoney, isConnectedSource, normalizeInstantAnswerOrder, normalizeShopifyDomain, parseInstantAnswers, roleLabel, selectedShopifyDomain, shopifyAPIStatusView, shopifyAppEmbedUrl, shopifyAppStatusView, shopifyEmbedStatusView, shopifyInstallUrl, shopifyRuntimeStatusView, sourceLabel, sourceStatusView, systemAdminUserId, timeLabel, userDisplayName, userStatusLabel } from "../shared/helpers";

export function AISettingsPanel(props: {
  api: PlatformAPI;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/chat/completions");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [models, setModels] = useState(["deepseek-v4-flash", "deepseek-v4-pro"]);
  const [thinking, setThinking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);

  const load = useCallback(async () => {
    try {
      const value = await props.api.getAISettings();
      setSettings(value);
      setEnabled(value.enabled);
      setBaseUrl(value.baseUrl);
      setModel(value.model);
      setModels(value.models.length ? value.models : [value.model]);
      setThinking(value.thinking);
      setApiKey("");
    } catch (error) {
      props.setToast({ tone: "error", text: `加载 AI 配置失败：${errorText(error)}` });
    }
  }, [props.api]);

  useEffect(() => { void load(); }, [load]);

  const input = () => ({ enabled, baseUrl: baseUrl.trim(), model, models, thinking, apiKey: apiKey.trim() });

  async function save() {
    props.setBusy(true);
    try {
      const value = await props.api.saveAISettings(input());
      setSettings(value);
      setApiKey("");
      props.setToast({ tone: "success", text: "AI 接入配置已保存" });
    } catch (error) {
      props.setToast({ tone: "error", text: `保存 AI 配置失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await props.api.testAISettings(input());
      props.setToast({ tone: "success", text: result.message });
    } catch (error) {
      props.setToast({ tone: "error", text: `AI 连接测试失败：${errorText(error)}` });
    } finally {
      setTesting(false);
    }
  }

  async function syncModels() {
    setSyncingModels(true);
    try {
      const result = await props.api.syncAIModels(input());
      const nextModels = Array.from(new Set([...result.models, model]));
      setModels(nextModels);
      props.setToast({ tone: "success", text: `已同步 ${result.models.length} 个可用模型，保存配置后生效` });
    } catch (error) {
      props.setToast({ tone: "error", text: `同步模型失败：${errorText(error)}` });
    } finally {
      setSyncingModels(false);
    }
  }

  const status = !enabled ? "已停用" : settings?.hasApiKey ? "已配置" : "缺少 API Key";
  return (
    <section className="platform-panel ai-settings-panel">
      <div className="panel-title ai-settings-heading">
        <div>
          <h2>DeepSeek 接入</h2>
          <p>全局配置供消息直译和 AI 回复建议使用；AI 只生成草稿，不会自动发送。</p>
        </div>
        <span className={`connection-badge ${enabled && settings?.hasApiKey ? "connected" : "muted"}`}>{status}</span>
      </div>
      <div className="ai-settings-form">
        <div className="ai-provider-row">
          <div><span className="field-label">服务商</span><strong>DeepSeek</strong></div>
          <label className="ai-enable-control"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 启用 AI 功能</label>
        </div>
        <label>
          <span className="field-label">API 地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
        </label>
        <label>
          <span className="field-label">模型</span>
          <div className="ai-model-row">
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {models.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button type="button" onClick={() => void syncModels()} disabled={syncingModels || props.busy || !baseUrl.trim()}>
              <RefreshCw size={15} className={syncingModels ? "spin" : ""} />
              {syncingModels ? "同步中" : "同步模型"}
            </button>
          </div>
          <small>仅点击“同步模型”时获取最新列表，不会自动更新或切换当前模型。</small>
        </label>
        <div className="ai-provider-row">
          <div>
            <span className="field-label">深度思考</span>
            <small>开启后所有 AI 回复和翻译都会使用思考模式，响应时间会增加。</small>
          </div>
          <label className="ai-enable-control"><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} /> 启用深度思考</label>
        </div>
        <label>
          <span className="field-label">API Key</span>
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? "已配置，留空则保留现有 Key" : "填写 DeepSeek API Key"} autoComplete="new-password" />
          <small>{settings?.keySource === "environment" ? "当前使用服务器环境变量中的 Key。" : "Key 经服务器加密后保存，浏览器不会读取原文。"}</small>
        </label>
        {!settings?.encryptionConfigured ? <div className="inline-warning"><CircleAlert size={16} />服务器需配置 AI_SETTINGS_ENCRYPTION_KEY 后才能保存新的 API Key。</div> : null}
        <div className="form-actions">
          <button type="button" onClick={() => void testConnection()} disabled={testing || props.busy || !baseUrl.trim() || !model}>{testing ? "正在测试..." : "测试连接"}</button>
          <button className="primary" type="button" onClick={() => void save()} disabled={props.busy || !baseUrl.trim() || !model}>{props.busy ? "保存中..." : "保存配置"}</button>
        </div>
      </div>
    </section>
  );
}

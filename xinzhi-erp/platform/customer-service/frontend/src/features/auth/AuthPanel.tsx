import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDot, Copy, ExternalLink, FileQuestion, FormInput, HelpCircle, Languages, Mail, MessageSquareText, PackageSearch, PieChart, Plus, RefreshCw, Send, Settings, ShieldCheck, Store, Truck, UserPlus, X } from "lucide-react";
import { AISettings, cleanBaseUrl, Conversation, KnowledgeEntry, Message, PlatformAPI, PlatformAPIError, ResponseMetrics, Shop, ShopifyConnectionStatus, ShopifyOrderSummary, ShopSource, User, UserRole } from "../../api";
import { Badge, Empty, Panel } from "../../components/ui";
import { DEFAULT_INSTANT_ANSWER, DEFAULT_WIDGET_LANGUAGE, SHOPIFY_STORE_ID_EXAMPLE, type InstantAnswerConfig, type Language, type ShopConfigMenuKey, type T, type ToastMessage, type ToastTone } from "../shared/types";
import { errorText, connectedShopChannelLabels, conversationStatusLabel, dateOnly, defaultShopifyInstallUrl, defaultShopifyOrderQuery, durationLabel, firstTracking, formatMoney, isConnectedSource, normalizeInstantAnswerOrder, normalizeShopifyDomain, parseInstantAnswers, roleLabel, selectedShopifyDomain, shopifyAPIStatusView, shopifyAppEmbedUrl, shopifyAppStatusView, shopifyEmbedStatusView, shopifyInstallUrl, shopifyRuntimeStatusView, sourceLabel, sourceStatusView, systemAdminUserId, timeLabel, userDisplayName, userStatusLabel } from "../shared/helpers";

export function AuthPanel(props: {
  t: T;
  busy: boolean;
  needsBootstrap: boolean;
  tenantRequired?: boolean;
  onBootstrap: (input: { email: string; displayName: string; password: string }) => void;
  onLogin: (email: string, password: string, tenantId: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState(() => new URLSearchParams(window.location.search).get("tenant") ?? "");
  const { t } = props;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (props.needsBootstrap) props.onBootstrap({ email, displayName, password });
    else props.onLogin(email, password, tenantId.trim());
  }

  return (
    <section className="auth-layout">
      <div className="auth-card">
        <div className="section-title">
          <ShieldCheck size={20} />
          <div>
            <h2>{props.needsBootstrap ? t.authInitTitle : t.authLoginTitle}</h2>
            <p>{props.needsBootstrap ? t.authInitDesc : t.authLoginDesc}</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={submit}>
          {props.tenantRequired && <label>{t.nativeTenantLabel}<input value={tenantId} onChange={(event) => setTenantId(event.target.value)} autoComplete="organization" maxLength={160} required disabled={props.busy} aria-describedby="native-tenant-help" /><small id="native-tenant-help">{t.nativeTenantHelp}</small></label>}
          <label>{t.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          {props.needsBootstrap ? <label>{t.name}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label> : null}
          <label>{t.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={props.needsBootstrap ? "new-password" : "current-password"} required /></label>
          <button className="primary" type="submit" disabled={props.busy}><ShieldCheck size={16} /> {props.needsBootstrap ? t.createAdmin : t.login}</button>
        </form>
      </div>
      <div className="auth-side">
        <h2>{t.authSideTitle}</h2>
        <p>{t.authSideDesc}</p>
        <div className="feature-grid">
          <span>{t.shopAssignment}</span>
          <span>{t.servicePermission}</span>
          <span>{t.realtimeChat}</span>
          <span>{t.multiSourceMessages}</span>
        </div>
      </div>
    </section>
  );
}

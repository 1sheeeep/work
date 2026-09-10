import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError, apiClient } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { clearNativeLink, readNativeLink, saveNativeLink, validPreparedShop,
  type NativeLinkState, type PreparedShop } from "../shopify/nativeLinkState";
import "./shopify-native-link.css";

type Preview = {
  pending: { shopDomain: string; shopName: string; grantedScopes: string[]; expiresAt: string };
  existingShop: PreparedShop | null;
  canCreateShop: boolean;
};
const copy = {
  "zh-CN": {
    title: "关联 Shopify 店铺", intro: "将已授权的 Shopify 店铺关联到已获准使用的 ERP 企业。ERP 与客服使用同一套账号，业务权限独立校验。",
    access: "本系统须由新知工作人员开通账号并授权后使用，不开放自助注册。安装或授权 Shopify 应用不会获得系统使用权。", contact: "联系工作人员开通",
    loading: "正在核验店铺与账号…", login: "登录已有 ERP 账号", loginHint: "请使用目标企业的原生管理员账号登录，然后回到这里确认店铺归属。不会自动新建企业。",
    missing: "关联凭据已失效或当前浏览器无法保存它。请返回 Shopify 应用页，刷新连接状态后重新发起关联。",
    forbidden: "仅本企业原生管理员且具备店铺授权权限时可以关联。创建新店还需要店铺管理权限。",
    wrong: "此次确认已锁定到另一个 ERP 企业或管理员。请恢复原账号后重试；不要用其他账号接管这次关联。",
    unavailable: "认证服务暂时不可用。", retrySession: "重试认证", shop: "Shopify 店铺", tenant: "目标 ERP 企业", user: "当前管理员",
    existing: "沿用当前企业的已有 ERP 店铺，不新建副本。", create: "将在当前企业创建 ERP 店铺记录；不会修改 Shopify 店铺资料。",
    check: "我确认此 Shopify 店铺属于上方 ERP 企业，并授权建立关联。", confirm: "确认关联", retry: "重试同一次关联", busy: "正在确认，请勿重复操作…",
    unknown: "尚未取得完整确认结果。店铺身份已固定，请重试同一次关联；不要新建店铺或切换企业。",
    expired: "当前凭据不可继续使用。关联可能已被处理，请先返回 Shopify 应用页刷新状态，再决定是否重新发起。",
    failure: "暂时无法核验。没有发起关联，可重试核验。", previewRetry: "重试核验", storage: "浏览器无法安全保存本次重试信息，已停止提交。请允许此站点的会话存储后重试。",
    success: "店铺关联成功", done: "返回原 Shopify 应用页并刷新连接状态。客服工作台的日常登录保持独立，不需要先登录 ERP。",
    cancel: "取消关联", finish: "结束此次操作", cancelled: "已结束此次操作。结束页面不会撤销已经提交或完成的关联。",
    remaining: "凭据有效至", prepared: "ERP 店铺已固定。后续只确认这家店铺，不会重复创建。", erp: "进入 ERP", switchAccount: "退出当前 ERP 账号",
  },
  en: {
    title: "Link your Shopify store", intro: "Link the authorized Shopify store to an approved ERP business. ERP and customer service share an account with separate business permission checks.",
    access: "Access requires an account provisioned and authorized by Xinzhi staff. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access.", contact: "Contact staff for access",
    loading: "Verifying store and account…", login: "Sign in to an existing ERP account", loginHint: "Use the native administrator account for the intended business, then return here to confirm ownership. No business is created automatically.",
    missing: "The link has expired or could not be stored in this browser. Return to the Shopify app, refresh its connection status, then start again.",
    forbidden: "A native business administrator with shop authorization permission is required. Creating a shop also requires shop management permission.",
    wrong: "This confirmation is locked to another ERP business or administrator. Restore the original account to retry; do not take over this link with another account.",
    unavailable: "Authentication is temporarily unavailable.", retrySession: "Retry authentication", shop: "Shopify store", tenant: "Target ERP business", user: "Current administrator",
    existing: "Reuse the existing ERP shop in this business. No duplicate shop will be created.", create: "Create an ERP shop record in this business. Shopify store details will not be changed.",
    check: "I confirm this Shopify store belongs to the ERP business above and authorize the link.", confirm: "Confirm link", retry: "Retry this confirmation", busy: "Confirming. Please do not submit again…",
    unknown: "The complete result is not yet known. The shop identity is fixed. Retry this confirmation; do not create another shop or switch businesses.",
    expired: "This proof can no longer be used. The link may already have been processed. Return to the Shopify app and refresh its status before starting a new link.",
    failure: "Verification is temporarily unavailable. Linking has not started. You can retry verification.", previewRetry: "Retry verification", storage: "This browser could not safely save retry information. Submission was stopped. Allow session storage for this site, then retry.",
    success: "Store linked", done: "Return to the original Shopify app page and refresh the connection status. Customer service keeps its independent daily login; signing in to ERP first is not required.",
    cancel: "Cancel linking", finish: "End this operation", cancelled: "This operation has ended. Closing this page does not undo a link that was already submitted or completed.",
    remaining: "Link expires at", prepared: "The ERP shop is fixed. Only this shop will be confirmed; no duplicate will be created.", erp: "Open ERP", switchAccount: "Sign out of this ERP account",
  },
};

export function ShopifyNativeLinkPage() {
  const auth = useAuth();
  const { locale } = useI18n();
  const text = copy[locale];
  return <main className="shopify-link-page">
    <header><div className="shopify-link-brand"><img src="/assets/xinzhi-erp-logo.png" alt="" width="32" height="32" /><strong>Xinzhi ERP</strong></div><LanguageSwitcher /></header>
    <section className="shopify-link-card" aria-labelledby="native-link-title">
      <h1 id="native-link-title">{text.title}</h1><p>{text.intro}</p>
      <p>{text.access} <a href="mailto:support@xzkj.ai">{text.contact}</a></p>
      {auth.status === "initializing" ? <p role="status">{text.loading}</p>
        : auth.status === "unavailable" ? <><p role="alert">{text.unavailable}</p><button className="button button-secondary" onClick={() => void auth.retry()}>{text.retrySession}</button></>
        : auth.status === "unauthenticated" ? <><p>{text.loginHint}</p><Link className="button button-primary" to="/login" search={{ redirect: "/shopify/link" }}>{text.login}</Link></>
        : <AuthenticatedLink key={`${auth.session?.tenant.id}:${auth.session?.user?.id}`} />}
    </section>
  </main>;
}

function AuthenticatedLink() {
  const auth = useAuth();
  const { locale, formatDateTime } = useI18n();
  const text = copy[locale];
  const [link, setLink] = useState<NativeLinkState | null>(readNativeLink);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<keyof typeof text | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [revision, setRevision] = useState(0);
  const alive = useRef(false), submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const tenant = auth.session?.tenant, user = auth.session?.user;
  const permitted = !!tenant && !!user && !auth.session?.platformAdmin && auth.hasPermission("shop:authorization:write");
  const wrong = !!link?.tenantId && (link.tenantId !== tenant?.id || link.userId !== user?.id);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!link || cancelled || done) return;
    const timer = window.setTimeout(() => { clearNativeLink(); setLink(null); }, Math.max(0, link.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [link, cancelled, done]);
  useEffect(() => {
    if (!link || link.prepared || wrong || !permitted || done || cancelled) return;
    let ignore = false;
    setBusy(true); setError(null);
    void apiClient.request<Preview>("/api/v1/platform-center/shopify/native-link/preview", {
      method: "POST", body: { proof: link.proof },
    }).then(result => {
      if (ignore) return;
      const expiresAt = Date.parse(result.pending?.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()
          || !validPreparedShop({ ...result.pending, shopId: "00000000-0000-4000-8000-000000000000" })
          || (result.existingShop !== null && (!validPreparedShop(result.existingShop)
            || result.existingShop.shopDomain !== result.pending.shopDomain))) throw new Error("Invalid preview");
      const updated = { ...link, expiresAt: Math.min(link.expiresAt, expiresAt) };
      saveNativeLink(updated);
      setLink(updated); setPreview(result);
    }).catch(cause => { if (!ignore) setError(errorKey(cause, false)); })
      .finally(() => { if (!ignore) setBusy(false); });
    return () => { ignore = true; };
    // Refreshing the safe summary must not issue a new proof or repeat a mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.proof, link?.prepared?.shopId, wrong, permitted, done, cancelled, revision]);

  async function confirm() {
    if (!link || !tenant || !user || !permitted || wrong || submitting.current || (!link.tenantId && !checked)) return;
    if (!readNativeLink()) { setLink(null); return; }
    submitting.current = true; setBusy(true); setError(null);
    let saved = { ...link, tenantId: tenant.id, userId: user.id };
    try { saveNativeLink(saved); setLink(saved); }
    catch { setError("storage"); setBusy(false); submitting.current = false; return; }
    try {
      if (!saved.prepared) {
        const prepared = await apiClient.request<PreparedShop>("/api/v1/platform-center/shopify/native-link/prepare", {
          method: "POST", body: { proof: saved.proof },
        });
        if (!alive.current) return;
        if (!validPreparedShop(prepared) || prepared.shopDomain !== preview?.pending.shopDomain
          || (preview?.existingShop && prepared.shopId !== preview.existingShop.shopId)) throw new Error("Invalid prepared shop");
        saved = { ...saved, prepared };
        // Save the shop id before sending a request that could consume the proof.
        try { saveNativeLink(saved); setLink(saved); }
        catch { setError("storage"); return; }
      }
      if (!alive.current || !readNativeLink()) return;
      const result = await apiClient.request<PreparedShop>(`/api/v1/platform-center/shops/${saved.prepared!.shopId}/channels/shopify/native-link/confirm`, {
        method: "POST", body: { proof: saved.proof },
      });
      if (!alive.current) return;
      if (!validPreparedShop(result) || result.shopId !== saved.prepared!.shopId || result.shopDomain !== saved.prepared!.shopDomain) throw new Error("Invalid confirmation");
      clearNativeLink(); setDone(true);
    } catch (cause) { if (alive.current) setError(errorKey(cause, true)); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }

  if (done) return <div role="status"><h2>{text.success}</h2><p>{text.done}</p><Link className="button button-primary" to="/">{text.erp}</Link></div>;
  if (cancelled) return <p role="status">{text.cancelled}</p>;
  const shop = link?.prepared ?? preview?.pending;
  const blocked = !link ? "missing" : !permitted ? "forbidden" : wrong ? "wrong" : null;
  return <>
    {blocked ? <p role="alert">{text[blocked]}</p> : <>
      <dl className="shopify-link-details">
        <div><dt>{text.shop}</dt><dd>{shop ? <>{shop.shopName}<small>{shop.shopDomain}</small></> : text.loading}</dd></div>
        <div><dt>{text.tenant}</dt><dd>{tenant?.name}<small>{tenant?.code}</small></dd></div>
        <div><dt>{text.user}</dt><dd>{user?.displayName}<small>{user?.email ?? user?.username}</small></dd></div>
      </dl>
      {shop && <p>{link?.prepared ? text.prepared : preview?.existingShop ? text.existing : text.create}</p>}
      {link && <p className="shopify-link-muted">{text.remaining}: {formatDateTime(new Date(link.expiresAt))}</p>}
      {preview && !preview.existingShop && !preview.canCreateShop && <p role="alert">{text.forbidden}</p>}
      {shop && !link?.tenantId && <label className="shopify-link-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} /><span>{text.check}</span></label>}
      {error && <p className="shopify-link-error" role="alert" tabIndex={-1} ref={errorRef}>{text[error]}</p>}
      {busy && <p role="status">{link?.tenantId ? text.busy : text.loading}</p>}
      <div className="shopify-link-actions">
        {error === "failure" && <button className="button button-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>{text.previewRetry}</button>}
        <button className="button button-primary" disabled={busy || !shop || (!link?.tenantId && !checked)
          || (!link?.prepared && (!preview || (!preview.existingShop && !preview.canCreateShop)))
          || error === "expired" || error === "forbidden"} onClick={() => void confirm()}>{link?.tenantId ? text.retry : text.confirm}</button>
      </div>
    </>}
    <div className="shopify-link-actions">
      <button className="button button-secondary" disabled={busy} onClick={() => { clearNativeLink(); setCancelled(true); }}>{link?.tenantId ? text.finish : text.cancel}</button>
      <button className="button button-secondary" disabled={busy} onClick={() => void auth.logout()}>{text.switchAccount}</button>
    </div>
  </>;
}

function errorKey(cause: unknown, submitted: boolean): "forbidden" | "expired" | "unknown" | "failure" {
  if (cause instanceof ApiError && cause.status === 403) return "forbidden";
  if (cause instanceof ApiError && cause.code === "native_link_unavailable") return "expired";
  return submitted ? "unknown" : "failure";
}

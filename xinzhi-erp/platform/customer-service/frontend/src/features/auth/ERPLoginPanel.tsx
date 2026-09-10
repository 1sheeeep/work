import { FormEvent, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PlatformAPIError } from "../../api";
import type { Language } from "../shared/types";
import "./erp-login.css";

export type ERPLoginInput = { tenantCode: string; loginIdentifier: string; password: string };
const tenantKey = "support-platform.login-enterprise";

export function ERPLoginPanel({ language, onLogin }: {
  language: Language;
  onLogin: (input: ERPLoginInput) => Promise<void>;
}) {
  const zh = language === "zh";
  const [tenant, setTenant] = useState(() => {
    try { return window.localStorage.getItem(tenantKey) || ""; } catch { return ""; }
  });
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      await onLogin({ tenantCode: tenant.trim(), loginIdentifier: String(form.get("loginIdentifier") || "").trim(), password: String(form.get("password") || "") });
      try { window.localStorage.setItem(tenantKey, tenant.trim()); } catch { /* Login does not require persistent storage. */ }
    } catch (failure) {
      const status = failure instanceof PlatformAPIError ? failure.status : 0;
      setError(status === 401 || status === 400
        ? (zh ? "企业标识、账号或密码不正确，请检查后重试。" : "Check your enterprise code, account and password, then try again.")
        : status === 403
          ? (zh ? "此账号暂时无法使用客服，请联系企业管理员确认权限。" : "This account cannot access customer service. Contact your enterprise administrator.")
          : status === 429
            ? (zh ? "登录尝试过于频繁，请稍后重试。" : "Too many sign-in attempts. Please try again later.")
            : (zh ? "暂时无法登录，请稍后重试。" : "Sign-in is temporarily unavailable. Please try again."));
      passwordRef.current?.focus();
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      pending.current = false;
      setSubmitting(false);
    }
  }

  return <section className="erp-login-layout" aria-labelledby="erp-login-title">
    <div className="auth-card erp-login-card">
      <div className="erp-login-heading">
        <img src="/xinzhi-logo.png" alt="" width="40" height="40" />
        <h1 id="erp-login-title">{zh ? "登录客服工作台" : "Sign in to customer service"}</h1>
        <p>{zh ? "使用与 ERP 相同的账号和密码" : "Use the same account and password as ERP"}</p>
      </div>
      <form className="form-grid" onSubmit={(event) => void submit(event)} aria-busy={submitting}>
        <label htmlFor="erp-login-tenant">{zh ? "企业标识" : "Enterprise code"}
          <input id="erp-login-tenant" name="tenantCode" value={tenant} onChange={(event) => setTenant(event.target.value)} autoComplete="organization" autoCapitalize="none" spellCheck={false} maxLength={64} pattern="[a-z0-9][a-z0-9_\-]*" required readOnly={submitting} />
        </label>
        <label htmlFor="erp-login-account">{zh ? "账号" : "Account"}
          <input id="erp-login-account" name="loginIdentifier" type="text" placeholder={zh ? "邮箱或手机号" : "Email or phone number"} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} required readOnly={submitting} />
        </label>
        <label htmlFor="erp-login-password">{zh ? "密码" : "Password"}</label>
        <div className="erp-login-password">
          <input ref={passwordRef} id="erp-login-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" maxLength={128} required readOnly={submitting} aria-describedby={error ? "erp-login-error" : undefined} />
          <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? (zh ? "隐藏密码" : "Hide password") : (zh ? "显示密码" : "Show password")} aria-pressed={visible}>
            {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {error && <p className="erp-login-error" id="erp-login-error" role="alert">{error}</p>}
        <button className="primary erp-login-submit" type="submit" disabled={submitting}>{submitting ? (zh ? "正在登录…" : "Signing in…") : (zh ? "登录" : "Sign in")}</button>
      </form>
    </div>
  </section>;
}

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  MAXIMUM_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  meetsPasswordPolicy,
} from "../auth/passwordPolicy";
import { httpPlatformAdminAdapter } from "../platform/platformAdminApi";

export function PlatformCredentialPage() {
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const token = useRef(new URLSearchParams(search).get("token") ?? "");
  const [state, setState] = useState<"ready" | "done">("ready");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.search)
      window.history.replaceState(
        window.history.state,
        "",
        "/platform-admin/activate",
      );
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token.current) {
      setError("此链接缺少凭证令牌。请向管理员索取新的激活或重置链接。");
      return;
    }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("newPassword") ?? "");
    const confirm = String(data.get("confirmPassword") ?? "");
    if (!meetsPasswordPolicy(password)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致。");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await httpPlatformAdminAdapter.redeemPasswordCredential({
        token: token.current,
        newPassword: password,
      });
      token.current = "";
      setState("done");
    } catch (reason) {
      setError(
        reason instanceof ApiError &&
          (reason.status === 400 ||
            reason.status === 401 ||
            reason.status === 404 ||
            reason.status === 409)
          ? "此链接已过期、已使用或无效。请向管理员索取新的链接。"
          : "暂时无法设置密码，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };
  if (state === "done")
    return (
      <main className="full-page-state">
        <h1>密码设置完成</h1>
        <p>请使用平台管理员账号在平台后台登录。</p>
        <a className="button button-primary" href="/platform-admin/login">
          前往登录
        </a>
      </main>
    );
  return (
    <main className="login-page">
      <section className="login-intro">
        <p className="eyebrow eyebrow-light">一次性凭证</p>
        <h1>设置平台管理员密码</h1>
        <p>此链接只能使用一次。令牌不会保存在浏览器存储或地址栏中。</p>
      </section>
      <section className="login-form-region">
        <div className="login-card">
          <h2>激活或重置账号</h2>
          {error && (
            <div
              className="form-error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              {error}
            </div>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="platform-new-password">新密码</label>
            <input
              id="platform-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              maxLength={MAXIMUM_PASSWORD_LENGTH}
              required
              autoFocus
              disabled={submitting}
            />
            <label htmlFor="platform-confirm-password">确认密码</label>
            <input
              id="platform-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              maxLength={MAXIMUM_PASSWORD_LENGTH}
              required
              disabled={submitting}
            />
            <button className="button button-primary" disabled={submitting}>
              {submitting ? "正在设置" : "设置密码"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { normalizeLoginIdentifier } from "../auth/identity";
import { usePlatformAdmin } from "../platform/PlatformAdminContext";

export function PlatformAdminLoginPage() {
  const { status, login, error: sessionError } = usePlatformAdmin();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  if (status === "authenticated")
    return <Navigate to="/platform-admin" replace />;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const loginIdentifier = String(
      form.get("loginIdentifier") ?? "",
    ).trim();
    try {
      await login({
        ...normalizeLoginIdentifier(loginIdentifier),
        password: String(form.get("password") ?? ""),
      });
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 401
          ? "邮箱、手机号（或旧账号）或密码不正确，请重新输入。"
          : reason instanceof ApiError && reason.status === 429
            ? "登录尝试过多，请稍后再试。"
            : "平台认证服务暂时不可用，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="login-brand">
          <span className="brand-mark has-product-logo" aria-hidden="true">
            <img src="/assets/xinzhi-erp-logo.png" alt="" />
          </span>
          <strong>Xinzhi ERP</strong>
        </div>
        <p className="eyebrow eyebrow-light">平台管理</p>
        <h1>平台系统管理员入口</h1>
        <p>
          仅限 SYSTEM_ADMIN
          使用。登录后默认停留在平台后台，不会加载企业商品、库存、采购、订单或客服数据。
        </p>
      </section>
      <section className="login-form-region">
        <div className="login-card">
          <div className="login-card-heading">
            <p className="eyebrow">受限访问</p>
            <h2>登录平台后台</h2>
            <p>使用本系统的平台管理员账号和密码登录。</p>
          </div>
          {(error ?? sessionError) && (
            <div
              className="form-error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              <strong>无法登录</strong>
              <span>{error ?? sessionError}</span>
            </div>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <label htmlFor="platform-login-identifier">邮箱或手机号</label>
            <input
              id="platform-login-identifier"
              name="loginIdentifier"
              autoComplete="username"
              maxLength={254}
              aria-describedby="platform-login-identifier-help"
              required
              autoFocus
              disabled={submitting}
            />
            <small
              className="password-requirements"
              id="platform-login-identifier-help"
            >
              中国大陆手机号可直接输入 11 位号码；旧账号仍可兼容登录。
            </small>
            <label htmlFor="platform-password">密码</label>
            <input
              id="platform-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={submitting}
            />
            <button
              className="button button-primary login-submit"
              disabled={submitting}
            >
              {submitting ? "正在登录" : "登录平台后台"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

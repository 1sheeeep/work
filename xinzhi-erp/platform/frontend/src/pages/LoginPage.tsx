import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Navigate, useSearch } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { normalizeLoginIdentifier } from '../auth/identity'
import { sanitizePostLoginRedirect } from '../auth/redirects'
import { LanguageSwitcher } from '../i18n/LanguageSwitcher'
import { useI18n } from '../i18n/I18nContext'

export function LoginPage() {
  const { t } = useI18n()
  const { status, login } = useAuth()
  const search = useSearch({ from: '/login' })
  const errorRef = useRef<HTMLDivElement>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const productName = 'Xinzhi ERP'

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const requestedPath = sanitizePostLoginRedirect(search.redirect) ?? '/'
  if (status === 'authenticated') {
    return <Navigate to={requestedPath} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const formData = new FormData(event.currentTarget)
    const loginIdentifier = String(
      formData.get('loginIdentifier') ?? '',
    ).trim()

    try {
      await login({
        tenantCode: String(formData.get('tenantCode') ?? '').trim(),
        ...normalizeLoginIdentifier(loginIdentifier),
        password: String(formData.get('password') ?? ''),
      })
    } catch (loginError) {
      if (loginError instanceof ApiError && loginError.status === 401) {
        setError(t('企业标识、邮箱、手机号（或旧账号）或密码不正确，请重新输入。'))
      } else {
        setError(t('登录服务暂时不可用，请稍后重试。'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <LanguageSwitcher className="login-language-switcher" />
      <section className="login-intro" aria-labelledby="login-product-title">
        <div className="login-brand">
          <span className="brand-mark has-product-logo" aria-hidden="true">
            <img src="/assets/xinzhi-erp-logo.png" alt="" />
          </span>
          <strong>{productName}</strong>
        </div>
        <div>
          <p className="eyebrow eyebrow-light">{t('跨境运营平台')}</p>
          <h1 id="login-product-title">{t('让跨境业务在同一套工作台协同')}</h1>
          <p>
            {t('统一管理店铺、商品、订单、履约与经营信息。')}
          </p>
        </div>
        <ul className="login-benefits">
          <li>
            <ShieldCheck size={20} aria-hidden="true" />
            <span>
              <strong>{t('企业数据隔离')}</strong>
              {t('身份、权限与业务数据按企业独立管理')}
            </span>
          </li>
          <li>
            <KeyRound size={20} aria-hidden="true" />
            <span>
              <strong>{t('统一认证')}</strong>
              {t('登录状态由系统统一管理')}
            </span>
          </li>
        </ul>
      </section>

      <section className="login-form-region" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-card-heading">
            <p className="eyebrow">{t('安全登录')}</p>
            <h2 id="login-title">{t('登录 ERP 工作台')}</h2>
            <p>{t('使用管理员分配的企业标识，以及邮箱或手机号登录。')}</p>
          </div>

          {error && (
            <div className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
              <strong>{t('无法登录')}</strong>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(event) => void handleSubmit(event)}>
            <label htmlFor="tenant-code">{t('企业标识')}</label>
            <div className="input-shell">
              <Building2 size={18} aria-hidden="true" />
              <input
                id="tenant-code"
                name="tenantCode"
                type="text"
                autoComplete="organization"
                placeholder={t('请输入企业标识')}
                required
                autoFocus
                disabled={submitting}
              />
            </div>

            <label htmlFor="login-identifier">{t('邮箱或手机号')}</label>
            <div className="input-shell">
              <UserRound size={18} aria-hidden="true" />
              <input
                id="login-identifier"
                name="loginIdentifier"
                type="text"
                autoComplete="username"
                maxLength={254}
                placeholder={t('请输入邮箱或手机号')}
                required
                disabled={submitting}
                aria-describedby="login-identifier-help"
              />
            </div>
            <small
              className="password-requirements"
              id="login-identifier-help"
            >
              {t('中国大陆手机号可直接输入 11 位号码；旧账号仍可兼容登录。')}
            </small>

            <label htmlFor="password">{t('密码')}</label>
            <div className="input-shell">
              <KeyRound size={18} aria-hidden="true" />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={t('请输入密码')}
                required
                disabled={submitting}
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={t(showPassword ? '隐藏密码' : '显示密码')}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>

            <button
              className="button button-primary login-submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  {t('正在登录')}
                </>
              ) : (
                <>
                  {t('登录工作台')}
                  <ArrowRight size={18} aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <p className="login-help">
            {t('本系统须由新知工作人员开通账号并授权后使用，不开放自助注册。安装或授权 Shopify 应用不会获得系统使用权。')}
            {' '}<a href="mailto:support@xzkj.ai">{t('联系工作人员开通')}</a>
          </p>
          <p className="login-help">
            {t('已有账号无法登录时，请联系工作人员或账号管理员核对使用授权和账号状态。')}
          </p>
        </div>
      </section>
    </main>
  )
}

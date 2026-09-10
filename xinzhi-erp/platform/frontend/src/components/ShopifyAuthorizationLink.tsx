import { Copy, RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'

type CopyState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }

export function ShopifyAuthorizationLink({
  authorizationUrl,
  checking = false,
  onCheck,
  directInstall = false,
}: {
  authorizationUrl: string
  checking?: boolean
  onCheck?: () => void
  directInstall?: boolean
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [copyState, setCopyState] = useState<CopyState>({ status: 'idle' })

  const copyAuthorizationUrl = async () => {
    try {
      await navigator.clipboard.writeText(authorizationUrl)
      setCopyState({
        status: 'success',
        message: t('安装链接已复制。请在对应店铺的浏览器中新开标签页后粘贴打开。'),
      })
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      setCopyState({
        status: 'error',
        message: t('自动复制失败，链接已选中。请复制后在对应店铺的浏览器中打开。'),
      })
    }
  }

  return (
    <section className="shopify-authorization-guide" aria-labelledby="shopify-authorization-guide-title">
      <div>
        <strong id="shopify-authorization-guide-title">{t('在对应店铺的浏览器中安装或重新授权公开应用')}</strong>
        <p>{t('系统只负责生成和复制链接，不会启动或控制浏览器。')}</p>
      </div>
      <label htmlFor="shopify-authorization-url">{t('公开应用安装链接')}</label>
      <div className="shopify-authorization-link-row">
        <input
          id="shopify-authorization-url"
          ref={inputRef}
          value={authorizationUrl}
          readOnly
          spellCheck={false}
          aria-describedby="shopify-authorization-safety-note"
        />
        {directInstall ? (
          <a className="button button-primary" href={authorizationUrl}>{t('继续 Shopify 安装')}</a>
        ) : (
          <button className="button button-primary" type="button" onClick={() => void copyAuthorizationUrl()}>
            <Copy size={15} aria-hidden="true" />
            {t('复制安装链接')}
          </button>
        )}
      </div>
      <p className="shopify-authorization-safety-note" id="shopify-authorization-safety-note">
        {directInstall
          ? t('这是从 Shopify 发起并经签名验证的安装请求，可在当前页面继续。')
          : t('复制后，请在对应店铺的浏览器中新开标签页粘贴打开并确认安装。请勿在其他店铺的浏览器中打开。')}
      </p>
      {copyState.status !== 'idle' && (
        <p
          className={copyState.status === 'error' ? 'form-error' : 'shopify-copy-success'}
          role={copyState.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {copyState.message}
        </p>
      )}
      {onCheck && (
        <button className="button button-secondary" type="button" onClick={onCheck} disabled={checking}>
          <RefreshCw className={checking ? 'spin' : undefined} size={15} aria-hidden="true" />
          {t(checking ? '正在检查安装状态' : '我已完成安装或授权，检查状态')}
        </button>
      )}
    </section>
  )
}

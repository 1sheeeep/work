package platform

import (
	"fmt"
	"html/template"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

type xzERPPublicSiteConfig struct {
	LegalName     string
	SupportEmail  string
	SupportMailto string
	EffectiveDate string
	PageTitle     string
}

func (s *Server) handleXZERPPublicPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	page, ok := xzERPPublicPageTemplates[r.URL.Path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	cfg, err := loadXZERPPublicSiteConfig()
	if err != nil {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Xinzhi ERP public app information is not configured",
		})
		return
	}
	cfg.PageTitle = page.title
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err := page.template.Execute(w, cfg); err != nil {
		return
	}
}

func loadXZERPPublicSiteConfig() (xzERPPublicSiteConfig, error) {
	legalName := strings.TrimSpace(firstNonEmptyEnv("XZ_ERP_LEGAL_NAME"))
	supportEmail := strings.TrimSpace(firstNonEmptyEnv("XZ_ERP_SUPPORT_EMAIL"))
	effectiveDate := strings.TrimSpace(firstNonEmptyEnv("XZ_ERP_PRIVACY_EFFECTIVE_DATE"))
	if legalName == "" || supportEmail == "" || effectiveDate == "" {
		return xzERPPublicSiteConfig{}, fmt.Errorf("%w: Xinzhi ERP public app information is incomplete", ErrInvalid)
	}
	address, err := mail.ParseAddress(supportEmail)
	if err != nil || !strings.EqualFold(strings.TrimSpace(address.Address), supportEmail) {
		return xzERPPublicSiteConfig{}, fmt.Errorf("%w: Xinzhi ERP support email is invalid", ErrInvalid)
	}
	if _, err := time.Parse("2006-01-02", effectiveDate); err != nil {
		return xzERPPublicSiteConfig{}, fmt.Errorf("%w: Xinzhi ERP privacy effective date is invalid", ErrInvalid)
	}
	return xzERPPublicSiteConfig{
		LegalName:     legalName,
		SupportEmail:  supportEmail,
		SupportMailto: "mailto:" + supportEmail,
		EffectiveDate: effectiveDate,
	}, nil
}

type xzERPPublicPage struct {
	title    string
	template *template.Template
}

var xzERPPublicPageTemplates = map[string]xzERPPublicPage{
	"/shopify/xz-erp":               newXZERPPublicPage("Xinzhi ERP", xzERPLandingContent),
	"/shopify/xz-erp/":              newXZERPPublicPage("Xinzhi ERP", xzERPLandingContent),
	"/shopify/xz-erp/privacy":       newXZERPPublicPage("隐私政策 - Xinzhi ERP", xzERPPrivacyContent),
	"/shopify/xz-erp/support":       newXZERPPublicPage("支持 - Xinzhi ERP", xzERPSupportContent),
	"/shopify/xz-erp/guide":         newXZERPPublicPage("使用说明 - Xinzhi ERP", xzERPGuideContent),
	"/shopify/xz-erp/data-deletion": newXZERPPublicPage("数据删除说明 - Xinzhi ERP", xzERPDataDeletionContent),
}

func newXZERPPublicPage(title string, content string) xzERPPublicPage {
	return xzERPPublicPage{
		title:    title,
		template: template.Must(template.New("page").Parse(xzERPPublicPageShell + content)),
	}
}

const xzERPPublicPageShell = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Xinzhi ERP Shopify 应用公开信息与使用说明。">
  <title>{{.PageTitle}}</title>
  <style>
    :root{--primary:#1e3a8a;--primary-strong:#172554;--surface:#fff;--background:#f8fafc;--text:#0f172a;--muted:#475569;--border:#cbd5e1;--focus:#b45309}
    *{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--background);color:var(--text);font:16px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
    a{color:var(--primary);text-underline-offset:3px}.skip{position:absolute;left:16px;top:-80px;background:var(--surface);padding:12px 16px;border:2px solid var(--focus);z-index:10}.skip:focus{top:16px}
    header{background:var(--primary-strong);color:#fff;border-bottom:1px solid #29416d}.nav{max-width:1120px;margin:auto;padding:16px 24px;display:flex;align-items:center;gap:24px}.brand{color:#fff;font-weight:700;font-size:20px;text-decoration:none;white-space:nowrap}.links{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}.links a{color:#e2e8f0;text-decoration:none;padding:10px 12px;min-height:44px;border-radius:3px}.links a:hover{background:#243b63;color:#fff}.links a:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
    main{max-width:1120px;margin:auto;padding:48px 24px 72px}.hero{border-left:5px solid var(--primary);padding:8px 0 8px 24px;margin-bottom:40px}.eyebrow{color:var(--primary);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px}.hero h1{font-size:clamp(32px,5vw,52px);line-height:1.15;margin:8px 0 16px}.lead{font-size:19px;color:#334155;max-width:760px;margin:0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card,.section{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:24px}.card h2,.section h2{margin-top:0;font-size:21px}.card p{color:var(--muted)}.action{display:inline-flex;align-items:center;min-height:44px;padding:10px 16px;background:var(--primary);color:#fff;text-decoration:none;border-radius:3px;font-weight:700}.action:hover{background:#1e40af}.section{max-width:820px;margin:0 0 20px}.section h2{border-bottom:1px solid var(--border);padding-bottom:10px}.section h3{font-size:17px;margin-top:24px}.section li+li{margin-top:8px}.meta{color:var(--muted);font-size:14px}footer{border-top:1px solid var(--border);background:#eef2f7}.footer{max-width:1120px;margin:auto;padding:24px;color:var(--muted)}
    @media(max-width:760px){.nav{align-items:flex-start;flex-direction:column;gap:8px}.links{margin-left:0}.links a{padding-left:0;padding-right:16px}.grid{grid-template-columns:1fr}main{padding-top:32px}.hero{padding-left:16px}.section,.card{padding:20px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <a class="skip" href="#main">跳到主要内容</a>
  <header><nav class="nav" aria-label="主要导航"><a class="brand" href="/shopify/xz-erp">Xinzhi ERP</a><div class="links"><a href="/shopify/xz-erp/guide">使用说明</a><a href="/shopify/xz-erp/privacy">隐私政策</a><a href="/shopify/xz-erp/data-deletion">数据删除</a><a href="/shopify/xz-erp/support">支持</a></div></nav></header>
  <main id="main">{{template "content" .}}</main>
  <footer><div class="footer">© {{.LegalName}} · Xinzhi ERP Shopify App</div></footer>
</body>
</html>`

const xzERPLandingContent = `{{define "content"}}
<section class="hero"><div class="eyebrow">Shopify App · 免费</div><h1>Xinzhi ERP</h1><p class="lead">统一 Connector 负责安装、OAuth/API 授权、令牌和 Webhook；商品、订单、库存与履约在 Xinzhi ERP 管理，Support Chat 与邮箱渠道在 Xinzhi 客服工作台管理。</p></section>
<section class="grid" aria-label="连接后在独立 ERP 后台使用的能力">
  <article class="card"><h2>店铺连接</h2><p>通过 Shopify 官方授权连接店铺，并在 Shopify 连接主页查看状态和已授予权限。</p></article>
  <article class="card"><h2>商品管理</h2><p>在独立 ERP 后台预览 Shopify 商品与变体，按 SKU 匹配并导入本地商品映射。</p></article>
  <article class="card"><h2>订单管理</h2><p>在独立 ERP 后台预览并导入订单；履约前可按权限写回地址、商品行或数量。</p></article>
  <article class="card"><h2>履约发货</h2><p>在独立 ERP 后台完成称重交运后，按商品明细和运单号安全回传 Shopify。</p></article>
  <article class="card"><h2>拒付概览</h2><p>在独立 ERP 后台查看拒付状态、金额、原因和处理截止时间；证据材料在 Shopify Admin 中处理。</p></article>
  <article class="card"><h2>店面客服插件</h2><p>通过同一应用启用 Xinzhi Chat，访客消息由客服工作台接收和回复。</p></article>
</section>
<section class="section" style="margin-top:24px"><h2>开始前请阅读</h2><p>Xinzhi ERP 当前支持 Shopify 商品匹配、订单导入与受控编辑、库存发布、商家自管履约、退货退款、客户档案查询、拒付元数据查看和 Xinzhi Chat。商品资料写入/发布、草稿订单、客户营销以及拒付证据读取、编辑和提交不在当前版本。</p><a class="action" href="/shopify/xz-erp/guide">查看使用说明</a></section>
{{end}}`

const xzERPPrivacyContent = `{{define "content"}}
<section class="hero"><div class="eyebrow">Public App Information</div><h1>隐私政策</h1><p class="lead">本政策说明 {{.LegalName}} 运营的 Xinzhi ERP Shopify App 如何处理商家和客户数据。</p><p class="meta">生效日期：{{.EffectiveDate}}</p></section>
<section class="section"><h2>我们处理的数据</h2><ul><li>店铺标识、myshopify.com 域名、安装状态、授权范围和加密保存的访问令牌。</li><li>商家主动在 ERP 中查询或处理的商品与变体、地点、库存、订单、客户、收件地址、商家自管履约、退货退款，以及 Shopify Payments 拒付状态、金额、原因和截止时间；当前版本不访问拒付证据。</li><li>商家启用 Xinzhi Chat 时，处理访客主动提交的消息、附件、会话连续性标识及自愿提供的订单查询信息。</li><li>保障系统安全与可追溯性所需的请求标识、操作记录和错误状态；安全日志不记录访问令牌、地址或消息正文。</li></ul></section>
<section class="section"><h2>处理目的</h2><ul><li>连接 Shopify 店铺并提供商品匹配、订单与客户识别、库存发布、商家自管履约、退货退款和拒付元数据查看等 ERP 工作流。</li><li>在商家启用店面客服插件时维持访客会话、提供所请求的订单状态帮助，并让获授权客服人员回复。</li><li>维护系统安全、排查故障、防止滥用并履行法定义务。</li></ul><p>本应用不将 Shopify 客户或店面客服数据用于广告、画像、获客或无关营销。</p></section>
<section class="section"><h2>保存、共享与安全</h2><p>数据仅在提供 Xinzhi ERP、履行商家指令和法定义务所需范围内保存。我们不会出售个人数据。仅在提供基础设施、存储或运维服务所必需时向受约束的服务提供商披露。Shopify 访问令牌由统一 connector 持有并加密保存，ERP 业务服务不直接保存令牌。</p></section>
<section class="section"><h2>隐私请求</h2><p>我们验证并接收 Shopify 的客户数据访问、客户删除和店铺删除合规 webhook。有效请求会进入受限的内部隐私任务，并在适用要求规定的期限内处理。联系邮箱：<a href="{{.SupportMailto}}">{{.SupportEmail}}</a>。</p></section>
{{end}}`

const xzERPSupportContent = `{{define "content"}}
<section class="hero"><div class="eyebrow">Support</div><h1>获取支持</h1><p class="lead">安装、授权、商品或订单导入遇到问题时，请联系 Xinzhi ERP 支持团队。</p></section>
<section class="section"><h2>联系方式</h2><p>支持邮箱：<a class="action" href="{{.SupportMailto}}">{{.SupportEmail}}</a></p><p>邮件中请提供 ERP 店铺名称、myshopify.com 域名、问题发生时间和页面提示。请勿发送 Shopify 密码、访问令牌或银行卡信息。</p></section>
<section class="section"><h2>常见处理</h2><ul><li>授权范围缺失：返回 Shopify 重新授权 Xinzhi ERP。</li><li>商品无法匹配：确认 Shopify 变体 SKU 与 ERP 本地 SKU 完全一致。</li><li>订单无法导入：检查订单读取能力和本地 SKU 匹配状态。</li><li>地址无法写回：确认应用已获得 write_orders，且订单尚未进入履约。</li><li>商品无法新增或数量无法修改：确认已授予 write_order_edits、订单尚未履约、Listing 与订单行映射未变化，且待新增变体不在订单中；结果不确定时保留原请求并重试。</li><li>发货无法回传：确认包裹已有运单号，并已授予 write_merchant_managed_fulfillment_orders；结果不确定时使用“核对并重试回传”。</li><li>拒付数据无法显示：确认已授予 read_shopify_payments_disputes；拒付证据请直接在 Shopify Admin 中处理。</li><li>客服插件未显示：在 Shopify 主题编辑器的 Xinzhi ERP 下启用 Support Chat 应用嵌入并保存。</li><li>隐私或删除请求：在邮件主题中注明“Xinzhi ERP 隐私请求”。</li></ul></section>
{{end}}`

const xzERPGuideContent = `{{define "content"}}
<section class="hero"><div class="eyebrow">User Guide</div><h1>Xinzhi ERP 使用说明</h1><p class="lead">同一公开应用只安装一次，但职责分开：ERP 管业务授权与店铺生命周期，客服工作台管 Support Chat 和邮箱渠道，统一 Connector 独占令牌与 Shopify API。</p></section>
<section class="section"><h2>1. 安装与授权</h2><ol><li>从 Shopify 应用市场或 Shopify 管理界面打开 Xinzhi ERP 并确认安装，不需要为客服功能再次 OAuth。</li><li>查看并批准应用请求的权限。</li><li>在 Shopify 连接主页确认连接有效；再进入 Xinzhi ERP 店铺详情检查授权范围和缺失权限提示。</li></ol><p>授权失败可重新生成安装链接；权限缺失应重新授权补齐。若页面提示 Connector 无法访问，请先重新检测，避免重复创建店铺。</p></section>
<section class="section"><h2>2. 商品目录</h2><ol><li>进入商品中心并打开 Shopify 目录导入。</li><li>按关键词或状态预览商品与变体。</li><li>确认 Shopify 变体 SKU 与 ERP 本地 SKU 精确匹配后再导入。</li></ol><p>商品导入只写入 ERP 本地 Listing 映射，不会修改 Shopify 商品。</p></section>
<section class="section"><h2>3. 订单目录</h2><ol><li>进入订单中心并打开 Shopify 订单导入。</li><li>预览订单、行项目、地址与履约摘要。</li><li>检查 SKU 匹配结果后导入 ERP；重复订单会跳过，未匹配 SKU 会进入本地匹配流程。</li></ol><p>订单导入只创建 ERP 本地订单，不会修改 Shopify 订单。</p></section>
<section class="section"><h2>4. 收货地址写回</h2><ol><li>打开已导入的 Shopify 订单详情。</li><li>在“写回 Shopify 收货地址”中复核姓名、地址、地区代码和电话。</li><li>确认后，Xinzhi ERP 先修改 Shopify，再以平台返回的标准化地址更新 ERP。</li></ol><p>地址写回需要 write_orders。订单进入配货、已发货、已送达或已取消后，该操作会被锁定；每次请求均有幂等记录和不含地址明文的审计记录。</p></section>
<section class="section"><h2>5. 商品新增与数量编辑</h2><ol><li>打开尚未进入履约的 Shopify 订单详情；如需新增商品，选择当前店铺的活动 Listing，设置数量并确认。</li><li>如需修改已有商品，在目标商品行点击“编辑数量”；减少数量时可选择是否将差额补回库存。</li><li>选择是否通知客户并确认，Xinzhi ERP 会核对 Shopify 当前状态，完成编辑并同步最新订单行与总额。</li></ol><p>商品新增和数量编辑需要 write_orders、write_order_edits；新增已映射变体还需要 read_products。对应写权限已包含必要的订单和订单编辑读取能力。系统拒绝新增订单内已有变体；结果不确定时请保留相同输入重试，系统会先核对 Shopify 是否已完成修改。</p></section>
<section class="section"><h2>6. 发货与运单回传</h2><ol><li>在订单履约明细中完成拣货、包装、称重和仓库交运，并填写承运商与运单号。</li><li>在已交运包裹中复核物流查询链接和是否通知客户。</li><li>点击“回传 Shopify 发货”；成功后包裹会显示 Shopify fulfillment 标识，且不能再冲销本地发货事实。</li></ol><p>如果页面提示结果不确定，请使用“核对并重试回传”。系统会先按运单号和商品数量核对 Shopify，避免重复创建发货。</p></section>
<section class="section"><h2>7. 拒付概览</h2><ol><li>进入订单中心的“拒付管理”并选择店铺。</li><li>查看金额、状态、拒付原因和处理截止时间。</li><li>需要查看、编辑或提交证据时，转到 Shopify Admin 的拒付页面处理。</li></ol><p>当前版本只同步拒付元数据，不读取、编辑、上传或提交拒付证据。</p></section>
<section class="section"><h2>8. 客服渠道</h2><h3>店面聊天</h3><ol><li>在 Shopify 主题编辑器的 Xinzhi ERP 下启用 Support Chat 应用嵌入并保存。</li><li>在 Xinzhi 客服工作台完成聊天渠道绑定与挂件配置。</li><li>从店面发送测试消息并在客服工作台回复。</li></ol><h3>邮箱</h3><p>Gmail、Outlook 等邮箱只在 Xinzhi 客服工作台授权、停用、解绑和重新授权，与 Shopify 应用安装相互独立。</p></section>
<section class="section"><h2>9. 停用、解绑与删除</h2><ul><li><strong>停用店铺：</strong>只暂停 ERP 新的同步和业务命令；Shopify 安装、店面聊天和客服邮箱保持不变。</li><li><strong>解绑并卸载：</strong>在 ERP 店铺详情发起，统一 Connector 请求 Shopify 卸载公开应用并清除本地凭据；店面应用嵌入随卸载停止，客服邮箱不受影响。也可在 Shopify 后台手动卸载，系统收到 app/uninstalled 通知后完成同样的本地失效处理。</li><li><strong>删除店铺：</strong>必须先完成解绑。ERP 采用软删除，默认隐藏店铺但保留历史订单和审计记录。</li></ul><p>需要再次使用时，对同一个 ERP 店铺重新安装并授权，不要新建重复店铺。后续的数据删除请求按照<a href="/shopify/xz-erp/data-deletion">数据删除说明</a>处理。</p></section>
<section class="section"><h2>10. 失败恢复</h2><ul><li><strong>授权失败：</strong>确认当前浏览器登录的是正确店铺，再重新生成安装链接。</li><li><strong>权限缺失：</strong>在 ERP 店铺详情执行重新授权并批准新增权限。</li><li><strong>接入失败：</strong>先“重新检测”；Connector 不可用不会自动清除凭据或删除店铺。</li><li><strong>解绑失败：</strong>令牌失效或权限不足时，系统保留本地绑定。请先重新授权后再解绑，或在 Shopify 后台手动卸载后返回 ERP 重新检测。</li></ul></section>
{{end}}`

const xzERPDataDeletionContent = `{{define "content"}}
<section class="hero"><div class="eyebrow">Data Deletion</div><h1>数据删除说明</h1><p class="lead">商家可以通过 Shopify 的标准隐私流程或直接联系 Xinzhi ERP 提交数据访问与删除请求。</p></section>
<section class="section"><h2>Shopify 标准流程</h2><ul><li><strong>客户数据访问：</strong>Shopify 发送 customers/data_request 通知后，我们建立受限内部任务并整理相关数据。</li><li><strong>客户数据删除：</strong>Shopify 发送 customers/redact 通知后，我们核对客户与订单标识并执行适用的删除或匿名化。</li><li><strong>店铺数据删除：</strong>卸载后 Shopify 发送 shop/redact 通知，我们删除或匿名化不再需要保留的店铺数据。</li></ul><p>有效请求将在 Shopify 要求的期限内完成；法律要求保留的数据仅在法定范围和期限内保留。</p></section>
<section class="section"><h2>直接联系</h2><p>请发送邮件至 <a href="{{.SupportMailto}}">{{.SupportEmail}}</a>，提供店铺 myshopify.com 域名、请求类型和可用于验证商家身份的信息。请勿在邮件中发送访问令牌或密码。</p></section>
{{end}}`

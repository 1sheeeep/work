# 现有 Shopify 公开应用身份与发布边界

状态：`ACTIVE`。本文件已替代旧的“创建新公司、新组织、新应用”方案；不得按旧方案另建测试 App。

## 已确认的唯一应用身份

- 法定主体 / Partner 组织：`Aspen Ridge International Trade LLC`
- Dev 组织 ID：`229977658`
- App name：`Xinzhi ERP`
- App ID：`407894786049`
- 审核开发店显示名：`Xinzhi App Lab`
- 审核开发店域名：`xinzhi-app-lab.myshopify.com`，送审前仍需从 Shopify 后台人工复核

现有应用就是拟送审的公开应用。不得删除或重建该应用，也不得再创建第二个“测试应用”。`Xinzhi App Lab` 只是使用合成数据的隔离审核店，不是另一个应用。

## 产品和系统边界

- Shopify 应用负责安装、OAuth 授权、API 权限、Webhook、卸载与合规 Webhook，以及最小化的 Shopify App Home。
- 当前本地 App Home 已有待关联授权、既有 ERP 账号确认、插件设置引导、连接重查和权限检查；这些本地切片不是精确部署与真实店铺闭环验收。开户方式已确定：任何用户和企业均须由我们开通账号并授权，不开放自助注册，Shopify 安装不授予系统使用权。`embedded=true` 的受控开户提示、完整安装/配置/连接管理及两业务/插件仍需精确构建验收，不能据此正式送审。ERP 与复制客服共用 ERP 账号，客服独立业务权限；ERP 提供客服入口，免二次登录，不依赖 One。Shopify 授权仍由 ERP／Connector 负责；见 `00-submission-product-boundary.md`。
- 订单、库存、履约、退货退款、客户和拒付业务均由授权员工在独立的 Xinzhi ERP Web 后台管理。
- 主题应用扩展仅用于可选的店面客服入口；当前 Shopify 主题的欢迎语、精选商品、颜色、按钮和位置在主题编辑器中配置，渠道绑定、即时回答、客服行为和最近加载状态在独立客服系统中管理。插件配置/启用链接只由用户点击复制，并在对应店铺已登录的浏览器中手工打开。
- Shopify 登录、安装、重新授权、权限申请和送审均由用户在对应店铺已登录的浏览器中手工完成。应用版本由系统管理员在 ERP 平台管理后台确认后，通过 Xinzhi ERP 应用级 Automation Token 无交互发布；不会控制店铺浏览器。

## 公开应用参数

| 项目 | 当前值 |
|---|---|
| App name | `Xinzhi ERP` |
| App ID | `407894786049` |
| Developer / company website | `https://www.xzkj.ai/` |
| Company identity | `https://www.xzkj.ai/about/` |
| Company contact | `https://www.xzkj.ai/contact/` |
| App URL | `https://erp.xzkj.ai/shopify/app` |
| OAuth callback | `https://erp.xzkj.ai/shopify/oauth/callback` |
| Privacy policy | `https://erp.xzkj.ai/shopify/privacy` |
| Terms of service | `https://erp.xzkj.ai/shopify/terms` |
| Data deletion | `https://erp.xzkj.ai/shopify/data-deletion` |
| Support | `https://erp.xzkj.ai/shopify/support` |
| Installation guide | `https://erp.xzkj.ai/shopify/guide` |

`xzkj.ai` 用于公开公司与开发者身份；`erp.xzkj.ai/shopify/...` 用于应用自身的安装、隐私、条款、删除、支持和审核说明。不得把官网仅覆盖网站访问的隐私政策或条款误填成 Xinzhi ERP 应用政策。

最终申请权限固定为以下 10 项：

`read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns`

- `read_all_orders`：已于 2026-08-17 获批。
- `read_shopify_payments_dispute_evidences` 与 `write_shopify_payments_dispute_evidences`：Shopify 已因 Partner 组织未满一年而拒绝，本版本明确排除；证据处理留在 Shopify Admin。
- 审核店域名、审核员账号和最终联系信息仍须由负责人在送审前人工填写。

## 禁止记录的内容

仓库、文档、截图和聊天中不得记录 Client secret、Admin API access token、审核员密码、数据库口令或其他密钥。只允许记录非敏感标识和人工确认状态。

## 应用版本发布鉴权

- 使用 Shopify Dev Dashboard 为 `Xinzhi ERP` 单独生成的 App Automation Token；令牌只用于 Shopify CLI 发布应用配置和扩展，不用于 Shopify Admin API 或店铺业务请求。
- 令牌只允许系统管理员在 ERP“平台管理 → 应用发布”保存或替换，使用服务端 AES-256-GCM 加密；接口和页面只返回“是否已配置”，不回显令牌原文。令牌不得进入客服系统、仓库、命令行参数、日志、截图或聊天。
- ERP 发布服务强制 `CI=1`，缺令牌时在调用 Shopify CLI 前失败关闭，并校验固定 Client ID、镜像内的 TOML 和客服主题应用扩展。
- 系统管理员点击“发布 Shopify 应用”并二次确认后，ERP 使用 Shopify 为 CI/CD 推荐的 `--allow-updates` 创建并启用新版本；不得使用 `--allow-deletes`，也不得由企业租户或客服账号调用。
- 页面记录发布中、成功、失败和版本号；失败可重试，令牌可替换或清除，服务重启造成的中断自动恢复为可重试的失败状态。
- Automation Token 失效或错误时直接终止；不得回退到设备码登录、系统默认浏览器或任何店铺浏览器环境。

## 发布与人工验收顺序

1. 验证 TOML、运行时、功能、文案和送审材料均只包含上述 10 项权限，且没有拒付证据读写能力或声明。
2. 完成本仓库精确构建、本地测试和送审就绪门禁。
3. 系统管理员在 ERP“平台管理 → 应用发布”保存应用级 Automation Token，并二次确认发布包含上述 10 项权限和客服 Theme App Extension 的新版本。
4. ERP 页面显示发布成功和新版本号后，再开始审核店验证；发布失败时按页面提示替换令牌或重试。
5. 用户在 `Xinzhi App Lab` 中手工重新授权现有应用。
6. 在 ERP 店铺详情中验证 10 项权限均为已授权。
7. 仅使用合成数据制作截图和录屏。
8. 完成 Partner Dashboard 清单后由用户手工提交审核。

在 10 项授权未实测、被拒绝的证据 scope 或功能仍有残留、占位符未清零或最终媒体未完成时，结论必须为 `NO-GO`。

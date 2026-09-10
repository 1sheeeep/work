# Xinzhi ERP Shopify App 审核材料包

> **2026-09-06 接入目标更新，仍为 NO-GO。** 用户确认未来复用原生产客服、以客服既有账号为保留基准并入 ERP 账号，同时保留客服店铺应用与 ERP SaaS 两条接入；允许经验证不影响现有使用的准备性部署，正式接入仍等通知。见 [当前接入准备](../production-customer-service-integration-preparation.md)。以下账号、复制客服、单一授权来源和未来代理切换说明是旧验收基线，不直接用作新目标的最终提交说明；须待实际版本与人工流程重新验证。既有 SaaS 应用身份和申请路线保留，不新增应用、不改权限、不提交、不宣称接入完成。

## 现有应用身份

当前唯一送审目标是 `Aspen Ridge International Trade LLC` 组织中的现有公开应用 `Xinzhi ERP`（App ID `407894786049`）。不得删除、重建或另建“测试 App”。`Xinzhi App Lab` 只是使用合成数据的隔离审核店。完整身份和人工发布边界见 `12-existing-app-release-boundary.md`。

官方公司/开发者网站的规范地址为 `https://www.xzkj.ai/`；公司主体页为 `https://www.xzkj.ai/about/`，公开联系页为 `https://www.xzkj.ai/contact/`。裸域 `xzkj.ai` 当前统一重定向到该规范地址。官网用于证明公开主体和企业邮箱分工，不替代 `erp.xzkj.ai/shopify/...` 下针对 Xinzhi ERP 应用的数据处理、隐私、条款和支持页面。

本目录是 Partner Dashboard 申请的可复制工作稿，不是已提交或已通过声明。代码和文案已经尽可能保持一致；用 `{{...}}` 标记的信息必须由实际主体在提交前填写，禁止使用虚构信息。

## 材料索引

- `00-submission-product-boundary.md`：本次送审的权威产品边界；一个公开应用同时包含完整 ERP 与客服工作台两个业务面。
- `01-app-listing-copy.md`：英文主列表文案、简体中文工作翻译、定价和安装资格。
- `02-reviewer-test-instructions.md`：审核员账号、安装路径、测试数据和逐步验证脚本。
- `03-access-and-protected-data.md`：Shopify scope 用途、功能证据、受保护客户数据申请草稿。
- `04-assets-and-screencast.md`：图标、功能媒体、截图和审核录屏的制作清单。
- `05-submission-checklist.md`：从部署到点击 Submit 的失败关闭检查表。
- `06-screencast-script-and-subtitles.md`：覆盖完整业务流程的审核录屏分镜与未定时英文字幕稿，不预设三分钟时长。
- `07-partner-dashboard-entry-sheet.md`：Partner Dashboard 可复制字段、URL 和提交说明骨架。
- `08-material-status.md`：已完成材料、Level 2 路线决策和必须人工完成的事项。
- `09-engineering-readiness-evidence.md`：前端、Go、Java/PG16、API/audit 与依赖扫描的实测证据。
- `10-level2-data-protection-evidence.md`：Level 2 受保护客户字段、用途、控制证据和未完成的法务/运维门禁。
- `11-owner-input-and-production-evidence-pack.md`：公司负责人填写项、生产证据编号、脱敏要求和最终交付顺序。
- `12-existing-app-release-boundary.md`：现有公开应用身份、系统边界、人工发布顺序和 go/no-go 门禁。
- `13-data-protection-operations.md`：第 8–10 个数据保护问题的真实控制、生产启用步骤、证据和可勾选条件。
- `16-parallel-review-preparation.md`：共用 ERP 账号基线下的材料准备、合成测试数据分组及精确版本证据交接。
- `17-embedded-review-gap-audit.md`：App Home、安装返回路径和身份关联的实际缺口，以及页面嵌入安全边界的本地修复证据。

## 当前边界

- 定价：免费，不提供站外付费或 Shopify Billing 订阅。
- 分发：公开 App Store，完整可见并可搜索。
- 账号：使用一套经过验证的 ERP 企业标识、账号和密码。ERP 的「客服工作台」入口免二次登录；复制客服独立网址直接填写同一套账号密码，留在当前页登录。坐席业务权限与店铺范围单独验证，不另存客服密码或按邮箱认领身份。直接表单已部署 UAT，最终录制前仍须人工验证真实账号和准确版本。
- Shopify App Home：保留独立 ERP／客服工作台，补齐 Shopify Admin 内的安装、账号关联、配置、连接管理及必要状态。官方集成指南允许 ERP 主业务和持续监控的客服会话使用独立工作区，但当前状态加只读预览不等于已通过审核要求；不以取消 `embedded=true` 绕过。
- 两个完整业务工作区：独立 Xinzhi ERP Web 后台负责订单、库存、履约、退货退款、客户和拒付元数据等 ERP 业务；独立客服工作台负责 Shopify 渠道、插件、客户会话、分配/领取/转交/结束、工单及精确版本已提供的客服管理能力。两者属于同一个 `Xinzhi ERP` 公开应用并一起送审，不是主应用与附带演示的关系。
- 店铺在线客服：作为同一个公开应用的 Theme App Extension 进入审核；Shopify 主题编辑器管理当前主题的欢迎语、精选商品、颜色、按钮和位置，独立客服后台管理渠道绑定、即时回答、客服行为、会话和最近加载状态，并仅在用户点击时复制主题编辑器链接。用户必须在对应店铺已登录的浏览器中手动粘贴打开、配置、启用并保存；审核流程继续展示会话领取、回复、转交、结束和关联工单，不触发第二次 Shopify 授权。
- 登录边界：不依赖 One、不另建底座，复用 ERP IAM；客服保持独立业务界面和会话。见 `../shared-erp-customer-service-identity.md`。真实版本登录与业务验证仍是发布条件。
- 域名边界：`kf.xzkj.ai` 始终是正式客服域名，`kf-uat.xzkj.ai` 只用于审核/UAT；同一 Connector 以正式域名为默认，仅对审核店设置 UAT 覆盖，未来迁移只切换正式域名后的代理上游。
- scope：本次可发布的完整必要权限已冻结为 10 项。`read_all_orders` 已获批；`read_shopify_payments_dispute_evidences` 和 `write_shopify_payments_dispute_evidences` 因合作伙伴组织未满一年而被 Shopify 明确拒绝，本版本不请求、不实现也不宣称证据读写，证据处理留在 Shopify Admin。

## 异步处理时只需填写

1. 现有主体、组织、应用和官方公司网站已确认；仍需从 Shopify 后台人工复制审核店域名，并由公司负责人复核营业地址、联系人和公开政策内容。对外邮箱已统一为 `developer@xzkj.ai`、`support@xzkj.ai` 和 `privacy@xzkj.ai`，官网联系页已按相同用途公开。
2. `developer@xzkj.ai` 是主企业邮箱及 API、提交和紧急开发者联系邮箱，紧急电话为 `+86 180 0262 9295`；`support@xzkj.ai` 与 `privacy@xzkj.ai` 是可收发邮件但不能独立登录的企业别名。仍需确认三个地址的真实监控负责人、覆盖安排和升级路径。
3. Associated Developer Account 填 `No`：`Weyr Uetgy LLC` 的旧 Partner 账号及早期草稿归该独立公司所有和控制，当前负责人当时只是提供开发协助，从未拥有或控制旧公司或其 Partner 账号；`Aspen Ridge International Trade LLC` 与其不存在持股、控制或共同控制关系。审核账号邮箱为 `uat.erp@example.com`；真实密码只在 Shopify 的受限审核字段中人工填写，不写入仓库或可复用材料。
4. Level 1/2 的同意、数据分享退出、重大自动决策、商户数据保护协议、物理营业地址、处理区域、子处理商、传输保障、隐私负责人/DPO 适用性、保留/删除、加密备份、环境隔离、DLP、人员访问、访问日志和事件响应证据。
5. 图标、功能图、3–6 张截图、英文或英文字幕录屏 URL，以及直达 Shopify 连接主页的 Demo store URL。
6. 上线环境部署后的最终负向测试和 Partner Dashboard 自动检查结果。
7. 最终 10 项权限矩阵及精确构建验证。两个已拒绝的拒付证据受限权限不得出现在 TOML、运行时、版本权限、截图、录屏或功能声明中。

## 当前提交状态

产品已确认采用 Level 2 路线，代码和本地审核文档已对齐姓名、地址、电话、邮箱的履约/订单支持用途，但审核包尚未达到可提交状态。当前阻塞项以 `08-material-status.md` 和 `10-level2-data-protection-evidence.md` 为准。任何 `{{...}}` 占位符、未确认法律政策、缺失的生产控制证据或未完成的真实店铺证据都不得用猜测值替换。

2026-09-04 用户已恢复本地送审准备。跨任务确认沿用既有免费公开应用、完整 ERP＋复制客服＋插件、十项 scope；历史 One 方案已退役。原客服迁移不作为送审功能，本轮不操作生产或正式提交。已确认的主体、定价与政策不重复征询，仅补未完成凭据/证据及精确版本复核。

提交前从仓库根目录运行 `node platform/scripts/shopify-review-readiness-gate.mjs`。该门禁会验证固定审核文档、listing 的 30/100/500/80 字符上限与搜索词数量、图标和功能图尺寸、英文字幕时序、3–6 张最终截图规格及文件去重、未填占位符及未勾选要求；当前材料未完成时按设计返回失败，禁止绕过或把草稿截图复制到 `assets/final` 充数。截图可使用中文产品界面，但必须是彼此不同的真实应用界面，不得包含桌面背景或浏览器窗口；近似重复、可读性、英文 alt text、脱敏和视觉质量仍须由产品负责人按 `04-assets-and-screencast.md` 人工确认。

检查器同时防止原生登录入口和公开说明退回旧身份方案；这只是源码静态防回归，不证明部署账号可用。字幕逐项出现十个 scope 名称是本项目内部证据规则，不是 Shopify 官方逐字朗读要求；官方要求实际展示功能并提供英文或英文字幕。未定时稿不能代替实际录制与对时。

Connector 部署或录屏前还必须在部署机上运行 `platform/infra/review/verify-customer-service-origin-routing.sh`，并向它传入实际 `shopify.env` 路径。该门禁只输出通过/失败，不回显环境值；它要求共享默认地址保持 `https://kf.xzkj.ai`，且唯一覆盖必须是 `xinzhi-app-lab.myshopify.com=https://kf-uat.xzkj.ai`。任何其他默认地址、缺失/重复覆盖或额外店铺覆盖都按失败处理。

精确提交版本部署后，再运行 `node platform/scripts/shopify-public-review-smoke.mjs --base-url https://erp.xzkj.ai`。该门禁不使用凭据，检查七个公开 URL（包括商户数据处理条款）的 HTTPS、无重定向 HTTP 200、HTML、页面标记、响应体上限、占位/示例值，以及无凭据请求的禁止嵌入、隐私响应头和首页禁止缓存；它不能替代带签名 Shopify 启动测试或产品负责人的视觉验收。

同时运行 `node platform/scripts/shopify-company-identity-smoke.mjs`，确认官网首页、主体、联系、隐私和条款五页仍公开显示 `Aspen Ridge International Trade LLC` 以及用途一致的三类企业邮箱。该检查只读取公开网站，不发送邮件，也不能代替邮箱收发测试或公司权属文件。

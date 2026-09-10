# 送审并行准备与精确版本证据交接

更新：2026-09-06。ERP 使用原生账号；复制客服通过短时单次凭证验证同一 ERP 账号，再建立独立业务会话并校验既有坐席、权限和店铺范围。准备工作不访问生产客服、真实店铺、账号或凭据，不部署、不正式提交；已单独获准完成的客服直登 UAT 发布见 `../customer-service-direct-login-deployment-2026-09-06.md`。

## 当前可以完成什么

- 可以现在完成：英文 listing、逐步审核说明、十项 Shopify 权限用途、未定时英文旁白、测试数据分组、截图选题与 alt text、材料一致性测试。
- 需隔离环境验证：一套 ERP 审核账号及其既有客服坐席、角色/店铺范围、免二次登录、禁用/退出与 WebSocket、跨企业/店铺拒绝。不等待 One 集成。
- 仍未完成：Shopify 新店安装/账号关联、Admin 内必要配置和连接管理、真实店铺写入/主题插件/安装卸载验证，以及尚缺的法务、邮箱监控和生产数据保护证据。已批准的政策保留原证据，不重复列为未决定。
- 最后统一完成：冻结提交版本、隔离部署、真实流程与视觉验收，再拍最终截图/视频、按实际视频生成 SRT、填写受限账号字段和正式提交。

不使用 One 或替代身份底座。继续使用既有 Xinzhi ERP 公开应用、十项 scope 与一个 Connector。Shopify 授权归 ERP／Connector；ERP 与复制客服共用既有 ERP 账号，但不复制密码或原始 ERP Token，客服保留独立业务会话、坐席权限和店铺范围，也不改变既有 canonical 店铺归属。

## 材料修正结果

1. `01` 不再将状态页加外链包装为已符合嵌入式要求；保留 ERP、客服两业务和已批准功能，不扩大 scope 或完整英语支持声明。
2. `02`、`07` 明确只提供一套 ERP 企业标识、账号和密码；客服入口使用短时单次凭证建立独立业务会话，并继续校验既有客服坐席、业务权限和店铺范围，不按邮箱认领或复制密码。
3. `04` 最小三图组合包含连接状态、ERP 商品、客服会话；其余图片仅在有不同且可接受的真实视图时添加。不改动旧图片、不用拼图或修图补功能。
4. `06` 是未验收、未定时的准备稿，覆盖完整业务和十项 scope；身份及嵌入式章节明确等待真实验收。不压缩成预设三分钟，也不编造成功时间轴。
5. `05` 重新打开旧账号措辞及五项全量工程验证：此前证据对应旧版本，不代表本次改造后的精确送审版本。
6. Connector 的实际公开指南路由 `/shopify/guide` 已在本地更新，源码位于 `customer-service/internal/connectors/shopify/installations/reviewer_guide.go`。沿用现有公开页面样式，添加六节目录、十项 scope 对应操作、ERP 免二次密码进入客服及直接网址的同账号密码表单、会话/工单完整过程以及卸载与失败恢复说明；没有改动法务政策、权限或运行配置。该指南是待部署的操作说明，不是功能已验收的证明。

## 权限 → 场景 → 代码核对入口

以下只证明仓库中存在对应实现/测试位置，不证明隔离环境、Shopify 授权或审核员可用。目录前缀统一为 `platform/`；业务步骤以 `02` 为准，旁白以 `06` 为准。

| Shopify scope | 准备场景 | 本地核对入口 |
| --- | --- | --- |
| `read_products` | 商品变体预览与 SKU 匹配 | `backend/src/test/java/cn/xzkj/erp/product/service/ProductShopifyCatalogPreviewServiceTest.java` |
| `read_customers` | 合成客户与最近订单关系 | `backend/src/test/java/cn/xzkj/erp/order/service/OrderShopifyCustomerServiceTest.java` |
| `read_all_orders` | 真实满足超过 60 天条件的测试订单预览/导入；缺权限拒绝 | `backend/src/test/java/cn/xzkj/erp/order/service/OrderShopifyCatalogPreviewServiceTest.java`，`historicalPreviewRequiresAllOrdersAndAddsServerCutoff` / `historicalPreviewFailsClosedWithoutAllOrdersScope` |
| `write_orders` | 当前订单读取/导入，独立合成订单的地址修改或取消 | `backend/src/test/java/cn/xzkj/erp/order/service/OrderShopifyShippingAddressServiceTest.java` / `OrderShopifyCancellationServiceTest.java` |
| `write_order_edits` | 未履约订单修改一条数量或折扣 | `backend/src/test/java/cn/xzkj/erp/order/service/OrderShopifyLineQuantityServiceTest.java` / `OrderShopifyLineDiscountServiceTest.java` |
| `read_locations` | Shopify 地点与 ERP 仓库映射 | `backend/src/test/java/cn/xzkj/erp/platform/service/ShopifyLocationMappingServiceTest.java` |
| `write_inventory` | 数量对照、明确确认、单次发布与幂等恢复 | `backend/src/test/java/cn/xzkj/erp/inventory/service/ShopifyInventoryPublicationServiceTest.java` |
| `write_merchant_managed_fulfillment_orders` | 已准备包裹的商家管理履约与物流信息 | `backend/src/test/java/cn/xzkj/erp/fulfillment/service/ShopifyFulfillmentPublicationServiceTest.java` |
| `write_returns` | 符合条件的退货、平台计算退款预览与确认 | `customer-service/internal/platform/shopify_after_sales_test.go`，`TestShopifyReturnRefundPreviewAndRetryRecovery` |
| `read_shopify_payments_disputes` | 测试拒付的元数据，不读写证据 | `customer-service/internal/platform/shopify_after_sales_test.go`，`TestShopifyDisputeListUsesOnlyUnrestrictedSummaryFields` |

客服/插件不另加 Shopify scope：原生权限在 `customer-service/internal/platform/permissions.go`；主题配置及租户路由测试在 `shopify_plugin_boundary_test.go`；隐私事件校验在 `shopify_compliance_test.go`，执行/数据清理在 `shopify_privacy_data_test.go`；这些文件均位于该 `internal/platform/` 目录。不得用代码测试替代主题编辑器和真实隐私事件的精确版本证据。

## 合成数据准备单（未创建记录）

所有标签仅用于安排将来的隔离测试，不代表现有 Shopify ID，不读取或复制生产资料。店铺限定 `xinzhi-app-lab.myshopify.com`，客服限定 `kf-uat.xzkj.ai`。实际建数由获授权的操作者完成；不为送审伪造记录状态或回执。

| 标签 | 最低准备状态 | 用后限制 |
| --- | --- | --- |
| `REVIEW-PRODUCT-A/B` | 两种商品/变体有可核对的 SKU，ERP 映射明确 | 只读匹配用，不顺便刊登或改商品 |
| `REVIEW-IMPORT` | 当前时间窗内的可读取订单 | 导入只写 ERP，不复用为履约、取消或退款订单 |
| `REVIEW-ADDRESS` | 允许地址修改的独立订单 | 只改一项合成字段，保留前后状态 |
| `REVIEW-EDIT` | 未履约、可编辑的独立订单 | 编辑后不得转作原始金额的退款演示 |
| `REVIEW-HISTORY` | Shopify 实际创建时间已超过 60 天且可授权读取 | 不能通过改本地日期伪造；若没有合格记录，此场景保持阻断 |
| `REVIEW-INVENTORY` | 合成 SKU、单一映射地点，ERP/Shopify 数量存在安全差值 | 确认后发布一次；结果不确定先查询，不重复点提交 |
| `REVIEW-FULFILLMENT` | 独立订单、已准备包裹、可用商家管理地点与合成物流 | 发布后不复用为未履约编辑订单，不购买面单 |
| `REVIEW-RETURN` | 独立订单与符合审批/退款条件的退货请求 | 必须有平台计算退款预览；不手填金额替代 |
| `REVIEW-DISPUTE` | 合格测试店可实际产生的测试拒付元数据 | 空列表不证明读取成功；不能用真实拒付或合成界面冒充平台结果 |
| `REVIEW-CHAT-A/B` | 两名合成坐席或可实际操作的转交目标、未领取会话 | 领取、回复、转交、结束/重开均留证；不发真实邮箱消息 |
| `REVIEW-TICKET` | 与上述合成会话相关的可操作工单 | 记录关联与更新结果，不只展示空工单列表 |
| `REVIEW-PRIVACY` | 单独的合成客户/订单/会话/附件集合 | 放在其他演示之后；覆盖存储与重试，不删除公共演示数据 |

账号验证：只提供一套可访问 ERP 与客服的 ERP 审核凭据；核验 ERP → 客服免二次密码、直接客服网址同页输入企业标识/账号/密码登录而不跳转 ERP、ERP Token 跨业务拒绝，以及跨企业/店铺权限。仅保存用途和验证状态；真实密码不进仓库、聊天或截图。现有 `uat.erp@example.com` 已只读核实 ERP/CHAT 开通和客服权限，仍须真实会话验证；保留既有客服租户与主键，不迁移密码或按邮箱认领。本机实际客服进程加合成 ERP IAM 的登录回归见 `../shared-erp-customer-service-identity.md`，不代替真实账号验收。

## 每个真实场景需要留下的最小证据

- 精确 ERP、复制客服、Connector、Theme App Extension 版本及记录时间；工作区 HEAD 不自动等于服务版本。
- 各业务原生账号所属企业/租户、有效业务权限与店铺范围的脱敏结果；不保存 OAuth Token、密码、回调参数。
- 使用的合成标签及初始状态；操作前确认、一次实际动作、平台返回结果和刷新后的最终状态。未知结果必须保留为未知，不能替换成成功。
- 正向与缺权限/跨范围负向结果分开；隐私事件区分“收到 Webhook”与“完成导出/匿名化/删除”。
- 最终媒体文件与该版本证据相互对应。截图人工检查页面、脱敏、可读性与差异；SRT 在导出视频后逐段对时并静音复查。

先完成业务演示，再测试独立客户级隐私集合，最后做单一应用卸载/重装。`shop/redact` 整店清理不得在共享审核店执行；必须沿用 `13-data-protection-operations.md` 的一次性隔离店铺/快照及单独授权、恢复验证边界，本准备单不授权创建另一真实店铺或执行整店删除。卸载验证同时覆盖 ERP 的 Shopify 访问和客服的 Shopify 关系；不把聊天历史保留误写为卸载时自动全部删除。

## 尚需负责人提供，而不是开发者猜填

沿用 `11-owner-input-and-production-evidence-pack.md`、`03` 和 `10`：补历史订单权限批准的留档参考、品牌/主体授权参考、邮箱值守与真实演练、隔离/访问日志等尚缺证据。已确认的 DPA、保留删除、备份、子处理商/区域、DLP 与人员访问决定保留原批准记录，只对精确版本变化和尚缺运维证据复核，不能重复宣称它们均未批准。

## 原生送审说明本轮验证

2026-09-04：readiness、public-review-smoke、company-identity-smoke、framing-boundary 四个 Node 测试文件共 72 项通过，零失败/跳过；Go installations 包测试和 vet 通过。原生表单允许企业标识，拒绝旧身份回退及旧指南；缺失真实凭据、最终媒体和未确认项仍失败关闭。实际材料为 18 次占位字段出现、78 项待确认、两张已有最终图片及旧 SRT；这是当前值，下面 14 次/65 项为此前记录。未访问服务或店铺，未做本轮浏览器验收。

## 此前检查记录（原版本，不是本次重跑）

本地检查器回归：送审门禁 25 项，加公开页面/主体页面检查器的合成测试合计 65 项全部通过、零跳过。新检查拒绝公开指南恢复旧 ERP 登录说明、遗漏独立客服入口或工单/转交步骤，并验证公开请求的页面嵌入/隐私响应头。代理模板与既有业务边界另 6 项通过。未调用这些脚本访问实际公开服务；旧线上 7/7 成功记录不能认证本版。实际材料门禁仍报告 78 项待确认、14 个占位字段、最终截图数量不足、旧 SRT 缺九项 scope；未定时英文准备稿的十项覆盖已通过检查。

上一轮指南 Go 包为 132 项通过，浏览器仅检查同源模板的本机合成预览：桌面目录跳转正常，375×812 竖屏长权限名称可换行，812×375 横屏恢复说明可读；两种小屏页面内容宽度均未超出可视宽度。预览使用固定虚构公开字段，无账号/数据库/店铺连接，已结束临时服务；它不等于实际 Go 服务、隔离部署或真实业务验收。后续页面嵌入安全及 OAuth 成功返回切片使 Go Shopify Connector 四包达到 346 项通过，其中 installations 为 198 项；相同四包 `go vet` 通过。证据和仍未关闭的托管安装/业务身份缺口见 `17-embedded-review-gap-audit.md`，不是全量 ERP/客服业务测试。

当前未完成原生账号隔离环境验收、安装/关联与 Admin 管理、真实店铺操作、最终媒体和正式提交。实际 `shopify-review-readiness-gate.mjs` 必须保持 NO-GO，直到真实证据闭合；不通过删除占位字段、提前勾选或伪造 SRT 消除红项。字幕包含逐个 scope 标识是内部追溯规则，不是官方逐字朗读要求。

依据：2026-09-04 核对 [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) 的嵌入式体验、必要权限、真实媒体与测试凭据要求，以及 [listing best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices) 的商家导向文案与语言声明要求。以上为内部准备安排，不代表 Shopify 预先批准。

# Xinzhi ERP Shopify App 上架与联调准备契约

本文记录当前代码已经落地的 Shopify App 能力、内部接口边界、已申请权限意图和后续上架审核前必须补齐的材料。它不是 Shopify 审核通过声明，也不是生产发布授权。

> **范围门禁：** 本文只记录技术现状，不批准产品范围。所有菜单、功能、字段和审核材料必须服从
> [`locked-product-scope-boundaries.md`](locked-product-scope-boundaries.md)。本文中对既有供应商、财务、
> 商品合规或仓库越界实现的描述，不能解释为解除暂停或永久排除。

Partner Dashboard 可复制的 listing 文案、审核员脚本、scope/受保护客户数据说明、媒体清单和提交检查表位于 `platform/docs/shopify-review/`。

## 产品定位

- App 名称：`Xinzhi ERP`
- 类型：公开 Shopify App，目标是在 Shopify 应用市场公开展示并可搜索。
- 业务定位：Shopify 公开应用是 Xinzhi ERP 的 API 集成层，不是 ERP 管理界面。订单、库存、履约、退货退款、客户、拒付和客服业务均由授权员工在独立的 Xinzhi ERP Web 后台处理。
- 首发系统边界：Shopify App Home 只负责连接/setup 状态和有限只读审核预览；Shopify OAuth、token、Admin API 调用由统一 connector 持有，ERP Java 只通过内部受控接口读取或下发命令。

## 当前已实现的安全切片

| 能力 | ERP 入口 | 内部 connector 能力 | 写入 Shopify | 当前状态 |
| --- | --- | --- | --- | --- |
| 店铺连接状态 | Shop Center / Platform Center | `connection` | 否 | 已接入 |
| 商品平台目录预览 | Product Center | `product-catalog` | 否 | 已接入 |
| 商品按 SKU 精确匹配导入 | Product Center | `product-catalog` 读后由 ERP 本地落库 | 否 | 已接入 |
| Shopify 库存预检与发布 | Inventory Center | `inventory-level`、`inventory-set` | 是 | 已接入；要求唯一商品与地点映射，发布前核对 ERP 版本和 Shopify 当前库存，持久化任务支持幂等、租约、未知结果恢复及跨浏览器最近任务恢复 |
| 订单平台目录预览 | Order Center | `order-catalog` | 否 | 已接入 |
| 订单导入 ERP 本地 | Order Center | `order-catalog` 读后由 ERP 本地建单 | 否 | 已接入；后端重跑预览，重复订单跳过，未匹配 SKU 进入订单匹配队列 |
| 订单地址修改 | Order Center 订单详情 | `order-shipping-address` | 是 | 已接入；仅 Shopify GID 订单，履约开始前可用，平台先写、本地后同步 |
| 订单商品数量编辑 | Order Center 订单详情 | `order-edit-quantity` | 是 | 已接入；仅未履约且映射唯一的 Shopify 商品行，支持减量补回库存、客户通知、订单总额同步与不确定结果恢复 |
| 订单新增已映射商品 | Order Center 订单详情 | `order-add-variant` | 是 | 已接入；仅未履约订单和当前店铺的活动 Listing，拒绝订单内已有变体，支持客户通知、总额同步与不确定结果恢复 |
| 订单新增自定义金额 | Order Center 订单详情 | `order-add-custom-item` | 是 | 已接入；支持名称、单价、数量、发货/计税属性和客户通知，提交前明确确认，总额同步且重复或不唯一结果失败关闭 |
| 订单商品行新增折扣 | Order Center 订单详情 | `order-line-discount` | 是 | 已接入；支持固定金额或百分比折扣，提交前明确确认，精确核对原折扣、折扣分配和订单总额，不确定结果仅允许同一幂等命令安全恢复 |
| 取消平台订单 | Order Center 订单详情 | `order-cancel` | 是 | 已接入；不可逆操作明确确认，可分别选择原路退款、库存回补和客户通知；用命令标记精确核对未知结果，履约开始后失败关闭 |
| 发货/运单回传 | Order Center 履约明细 | `fulfillment-publish` | 是 | 已接入；仅不可变的已交运包裹，按 Shopify Fulfillment Order 创建并支持不确定结果核对恢复 |
| 拒付元数据查看 | Order Center / 拒付管理 | `dispute-catalog` | 是 | 只读取金额、状态、类型、原因、订单、时间和处理截止日；证据始终在 Shopify Admin 处理 |
| 退货与退款 | Order Center / 退货与退款 | `return-catalog`、退货决定、退款预览与处理 | 是 | 已接入退货明细、批准/拒绝、退款预览与明确确认后的退款处理；嵌套分页截断时失败关闭 |
| 客户档案 | Order Center / 客户档案 | `customer-catalog` | 否 | 已接入只读查询、基础联系方式、宽泛地区、累计订单与最近订单关联；不编辑客户、不营销、不复制客服工单 |
| 客服会话/工单 | ERP“客服”菜单 | 已导入 customer-service bounded service | 视具体动作 | 一次性 grant + 内部 workload 兑换基础已接入；生产 origin/部署仍保持关闭 |
| Shopify 隐私合规请求 | 公共回调 + 平台管理后台 | `customers/data_request`、`customers/redact`、`shop/redact` | 否 | 已接入 HMAC 校验、交付去重、30 天截止，以及 ERP 持有订单数据的导出、交付确认和脱敏操作；客服数据覆盖及部署证据仍待完成 |

## ERP 权限与 Shopify scope 闭环

当前前后端按“读可预览、写才导入”的原则收敛权限，不把平台写权限伪装成已经上线的 Shopify 写入能力。

| ERP 操作 | ERP 权限点 | 必需 Shopify scope | 当前行为 |
| --- | --- | --- | --- |
| 商品目录预览 | `products.listing.read` | `read_products` | 读取 Shopify 商品/变体并按本地 SKU 预匹配；只读用户可执行 |
| 商品映射导入 | `products.listing.write` | `read_products` | 后端重跑预览，只把精确 SKU 匹配写入 ERP 本地 Listing；不会写 Shopify |
| Shopify 库存预检 | `inventory.read` + `shop:read` | `read_inventory` + `read_locations` | 读取唯一商品库存项和仓库地点映射，比较 ERP 可用库存与 Shopify 当前可用库存；映射缺失、重复或数据身份变化时失败关闭 |
| Shopify 库存发布 | `inventory.shopify.publish` + `inventory.read` | `read_inventory` + `write_inventory` + `read_locations` | 使用持久化幂等任务、ERP 库存版本和 Shopify 当前值执行 compare-and-set；未知结果先核对再恢复，前端在新标签页或刷新后先恢复最近任务以避免重复发布 |
| 订单目录预览 | `orders.read` | `read_orders` | 读取 Shopify 订单、行项目、金额、地址、履约摘要；只读用户可执行 |
| 订单导入 ERP | `orders.write` | `read_orders` | 后端重跑预览并创建 ERP 本地订单；重复订单跳过，未匹配 SKU 进入本地匹配流程；不会写 Shopify |
| 收货地址写回 | `orders.write` | `write_orders` | 校验订单/资料版本、状态和授权后先写 Shopify；使用持久化幂等命令，平台返回标准化地址后更新 ERP，并记录不含地址明文的审计 |
| 订单商品数量编辑 | `orders.shopify_edit.write` | `read_orders` + `read_order_edits` + `write_order_edits` | 仅允许未履约、具有唯一订单行和变体映射的订单；先核对平台当前数量，再执行 begin/set/commit；拒绝超过 100 行的截断订单，成功后同步 ERP 数量和 Shopify 最新总额，不确定结果必须使用同一请求重试 |
| 订单新增已映射商品 | `orders.shopify_edit.write` + `products.listing.read` | `read_orders` + `read_order_edits` + `write_order_edits` | 仅允许从当前店铺的活动 Listing 选择尚未存在于订单的 Shopify 变体；执行 begin/add/commit 后精确核对变体、数量、金额与新行标识，再原子写入 ERP 订单行和审计；不确定结果仅允许同一幂等请求核对恢复 |
| 订单商品行新增折扣 | `orders.shopify_edit.write` | `read_orders` + `read_order_edits` + `write_order_edits` | 仅允许未履约且映射唯一的 Shopify 商品行；固定金额和百分比参数严格互斥，执行 begin/add-discount/commit 后精确核对描述、类型、金额或比例、折扣增量和最新总额，再原子同步 ERP；Shopify 操作者还需具备应用订单折扣的后台用户权限 |
| 取消 Shopify 订单 | `orders.shopify_edit.write` | `read_orders` + `write_orders` | 仅允许尚未开始履约且未取消的订单；退款、库存回补和客户通知分别显式选择，并要求不可逆确认；取消备注包含唯一命令标记，超时重试只恢复原因和标记完全一致的结果 |
| 发货与运单回传 | `fulfillments.ship.write` | `read_merchant_managed_fulfillment_orders` + `write_merchant_managed_fulfillment_orders` | 只处理商家自管地点的 Shopify Fulfillment Order；运单号可由 ERP 人工录入或后续物流接口取得，再由本闭环回传 Shopify。只允许已交运且未冲销的包裹；跨地点失败关闭；持久化发布状态、幂等键和安全审计，不确定结果重试前先按运单号与明细核对 Shopify |
| 拒付查看 | `orders.dispute.read` | `read_shopify_payments_disputes` | 分页读取拒付金额、状态、类型、原因、订单、时间和处理截止日；不读取证据，重复或无效平台标识失败关闭 |
| 退货/RMA 查看 | `orders.read` | `read_orders` + `read_returns` | 按订单分页读取退货状态、时间、退货商品、数量与原因；不返回客户备注或地址等额外 PII；缺少 scope、重复标识、数量不一致或嵌套分页截断时失败关闭 |
| 客户档案查询 | `orders.read` | `read_customers` | 实时读取当前店铺客户的最小业务字段，并记录不含查询词、邮箱或手机号的受保护数据访问审计 |
| 退货决定与退款 | `orders.write` | `write_returns`（包含对应读取能力）+ `write_orders`（包含订单读取能力） | 批准/拒绝请求；退款必须先取得短期预览并明确确认，平台结果同步回 ERP |

店铺详情页会展示 Xinzhi ERP App 的 Shopify scope 覆盖情况：已授予、待申请、缺失数量，以及缺失 scope 明细。商品/订单拉取入口在前端预检 `read_products` / `read_orders`，后端也会再次检查连接状态和 scope 覆盖，返回 `shopify_authorization_conflict` 与 `details.reason/scope` 供前端安全提示使用。

## 当前内部接口

ERP Java 与 customer-service 到独立 Go connector runtime 的调用只允许走内部 connector API，并携带 `XZ_ERP_CONNECTOR_TOKEN` / `ERP_XZ_ERP_APP_CONNECTOR_TOKEN` 对应的服务令牌。connector 必须作为可独立启动、重启和部署的进程或容器运行；不得把 customer-service 同一进程内的 package 调用宣称为 token 所有权隔离。

当前代码已提供独立 runtime 的 installation v1 基础，包括 OAuth start/callback、安装探测、撤销、加密 connector-owned 文件仓库和 legacy→canonical 唯一绑定。连接探测、六条 ERP 只读路由以及 InventorySet、DisputeEvidence、FulfillmentPublish 三条写路由已经切换；历史安装真实迁移、旧 callback、Customer/Support 查询和订单编辑/取消等其余 customer-service 业务读写路径仍属于待迁移偏差，不得描述为 token ownership 已完成。

当前另提供一次性 `cmd/shopify-connector-migrate` 历史安装迁移工具：它只从明确配置的旧 FileStore 稳定快照或 PostgreSQL 只读一致快照直接导入 connector-owned 仓库，非空整批预检后以跨进程文件锁和持久化 generation/CAS 完成单次原子提交，空源、并发写入或陈旧进程写入均失败关闭，且输出仅含状态与计数。代码与合成测试就绪不表示真实迁移已运行；访问真实旧库、快照、凭据或密钥仍需用户另行明确授权。该工具不删除旧数据、不切换旧 callback，也不替换现有 customer-service 业务读写路径，因此 token ownership 仍未完成迁移。

连接探测已按 `shopify.connector.connection.v3` 垂直切换：独立 runtime 只根据 connector-owned repository 返回 canonical tenant/shop、`CONNECTED` / `DISCONNECTED` / `NOT_CONFIGURED`、规范化 granted scopes、本次 repository probe 时间，以及 OAuth 完成时由 Shopify Admin API 校验过的店铺名称和 `myshopify.com` 域名。该状态不代表刚刚连通 Shopify Admin API，也不包含客服聊天组件的 theme embed 状态。ERP Java 仍调用 customer-service 的统一 base URL，由 customer-service 经 `XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL` 转发已迁移路由到独立 runtime；目标必须为 HTTPS 或 loopback HTTP，且缺失配置、递归目标、HTTP/解码/identity/版本异常均失败关闭，不回退读取旧 token。其他 Shopify 业务路由仍待逐族迁移。

ProductCatalog 已按 `shopify.connector.product-catalog.v1` 完成只读垂直切换：独立 runtime 从 connector-owned repository 解析 canonical installation、credential 与 `read_products` scope，在 connector 边界内调用 Shopify Admin API；customer-service 只通过与 connection 共用的受认证 typed HTTP client 转发。商品与变体只返回白名单 DTO，变体连接完整分页；缺失/重复游标、父商品消失、版本/身份/状态/响应形状异常或 provider 失败均失败关闭，不回退 customer-service 的旧 token。该段只说明 ProductCatalog 边界；整体 ownership 完成状态以本节当前汇总为准。

OrderCatalog 已按 `shopify.connector.order_catalog.v1` 完成只读垂直切换：独立 runtime 从 connector-owned repository 解析 canonical installation、credential 与 `read_orders` scope；外层订单保持游标分页，每张订单的 lineItems 完整续页，空/重复游标、父订单消失或续页失败均失败关闭。Shopify `Order.fulfillments` 继续用第 11 条超限探针，超过既定 10 条安全上限即拒绝返回，不静默截断。customer-service 仍只复用同一受认证 typed HTTP client 转发并严格核对版本、canonical identity、state 与白名单响应形状；SupportOrderSearch/customer.lastOrder 与订单编辑/取消仍待后续独立迁移，因此 token ownership 仍未完成。

剩余 ERP Shopify 只读数据面也已垂直切换：ReturnCatalog、LocationCatalog、InventoryLevel read 与 DisputeCatalog 由独立 runtime 使用 connector-owned installation/credential 执行，customer-service 只复用同一受认证 typed HTTP client 转发。ReturnCatalog 完整续读订单内 returns 与每个 return 的 line items；LocationCatalog、InventoryLevel 和 DisputeCatalog 保持原白名单与精确 scope 门禁。配置、identity、版本、state、游标、响应形状或 provider 异常均失败关闭，不回退 customer-service token。Customer、Support 搜索、订单编辑/取消 mutation、旧 callback 与旧 token 存储仍未迁移，因此 token ownership 仍未完成。

| 方法 | 路径 | 用途 | 备注 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/shopify-connector/installations/oauth/start` | 为 canonical tenant/shop 与唯一 legacy shop 绑定创建一次性 OAuth grant | 内部服务令牌；返回 connector 浏览器入口，不接收或返回 provider token |
| `GET` | `/shopify/oauth/authorize` | 将一次性 grant 绑定到发起浏览器后跳转 Shopify | 不携带服务令牌；Secure/HttpOnly/SameSite cookie，不接受跨浏览器复用 |
| `GET` | `/shopify/oauth/callback` | 在独立 connector runtime 内验证 Shopify HMAC/state/浏览器绑定、消费 grant、交换并保存 token | 公开 provider callback；重放失败关闭；错误固定去敏 |
| `POST` | `/api/v1/shopify-connector/installations/probe` | 查询 connector-owned 安装状态与已授予 scopes | 内部服务令牌；只返回白名单元数据 |
| `POST` | `/api/v1/shopify-connector/installations/revoke` | 幂等撤销安装并确认 customer-service source/cache 副作用 | token 先不可用；副作用失败可安全重试 |
| `POST` | `/api/v1/erp-connector/shopify/connection` | 查询 connector-owned canonical Shopify 安装连接状态与已验证店铺身份（connection.v3） | 独立 runtime 持有事实；customer-service 仅认证转发；不代表实时 Admin API 或 theme embed 就绪 |
| `POST` | `/api/v1/erp-connector/shopify/product-catalog` | 分页读取 Shopify 商品/变体/SKU | 独立 runtime；要求 `read_products`；变体完整游标分页，customer-service 仅认证转发 |
| `POST` | `/api/v1/erp-connector/shopify/order-catalog` | 分页读取 Shopify 订单、行项目、金额、地址、履约摘要 | 独立 runtime；要求 `read_orders`；lineItems 完整游标分页，fulfillments 超限探针；customer-service 仅认证转发 |
| `POST` | `/api/v1/erp-connector/shopify/location-catalog` | 读取 Shopify 地点并供 ERP 仓库建立唯一映射 | 独立 runtime；只读；要求 `read_locations`；重复地点标识失败关闭 |
| `POST` | `/api/v1/erp-connector/shopify/inventory-level` | 读取指定库存项在指定地点的可用库存 | 独立 runtime；要求 `read_inventory` 与 `read_locations`；只返回白名单库存字段 |
| `POST` | `/api/v1/erp-connector/shopify/inventory-set` | 将指定库存项在指定地点的可用库存设为目标值 | 独立 runtime；要求 `write_inventory` 与 `read_locations`；保留比较前当前值、provider 幂等键和冲突/未知结果安全映射；customer-service 仅认证转发 |
| `POST` | `/api/v1/erp-connector/shopify/order-shipping-address` | 修改已映射 Shopify 订单的收货地址 | 要求有效店铺映射、安装 token 和 `write_orders`；失败输出固定安全错误 |
| `POST` | `/api/v1/erp-connector/shopify/order-edit-quantity` | 修改已映射 Shopify 订单商品行数量 | 要求 `read_orders`、`read_order_edits`、`write_order_edits`；精确核对订单行、变体和旧数量，提交后回传最新总额；失败输出固定安全错误 |
| `POST` | `/api/v1/erp-connector/shopify/order-add-variant` | 向已映射 Shopify 订单新增商品变体 | 要求 `read_orders`、`read_order_edits`、`write_order_edits`；拒绝普通重复变体，仅在同一不确定幂等命令重试时核对并恢复，提交后回传新行和最新总额 |
| `POST` | `/api/v1/erp-connector/shopify/order-line-discount` | 为已映射 Shopify 商品行新增折扣 | 要求 `read_orders`、`read_order_edits`、`write_order_edits`；固定金额和百分比严格互斥，核对当前折扣总额与唯一手工折扣分配，提交后回传最新折扣总额和订单总额 |
| `POST` | `/api/v1/erp-connector/shopify/order-cancel` | 取消已映射 Shopify 订单 | 要求 `read_orders`、`write_orders`；不可逆，精确核对取消原因、时间和带幂等键的员工备注，provider 原始错误不外泄 |
| `POST` | `/api/v1/erp-connector/shopify/fulfillment-publish` | 将 ERP 已交运包裹发布为 Shopify fulfillment | 独立 runtime 使用 connector-owned installation/credential；要求同类履约读取/写入 scope；完整续读履约单和明细，拒绝截断数据、跨地点包裹和重复运单冲突；customer-service 仅认证转发，provider 原始错误不外泄 |
| `POST` | `/api/v1/erp-connector/shopify/dispute-catalog` | 分页读取 Shopify Payments 拒付元数据 | 独立 runtime；只要求 `read_shopify_payments_disputes`；只返回白名单元数据，不返回证据 |
| `POST` | `/api/v1/erp-connector/shopify/return-catalog` | 按订单分页读取 Shopify 退货与商品明细 | 独立 runtime；要求 `read_orders` 与 `read_returns`；完整续读所有嵌套页 |
| `POST` | `/api/v1/erp-connector/shopify/customer-catalog` | 分页查询 Shopify 客户档案与最近订单摘要 | 独立 runtime；要求 `read_customers` 与受保护客户数据批准；只返回白名单字段并记录最小化访问审计 |

目录接口采用失败关闭的完整性规则：

- 商品页内单个商品如果超过 100 个变体，独立 connector runtime 会继续读取全部变体续页；缺失/重复游标、父商品消失或续页错误时拒绝返回该页，不向 ERP 提供截断数据。
- 订单页内单张订单如果超过 100 个行项目，独立 connector runtime 会继续读取全部 lineItems 续页；缺失/重复游标、父订单消失或续页错误时拒绝返回该页。
- Shopify 的订单 `fulfillments` 字段是可截断数组而不是游标连接；connector 实际请求 11 条，仅允许最多 10 条，出现第 11 条即拒绝返回该页。
- 退货目录以 Shopify 订单连接为外层分页游标；独立 runtime 会继续读取每张订单的全部 returns 与每个 return 的全部商品明细。空/重复游标、父对象消失或续页错误时拒绝整个请求，避免静默丢失 RMA 数据。
- 上述错误统一经过 connector 安全映射，不向 ERP 或浏览器返回 Shopify provider 原始错误内容。

Java 侧运行模式：

- `erp.channel-connector.mode=fake`：本地确定性假数据。
- `erp.channel-connector.mode=xz-erp-app`：通过内部 HTTP 调用统一 Go connector。
- `ERP_XZ_ERP_APP_CONNECTOR_BASE_URL` 必须是 HTTPS，或仅限本地 loopback HTTP。
- 至少一个 ERP 实例必须设置 `ERP_INVENTORY_PUBLICATION_WORKER_ENABLED=true`，
  才会处理已入队的 Shopify 库存发布命令；多实例通过数据库行锁和租约安全竞争，
  不得在没有内部 connector 服务令牌的实例上启用。

## 公共 App 页面与合规回调

代码已经提供以下公开页面：

| 路径 | 用途 |
| --- | --- |
| `/shopify/xz-erp` | Xinzhi ERP App 介绍与当前真实能力 |
| `/shopify/xz-erp/guide` | 安装、授权、商品和订单导入说明 |
| `/shopify/xz-erp/privacy` | 隐私政策 |
| `/shopify/xz-erp/data-deletion` | 客户/店铺数据访问与删除说明 |
| `/shopify/xz-erp/support` | 支持联系方式与常见问题 |

公开页面不会使用虚构主体或占位邮箱。部署时必须提供真实的 `XZ_ERP_LEGAL_NAME`、`XZ_ERP_SUPPORT_EMAIL` 和 `XZ_ERP_PRIVACY_EFFECTIVE_DATE`；缺少或格式错误时页面固定返回 503，阻止以无效材料送审。

`shopify.app.toml.example` 已通过 App-specific subscriptions 配置：

- `app/uninstalled` → `/webhooks/shopify/app/uninstalled`
- `customers/data_request`、`customers/redact`、`shop/redact` → `/webhooks/shopify/compliance`

合规入口只接受 JSON POST，先验证 Shopify HMAC，再验证 topic 与店铺域名。有效请求按 `X-Shopify-Webhook-Id` 去重，且不保存 webhook 中的客户邮箱和电话；已安装店铺的请求会生成只分配给有效系统管理员的内部紧急隐私任务。没有可用管理员时返回 503 让 Shopify 重试，未知且本地无数据的店铺安全确认接收但不创建含个人数据的记录。

## Shopify scope 申请意图

`platform/customer-service/shopify.app.toml.example` 当前按“Shopify 集成一次申请、最小必要”的方向配置 10 个目标 scopes。仅在 Shopify 明确由写 scope 提供对应读取能力时省略 read scope。审核材料必须按外部 ERP 的真实功能逐项说明用途。

其中 `read_all_orders` 已于 2026-08-17 在 Dev Dashboard 获批。Shopify Support 已确认 App ID `407894786049` 因 Partner 组织未满一年而不符合 `read_shopify_payments_dispute_evidences` 与 `write_shopify_payments_dispute_evidences` 的资格；当前版本明确排除这两项权限及全部证据读写功能和声明。这 10 项是最终当前版本边界，不是 fallback。

| scope | 用途意图 |
| --- | --- |
| `read_products` | 商品/变体读取与 ERP SKU 匹配 |
| `read_customers` | 客户档案、履约和售后识别；不用于营销 |
| `read_locations` | Shopify 地点读取与 ERP 仓库映射 |
| `read_shopify_payments_disputes` | 拒付列表、状态、类型、原因、金额、订单、时间与处理截止日；不含证据 |
| `write_inventory` | 库存读取与受控发布 |
| `write_orders` | 订单读取/导入、地址维护与取消 |
| `write_order_edits` | 订单行、数量、自定义金额和折扣编辑 |
| `write_merchant_managed_fulfillment_orders` | 商家自管履约单读取、发货和运单回传 |
| `write_returns` | 退货读取、决定与退款处理 |

## 审核前必须补齐

1. 公开页面部署：
   - 代码路由已实现；
   - 配置真实主体、营业地址、支持/隐私邮箱、隐私生效日期、处理区域、子处理商、传输保障、运营/备份保留、删除流程和隐私负责人；
   - 部署到 Partner Dashboard 使用的 HTTPS 域名；
   - 检查外网可访问性和最终法律文本。
2. Shopify Partner Dashboard 材料：
   - App 名称、图标、截图；
   - 明确功能描述；
   - 定价为免费；
   - 测试账号和测试店铺；
   - 每个敏感 scope 的用途解释。
3. 演示视频：
   - 安装 Xinzhi ERP；
   - 店铺授权；
   - ERP 内查看连接状态；
   - 拉取商品并按 SKU 匹配导入；
   - 拉取订单预览，并导入 ERP 本地订单；
   - 在履约开始前修改 Shopify 订单收货地址，并展示 ERP 同步结果；
   - 在履约开始前修改 Shopify 商品数量，展示补回库存、客户通知选项和 Shopify 最新订单总额同步结果；
   - 在履约开始前从当前店铺活动 Listing 新增一个订单内尚不存在的 Shopify 变体，并展示客户通知、最新订单行和总额同步结果；
   - 在履约开始前为商品行新增固定金额或百分比折扣，展示明确确认、折扣分配和 Shopify 最新总额同步结果；审核员使用的 Shopify 后台账号需具备应用订单折扣权限；
   - 取消一张尚未履约的测试订单，展示原路退款、库存回补、买家通知选项与不可逆确认；刷新 Shopify Admin 和 ERP 后展示一致的取消状态；
   - 完成 ERP 包裹称重交运，回传 Shopify 发货与运单，并展示成功状态；
   - 演示一次不确定结果的“核对并重试”安全恢复说明；
   - 打开客户档案，按姓名/邮箱/手机号查询并跳转最近订单；
   - 打开退货与退款，展示退货决定、退款预览和明确确认后的处理结果；
   - 打开拒付管理，只展示金额、状态、类型、原因、订单、时间和处理截止日；
   - 明确说明当前版本不读取、编辑、上传、保存或提交证据，全部证据处理均在 Shopify Admin 完成；
   - 在 Shopify 内嵌 ERP 展示店铺客服插件状态和官方主题编辑器启用入口；在店铺前台发送一条合成测试消息，通过 ERP 统一登录明确跳转到独立客服工作台回复，再回到店铺确认送达。只展示这一条插件会话闭环，不展示无关邮箱、工单、路由、坐席管理或第二次 Shopify 授权。
4. 其余写权限能力上线前的工程门槛：
   - ERP command API；
   - 权限点；
   - 状态机；
   - 幂等键；
   - 审计日志；
   - 失败回滚/重试规则；
   - 非生产测试覆盖。

## 当前验证证据

- customer-service Go：历史全量 15 个 package、645 项测试通过，包含订单新增商品、自定义金额、数量编辑、商品行折扣、订单取消、发货回传、拒付目录、目录完整性和 Shopify 公共页面；本轮精确十项权限边界必须重新运行并单独记录结果。
- frontend：`npm.cmd run typecheck` 通过。
- Shopify 退货/RMA 增量验证：Go connector 全量 package 通过；Java connector/服务相关 23 项测试通过；前端新增 2 个测试文件、4 项测试通过，资源争用超时的 4 个既有文件已串行复跑 136 项全部通过。
- frontend：全量运行 112 个测试文件、812 项测试，全部通过；覆盖订单编辑、商品行折扣与订单取消、Shopify 库存预检/发布、最近任务恢复、输入与响应身份失败关闭、独立权限、首页工作台、供应链、财务、销售/商品/店铺报表，以及设置任务公告、通用参数和系统设置只读入口。
- 供应链采购增量：`procurement.read` / `procurement.write` 独立权限下的手工采购计划创建、分页筛选、详情与未采购计划作废已接入；计划详情可带计划编号进入采购单创建或查询，生成采购单时自动选中精确匹配的来源计划，再从该 SKU 既有的有效供应商供货关系中选择供应商，并保存计划、供应商、SKU、仓库和库位快照；计划、SKU、仓库、库位、采购单和供应商候选均校验分页请求身份并拒绝同页重复业务 ID，多页仓库、库位和供应商候选合并还校验分页快照、最终数量与跨页唯一性，并发导致计划或供货关系失效时会撤销旧选择并刷新相应数据。采购单可按收货状态筛选并以受校验的采购单 ID 直达详情，详情可通过采购单 ID 直接打开可刷新恢复的签收入库工作区及该单已有流水，签收工作台和采购流水也可返回同一张采购单；签收工作台默认只分页读取待收货和部分收货订单，全部收货后移出默认队列并补位刷新，按单号搜索时仍保留已完成历史。分批签收不超过剩余数量，每次写入库存事件并累计到货状态；并发签收冲突后会重新读取最新采购单和收货记录，无法恢复时关闭旧表单并刷新队列。智能计算、采购审核、价格与付款、质检、退货、1688、供应商写入和财务能力未进入该合同。
- 供应商授权增量：1688 账号授权的 8 列结构和淘供销账号授权的 6 列结构已分别纳入 `suppliers.read`；添加授权、第三方 OAuth、真实账号与令牌读取继续失败关闭，两类授权不共用数据合同。
- 供应商合同增量：合同管理已固化模板名称/供应商两类只读搜索入口；合同模板、签署、审批、文件、金额和删除继续失败关闭。
- 供应商 KPI 增量：供应商 KPI 已固化日期区间、供应商批量查询入口和 11 个归档结果字段；指标公式、评级、奖惩、历史数据读取和导出继续失败关闭。
- 供应商质量报表增量：供应商质量报表已作为独立 `suppliers.read` 入口接入；归档未证明的筛选项、结果列、质量公式、明细和导出没有借用 KPI 合同或模拟数据补齐。
- 供应商对账增量：供应商对账已作为独立 `suppliers.read` 入口接入；归档未证明的筛选、金额、账期、核销、付款、审核和差异处理没有借用采购财务处理合同补齐。
- 采购员绩效增量：采购员绩效已固化天/月粒度、日期区间、采购员入口和 16 个归档结果字段；采购员选项、指标公式、历史数据和导出继续失败关闭。
- 采购流水增量：采购流水已接入真实收货记录、采购单快照和对应库存事件，支持日期区间、采购单号/计划号、供应商关键字和三种排序维度；签收入库可分页查看本单全部分批收货记录、独立重试失败读取并按该采购单进入流水核对，错页、重复收货 ID 或跨采购单记录继续失败关闭。金额、质检结论与导出没有数据合同，继续失败关闭。
- 财务银行账号增量：财务模块已建立独立 `finance.read` 导航，银行账号页固化账户名称和日期区间查询；账号详情、余额、金融凭据、账户日志和导出继续失败关闭。
- 财务收付款单增量：收/付款单已固化费用单、付款单、收款单三页签及关键字、日期和本人创建筛选；创建、审核、批处理、导入导出与未确认结果列继续失败关闭。
- 财务 PayPal 账号增量：账号管理已固化账号/账号别名查询入口；真实 PayPal 连接、凭据、授权、余额、新增账号、新增 case 与未确认结果列继续失败关闭，且不计入 Shopify App 权限申请范围。
- 财务 PayPal 管理增量：余额查询、eBay 账号修改和退款审核已接入独立只读入口；退款五种状态、订单编号筛选及 14 个归档结果字段已固化，余额导出、账号修改任务、退款新增/审批/批处理/平台操作全部失败关闭，且均不扩大 Shopify App scope。
- 财务 PayPal 管理补全：PayPal Case 已固化七种归档搜索方式，自动上传运单号已固化 paypal账号/平台/店铺三列；同步、导出与上传均失败关闭。PayPal注册因归档未进入外部域，仅提供明确不可用状态，不执行跳转或代填资料。
- 财务连连收款增量：账户管理保留美国/美元、日本/日元、欧洲/欧元、英国/英镑四个归档入口但不发起授权；交易查询已固化金额与日期筛选及七个结果字段，不使用马帮 client_id、回调地址或模拟金融数据。
- 财务 Payoneer 收款增量：账户管理、银行证明、提前放款已按归档统一接入注册邮箱查询；绑定账号、待审核、已审核、金融凭据与真实状态均失败关闭，未从三个结构相同的空态页面反推独立业务规则。
- 财务 WorldFirst 增量：账户管理已固化昵称查询，交易查询已固化起止日期；未授权入口、真实账号、交易结果列、币种、金额精度和同步全部失败关闭，归档残缺空态文本未直接进入产品界面。
- 报表费用管理增量：报表模块已建立独立 `analytics.read` 导航；“费用管理(新)”固化开始/结束日期、备注筛选和 10 个归档结果字段，两处未取证下拉、金额口径、排序分页、新增、导入、删除与配置动作全部失败关闭。
- 报表财务报告补全：利润报表(新)已固化 15 个平台、5 个视图、时间区间及 48 个归档字段；Amazon 按归档提示失败关闭，不跳转专业版。业务配置(新)固化费用名称查询与 6 个字段，大量未标注下拉未被猜作筛选或编辑规则；旧版、任务中心、恢复默认和全部金额/分摊口径均失败关闭。财务报告 3 个复刻入口已全部覆盖。
- 报表销售报告增量：收支报表、营业额报表和订单状态报表已按归档顺序接入；营业额固化天/月、日期及 16 个字段，订单状态固化日期及 8 个字段，收支报表因列结构未取证不借用其他报表字段。平台等未展开筛选、指标口径、设置、详情、历史跳转与导出全部失败关闭。
- 报表销售报告补充：退款报表已固化日期与 10 个结果字段；商品销量报表已固化日期、SKU 关键字与 39 个归档字段。店铺、平台、人员、目录、品牌、状态等未展开筛选，退款率、成本、毛利、精确搜索、历史数据、详情与导出继续失败关闭。
- 报表销售报告补全：Listing、库存与组合实时销量已分别固化时间区间、关键字及 14/22/14 个结果字段；Listing 保留 8 个归档平台页签，三类结果合同不合并。订单分析因无筛选、图表和表格证据仅提供明确空态；实时口径、快捷时间标签、下拉选项和导出均失败关闭。销售报告 9 个复刻入口已全部覆盖。
- 报表商品与店铺报告补全：进销存报表-新、库龄分析、海外仓库存对账分别固化 11/15/8 个字段，且与商品中心已有入口保持独立合同；店铺健康New 固化 7 个平台页签与 25 个指标字段。功能开启、立即对账、设置、导出、仓库/品牌/站点选项、库存金额、库龄、快照和经营指标口径全部失败关闭。报表模块 16 个复刻入口已全部覆盖，客服与 6 个 Amazon 专项入口继续按归档暂缓。
- 设置任务公告增量：新增独立 `settings.read` 权限；审核单据、任务列表、消息中心、导入/导出任务、附件下载、任务中心和内部公告 7 个入口已按归档固化。已取证页签、筛选和 7/3/10/8 列表字段保留；归档未取得列结构的三个页面明确空态失败关闭，审核、创建、删除、标记已读、文件下载、重算和后台任务执行均不开放。
- 设置通用参数增量：别名管理、订单异常分类处理配置、订单发货期限设置、审批规则设置、汇率管理和地址映射配置 6 个入口已固化；13/8/7/6 个已取证列表字段及可安全查询条件保留。别名导入与编辑、异常分类保存、发货期限写入、审批规则新增、汇率编辑/日志和地址转换全部失败关闭；速卖通买家自选物流优先级属于未批准平台专项，不进入 Shopify-only 产品导航。
- 设置系统配置增量：任务管理、系统设置、企业信息和员工列表 4 个入口已补齐。任务管理固化 4 种搜索字段、6 种状态、2 种紧急程度及 11 个列表字段；系统设置和企业信息仅呈现归档已确认字段，所有配置、保存、Logo 与水印写入失败关闭；员工列表直接复用现有 IAM 的员工、角色、权限与审计合同，不另建身份模型。Amazon、FBA、速卖通、Lazada、1688 与巴西 NFe 专项入口均未进入当前 Shopify-only 导航。
- 首页工作台增量：在既有真实订单摘要和按权限常用入口之上，补齐待办事项、商品看板、店铺状态和公告四个归档分区；待审核/待履约使用现有订单摘要合同，热销/滞销固化 5 个已取证字段，Shopify 店铺中心与内部公告使用现有安全路由。采购、财务、店铺聚合计数、商品排行和公告正文没有正式合同，统一显示“—”或明确空态，不使用马帮动态值或模拟数据。
- backend Java：既有 V62 基线全量 600 项测试通过，0 失败、0 错误、0 跳过；V63–V67 增量中的租户管理员权限单元测试与 PostgreSQL 16 架构漂移门禁共 4 项测试通过。全量回归仍沿用既有基线，不把本次定向验证表述为新的全量证据。
- repository gates：API 契约 225 个 endpoint / 112 个 request schema、审计覆盖 143 个写接口均通过；相关脚本测试通过。
- PostgreSQL 16 / Flyway：空库 V1→V113 已在隔离 PostgreSQL 16 应用并校验 87 个迁移；本轮另验证了 Shopify 隐私请求导出、个人信息匿名化、交易事实保留和幂等重试。
- Shopify 目录完整性：商品变体、订单行项目和履约列表的嵌套截断均有失败关闭测试。
- Shopify embedded session：App 配置错误和 token exchange provider 错误均返回固定安全错误，不回显内部异常、环境变量名或 token 内容。
- Shopify 合规请求：三个必需主题、HMAC 401、交付去重、PII 最小化和无隐私负责人时重试均有测试；ERP 侧另有管理员操作、严格确认及 PostgreSQL 16 导出/脱敏/幂等验证。
- Shopify 公共页面：五个公开页面、必填部署配置、语义结构和安全响应头均有测试。
- diff 检查：`git diff --check` 通过，仅有 Windows CRLF 提示。

## 不得绕过的边界

- 不得让 ERP Java 直接保存 Shopify token。
- 不得让 ERP 和客服各自维护一套 Shopify connector。
- 不得把旧客服用户 session、cookie 或 provider token 转发给 ERP。
- 不得把尚未完成的退货创建/审批/退款/入库写回或拒付附件上传描述成已完成能力；订单行折扣仅按当前已实现的“商品行新增固定金额或百分比折扣”范围展示。
- 不得绕过已经落地的履约/拒付状态机、幂等记录和安全审计直接调用 Shopify 写接口。

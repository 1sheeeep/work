# 库存命令与双来源：本地接入准备

2026-09-07。**PREPARATION_ONLY / NOT_MOUNTED / NO_GO**。

## 已闭合的本地库存切片

InventoryCommandPreparation 显式构造，没有 Bean、HTTP 路由、后台任务或自动 SQL。两业务必须使用同一个 PostgreSQL 持久日志；现有 Worker、SaaS 生产入口及原客服业务路径均未替换。

- 下发前独立事务提交完整非敏感意图、操作者、摘要、幂等键、原来源和版本。预先记为 UNKNOWN，超时、断网、落库失败不重发、不换来源、不按时间清除。
- 命令/幂等键跨进程唯一；同一库存项与地点存在未决命令时拒绝新写。原来源发请求前消费唯一 claim，重新核验原业务人员权限和店铺范围。服务 Token 不是用户授权。
- ERP 使用既有 ERP 人员权限；仅客服人员使用原客服 ID 和独立客服授权回调，不需要先创建 ERP 席位、不把客服 ID 伪造成 ERP UUID。日志分别保存业务来源及原操作人，不回写历史。
- 回放只能取得原来源回执；切换后、重启后仍如此。明确匹配的成功/业务拒绝才终结，其余保持 UNKNOWN。
- 核对通过原来源的持久命令回执，并原子记录核对人、来源、版本和结果。不提供强制成功、忽略未知或按当前库存猜测命令成功的接口；原来源无可靠回执时持续阻塞。
- 冻结拒绝新命令，允许原在途命令 claim/记录回执。激活候选要求本地未决数为零、外部未决数为零、同一 Shopify Shop ID、有效库存实际 scopes、最近核验/同步检查点、两业务冻结版本一致、原插件保留。
- 此路由只属于库存演练，不代表整个店铺所有操作已经共用生产切换锁。核验回调必须来自可信所有者，不能接浏览器声明。

SQL 为 platform/preparation/sql/inventory-command-journal.sql，只在独占合成库显式执行，不在 Flyway 目录。

## 实际服务适配证据

Java 测试通过 loopback HTTP 启动独立 Go 进程；Go 调用任一来源前向同一 Java/PostgreSQL 日志取得一次性 claim。

- 店铺来源：新增未挂载的 NewERPStoreAppInventoryPreparationHandler，复用所有者原生 store、安装核验及现有 Admin API client。Token 留在所有者；缺 scope、错误 Shop ID、重复 claim、版本错误都拒绝。
- SaaS 来源：合成启动器使用既有 installations.Service.SetInventoryAvailable，不复制另一端凭据。
- 上游：两来源使用真正的 GraphQL 序列化/解析器，最后一跳是**无网络 socket 的合成 Shopify Transport**。测试断言现行 changeFromQuantity、幂等键和各自所有者 Token，旧 compareQuantity 字段不被接受。新增显式 NewPreparationBudgetedHTTPClient 在每次实际 Transport 调用前请求同一 Java/PostgreSQL 预算，缺预算不调用上游，不跟随重定向、不重试或退还未知成本。
- 流程：ERP 发店铺来源库存命令 → 冻结并核验 → 仅客服人员通过 SaaS 来源发命令 → 回放原命令不再写 → 模拟已生效后丢回复 → 重建对象仍 UNKNOWN，切换/回退被阻止。
- 固定原生 5f8a1f3 导出副本也通过真实 PostgreSQL 所有者适配检查，前后全部业务表摘要不变。

这比内存写入器检查多了一条实际 Java → Go → 既有客户端链路，但**不是实际 Shopify 写入或两套生产服务已接入**。完整计数与精确产物见 DEV_STATE 和原生准备说明。

## 共享预算与事件候选

ShopifyCoordinationPreparation 与 shopify-coordination.sql 同样没有运行时挂载：

- 同企业/店铺/App 共用持久预算、并发锁与客服前台预留；ERP 后台不能占用预留。过期/缺失观测拒绝，未知回复不退款，反馈只能降低余额，不能由乱序回复抬高余额。
- 所有者先验签，候选只处理白名单业务事件。投递去重与跨应用资源版本去重分层；投影、版本和回执同事务，失败全部回滚；乱序不倒退、同版本不同内容隔离。
- 订单/商品主题匹配资源类型；库存使用库存项和地点组合身份。事件提交与检查点检查串行，未完成分页或存在冲突不推进检查点。
- 隐私、卸载、撤权仍属于各应用原有处理器，不能因当前业务来源不同而丢弃。

库存隔离链路已把两来源的实际客户端接到同一持久预算：店铺来源两次请求、SaaS 两次请求共四次成功预留，另一次预算不足在 Transport 前拒绝。优先级从原命令业务身份核验，ERP 使用店铺来源仍为后台，客服使用 SaaS 仍为前台；未 claim、错来源、已完成命令和撤权均不得取得预算。这不是两套生产进程已经接管共同预算，也不等于 Webhook 和补拉 Worker 已接入。

预算候选保守预留单查询上限 1,000 点，不凭合成数据猜真实查询成本；测试的 10,000 点桶只是合成容量，不是生产套餐结论。真实桶容量/恢复率/查询成本尚未采集。若真实容量无法同时容纳预留与前台保护额度，应拒绝并先核验精确查询成本，不降低前台保护、猜成本或偷偷绕过预算。事件摘要须为所有者核验后的同一业务投影规范，不能直接拿两个 App 的原始 payload 散列作通用版本。

## 尚未闭合，禁止提前放行

1. 所有已批准操作的双来源适配、原有后台任务与共同入口接管；当前只闭合授权/一页订单读取及库存演练，不能把 Gateway 的全部方法自动算入已批准业务。
2. 原生/生产目标上的共同预算接管与真实成本核验、来源验证后的 Webhook 接收及实际增量补拉/冲突核对；本地库存 Transport 接线已验证，不覆盖其他既有调用路径。
3. 正式原来源命令回执服务、双业务冻结确认与授权证据采集；当前相关回调由合成测试提供。
4. 真实浏览器完整登录、原生聊天/邮件完整交互、生产版本和真实数据核验。

这些是明确缺口，不是测试豁免。正式接入、生产服务、真实店铺和账号均等待用户另行命令。

## 官方机制依据

[Shopify 当前库存 CAS 字段](https://shopify.dev/changelog/finalizing-compare-and-swap-redesign-for-inventory-set-quantities)、[API 成本限额](https://shopify.dev/docs/api/usage/limits)、[Webhook 所有者验证](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)。不自动重发库存命令，不通过来源切换绕过限额或未知结果。

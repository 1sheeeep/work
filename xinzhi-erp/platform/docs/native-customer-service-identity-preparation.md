# 原生客服接入：隔离兼容、保护与回退演练

2026-09-07。**39 表本地保护与回退通过；生产接入 NO-GO**。本页演练本身不访问原客服或生产。用户另行授权的 [生产版本/结构只读核验](native-customer-service-production-baseline-2026-09-07.md) 发现额外历史关联表；现已在独占库用虚构记录补齐该表，公共结构与已采集目录摘要一致。原客服本地项目和生产均未修改。

## 固定输入与源码边界

- 固定既有归档提交：5f8a1f3ab3a36bb194d1fe517a19bce3c2e602f2；276 文件，包含原生扩展测试资源。后续核验确认生产版本标识前缀一致；不等于已证明二进制由该精确归档可复现构建。
- 归档：platform/backend/target/native-baseline-5f8a1f3-complete/native-source.tar
- SHA-256：0cd16ab8cab966d96f13290e9c2fc2861b11ca9659c45b4f11b428661333a513
- 脚本只接受 ERP 自有目录内的该精确归档；拒绝隐式读取原项目、外部数据库和变更归档。Docker 限已核实的本机 desktop-linux，镜像禁止拉取，数据库只发布 127.0.0.1 随机端口，子进程环境白名单。
- 原生业务迁移 SQL 字节不变。仅在导出副本补身份版本/适配器、迁移账本及测试；Go 依赖复用既有 Connector 最小接口和 Admin API client，不复制 OAuth 服务或挂载生产路由。
- 原有 PostgreSQL 测试中一项旧断言从“启动修复已存储店铺范围”调整为“启动保留已存储范围”。这是明确的准备目标改变，不称原测试完全未修改。

## 已修复的本地重启阻塞

旧 OpenPostgresStore 每次重放全部 SQL：020 会为部分定制权限账号追加 routing.auto_receive，031 会重置已存储 data_scopes。事务审计仍使用未修改 SQL，稳定检测 permissions 和 data_scopes 变化并回滚，保留风险证据。

候选启动改为同一 PostgreSQL 事务/原生 advisory lock 下的迁移账本：

- 空数据库只执行并记录一次。
- 已有业务表但无账本时拒绝启动，不自动假定历史 SQL 已执行。
- 显式基线核对要求固定源码提交、迁移文件摘要和 schema catalog 摘要；记录 REVIEWED_BASELINE，不重新执行历史 DML。该内部方法不挂路由、不自动运行；schema 摘要只用于绑定人工审阅结果，不会自动证明任意生产 schema 正确。
- 已应用历史须为当前文件有序前缀；校验和漂移、历史插入/丢失、数据库比旧程序更新均拒绝。追加迁移与账本同事务。
- 实际并发 OpenPostgresStore 构造、反复启动、错误基线与校验和、未来版本拒绝均覆盖。历史范围通过直接构造独占合成库记录验证，避免原生 CreateUser 默认化掩盖风险。
- 不改变原生权限计算规则，也不通过调整真实账号使测试通过。

机制参考：[显式 Flyway baseline](https://documentation.red-gate.com/flyway/reference/commands/baseline)、[PostgreSQL 事务锁](https://www.postgresql.org/docs/16/explicit-locking.html)。这里只实现原生内嵌迁移所需最小账本，不引入生产自动迁移方案。

## 最新可核验证据

最新产物：platform/backend/target/owned-native-cs-identity-bhcZoR/receipt.json，状态 NATIVE_REHEARSAL_PASSED。productionReady=false、deploymentAllowed=false。此前 kh79X6 的 38 表回执保留，不覆盖本次 39 表结论。

- 原生平台/新增身份测试：705 个通过事件，0 失败，19 跳过；包含子测试。未启用的原生浏览器测试及单独恢复模式保留 skip 语义。
- 第二独占库 PostgreSQL 定向：19 个通过事件，0 失败/跳过。与前组重叠，不能相加成独立用例总数。
- 最新原生候选与回退副本 go vet ./internal/platform 均通过。
- 双连接凭证单次消费、重放/撤权拒绝、独立 ERP 会话、客服接待状态不变、原会话保持、新路由未挂载通过。
- 原生所有者安装/实际 scope 适配与库存 claim 检查通过，凭据未输出。
- 只读 repeatable-read 采集全部 39 个 public 表的行数/稳定摘要，包含 one_identity_links 的合成关联；身份和适配前后、移除 sidecar 前后相同。原始行不输出日志。仅新建自己的合成表，不迁入真实关联、不依赖 One 服务。
- 使用原生 PostgreSQL 消息接口写入新聊天/邮件消息，去重及历史消息保留；sending 邮件恢复为 ambiguous，不自动重发。不是实际 IMAP/SMTP/Gmail 或插件网络验收。
- 实际 pg_dump → 新库 pg_restore，39 表摘要匹配；恢复库原生构造及原会话 HTTP 200，新消息、历史关联和 ambiguous outbox 保留。
- 实际回退源码变体重新从固定归档构造，只保留迁移账本保护、不包含身份/来源适配器；针对保留新增数据的同一库启动，原会话 200、准备接口 404/405、全部业务行摘要不变。

候选源码摘要：eed47de223810114381f6fbb0d9980f8798277e3beef42f4a076dcb0d1978cec。
合成备份 SHA-256：58b8c013695fee0425b87af8c93b9b020863461e6dffd1c8e8c65f64fe2112d1。
公共目录比较：排除候选明确新增的 erp_native_preparation schema 名称后，其余 schema、扩展和公共对象全部比较；缺失/新增/变化均为 0，规范化摘要 aadb690c9402293e56291d4bde14a5daf7524bf7daba05b0264640e5ac4cb048。不是对生产业务行、ACL、运行配置或真实账户行为的验证。
专属容器及合成库由演练 finally 清理，导出源码/证据/合成备份保留。

## 回退限制与剩余验收

不能直接回退到会重放旧 SQL 的原始二进制；必须先核验“仅保留迁移安全”的回退候选。不能恢复旧数据库覆盖准备期间新增消息/订单；未知外部写入先经原来源核对。上述回退只是本机原生 store/HTTP 业务子集，不冒充生产部署回退或完整客服页面验收。

生产版本标识和结构目录已另行只读核验，39 表的公共结构与合成保护演练通过；生产账本采纳、账号/角色、真实历史保护、插件/邮箱完整网络连续性、完整双来源操作、实际浏览器仍未全部核验。本机 Docker 已按授权重启恢复，启动检查已补冷启动等待，不再是当前阻塞。复制版本替换仍为 REPLACEMENT_BLOCKED；不得以本演练通过部署复制客服覆盖原客服。

## 复跑

在 ERP 根目录：

```powershell
node --test platform/scripts/native-customer-service-identity-rehearsal.test.mjs
node platform/scripts/native-customer-service-identity-rehearsal.mjs --source-archive platform/backend/target/native-baseline-5f8a1f3-complete/native-source.tar
```

缺少已审阅归档即停止，不从线上下载备份或索取凭据。准备结果不授予生产访问、部署、账号合并或店铺切换权限。

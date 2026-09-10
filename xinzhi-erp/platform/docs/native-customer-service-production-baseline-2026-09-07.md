# 原生产客服版本与结构只读核验

状态：版本标识已核对；生产目录采集、固定空库结构差异和含历史表的 39 表合成保护/恢复/回退通过，仍 **NO-GO**。生产真实记录、ACL、运行配置及业务行为未因此核验。

## 授权与实际操作

用户“确认允许”针对仅只读核验当前生产客服版本和数据库结构，不是接入、修改或部署授权。本次读取原客服本地规则和发布脚本以确定既有 SSH 目标，使用已配置的密钥认证，未读取密钥内容、环境凭据或业务记录。未修改原客服项目、容器、配置、数据库、账号、店铺、邮件任务或 UAT。

生产数据库通过现有 PostgreSQL 容器中的 `psql -X -qAt -v ON_ERROR_STOP=1` 查询。SQL 使用 `REPEATABLE READ READ ONLY`，语句超时 5 秒、锁超时 2 秒、空闲事务超时 10 秒，以 `ROLLBACK` 结束；不调用原应用构造器、历史迁移、准备账本采纳或数据保护行扫描器。执行文本在 [目录查询](../preparation/sql/native-cs-schema-readonly.sql)。未执行生产备份、恢复、建表、写入或重启。

## 当前版本证据

核验时间：2026-09-07 18:36—18:38（Asia/Shanghai）。

| 证据 | 结果 |
| --- | --- |
| `kf.xzkj.ai/healthz` | `ok=true`，存储 `postgres/ok=true`，`green` |
| 健康接口、活动槽位状态文件、镜像 revision 标签 | `20260905T160517Z-5f8a1f3ab3a3` |
| 活动容器 | `deploy-api-green-1`，healthy；启动于 `2026-09-06T06:22:52.175250413Z` |
| 镜像 ID | `sha256:487d0d01464cb86c077f1388e63f4f7a5b1772c28f1bb57edd7287b5abc7d09c` |
| `/support-server` SHA-256 | `e2969fb4cb83753f8f97f58034c6196594aa83c90b1f863d7a6560999654beb0` |
| 旧蓝槽 | 保留且已停止，标识 `20260905T125714Z-cc5111ca2817`；未操作 |
| PostgreSQL | `16.14`，容器 healthy |

当前运行版本标识与本地固定原生源码 `5f8a1f3ab3a36bb194d1fe517a19bce3c2e602f2` 的前缀一致。上述不是源码到二进制的可复现构建证明，也不证明所有业务链路健康。没有因旧槽存在而认定它满足新的回退要求。

## 结构事实与新增保护对象

目录快照时间 `2026-09-07T10:38:34.209602+00:00`；数据库确认 `readOnly=on`、`isolation=repeatable read`。非系统 schema 仅 `public`，扩展仅 `plpgsql 1.0`。

- 39 张普通表和 1 个序列；395 个有效列、105 个表约束、119 个索引。
- 本次 public 目录查询未发现视图、物化视图、外部表、分区表、用户触发器、RLS policy 或 public 函数/过程。
- 固定源码 63 个迁移文件（包含两个不同的 `024_*`）的空库重建为 38 张表。实际逐项目录比较确认生产没有缺失或变化的已有对象，仅新增 `one_identity_links` 的 1 表、4 列、3 约束、2 索引；结果见 [结构差异](../preparation/evidence/2026-09-07-native-cs-schema-diff.json)。比较覆盖本页目录查询字段，不包含 ACL、业务行和运行配置。
- `one_identity_links` 有 `issuer`、`subject`、`user_id`、`created_at` 四列；主键 `(issuer, subject)`，唯一约束 `(issuer, user_id)`，外键 `user_id -> public.users(id) ON DELETE RESTRICT`。约束定义通过第二次只读目录查询确认。**没有读取任何关联记录，不能判断是否为空、是否仍在用或是否可退役。**
- 该历史表及其外键必须保留，后续隔离迁移/回退保护需要覆盖它。不得依据“不依赖 One”的新目标自动删除此表、绕开外键或修改原用户主键；本次不开展 One 系统工作。
- 未发现准备性 `customer_service` 或 `erp_native_preparation` schema。后续 39 表合成保护已补历史表虚构记录，不等于已读取或验证生产关联内容。

完整目录证据见 [结构快照](../preparation/evidence/2026-09-07-native-cs-production-catalog.json)。仅输出对象名称、结构类型、状态与定义摘要，不输出业务数据、ACL/角色、注释、序列当前值或函数/默认值正文。MD5 仅用于结构定义差异检测，不作安全签名。规范化结构 SHA-256 为 `aadb690c9402293e56291d4bde14a5daf7524bf7daba05b0264640e5ac4cb048`。

## 本地工具验证与恢复

新增 `native-cs-schema-baseline-rehearsal.mjs` 只接受固定 ERP 自有源码归档，校验 SHA-256 后在本机 Docker 的断网、独占空库重建结构；不接受生产地址或额外参数、不下载镜像、不使用真实凭据。比较器区分缺失、新增和变化对象，即使完全一致也不会给予上线许可。6 项 Node 测试通过，额外生产参数拒绝通过，`git diff --check` 通过。

用户随后明确允许重启本机 Docker Desktop，已执行官方 `docker desktop restart --timeout 50`，未重启生产、未执行 WSL 全局 shutdown、未清空数据或恢复出厂。冷启动时 containerd 实际耗时约 126 秒，引擎继续恢复容器后成为 running，Server 29.6.2。不能把冷启动中单次健康超时当作元数据损坏；未修改任何 Docker 元数据。官方重启和清空数据是不同操作，参考 [Docker 排障说明](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/)。

首次重启后未发现前序专用标签遗留。随后一次冷启动中的 run 请求超时，但容器稍后才创建；以创建前记录的唯一名称、标签和时间确认后，仅删除该 Created 状态合成容器 `6a3c996477428c88a2764ed3b1c16a901813b34a80c440c477f4d9d23b5b6c69`，没有项目数据。脚本现记录迟到创建待复核状态，不把暂时查无容器当作已确定清理。

固定空库重建两次通过，最新目录 `platform/backend/target/owned-native-schema-Le33v3`；原始差异证据使用前一次 yzJTqx，两次结构摘要一致。修订后的工具只等待 TCP 正式服务器，冷启动等待有 90 秒上限，拒绝临时 Unix 初始化服务器。39 表演练 `platform/backend/target/owned-native-cs-identity-bhcZoR/receipt.json` 为 NATIVE_REHEARSAL_PASSED：705 通过事件/0 失败/19 跳过，另 PostgreSQL 19 通过/0 跳过（重叠不相加），39 表备份恢复/回退通过，两份源码 Go vet 通过。已检查两类专属容器无遗留，合成源码/证据/备份保留。详情见 [原生演练](native-customer-service-identity-preparation.md)。

## 下一步与仍然禁止的动作

1. 本机恢复、空库比较及历史表合成保护已完成；不为追求“匹配”修改生产结构，不把合成数据保护替代生产核对。
2. 来源事件/补拉需要沿用原应用验签、安装归属、有效授权和原队列，不能凭结构目录或默认 scope 推断这些运行事实。用户后续另行授权的登录/权限/已保存安装授权摘要核验已经完成，详见 [授权摘要核验](native-customer-service-access-review-2026-09-07.md)；没有实时验权或扩大为业务内容查询。
3. 继续此前未完成的全批准操作共同入口、来源事件/增量补拉和真实浏览器等准备；仍不得接入现有生产处理器。
4. 正式接入、部署原客服候选、迁移账号、切换店铺/流量和 UAT 退役继续等待用户明确命令。

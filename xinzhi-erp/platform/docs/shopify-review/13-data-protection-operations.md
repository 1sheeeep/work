# 数据保护第 8–10 项操作单

本文件只解决 Partner Dashboard 中的三项：保留期限、静态/传输加密、备份加密。Shopify 当前要求 Level 1 应用应用保留期限并加密静态和传输数据，Level 2 还必须加密备份；审核时可能要求真实证据。依据：[Shopify protected customer data requirements](https://shopify.dev/docs/apps/launch/protected-customer-data#requirements)。

## 什么时候可以勾选“是”

现在不要仅凭本地代码勾选。以下生产证据全部齐备后，三项都如实选择“是”：

1. 保留期限：公开隐私页采用已批准的政策；ERP 与客服数据合成删除请求全链路成功；失败重试和人工升级有记录；备份最多保留 30 天。
2. 静态和传输加密：云服务商证据覆盖数据库 Docker 存储、上传文件和备份；所有公开端点为有效 HTTPS；API 到 PostgreSQL 的连接显示 TLS 已启用并验证主机名。
3. 备份加密：生产目录只发布 `.age` 加密包和校验和；离线环境使用私钥完成一次解密及 PostgreSQL 结构验证；旧明文或长期月度备份已经人工审查处置。

任何一项缺证据时保持未选择，不能把“计划做”写成“已经做到”。

## 已采用的简单策略

- 个人数据只在商户使用服务且履约、配送或订单支持确有需要时保留。
- 经核验的删除请求和 Shopify redact 请求在 30 天内完成；只允许依法保留去标识化的交易或安全事实。
- 加密滚动备份最多保留 30 天，不再建立长期月度个人数据备份。
- 删除后的个人数据不从备份恢复到正常业务；发生灾难恢复后，重新执行仍适用的删除请求。
- 商户主体、期限和例外最终仍需隐私/法务负责人批准，代码不能代替这一批准。

## 仓库中的真实控制

- `deploy/compose.production.yml`：公开流量由 HTTPS 入口处理；API 到 PostgreSQL 强制 `sslmode=verify-full`。
- `deploy/prepare-production-data-protection.sh`：在静态加密预检通过后生成 `DNS:postgres` 证书，检查证书剩余有效期和密钥匹配。
- `deploy/verify-at-rest-encryption.sh`：必须分别确认数据库、上传文件和备份的服务商静态加密；缺一项即失败。
- `deploy/backup-production.sh`：备份数据库、附件和生产配置，使用 `age` 公钥加密后才发布，最多保留 30 天；发现旧明文或月度备份时停止并等待人工决定，不自动删除。
- `deploy/verify-encrypted-backup.sh`：校验摘要、解密、拒绝危险路径、验证清单和 `pg_restore` 结构。

## 一次性生产准备

此步骤涉及真实服务器和私钥，只能在用户明确授权生产操作后进行。

1. 在云服务商控制台确认承载 Docker 数据库的系统盘、上传目录所在磁盘以及备份存储都启用了静态加密，保存不含账号和客户数据的截图。
2. 根据真实控制台证据，在服务器受限文件 `/etc/xzdesk/at-rest-encryption.evidence` 中记录四行：

   ```text
   database_encryption=enabled
   uploads_encryption=enabled
   backups_encryption=enabled
   verified_at_utc=YYYY-MM-DDTHH:MM:SSZ
   ```

3. 安装 Ubuntu 官方 `age` 包。私钥在独立、受控的管理员设备离线保存，服务器只放公钥收件人文件 `/etc/xzdesk/backup-recipients.txt`。不要把私钥放进应用目录、服务器备份目录、Git、截图或审核材料。
4. 由 root 运行一次 `sh /opt/xzdesk/deploy/prepare-production-data-protection.sh`。它会准备受限目录和 PostgreSQL TLS 证书；缺少真实静态加密证据时会直接停止。
5. 先审查旧备份。脚本发现 `postgres.dump`、`production.env`、`.tar` 或旧 monthly 目录会停止，不会替用户删除。
6. 执行一次加密备份。把加密包复制到隔离验证环境，使用离线私钥运行 `verify-encrypted-backup.sh`。保留成功时间、部署版本、备份策略、目录文件名和验证结果；不要保存私钥或客户值。
7. 安装/更新定时任务后检查下一次自动备份，确认目录内只有 `xzdesk-backup.tar.age` 和 `SHA256SUMS`。

## 提交前证据

- `L2-ENC-01`：数据库、上传和备份静态加密截图或导出，包含环境、区域、启用状态和采集时间。
- `L2-TLS-01`：公开 HTTPS 和 PostgreSQL TLS 的脱敏结果。
- `L2-BACKUP-01`：30 天保留策略、一次成功加密备份、一次隔离恢复验证、旧备份处置记录。
- `L2-DEL-01`：合成客户请求覆盖 ERP 和客服全部记录与附件，含失败重试/升级和 30 天内完成的证据。
- 法务/隐私负责人对公开保留、删除、恢复和例外表述的批准记录。

## 2026-08-17 生产执行结果

- 64 GB Lightsail 附加磁盘已永久挂载到 `/data`；PostgreSQL、上传、TLS 材料、备份暂存和正式备份均位于该磁盘，静态加密预检通过。
- API 到 PostgreSQL 使用 `sslmode=verify-full`，生产查询确认 PostgreSQL SSL 已开启并存在活动 SSL 连接；公开客服、ERP 和五个 Shopify 审核页面均通过 HTTPS 返回 200。
- systemd 备份服务和定时器已启用，连续生成三份仅含 `xzdesk-backup.tar.age` 与 `SHA256SUMS` 的正式备份；保留上限为 30 天。
- `20260816T170126Z` 已下载到独立本机环境，完成 SHA256、`age` 解密、归档安全、PostgreSQL 16.14 真实恢复、28 表及 743 个上传文件核对；验证后的明文、临时数据库和本机重复加密包均已删除，私钥未进入服务器。
- 删除前又生成并校验 `20260816T171620Z`；随后经用户明确确认删除系统盘迁移前副本、旧备份隔离目录、迁移安全备份和原 Docker 数据卷。删除后业务健康检查仍通过。
- Shopify Connector 已更新为 `xz-erp-shopify-connector:20260817T055557Z-merchant-dpa-b775eda5`，入口为只在上一精确 ERP Web 镜像上增加 Nginx 路由的派生镜像 `xz-erp-web:20260817T061005Z-dpa-route-b775eda5`。公开隐私、删除、条款、商户数据处理条款、支持和指南页面均为 200，服务条款与隐私页都链接到协议；无凭据七页内容门禁 7/7 通过。当前公开文案采用正式主体/地址、`support@xzkj.ai`、`privacy@xzkj.ai`、30 天删除和备份策略及最新 Customer Privacy API 存储说明；邮箱刷新后的部署证据记录在 `09-engineering-readiness-evidence.md`。
- 已在精确部署版本完成一次隔离合成 `customers/redact` 全链路：签名 Webhook 返回 204，平台管理员确认匿名化后待处理数归零；ERP 本次实际有值的 22 项个人字段全部清空，订单金额、状态和订单行保留；客服侧匹配记录由 2 条变为 0 条；客服与 Connector 重复处理均返回 `alreadyCompleted=true`，Connector 待处理列表为空。
- 合成测试前的受限备份位于 `/data/xzdesk/migration-safety/shopify-privacy-synthetic-20260816T181144Z`。测试期间发现并修复 `kf-uat.xzkj.ai` 缺少活动 Caddy 路由的问题，配置校验通过，UAT/生产客服健康检查及 ERP `/readyz` 均为 200。合成会话创建所需的临时“允许游客”仅作用于 Xinzhi App Lab，并已恢复为要求登录；浏览器核对两家店铺均恢复原规则。
- 负责人已于 2026-08-17 确认可实际执行的运营规则：平台管理员至少每周检查一次待处理隐私请求；发现失败后当天重试；再次失败则记录并升级给系统管理员排查；所有适用请求在收到后 30 天内完成。不承诺无法持续执行的每日检查，也不虚构尚未实现的自动邮件告警。

因此静态/传输加密和备份加密已有生产证据，保留期限也已有公开政策、备份控制、精确部署版本的客户删除成功证据和负责人批准的失败升级规则。公司/隐私负责人于 2026-08-17 批准商户数据处理条款，精确版本已公开并完成互链及 7/7 内容验证，`OWN-16` / `L1-DPA-01` 已关闭。`L2-DEL-01` 的客户删除部分已完成；只能在一次性隔离店铺/快照执行的 `shop/redact` 仍是最终提交门禁，禁止在共享审核店执行整店删除。

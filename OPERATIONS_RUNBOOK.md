# 上线、监控、备份与回滚手册

## 上线前必做

1. 复制 `.env.production.example` 为 `.env.production`，填写真实 HTTPS 域名，不在文件中放密码。
2. 从 `secrets/*.example` 创建无 `.example` 后缀的数据库和管理员密码文件，权限设为 `0600`；这些文件已被 Git 忽略，禁止把真实值写入 Git。
3. 域名 A/AAAA 记录指向主机，防火墙仅开放 80/443 和受控管理入口。
4. 执行 `docker compose -f compose.production.yaml --env-file .env.production config`，检查结果中无明文密码。
5. 执行 `scripts/release-check.sh` 和收敛后的 Playwright E2E，确认四个日常入口、系统管理员日志入口及旧 URL 重定向均正常，再创建数据库备份。
6. 测试和预发布必须确认 `APP_BROWSER_MONITOR_ONLY=true`。未完成真实页面逐动作验收、双人生产批准和低配额试运行前，不得建立或开启后台自动发送执行器。

## 发布

团队仓库的 `Verify` 工作流会在 PR 和主分支运行后端、前端、浏览器桥接器与本地连接器检查。需要准备交付物时，仅在 `main` 使用 Actions → `Prepare release package` 手动运行；它重新测试并产出带提交号和 SHA-256 摘要的前后端构建、桥接器与本地连接器源码包，**不会连接或更新服务器**。发布包仅保留 7 天；下载后须先核对摘要。此包不是线上已发布或真实业务验收的证明。

仓库中的共享入口方案使用 `compose.yaml`、`xz-erp-public-ingress` 网络和 8088 端口，当前桥接器文档也指向该端口；这不等于已经核实服务器运行态。下方 `compose.production.yaml` 单独占用 80/443 端口，且域名仍是示例值；不得直接对共享服务器执行以下独立部署命令。招聘专用受限发布通道、当前运行配置核对、数据库迁移门禁、备份及回退演练完成前，只能准备发布包，不得把它直接推上正式环境。ERP 的发布密钥和网关仅限 ERP，不能复用。

```sh
docker compose -f compose.production.yaml --env-file .env.production up -d --build
docker compose -f compose.production.yaml --env-file .env.production ps
scripts/smoke-test.sh https://recruitment.example.com
```

Caddy 自动申请和续期 TLS 证书；应用 Session Cookie 在生产配置中强制 `Secure`/`HttpOnly`/`SameSite=Lax`。数据库和后端不对公网映射端口。

## 监控与告警

- 存活：`/actuator/health/liveness`；就绪：`/actuator/health/readiness`。
- 启用 Prometheus：`docker compose -f compose.production.yaml --env-file .env.production --profile monitoring up -d`。
- Prometheus 仅绑定 `127.0.0.1:9090`，不直接公开。
- 建议告警：就绪检查连续 3 次失败、5xx 比例 > 2%、Gateway 超时/断路计数增长、PostgreSQL 磁盘 > 80%。
- 自动跟进额外告警：`FAILED` 尝试连续增长、账号 `pausedUntil` 非空、`CLAIMED` 租约长期不完成、单账号日配额提前耗尽。
- 浏览器设备告警：活跃设备超过 2 分钟无心跳、运行状态为 `PAUSED`、停机原因出现验证码/风险提示或设备反复重新配对。
- 安全看门狗默认每 30 秒执行；可用 `APP_BROWSER_SAFETY_WATCHDOG_INTERVAL` 调整扫描周期，用 `APP_BROWSER_HEARTBEAT_TIMEOUT` 调整离线阈值。不建议将心跳阈值设为少于 2 分钟。
- 指标 `recruitment_browser_safety_total{event="device_offline|send_lease_expired|fill_lease_expired"}` 增长时需核对对应账号；租约过期不得手工改回 READY/CLAIMED，应由 HR 核对真实页面后重新建立任务。
- 管理员可访问 `/api/operations/gateways` 查看各 Gateway 操作的连续失败数和断路截止时间。
- 系统管理员统一在“项目运行日志”查看关键运行状态与操作记录；账号的最近心跳、最后成功同步、暂停原因和恢复后重采证据在“招聘账号”查看。旧“运行保障”、“自动跟进”和独立操作日志页面不再可达。

## 备份与恢复

```sh
scripts/backup.sh
COMPOSE_FILE_PATH="$PWD/compose.production.yaml" COMPOSE_ENV_FILE="$PWD/.env.production" scripts/backup.sh
scripts/restore.sh /absolute/path/to/recruitment-YYYYMMDDTHHMMSSZ.dump --confirm
scripts/restore-drill.sh
```

对生产执行恢复或恢复演练时，同样同时设置 `COMPOSE_FILE_PATH` 和 `COMPOSE_ENV_FILE`。

- 每日全量备份，加密后离机保留；建议 7 份日备份、4 份周备份、12 份月备份。
- 恢复脚本要求显式 `--confirm`，且操作前自动再创建一份备份。
- 每月在隔离环境执行一次恢复演练，验证 Flyway 版本、行数、登录和核心流程。
- `restore-drill.sh` 仅使用固定的隔离数据库 `recruitment_restore_drill`，验证后自动删除，不覆盖主数据库。

## 回滚

1. 保留上一个已验收的 Git 提交和容器镜像摘要。
2. 发布前备份数据库，记录 Flyway 版本。
3. 仅前端/后端回滚时重新部署上一镜像；不执行 `git reset --hard`。
4. 若新迁移已写入不兼容数据，停止写入后使用发布前备份恢复，再部署上一镜像。
5. 回滚后执行健康检查、smoke test 和关键数据核对，并记录事故时间线。

## 数据保留与人工降级

- 候选人保留期尚待产品/法务确认；在此之前不自动删除，使用已有匿名化功能处理合法删除请求。
- BOSS Gateway 或浏览器伴随端超时、限流或断路时，自动回复必须失败关闭，保留失败状态供人工检查和后续幂等重试。
- 不得将 Cookie、Token、密码、候选人消息正文写入审计或普通日志。
- 新账号必须依次通过“DOM 适配与只监测”、“仅草稿”和“单账号小配额试发”，确认页面识别、发送限额、人工接管和紧急停止流程后才可开启自动发送。任何验证码、风险提示、登录异常、平台告警或投诉都应立即关闭该账号策略，不允许使用规避风控手段。

## 收敛页面的运行核对

- HR 首次开启挂机时，如某个已连接账号尚无策略，系统只允许建立安全默认策略（固定收悉模板、待审核草稿、自动发送关闭）。开启后应在项目运行日志中看到策略创建或值守变更记录。
- 公司统一回复资料和岗位工作内容只在“岗位资料”办理；公司级 AI 自动分析授权和 BOSS 简历异常恢复只在“简历分析”办理。不要尝试通过旧 URL 找回已删页面。
- “今日值守”中的岗位关联只能在严格标题匹配失败的未读详情中出现。候选项为空时，应先在岗位页完善同账号真实岗位，不得跨账号关联或手工伪造岗位。

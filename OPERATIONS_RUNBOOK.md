# 上线、监控、备份与回滚手册

## 上线前必做

1. 复制 `.env.production.example` 为 `.env.production`，填写真实 HTTPS 域名，不在文件中放密码。
2. 从 `secrets/*.example` 创建无 `.example` 后缀的数据库和管理员密码文件，权限设为 `0600`；这些文件已被 Git 忽略，禁止把真实值写入 Git。
3. 域名 A/AAAA 记录指向主机，防火墙仅开放 80/443 和受控管理入口。
4. 执行 `docker compose -f compose.production.yaml --env-file .env.production config`，检查结果中无明文密码。
5. 执行 `scripts/release-check.sh` 和全量 Playwright，再创建数据库备份。

## 发布

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
- 管理员可访问 `/api/operations/gateways` 查看各 Gateway 操作的连续失败数和断路截止时间。
- 管理员运行保障页显示 Flyway、审计只追加和 Gateway 保护状态；浏览器设备心跳与停机原因在“自动跟进”页查看。

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

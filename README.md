# BOSS 多账号 AI 自动招聘控制台

集团 HR 内部使用的招聘自动化控制台。当前仓库按交接文档采用模块化单体架构，V1 主链路止于“确认面试时间并通知 HR”。未经合法授权的 BOSS 能力只允许使用 Mock Gateway，不接网页内部接口、Cookie 自动化或爬虫。

## 当前已完成闭环

- 系统管理员通过服务端 Session + CSRF 防护登录、退出和恢复会话
- 初始化并维护单一集团资料
- 新增、编辑、查询、启用和停用企业
- 集团内企业名称、企业编码唯一校验
- 新增、编辑、查询、启用和停用 HR 用户
- 固定的招聘管理员/招聘专员角色与企业授权范围
- HR 用户只能查看自己授权范围内的企业
- HR 用户密码重置，密码内容不进入审计日志
- 按企业管理 BOSS 账号，支持新增、编辑、启停和能力检查
- `BossGateway` 隔离外部能力，当前仅提供 FULL、READ_ONLY 和 UNAVAILABLE 三种 Mock 情景
- 不同角色按企业授权隔离 BOSS 账号，招聘专员仅可查看
- 职位草稿新增、编辑、启用和关闭，关闭后作为终态保留
- 职位只能绑定同企业、已启用且具备 `JOB_SYNC` 能力的 BOSS 账号
- 职位包含地点、结构化薪资、经验、学历、JD 和筛选要求
- 自动招聘任务可绑定已启用职位及其 BOSS 账号，配置执行策略、日配额、时区、运行窗口和人工审核开关
- 任务支持草稿、待启动、运行、暂停、恢复、失败/人工介入和重试，达到配额后自动完成
- Mock Gateway 每次执行必须携带幂等键，执行结果和尝试次数持久化留痕
- 候选人按企业、来源和不可逆摘要去重，原始外部候选人 ID 不落库，联系方式不采集
- 硬规则、AI 建议和人工覆盖结论分开留痕，保存规则/模型/提示版本和理由
- 会话消息按外部消息 ID 幂等入库，AI/HR 外发草稿均先进入人工审核，支持人工接管和匿名化
- 候选人来信超时未处理时可按 BOSS 账号独立生成跟进草稿或自动发送，具备时段、日配额、最小间隔、人工接管阻断、失败暂停和数据库租约幂等保护
- `boss-browser-extension` 提供无官方招聘消息 API 时的 Chrome Manifest V3 页面伴随端骨架：可配置 DOM 适配器、超时检测、发送前二次复核、配额/时段保护和风险提示停机；真实招聘端选择器待测试账号到位后学习
- 面试安排支持 2–5 个带 IANA 时区的候选时间，处理过期、同一负责 HR 时间冲突、重复确认和重新约定
- 面试确认后经 `NotificationGateway` 通知负责 HR；支持 Mock 与 HMAC 签名 Webhook，幂等重试且已送达通知不会重复发送
- 运行中任务由后台调度器自动扫描，数据库租约、过期接管和 fencing token 保证多实例不会重复执行
- 候选人支持 CSV/XLSX 两阶段批量导入，预览时校验文件内及存量数据重复，确认后清理预览个人字段
- AI 辅助支持 JD 结构化解析和候选人建议，默认使用可复现 Mock，保留 Provider/模型/提示版本、输入摘要和人工复核提示
- 真实 HR Webhook 只发送候选人匿名引用，带时间戳、HMAC-SHA256 签名和幂等键，并提供白名单试运行开关
- 登录防爆破、统一请求 ID、CSP/防嵌入等安全头、审计脱敏和数据库级只追加保护
- Gateway 统一超时、并发/频率限制、连续失败断路、Prometheus 指标和人工降级状态
- 管理员运行保障页可查看 Flyway、审计防篡改和 Gateway 保护状态
- 登录、组织、HR 用户、BOSS 账号、职位、招聘任务、候选人和面试关键操作审计
- PostgreSQL Flyway V1–V16 迁移和 Docker Compose 本地/预发布/生产编排
- 桌面与移动端响应式管理界面

企业、HR 用户、BOSS 账号、职位和招聘任务均不提供物理删除，停用、关闭或进入终态后保留历史数据和关联边界。

## 技术栈

- 后端：Java 21、Spring Boot 4.1、Spring Security、Spring Data JPA、Flyway
- 前端：Vue 3、TypeScript、Vite、Element Plus
- 数据库：PostgreSQL 17
- 入口：Caddy
- 本地部署：Docker Compose

## 本地启动

仓库已包含本地 `.env`，该文件被 Git 忽略。新环境请复制 `.env.example` 为 `.env`，并设置独立的数据库密码和至少 12 位的管理员密码。

```powershell
docker compose up -d --build
docker compose ps
```

浏览器打开：<http://localhost:8088>

初始管理员用户名和密码分别来自 `.env` 中的：

- `APP_BOOTSTRAP_ADMIN_USERNAME`
- `APP_BOOTSTRAP_ADMIN_PASSWORD`

密码只在空数据库首次启动时用于创建管理员，系统日志不会输出密码。数据保存在 Docker 命名卷 `recruitment-console_recruitment_postgres_data` 中。

停止服务但保留数据：

```powershell
docker compose stop
```

## 验证命令

后端测试：

```powershell
docker run --rm -v recruitment_maven_cache:/root/.m2 -v "${PWD}\backend:/workspace" -w /workspace maven:3.9-eclipse-temurin-21 mvn -B -ntp test
```

前端构建和组件测试：

```powershell
cd frontend
npm.cmd run build
npm.cmd test
```

服务启动后执行桌面与移动端真实浏览器测试：

```powershell
cd frontend
npm.cmd run test:e2e
```

健康检查：<http://localhost:8088/actuator/health>

生产 HTTPS、密钥文件、Prometheus、备份恢复和回滚流程见 `OPERATIONS_RUNBOOK.md`；预发布和真实 HR 通知试运行见 `STAGING_RUNBOOK.md`。

## 配置边界

- `.env` 不进入 Git，不要把真实密码、Token 或授权密钥写入代码和普通日志。
- 正式环境必须设置 `APP_SECURE_COOKIE=true` 并通过 HTTPS 访问。
- 当前已完成从组织、职位、后台任务、候选人导入/AI 辅助、候选人沟通到“确认面试并通知 HR”的自动化主链路。
- BOSS 能力暂时只能使用 Mock Gateway；不保存 Cookie、Token 或真实凭据。
- 多账号自动跟进只能经已授权的 `BossGateway` 发送；禁止 Cookie 自动化、指纹伪装、风控规避或网页内部接口。配额和频控只能降低风险，不能保证第三方平台账号绝不被限制。
- 浏览器伴随端不导出 Cookie、不绕过验证码且默认关闭自动发送；加载和开启方式见 `boss-browser-extension/README.md`。
- M9–M13 已完成仓库内实现与本地预发布试运行；真实域名/TLS 签发、真实 HR Webhook 地址、真实 AI Provider 与外部 BOSS 授权仍需在目标环境配置和审批。
- 详细的分阶段实施和验收边界见 `IMPLEMENTATION_ROADMAP.md`。

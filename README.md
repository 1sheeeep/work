# BOSS HR 离开托管助手

供 HR 临时离开、开会、午休或下班期间使用的消息托管助手。BOSS 招聘端收到候选人新消息且 HR 超过设定时间仍未回复时，系统发送一条安全的接待回复，并将会话保留给 HR 返回后继续处理。项目不定位为完整 ATS 或自动招聘平台。

完整产品边界、核心流程和验收标准见 [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)。无可用官方消息 API 时，使用 Chrome 浏览器伴随端在 HR 主动登录的可见页面内识别和发送消息；产品界面将其统一表达为“BOSS 账号连接”。

## 当前已完成闭环

- HR 登录后进入托管概览，优先查看托管账号、待跟进会话、连接异常和今日自动接待数量
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
- 候选人按企业、来源和不可逆摘要去重，原始外部候选人 ID 不落库，联系方式不采集
- 硬规则、AI 建议和人工覆盖结论分开留痕，保存规则/模型/提示版本和理由
- 会话消息按外部消息 ID 幂等入库，AI/HR 外发草稿均先进入人工审核，支持人工接管和匿名化
- HR 开启离开托管后，候选人来信超时未处理时可按账号独立生成接待草稿或自动发送，具备时段、日配额、最小间隔、人工接管阻断、失败暂停和数据库租约幂等保护
- 招聘专员可快速开启临时离开或下班托管并设置自动结束时间；HR 提前返回可立即关闭，到期后服务端停止领取和签发发送任务
- 待跟进会话中心按未完成状态和等待时间排序，展示最后消息、自动接待结果、待审核草稿和人工接管状态
- `boss-browser-extension` 提供无官方招聘消息 API 时的 Chrome Manifest V3 页面伴随端：具备 DOM 选取学习、后端单次发送租约、多标签互斥、发送后 DOM 确认、本机紧急停止和风险提示停机；真实招聘端选择器待合法测试账号到位后学习和验收
- 登录防爆破、统一请求 ID、CSP/防嵌入等安全头、审计脱敏和数据库级只追加保护
- Gateway 统一超时、并发/频率限制、连续失败断路、Prometheus 指标和人工降级状态
- 管理员运行保障页可查看 Flyway、审计防篡改和 Gateway 保护状态
- 登录、组织、HR 用户、BOSS 账号、职位、候选人、浏览器设备和自动回复关键操作审计
- PostgreSQL Flyway V1–V18 迁移和 Docker Compose 本地/预发布/生产编排
- 桌面与移动端响应式管理界面

企业、HR 用户、BOSS 账号和职位不提供物理删除，停用或关闭后保留历史数据和关联边界。

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

生产 HTTPS、密钥文件、Prometheus、备份恢复和回滚流程见 `OPERATIONS_RUNBOOK.md`；预发布与 BOSS 浏览器伴随端试运行见 `STAGING_RUNBOOK.md`。

## 配置边界

- `.env` 不进入 Git，不要把真实密码、Token 或授权密钥写入代码和普通日志。
- 正式环境必须设置 `APP_SECURE_COOKIE=true` 并通过 HTTPS 访问。
- 当前唯一主链路是“HR 开启离开托管 → 候选人来信 → 超时仍未人工回复 → 安全接待回复 → HR 返回后继续跟进”。组织、职位、用户和运维仅作为支撑配置。
- BOSS 职位同步等平台能力当前仍使用 Mock `BossGateway`；候选人消息的识别与回复可由安全配对的浏览器伴随端完成。
- 多账号通过独立 Chrome Profile 和账号级设备配对隔离；每个 Profile 只登录一个 BOSS 招聘账号，不共享会话状态。
- 浏览器伴随端只在 HR 主动登录的可见页面上工作；不导出/上传 Cookie、Token 或密码，不调用网页私有接口，不伪造指纹，不绕过验证码或风险提示。
- 配额、时段、最小间隔和风险停机只能降低账号风险，不能保证第三方平台账号绝不被限制。加载和开启方式见 `boss-browser-extension/README.md`。
- 原自动招聘任务、CSV/XLSX 导入、AI 辅助、面试协调和 HR Webhook 代码已从运行版裁剪；历史 Flyway 仍保留以兼容已有数据库。
- 详细的分阶段实施和验收边界见 `IMPLEMENTATION_ROADMAP.md`。

# DEV_STATE

更新时间：2026-08-28。当前分支为 `main`。

## 已完成的业务闭环

1. 系统管理员登录、退出和 Session 恢复。
2. 单一集团资料与多企业管理，企业采用 `ACTIVE/INACTIVE` 软停用。
3. HR 用户新增、编辑、查询、启停、密码重置。
4. HR 用户固定为 `RECRUITMENT_ADMIN` 或 `RECRUITER`；系统管理员不在 HR 用户模块中维护。
5. 每名 HR 至少授权一家有效企业，登录后只能查看授权范围内的企业。
6. 关键组织和用户操作写入审计日志，不记录密码明文。
7. BOSS 账号按企业归属，支持新增、编辑、软停用和 Capability 检查。
8. BOSS 外部能力统一通过 `BossGateway`，当前仅实现不保存真实凭据的 Mock Gateway。

## M2 和 M3 实现

- Flyway `V2__hr_users_and_company_scopes.sql`：新增用户-企业授权关系和大小写不敏感用户名唯一索引。
- 后端 `users` 模块：列表筛选、新增、编辑、启停、重置密码、角色和授权校验、审计。
- 组织数据范围：非系统管理员查询企业时使用自己的授权集合过滤。
- 前端 HR 用户页：桌面/移动响应式列表、筛选、表单校验、企业多选、启停和重置密码。
- 导航和组织页按当前角色隐藏无权操作。
- E2E 夹具改为桌面/移动各复用一组固定企业和 HR 用户，结束后停用，不再每次追加时间戳数据。
- Flyway `V3__boss_accounts_and_capabilities.sql`：新增 BOSS 账号、连接状态和 Capability 持久化。
- 后端 `boss` 模块：企业数据范围、角色权限、新增/编辑/启停、能力检查与审计。
- `MockBossGateway`：提供 FULL、READ_ONLY、UNAVAILABLE 可重复验证的模拟情景。
- 前端 BOSS 账号页：响应式列表、筛选、统计、表单、连接状态、Capability 展示和按角色禁用操作。
- BOSS E2E 夹具同样复用固定数据，验证全能力、只读降级、软停用和桌面/移动无水平溢出。

## 验证状态

- Flyway V1–V3 在 PostgreSQL 17 真实容器中迁移成功。
- 后端 Java 21 + Maven 编译成功，17/17 测试通过。
- 前端 TypeScript 检查和 Vite 标准生产构建通过。
- 前端 Vitest 3/3 通过。
- Playwright 组织、HR 用户和 BOSS 账号的桌面/移动回归 6/6 通过。
- Docker Compose 中 db、backend、web 三个服务健康，入口为 <http://localhost:8088>。
- 数据库核对确认 BOSS 账号表不含密码、Cookie、Token、Secret 或 Credential 字段。

## 安全与范围边界

- 未取得合法 BOSS 授权前，不得连接网页内部接口、自动化 Cookie 或实施爬虫。
- 后续 BOSS 能力必须继续通过 Gateway/Adapter；真实集成前需先确认合法授权方式。
- 不提前建设 ATS、Offer 或入职模块。
- 正式环境必须使用 HTTPS 并设置 `APP_SECURE_COOKIE=true`。

## 下一步

1. 进入 M4 “职位管理”：先确认字段、状态机、BOSS 账号绑定规则和角色操作边界。
2. 实现 Flyway V4、后端职位模块、前端职位页及完整测试。
3. 详细顺序和每阶段验收标准见 `IMPLEMENTATION_ROADMAP.md`。

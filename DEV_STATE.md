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
9. 职位新增、编辑、筛选、启用和关闭；招聘专员只读。
10. 职位必须绑定同企业、已启用且具备 `JOB_SYNC` 能力的 BOSS 账号。
11. 职位状态机为 `DRAFT -> ACTIVE/CLOSED`、`ACTIVE -> CLOSED`，`CLOSED` 是不可编辑和重开的终态。
12. 自动招聘任务支持策略、日配额、时区/执行窗口、人工审核开关和可控 Mock 结果。
13. 任务状态机支持就绪、启动、暂停、恢复、失败/人工介入重试以及配额完成。
14. 任务执行经 `BossGateway` 并以 `Idempotency-Key` 去重，每次请求、处理数、结果和错误均持久化且可审计。

## M2–M5 实现

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
- Flyway `V4__job_positions.sql`：新增职位归属、BOSS 绑定、结构化薪资、JD、筛选要求、状态和数据库约束。
- 后端 `jobs` 模块：企业数据范围、角色权限、跨企业防护、`JOB_SYNC` 校验、状态机和审计。
- 前端职位页：响应式列表/卡片、统计、筛选、企业与可用 BOSS 账号联动、完整 JD 表单和状态操作。
- 职位 E2E 保留固定的已启用职位供 M5 复用，另用固定关闭职位验证终态，重复运行不追加时间戳数据。
- Flyway `V5__recruitment_tasks_and_executions.sql`：新增任务配置、状态/配额进度和执行记录，幂等键在单任务内唯一。
- 后端 `tasks` 模块：企业数据范围、角色权限、职位/BOSS/Capability 实时校验、状态机、配额/运行窗口和执行审计。
- `BossGateway` 扩展为可执行招聘周期；Mock 支持成功、失败和需人工介入三种可重现结果。
- 前端招聘任务页：响应式列表/卡片、筛选、配置表单、状态操作、失败重试和最近 20 条执行记录。
- 招聘任务 E2E 复用 M4 的固定职位，每次验证失败、修改 Mock 结果、重试成功、记录查看和最终暂停。

## 验证状态

- Flyway V1–V5 在 PostgreSQL 17 真实容器中迁移成功。
- 后端 Java 21 + Maven 编译成功，28/28 测试通过。
- 前端 TypeScript 检查和 Vite 标准生产构建通过。
- 前端 Vitest 5/5 通过。
- Playwright 组织、HR 用户、BOSS 账号、职位和招聘任务的桌面/移动回归 10/10 通过。
- Docker Compose 中 db、backend、web 三个服务健康，入口为 <http://localhost:8088>。
- 数据库核对确认 BOSS 账号表不含密码、Cookie、Token、Secret 或 Credential 字段。
- 数据库核对确认跨企业职位绑定为 0，已启用职位的无效 BOSS/Capability 绑定为 0。
- 数据库核对确认任务与职位 BOSS 账号错配为 0，执行幂等键重复为 0，任务关键动作均有审计记录。

## 安全与范围边界

- 未取得合法 BOSS 授权前，不得连接网页内部接口、自动化 Cookie 或实施爬虫。
- 后续 BOSS 能力必须继续通过 Gateway/Adapter；真实集成前需先确认合法授权方式。
- 不提前建设 ATS、Offer 或入职模块。
- 正式环境必须使用 HTTPS 并设置 `APP_SECURE_COOKIE=true`。

## 下一步

1. 进入 M6 “候选人、筛选和会话”：先确认候选人去重键、隐私保留策略、AI/硬规则边界和人工接管点。
2. 实现 Flyway V6、候选人主档与职位接触关系，再进入筛选决策和会话消息幂等入库。
3. 详细顺序和每阶段验收标准见 `IMPLEMENTATION_ROADMAP.md`。

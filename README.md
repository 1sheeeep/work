# BOSS 多账号 AI 自动招聘控制台

集团 HR 内部使用的招聘自动化控制台。当前仓库按交接文档采用模块化单体架构，V1 主链路止于“确认面试时间并通知 HR”。未经合法授权的 BOSS 能力只允许使用 Mock Gateway，不接网页内部接口、Cookie 自动化或爬虫。

## 当前已完成闭环

- 系统管理员通过服务端 Session + CSRF 防护登录、退出和恢复会话
- 初始化并维护单一集团资料
- 新增、编辑、查询、启用和停用企业
- 集团内企业名称、企业编码唯一校验
- 登录、集团修改和企业操作审计
- PostgreSQL Flyway V1 迁移和 Docker Compose 本地运行
- 桌面与移动端响应式管理界面

企业不提供物理删除，停用后保留历史数据和关联边界。

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

## 配置边界

- `.env` 不进入 Git，不要把真实密码、Token 或授权密钥写入代码和普通日志。
- 正式环境必须设置 `APP_SECURE_COOKIE=true` 并通过 HTTPS 访问。
- 当前仅完成第一个真实业务闭环，不代表 Phase 1 或 V1 已全部完成。
- 下一开发项继续按交接顺序进入 HR 用户、权限和 BOSS 账号管理，不提前建设 ATS、Offer 或入职功能。

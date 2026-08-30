# 公司内部招聘值守与 AI 简历助手

面向公司内部多个 BOSS 招聘账号的招聘值守工具：HR 离开时按账号策略进行一次受控接待，平台允许时协助处理简历和联系方式，并用 AI 对已授权简历提供证据化分析。最终决定始终由 HR 作出。

完整需求、边界与实施顺序见 [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)，当前开发状态见 [`DEV_STATE.md`](DEV_STATE.md)。

## 当前架构

```text
招聘管理后台（Java / Vue / PostgreSQL）
             ↓
本地 BOSS CDP 连接器（每账号独立 Chrome Profile）
             ↓
       HR 手动登录的 BOSS 网页
```

项目不再以浏览器插件作为运行主链路。每个 BOSS 账号由本地连接器启动独立、可见的 Chrome Profile；系统不保存 BOSS 密码、Cookie、Token 或浏览器 Profile。

## 当前完成情况

- 多账号的企业、账号、岗位、HR 权限、托管策略、审计和运行保障。
- `LOCAL_CDP_CONNECTOR` 正式账号类型，现有正式账号会由 Flyway V30 自动迁移。
- [`boss-local-connector`](boss-local-connector/) 支持每账号独立 Profile/端口、手动登录、一次性连接令牌和安全心跳。
- 后台默认只监测；连接器当前只建立连接并上报暂停状态，尚未读取消息或执行发送。
- 已清除所有明确标记为 E2E、Mock、UI 的测试招聘数据，保留正式企业、账号和岗位。

## 本地启动

项目根目录已包含 Docker Compose：

```bash
docker compose up -d --build
docker compose ps
```

管理后台：<http://localhost:8088>

初始管理员账号来自本地 `.env` 中的 `APP_BOOTSTRAP_ADMIN_USERNAME` 与 `APP_BOOTSTRAP_ADMIN_PASSWORD`。生产环境必须配置 HTTPS、独立密钥和备份策略。

## 多账号连接器

连接器的首次配置和命令见 [`boss-local-connector/README.md`](boss-local-connector/README.md)。

每个账号必须使用不同的：

- Chrome Profile；
- CDP 本地端口；
- 后台账号 ID；
- 本地连接器凭据。

账号掉线、登录失效、验证码、风险提示或页面不确定时，只暂停该账号，不影响其他账号。

## 安全边界

- HR 手动完成登录、扫码、短信验证和验证码；
- 不调用网页私有接口，不导出 Cookie，不使用无头浏览器；
- 只在平台当前可见且允许的页面入口中执行操作；
- 发送、求简历、接受简历、交换联系方式均需策略控制、日志和人工接管；
- 自动化只能降低遗漏，不能保证第三方平台账号绝不受限制。

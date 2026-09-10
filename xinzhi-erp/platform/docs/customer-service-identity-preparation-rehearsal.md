# 客服主身份与 ERP 独立会话：接入隔离演练

2026-09-06。**PREPARATION_ONLY / NOT_MOUNTED / NO_GO**。

已补持久身份关联、撤销和浏览器表单适配器；只在明确创建的合成演练环境运行。未合并真实账号、未改原生产客服、未部署，不能把本切片当作完整接入准备完成。

## 当前闭环

1. 只接受已核对的客服用户 ID、稳定人员引用、ERP 企业和既有 ERP 用户 ID。不按邮箱自动认领，不复制密码/密码散列，不创建客服账号，不合并角色。
2. 客服专用验证复用 bcrypt，不调用原登录控制器、不创建客服业务会话、不改变接待状态。固定三个 POST：`verify/exchange/validate`，前缀 `/internal/v1/erp-identity-preparation/`。
3. 30 秒单次票据兑换最长 5 分钟租约，绑定同次后台随机尝试、来源/目标、企业、双方用户、人员引用与关联版本。票据及客服租约不发给浏览器。
4. ERP 创建独立本地会话，只用自己的业务权限。候选访问重新检查客服身份版本、ERP 账号/企业/业务状态、角色权限和关联版本。
5. ERP 退出只撤销自己的会话，客服原会话与接待状态不变。候选令牌前缀 `cs-preparation_`，不能混用为现有 ERP 或客服 API 会话。

所有新适配器显式构造，没有默认 Bean、生产路由或启动迁移。现有 ERP 登录与复制客服页面未替换。

## 持久状态与保护

- `PersistentIdentityPreparationState.review` 要求当前启用企业的既有 `tenant_admin` 系统角色。平台管理员、非管理员、跨企业、过期版本拒绝；`UNREVIEWED/CONFLICT/CONFIRMED/DISABLED` 状态、递增版本、确认人和非敏感证据必填。关联与审计同事务。
- 客服账号和稳定人员引用在企业内各自唯一，不覆盖历史业务操作人。
- 客服密码/状态/邮箱/平台身份变动与修订版本同事务，删除保留墓碑；接待在线/离线不递增。身份读取前后版本不同则拒绝。MemoryStore/FileStore 同样保留修订，不向公开 User JSON 暴露。
- ERP 企业与个人撤销版本分开，单人变动不踢出其他人。恢复启用不回退版本，覆盖两次检查间短暂停用/业务撤权后恢复。
- ERP 从单条当前状态查询读取会话/关联/撤销版本，在远端身份响应返回后再核对一次，拒绝等待期间短暂撤权又恢复的旧请求。客服身份指纹还绑定原账号创建时刻，删除后用同 ID 重建不能复活旧票据。
- 客服票据/租约只保存散列；单次票据用原子 DELETE RETURNING 消费。有效租约可跨客服进程校验。每分钟 20 次总验证、每个关联账号 5 次的数据库计数跨实例共享；另保留实例内更紧的保护和单并发 bcrypt。不能据此声称已做生产容量验证。
- ERP 租约用 JDK AES-GCM：独立 32 字节密钥、随机 nonce、令牌散列绑定 AAD。密钥不写数据库/文档。错误密钥拒绝；原会话行与加密关联同事务保存。
- 账号密码不迁移。密码数组成功/失败后清零，但不能声称能擦除运行时全部短时编码/传输副本。
- Java 只接受 HTTPS 或回环 HTTP，固定端点、禁止重定向/带凭据 URL，响应最多 8 KiB、完整期限 5 秒、严格核对声明及 no-store。服务故障不回退密码源、不自动视作账号撤销。

显式 SQL 在 `platform/preparation/sql/`，不在自动迁移目录：

- `customer-service-identity.sql`：原生迁移完成后由 customer_service_migrator 执行，仅使用原 customer_service schema、所有权及默认 CRUD。触发器 SECURITY INVOKER，不放宽原函数权限检查。
- `erp-identity.sql`：独立 integration_preparation schema，准备关联随原会话清理级联删除。真实部署仍须核对 ERP 数据库运行角色，不能照搬合成库所有者权限。

脚本只在测试拥有的空库执行，没有生产安装/账号迁移入口。
脚本按事务执行，设置 2 秒锁等待和 10 秒语句上限；客服脚本先验证原生迁移角色，角色不符不执行 DDL。真实大库锁与运行时间仍须在获准的正式准备环境核验。

## 浏览器适配器

2026-09-08 更新：已修复本地表单 no-referrer 导致 Origin=null 的冲突，保留严格同源及 CSRF；内置浏览器合成登录、刷新、退出、错误密码流程已通过。下方 2026-09-07 浏览器失败记录为历史证据，不再单独阻塞该演练表单；仍不等于真实账号/生产业务验收。详见 [执行首轮](native-customer-service-execution-2026-09-08.md)。

`IdentityPreparationBrowser` 只由测试配置显式注册 `/preparation/identity/` 登录、演练工作台和退出。不注册正式业务 API，不复制客服工作台。

- 表单账号密码直接提交；成功只在同站点进入 ERP 演练页。错误在原页保留账号、清空密码。
- 复用 Spring Security 会话绑定 CSRF；校验固定 Host、Origin、Fetch Metadata；拒绝跨站、缺 Origin 写请求、查询串、未知/重复字段及超限表单。
- 候选 Cookie 为 HttpOnly、SameSite=Strict、限制路径/5 分钟寿命；HTTPS 使用 Secure。HTTP 仅限明确回环演练，不可用于真实域名。
- 登录/退出重建 CSRF 会话；Cookie-only 跟踪，票据/令牌不进 URL、HTML 或浏览器持久存储；CSP 限制表单目标和嵌入，无第三方脚本。
- 不是上线 SSO、自动续期或全业务退出。生产代理 Cookie、多标签/重启与最终体验仍需验收。

## 实测与复跑

```powershell
node platform/scripts/windows-maven-agent-path-gate.mjs --store-app-preparation
# 在 platform/customer-service 下：
go test ./internal/platform ./internal/connectors/shopify/adminapi ./internal/preparation/... ./cmd/identity-preparation-rehearsal ./cmd/store-app-read-rehearsal
```

固定门禁最近 102 项通过，零失败/错误/跳过；相关 Go 包通过。全量状态见根目录 DEV_STATE。

- 实际 Java + 两个 Go 进程 + 独占 ERP/客服 PostgreSQL 16：原账号/角色/主键不变、原生登录独立、短暂撤权不可复活、多实例解密与错误密钥拒绝。
- 实际 HTTP 表单：正确/错误密码、跨站、缺 CSRF、不同浏览器会话拒绝、响应不含令牌、退出不影响客服。
- pg_dump/pg_restore 恢复到另外两个独占空库，比较三套 schema 的所有表数据摘要；恢复客服重新通过原权限/迁移检查，原会话有效。
- 只停准备通道，原临时客服可用；备份后新增消息留在原临时库，没有拿旧备份覆盖。不是完整聊天/邮件业务回归或生产备份验收。
- 内置浏览器显示真实本机表单，但提交未到达身份端点；Chrome 打开该地址被 ERR_BLOCKED_BY_CLIENT 拦截，未绕过。**真实浏览器完整流程未通过**，不能以 HTTP 自动化替代。演练进程已停止。

Go 数据库演练只接受 --owned-postgres 与 stdin 的回环端口，数据库名固定 cs_identity_rehearsal，须有专属标记，仅使用代码中的合成角色。无真实 DSN/地址/凭据输入，不开放邮件/店铺/任务业务。

## 未放行项

2026-09-07 原生基线适配新增证据见 [原生身份兼容演练](native-customer-service-identity-preparation.md)。已验证原生库双连接与 sidecar 移除后的账号/会话保留，但重启时原生迁移会追加部分定制账号权限；门禁明确保持阻塞。最新用户要求现在不动生产客服，不能依据旧有条件部署说明操作生产系统。

真实浏览器完整验收、真实关联核对、实际生产版本/角色兼容、聊天邮件连续性和峰值表现仍缺。双来源写入/平滑切换、共享限额、源端保护采集与完整业务回退另有缺口。ERP-only 账号不能自动开户或改密。

正式接入等用户通知；不要求现在提供密码/Token/生产地址，不删除复制客服 UAT，不替换现有登录。

## 成熟机制依据

- [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)：会话同步令牌及默认 BREACH 防护。
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：短期随机会话、服务端撤销、Cookie 保护。
- [PostgreSQL 触发器](https://www.postgresql.org/docs/current/sql-createtrigger.html)：源变更与修订同事务，遵守现有角色边界。
- [JDK 有界响应](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html#limiting(java.net.http.HttpResponse.BodyHandler,long))：使用已有运行时，不新造网络框架。

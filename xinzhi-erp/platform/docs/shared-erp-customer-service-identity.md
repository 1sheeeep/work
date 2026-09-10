# ERP 与复制客服共用账号

> **历史实现与验证记录，非当前接入目标。** 2026-09-06 用户确认改为保留原生产客服账号、ERP 账号核对并入、店铺应用与 SaaS 两条授权通道；允许经验证不影响现有系统使用的准备性部署，正式接入仍等用户通知。见 [接入准备](production-customer-service-integration-preparation.md)。以下记录不删除，但其中“下一步登录 UAT”、ERP 主身份及继续部署复制客服的安排不再作为当前执行指令。本轮未修改或修复已部署登录行为，真实账号验收也未完成。

2026-09-05 用户明确批准：ERP 提供客服工作台入口，共用现有 ERP 账号，不依赖 One，客服免二次登录、保留独立网址和业务权限。取代 native-business-identity.md 中复制客服独立密码方案；原生账号恢复工具停止使用，不改密码、不改身份主键。

2026-09-06 用户要求简化客服独立网址：直接填写企业标识、同一 ERP 账号和密码，在当前页登录；取消“使用 ERP 账号登录”的中转卡片。经用户确认，已将提交 `69d5cad2` 发布到复制客服 UAT，见 [发布交接](customer-service-direct-login-deployment-2026-09-06.md)。真实账号与用户验收仍待人工。

## 实现边界

- 复用现有 CustomerServiceEntryGrantService 和复制客服 ERPTenantMux；不引入第三个身份系统，不恢复 One。
- ERP `/customer-service` 是安全跳转页，不是客服业务模块。登录后签发短时、单次、绑定目标域名/企业/用户的入口凭证，通过 POST 交给复制客服；不把 ERP bearer token 传到客服或 URL。
- ERP 顶部导航和应用切换器继续在当前标签页免二次密码进入客服，不改变 ERP 的 sessionStorage 保存方式。客服独立网址则直接显示账号密码表单，不导航至 ERP；只记住上次成功登录的企业标识，不保存密码。
- 直接登录由同源 `POST /api/v1/auth/erp/login` 接收输入，服务器调用现有 ERP 原生登录及一次性凭证签发/兑换接口，再建立客服自己的会话。密码仅用于本次服务器间认证，不写入客服账号库或日志；ERP bearer 与入口凭证不返回客服浏览器、不放入 URL。认证复用 ERP 现有尝试次数限制；固定目标、同源检查、严格输入、禁止跟随重定向和失败后的父会话尽力撤销均有定向测试。
- 每个客服请求检查本地会话和坐席权限；ERP 企业、账号、CHAT 开通及权限复核结果最多缓存 5 秒，实时连接另有 15 秒复核周期。退出或撤权不是零延迟推送。原客服坐席配置和停用状态保留，不凭共用账号放开业务权限。身份映射固定企业和 ERP 用户主键，不按邮箱匹配；只允许已有租户分区。
- ERP 入口创建的客服会话随对应 ERP 父会话撤销而失效。客服直接账号密码登录会创建独立的 ERP 父会话，不会自动登录 ERP 页面；退出另一个 ERP 浏览器会话不等于全局退出。账号停用、权限撤销等继续对该父会话进行复核。客服退出撤销自己的业务会话，直接登录的父会话自然到期；不宣称实现全系统单点退出。
- 审核说明只要求一套 ERP 测试账号，路径为 App Home → ERP → 客服工作台。Shopify 身份不自动获得任意 ERP 企业权限。
- 只发布 ERP 测试和复制客服 UAT；不改原生产客服、共享 Connector 的生产默认域名或真实店铺设置。

## 参考与验收

参考 [OWASP 授权检查](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) 的默认拒绝、每请求授权原则、[OWASP 登录建议](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) 的安全传输、限频与安全错误提示，以及 [Shopify 审核说明](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review) 的完整测试路径与有效凭据要求。复用项目现有第一方单次入口协议，不宣称它是标准 OIDC。测试部署对外必须使用 HTTPS；ERP 认证地址只允许 HTTPS 或回环 HTTP，不开放任意凭证代理。

发布前验证：ERP 入口成功、客服直接登录、失败重试、过期/重放/跨企业拒绝、原坐席配置保留、对应父会话退出或账号撤权后客服失效、重启后重新进入；构建/服务健康与真实账号端到端分别记录。真实 Shopify 安装、主题启用、录屏和正式提交仍由人工执行。

## 2026-09-06 本地开发阶段证据（发布前）

- `frontend` 的 `npm.cmd run build` 通过（乱码检查、TypeScript、Vite）；保留原有大包警告。`node --test tools/erp-login-api.test.mjs` 四项通过，覆盖同源/无旧鉴权头、跨源与 URL 凭据拒绝、安全错误、无效成功响应。
- `go test -json ./internal/platform ./internal/connectors/shopify/installations ./cmd/support-server -count=1` 三包最终通过，1,065 个通过事件（含子测试）；三包 `go vet` 通过。新增登录测试覆盖本机合成 ERP 登录/凭证兑换/客服会话、原坐席保留、撤权失效与失败关闭。未运行 Java 全量、其他 Go 包或真实数据库端到端。
- 初次全量在北京时间 00:05 触发既有 `TestMonitorExcludesAdminsFromPersonnelStatsButKeepsBusinessVolume` 失败，定向三次复现：样本取“当前时间减 10 分钟”，回复减 9 分钟，落入前一天而默认指标只统计上海当天。00:15 后未修改该统计代码或测试，原样全量复跑通过。当时没有消除该时间依赖；后续本地测试修正见下节，不属于已部署的登录版本。
- 使用现有构建和 `node tools/erp-login-browser-fixture.mjs` 的回环合成响应，本机浏览器跑通同页成功登录、401/403/429 留页错误、Enter 提交、提交中禁用、失败清空密码/焦点、退出和企业标识记忆；中文桌面、375×812 窄屏无横向溢出、812×375 英文短屏可滚动。服务未加载环境文件、真实账号或外部代理；浏览器检查不是 Go/Java 联调或真实账号验收。
- 八个 Shopify Node 测试文件 146 项通过；实际送审门禁仍拒绝两张最终图片、九个字幕 scope 缺项、78 项未确认及 14 处占位。只同步当前操作说明，未提交、部署、访问真实账号/店铺，未制作或提升最终送审素材。

## 2026-09-06 状态复核及本地测试收尾（未提交、未部署）

- UAT 复核仍为 `20260905T171054Z-direct-login-69d5cad2`；API、Web、PostgreSQL 均 healthy、重启 0，公网 readyz/bootstrap 通过。本次未改线上服务、数据或凭据，真实账号验收仍待用户确认。
- 只修改 `internal/platform/monitor_skill_group_test.go`：两项回复指标测试将合成回复固定在上海当天中午，保持 60 秒响应时长，避免“过去 9 分钟”落入昨日以及“创建后 2 分钟”落入明日。保留原有转接归属、管理员排除、业务量和超时异常断言；不修改线上统计实现。
- 新增 7 项固定日期边界用例：零点前、零点、此前失败的 00:05、等价 UTC 输入、月初、年初、闰日。验证上海日界的含起点、不含终点范围。未改变系统时间，也没有把这项日界单测声称为真实午夜端到端验收。
- 四项定向测试（含上述子测试）连续 20 轮通过；北京时间 17:01 完成三包 `go test -json ./internal/platform ./internal/connectors/shopify/installations ./cmd/support-server -count=1`，1,073 个测试通过事件（含子测试）、0 失败；三包 `go vet` 通过。本次未运行 Java、其他 Go 包、真实数据库或浏览器业务流程。
- 送审门禁复核仍 NO-GO：2 张最终 PNG 不满足 3–6 张要求，最终字幕缺 9 个 scope，78 项未确认及 14 处占位。测试收尾不代替真实安装、录屏或提交。

## 2026-09-06 实际客服进程登录回归（本地，未提交、未部署）

- 修正 `tools/erp-local-handshake-smoke.test.mjs` 的过时测试前提：旧脚本没有准备企业分区，实际进程返回 404 `not found`，不能再把登录当作创建企业分区的操作。现在仅在每轮临时目录预置合成企业、正常坐席和停用坐席，不改运行时认证规则。
- 测试构建并启动仓库内真实 Go `support-server`，ERP IAM 仍是本机合成 HTTP 服务，**不是 Java + 数据库联调、浏览器业务验收或真实账号验收**。服务使用环境变量白名单，不继承数据库地址、工作负载凭据或代理；复用已有严格离线模式，关闭外部后台工作，只绑定空闲回环端口，不停止既有服务。先停止子进程，再清理已校验归属的本轮临时目录。
- 覆盖 ERP 表单免二次登录和单次凭证重放拒绝、同页邮箱/用户名密码登录、退出后失效、ERP token 和跨企业替换拒绝、401/403/429/503 安全错误、无 CHAT 权限/停用坐席/未配置企业拒绝、失败父会话清理及对应父会话撤销后的缓存到期失效。验证既有坐席名称、角色、范围、接待量和停用状态不被重置；密码、ERP bearer、入口凭证不出现在响应、客服数据文件和日志中，客服 token 不明文落盘或进入日志。
- `node --test platform/customer-service/tools/erp-local-handshake-smoke.test.mjs platform/customer-service/tools/erp-login-api.test.mjs platform/scripts/customer-service-shared-auth.test.mjs`：25 项通过（含子测试），0 失败。`go test ./internal/platform -run 'Test(ERPPassword|SharedERPIdentity|SharedERPBootstrap|SharedERPIdentityCannot)' -count=3` 通过。本轮未重新运行全量 Go、Java、真实数据库或浏览器，也未重新核验 UAT 健康。
- 再向测试父进程注入合成的错误数据库地址、工作负载 token、生产模式和回环代理，25 项仍全部通过，验证客服子进程没有继承这些配置。没有读取或变更真实环境文件；本轮产生的测试进程、可执行文件和临时数据均已清理，先前部署遗留的受限构建快照未触碰。
- 复用项目现有 [Node 测试及清理机制](https://nodejs.org/api/test.html)，未增加依赖。同步 `16-parallel-review-preparation.md` 的旧“直接网址返回 ERP”措辞为当前同页表单；未勾选真实送审验收或提升最终素材。下一项实际验收仍为用户亲自使用既有 ERP 账号完成 UAT 登录、工作台权限检查与退出；Connector 发布和真实 Shopify 操作不在本轮范围。

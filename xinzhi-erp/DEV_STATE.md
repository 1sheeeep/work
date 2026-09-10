# DEV_STATE

截至 2026-09-09。ERP 单一 main，不使用 UI/UX Max。产品范围以 `platform/docs/locked-product-scope-boundaries.md` 为准；未知/用户文件及暂停范围保留，不因 Git 状态清理。

## 当前优先任务与线上版本

最新状态（2026-09-09 02:07 CST 核验）：新实例 `xzdesk-32gb-20260908` 已承载 ERP/原客服，静态 IP 不变；SSH 使用已保存的新机指纹校验。用户已确认 `cs1@xzkj.com` 用原客服密码登录 ERP 成功，但旧入口在新浏览器仍需客服二次登录。按用户确认已发布免重复登录交接：ERP 后端 `20260909-native-entry-r2`、Web `20260909-native-entry-r1`、原客服 green `20260909-native-entry-r1`，独立身份桥仍 `20260908-v2`；公网 readyz/healthz 与容器健康通过。两数据库及身份桥未重启，未新增业务迁移、改密、迁移用户或店铺通道。原客服 18 个绑定仍完整。详细证据、回退及版本基线见 `platform/docs/native-cs-passwordless-entry-2026-09-09.md`。

免重复登录使用短时单次凭证，签发/兑换重验原身份与 ERP 权限，只在新客服标签页保存会话，不沿用或清除其他标签页的客服账号，不自动使坐席上线，ERP 退出不调用客服退出。ERP 专项 21 项、前端 33 项、客服候选 Go 全量/vet、标签页隔离 3 项及两端前端构建通过；真实内部未知凭证返回 403，真实成功登录审计累计 2 条。修复后的真实浏览器交接、账号一致性与退出隔离仍待用户确认，不能宣布完整验收。UAT 三容器仍停用保留。另一客服任务已接收源码/配置衔接并准备在保留本次增量的前提下发布邮件范围规则，客服版本可能随后更新；本任务已释放发布锁，不并发切换。

服务器清理继续暂停，不恢复三个清理 timer 或巡检 automation，不按旧清单续删；详情见 `platform/docs/server-cleanup-retention-2026-09-08.md`。Shopify 送审仍暂停，其他业务范围不扩展。

## 前序筛选框布局修复（本地，未部署）

- 用户指定默认主题改为“瓷白石墨蓝”（slate）；首次访问、无效/不可读偏好采用此默认，已有手动保存的主题保持不变。仅本地修改，未部署。

- 修复订单筛选栏的嵌套标签误套两列 Grid 导致下拉框按选项固有宽度溢出；单列控件、6px 间距及按容器宽度换行，覆盖各订单阶段，不改主题或业务契约。
- 本地合成数据真实浏览器检查当前导航 70 个入口 × 1280/390px；无控件重叠，手机表格/页签原有横向滚动保留。长店铺/仓库名补测 320–1920px 共 9 个宽度；订单及主/库存 SKU 高级筛选可见区域检查通过。不代表真实业务或用户视觉验收。
- 相关 Vitest 3 文件 / 136 项、样式与主题 Node 15 项、TypeScript/Vite build 和 diff 检查通过；新增 `platform/scripts/erp-filter-layout.test.mjs`。合成预览脚本支持 `--long-labels`。
- 当时任务为布局修复，未接触生产客服；后续当前执行状态以上方统一账号部署为准。共享 Connector/Caddy 发布仍未执行。

## 当前送审状态：NO-GO

2026-09-08 重新核查：公网 smoke 在 App Home 的工作人员开户说明标记处失败；材料门禁仍缺最终媒体及 78 项确认。已按 2026-08-17 负责人批准条款补入保留/备份/删除三项政策答案，占位符从 14 处减至 11 处；未将政策批准冒充当前运营验证，未勾选缺证据项。最新以 `platform/docs/shopify-review/08-material-status.md` 顶部记录为准。共享发布须具体授权；真实店铺及正式提交仍人工。

用户确认：任何用户、任何企业均须由我们开通账号并授权才能使用系统，没有例外；不开放自助注册，Shopify 安装/OAuth/关联不授予 ERP 使用权。复用平台管理员开户、企业/账号启停、应用授权和角色权限，不新增审核后门。

受控开户提示、联系入口、公共说明与审核材料及 9 款可切换主题已提交 `0c429e37`。仅 ERP Web 已部署，共享 Connector 公共页面修改尚未发布。源码完成、部署健康和真实业务验收分别记录，不能互相替代。

## 前序 ERP Web 发布基线（现已由统一账号 Web v2 替换）

- 镜像 `xz-erp-web:20260907T152000Z-usability-0c429e37`，2026-09-07 23:18 CST 实际启动，healthy、重启 0；精确入口 `/assets/index-Dwn5D-Zu.js`。
- 从精确提交归档 npm ci / TypeScript / Vite 构建，服务器只封装固定摘要 Nginx；未混入工作区环境修改、未知页面或素材。未重置本机 Docker。
- 公网 /readyz、/login、新 JS/CSS 均 200；真实浏览器确认中文/英文工作人员开户授权说明及联系入口，无自助注册入口；未输入或提交登录凭据，最后恢复中文。
- ERP 后端 `f83c0b0f`、PostgreSQL 的容器、镜像、启动时间和重启数发布前后相同，均 healthy；环境仅 ERP_WEB_IMAGE 改变，Compose 未变。
- 客服入口继续 `kf-uat.xzkj.ai`。旧镜像与回退备份保留；回执 `platform/docs/erp-review-web-deployment-2026-09-07.md`。

## 验证与主题边界

- 全量已跟踪前端及新增主题测试：153 文件 / 1219 项通过；Shopify Node 151 项、主题 Node 11 项通过。
- 同批受控开户代码此前 Java 定向 29 项、Go installations 测试及 vet、前端构建与 diff 检查通过；本轮未重跑全量 Java/数据库集成。
- 9 款主题仅在当前浏览器保存；已部署版本默认奶杏燕麦，本地按用户新要求改为瓷白石墨蓝（尚未部署）。切换不刷新或重挂载业务页面，语义色和业务权限不变。前序本地 9 款桌面/窄屏共 18 次切换、草稿保留、刷新恢复与跨页弹窗检查见 `platform/docs/erp-theme-switcher-review-2026-09-07.md`。
- 本轮线上只检查公开登录页，不声称已完成已登录主题/全部业务写入验收；视觉与业务验收由用户决定。

## 送审必要剩余项

- 2026-09-08 本机 Docker Desktop 29.6.2 已响应，无重置。精确候选/备用在本地 Linux 容器按候选→备用→候选运行：三次 healthy、七公开页/两未认证接口拒绝通过、退出 0，清理过期合成状态后的文件哈希稳定。network=none、无端口、非 root、只读根、专用合成卷；所有测试服务已停止，生产未动。回执/限制见 `platform/docs/shopify-review/22-linux-container-rehearsal-2026-09-08.md`。下一步是具体共享发布授权与实时部署包装复核，不再将 Linux 主进程启停验证列为未做；备用仍非后台通用回退。

- 本轮补齐 Web Nginx 的 link-grant/chat-setup 两条精确转发（未部署），新增路由契约 3 项，Shopify Node 共 154 项通过。构建候选/无脚本 App Home 备用 Linux 二进制；15 阶段合成演练确认备用写入保留新状态、撤销/过期/去重和陈旧写入拒绝。备用只恢复页面故障，不是后台通用回退。真实 Caddy 2.11.4 + Nginx 1.28.0 Windows 环回 19 项通过，不等同 Linux 容器/生产验收。未访问线上；详见 `platform/docs/shopify-review/21-recovery-build-and-proxy-isolation-2026-09-07.md`。下一步仍需精确 Linux 容器验证及具体共享发布授权。

- 本地精确旧版 fd5e0085 → 候选 0c429e37 合成演练完成：旧数据向前读取通过，旧版写回新版文件会丢待关联授权/卸载回执/pendingRevision；无并发合成备份恢复通过，但禁止直接降级或覆盖在线新数据。候选公开七页 httptest 检查通过，5 个 Go 包 501 个通过事件（含子测试）、0 跳过/失败及 vet 通过。本轮未访问线上或部署。详见 `platform/docs/shopify-review/20-connector-isolation-rollback-rehearsal-2026-09-07.md`；兼容回退构建及代理运行时隔离仍待验证。

- 公共七页重新 GET 均 200，但 App Home/terms/support 各缺 3 个开户标记，guide 缺 13 个。App Home 无验证上下文 framing 仍为通配店铺，其余六页缺 frame-ancestors，七页 Referrer-Policy 均非仓库 no-referrer；公开 smoke 失败。
- 前序已获只读授权并核实：旧 Connector 自身返回旧说明/安全头；ERP 经过生产共用 Caddy，再经 Web Nginx 到 Connector，Caddy ERP 站点额外统一设置 SAMEORIGIN/旧 Referrer-Policy。修复需明确共享组件的发布影响范围及授权，不能套用 Web-only 发布许可。
- 材料门禁：14 份文档、14 处占位符、78 项未确认、2 张最终图、28 段/225 秒旧字幕，仍 NO-GO。没有虚勾清单或修改历史媒体冒充当前证据。
- 已找到 2026-08-17 负责人批准条款，可复用，不重复要求批准相同政策；当前全数据删除/备份演练、实际供应商、公司权属、历史订单批准等证据仍需核实。
- 下一步先处理共享组件安全发布授权，再由用户完成真实审核店安装/重授权及流程验收，之后制作最终媒体并检查 Partner。Shopify 登录、真实店铺授权/编辑/录制及正式 Submit 保持人工。
- 详细交接：`platform/docs/shopify-review/19-release-handoff-2026-09-07.md`；阶段记录：`18-resumed-readiness-2026-09-07.md`。

## 原生产客服统一账号（2026-09-08 已部署，实际密码验收待用户）

用户确认原客服 18 个账号合入现有 XZ 企业，保留原客服账号密码。ERP 20 个用户中 18 个完成正式 CONFIRMED/v2 绑定、16 个新增无本地密码身份；admin@xzkj.com 保留 tenant_admin，cs1@xzkj.com 与其余 16 人为客服员工，唯一新增业务权限 customer_service.read，18 人均有 ERP/CHAT 使用资格。未复制或重置原客服密码，源管理员权限未继承到 ERP。原客服 5f8a1f3 主进程、数据库容器启动信息和重启次数未变；只安装私有身份元数据/版本触发器及最小权限桥接角色，未运行原客服迁移或业务任务。

统一密码运行链路和新版入口已部署：ERP 后端 `20260908-native-identity-v1`、前端 `20260908-native-identity-v2`、独立 TLS 身份服务 `20260908-v1` 均 healthy，ERP readyz 正常，原客服 healthz green。真实浏览器已点击 ERP“客服工作台”，最终地址为 https://kf.xzkj.ai/，不再是 UAT，并确认浏览器返回可回 ERP 而非再次跳转。ERP 使用原客服密码验证，退出 ERP 不改变客服接待在线；两端独立会话，原客服未登录时仍走其原登录页，不宣称跨站免登录。旧 ERP 密码/普通 bearer、已绑定成员的本地改密和密码凭据旁路均拒绝。

验证：ERP 门禁 148 项、前端账号入口/设置 33 项、TypeScript/Vite 通过；原客服隔离固定源码 706 个通过事件/19 跳过，PostgreSQL 回归 19 项及 39 表备份恢复/回退通过。服务器候选 readiness=UP，无新业务迁移，真实 ERP→TLS→原客服错误密码拒绝检查通过。实际原客服密码登录尚未验收；已打开 ERP 登录页填 xz/cs1@xzkj.com，等待用户在页面输入原客服密码，不索取聊天明文。部署、备份、权限和验收边界见 `platform/docs/native-cs-common-credentials-2026-09-08.md`；前序开户回执为历史证据，不再用 loginIntegrationEnabled=false 描述当前运行态。

### 前序准备与尚未完成的业务适配边界

以下为统一账号上线前的历史准备记录，不覆盖上面的当前运行态。Shopify 送审继续暂停；原客服主进程、店铺/消息业务通道和 UAT 未替换或退役。

- 原生隔离复跑 `owned-native-cs-identity-Q1XInb/receipt.json` 为 NATIVE_REHEARSAL_PASSED：705 通过事件 / 19 跳过，独立 PostgreSQL 19 通过（重叠），39 表恢复与无适配器回退通过；仍 productionReady=false。
- 修复前后 ERP 准备门禁各 140 项通过、0 失败/错误/跳过。演练页面改用 same-origin 修复原生表单 Origin 冲突，仍拒绝跨站/空来源且保留 CSRF。内置浏览器合成登录、刷新、退出及错误密码拒绝通过；该入口仅测试显式注册，不是生产入口。首轮回执见 `platform/docs/native-customer-service-execution-2026-09-08.md`。
- 继续补齐本地订单有界分页协调：预算优先保护客服、失败不推进同步时间、重试持久去重、循环/越界/冲突/撤权拒绝。最终准备门禁 146 项通过（协调器 14 项，含新增 6 项）、0 失败/错误/跳过；未运行全量后端。无生产适配器、任务注册或真实订单验收，未提交/部署，不能视为真实增量接入完成。

- 2026-09-08 02:40 CST 公开 healthz 返回 green、`20260905T160517Z-5f8a1f3ab3a3`、ok=true、postgres/ok=true；未重验真实邮件/接待流程。迁移/结构证据仍来自 `platform/docs/native-customer-service-production-baseline-2026-09-07.md`，本轮未重新检查生产数据库。
- 合成原生演练为 NATIVE_REHEARSAL_PASSED，productionReady=false、deploymentAllowed=false；主测试 705 通过/19 跳过，独立 PostgreSQL 19 项与主计数重叠，不相加。
- 店铺业务来源事件/增量补拉、业务预算接管、来源回执及双业务冻结未闭合；这些业务通道切换仍 NO-GO，复制客服替换仍 REPLACEMENT_BLOCKED，不影响上面已部署的统一账号与原客服入口。不得将账号部署当作店铺业务写入/全系统融合验收。

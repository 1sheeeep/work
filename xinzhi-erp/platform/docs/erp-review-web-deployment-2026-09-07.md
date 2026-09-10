# ERP 受控开户与主题切换 Web 发布回执

2026-09-07。源码提交 `0c429e37`，仅发布 ERP Web；不是 Shopify 可送审或业务验收证明。

## 发布证据

- 镜像：`xz-erp-web:20260907T152000Z-usability-0c429e37`。
- 镜像 ID：`sha256:100650e01fc26fe7c703d00a5b31410ac4c19ed262bf507df0749f05c501da9a`。
- Web 容器：`93bb7bf9296f16b977cc5bdd95f5ce261a151dff869f903ebf862a9cc61572f1`；实际启动 `2026-09-07T15:18:00.692453427Z`，即 23:18 CST；healthy、重启 0。发布标识不是实际启动时间。
- 入口 `/assets/index-Dwn5D-Zu.js`，450.12 kB / gzip 138.86 kB；CSS `/assets/index-CpVbfrGj.css`。
- 公网 `/readyz`、`/login`、新 JS/CSS 均 200；登录 HTML 引用精确入口。
- ERP 后端 `33da6669`、PostgreSQL `50f96a91` 的完整容器 ID、镜像、启动时间和重启数发布前后完全一致；均 healthy。环境仅 `ERP_WEB_IMAGE` 改变，Compose 未变。

## 构建与回退

从 `git archive 0c429e37:platform/frontend` 构建，未混入工作区 `.env.development`、未知页面、图标删除和参考材料。生产模式仅显式设置既有客服入口 `https://kf-uat.xzkj.ai`，未开启准备功能开关。本机 `npm ci`、TypeScript/Vite 成功；服务器仅封装固定摘要的 Nginx 运行阶段，不执行前端编译，Docker RUN 使用 `--network=none`。

- 源归档 SHA256：`ca3489cd9142306034c3eef53c555d635682e8c53c1176f7791da150da3cba1f`。
- 运行材料 SHA256：`43e7545e50cacace304425128de7fd74f37a3831b48cb9d568a024428490c6a2`。
- 镜像归档 SHA256：`a5299dbc04d3a0ec05e1ab835a026a95ab20b64cd6f044bfa62a866af0994536`。
- 发布脚本校验前任镜像/容器，使用 `up --no-deps --pull never --wait web`，返回 `ERP_WEB_RELEASE_PASSED`。
- 回退备份：`/opt/xz-erp-test/backups/web-20260907T152000Z-usability-0c429e37`；原镜像 `xz-erp-web:20260907T133200Z-usability-358f5c51` 保留。备份含环境配置，只留服务器，不下载或公开内容。
- 发布源/运行材料：服务器 `/tmp/erp-web-20260907T152000Z-usability-0c429e37`；镜像归档 `/tmp/xz-erp-web-20260907T152000Z-usability-0c429e37.tar`。没有清理历史镜像或数据。

## 自动检查与浏览器分别记录

- 当前全量已跟踪前端加新增主题测试：152 文件 / 1201 项，加根路由 1 文件 / 18 项，共 **153 文件 / 1219 项通过**。有 jsdom 导航能力提示，未导致测试失败。
- Shopify Node 151 项及主题 Node 11 项通过；此前同批代码 Java 定向 29 项、Go installations 测试及 vet 通过。未声称本轮全量 Java 或数据库集成通过。
- 浏览器技能仅用于公开登录页检查：中文、英文授权说明及 `mailto:support@xzkj.ai` 联系入口可见，没有注册入口；英文页面视觉检查通过，最后恢复中文。未输入/提交登录凭据，未展开密码，未发邮件；浏览器自动填充不代表完成登录验收。
- 9 款主题的本地桌面/窄屏交互证据见主题报告；本轮未将公开登录页检查冒充线上已登录主题切换或业务流程验收。

## 送审仍 NO-GO

公开 Shopify 七页重新 GET 均 200，但新 smoke 失败：App Home、terms、support 各缺 3 个受控开户标记，guide 缺 13 个；App Home 无验证上下文时仍为通配店铺 framing，其余六页缺 frame-ancestors，全部 Referrer-Policy 仍为 `strict-origin-when-cross-origin`，不是仓库要求的 `no-referrer`。

这些路径属于共享 Connector/边缘代理，不由本次 ERP Web 替换。未检查该生产共享运行配置，不能断言具体根因；未重启或修改原生产客服、共享 Connector、代理或 Shopify 应用版本。真实审核店、最终录屏和负责人当前运行证据仍需闭合。

# ERP 前端便捷性发布 · 2026-09-07

用户授权“继续优化，优化完成后部署”。本次只发布 ERP Web，不发布后端、数据库、Connector、复制客服 UAT 或原生产客服，不变更业务数据、账号、授权与接入开关。

## 精确版本

- 源提交：`db108360e643dcc3e1d9579cf561ce3e43c6f740`，仅归档其中 `platform/frontend`；不包含脏工作区、暂停模块或未跟踪素材。
- 发布：`20260907T121600Z-usability-db108360`。
- 镜像：`xz-erp-web:20260907T121600Z-usability-db108360`，Linux/amd64。
- 镜像 ID：`sha256:63e2cebaa3eb40df46680b4eb6a6eb5fe85218e4b24050ad419581b7efbc7e6f`。
- Web 容器：`8c85eff1e35aff11e3eb79f79487b965c5e88389faab93b10137db0c570297cb`，启动 UTC `2026-09-07T12:18:06.375688803Z`，healthy，重启次数 0。
- 入口：`/assets/index-D4zfmEcz.js`；CSS：`/assets/index-CKHuvA_z.css`。生产入口 445.85 kB / gzip 136.96 kB，平台控制台独立块 65.88 kB。
- 客服入口构建参数保持 `https://kf-uat.xzkj.ai`；未启用 `VITE_STORE_APP_READ_PREPARATION`。

## 验证证据

- 前端 152 个测试文件、1192 项通过（151 文件 / 1183 项和根路由 1 文件 / 9 项分批运行）。未运行 Java 全量，本次无后端源码变更。
- 工作区及精确镜像中的 TypeScript / Vite 构建均通过，没有超过 500 kB 的主包警告。
- 本地 70 个允许菜单分别完成桌面与窄屏成功态呈现检查；夹具的写入 405、未知接口 503、关键词筛选均检查通过。详见 [优化记录](erp-frontend-usability-review-2026-09-07.md)。这不是全部真实数据、业务写入或所有弹窗的验收。
- 发布脚本返回 `ERP_WEB_RELEASE_PASSED`。回环 `/readyz`、`/login`、精确 JS 通过；公网 `/readyz`、`/login`、精确 JS/CSS、平台管理独立块均 HTTP 200，登录页引用新入口。
- Chrome 已有 ERP 会话刷新后确认新入口脚本。实测功能查找“仓库”返回六个允许入口并跳转；仓库列表 3 行、商品列表 3 行读取正常，无可见错误或整页溢出；商品操作列计算样式为 sticky，位于可视区域。
- 线上高级筛选创建日期填入后关闭/重开，DOM 值保留；检查后清空恢复原条件，未提交业务表单。未读取或代填密码、令牌，未操作真实店铺或生产客服。
- 用户视觉与业务验收未代办，不能以本轮自动化或只读检查宣称每个业务流程已验收。

## 发布保护与回退

服务目录 `/opt/xz-erp-test`。只执行 `up -d --no-deps --pull never --wait web`。发布前持有互斥锁，核对固定旧 Web 容器、旧镜像、归档哈希及健康状态，检查失败时只恢复旧 Web 环境并回退 Web。本次未触发回退。

- 后端保持 `xz-erp-backend:20260905T131900Z-shared-erp-f83c0b0f`；容器 ID `33da666966aab4257539c0308174d1f2490c299afcd517dc2b898142aa11778b`。
- PostgreSQL 保持 `xz-erp-postgres:16-alpine-57c72fd2a128`；容器 ID `50f96a912857a8ea6899f24d12149005ae4c5a39749783091f038f2e7f89b352`。
- 上述两容器镜像、启动时间及重启次数前后逐字一致，最终均 healthy、重启 0；Compose 逐字一致，环境文件仅 `ERP_WEB_IMAGE` 一行变化。
- 备份：`/opt/xz-erp-test/backups/web-20260907T121600Z-usability-db108360`，权限 700，保留旧环境、Compose、旧镜像标识、前后保护快照与校验文件。无数据库迁移或恢复。
- 旧 Web 镜像 `xz-erp-web:20260907T062200Z-global-ui-2de2cc34` 保留。手工回退须核对当前发布及对应备份，只切 Web，不运行完整栈脚本或恢复数据库。

正式发布包目录：`/opt/xz-erp-test/releases/20260907T121600Z-usability-db108360/`，保留 `images.tar`、`source.tar`、`deploy-web.sh`。

- images.tar SHA-256：`47baef3fa2e6d124cc15fbad7ee688dcc042f5034000d112ce09038998b1c330`。
- source.tar SHA-256：`48d08f7dc3d5505cb6eda9008977ad45aa92b87c83e4ad9238e42684a51c76ca`。
- 本地与传输到服务器的哈希一致。

原生产客服未访问或修改，未重新核验其版本；原接入准备继续 NO-GO，正式接入仍等待用户明确命令。

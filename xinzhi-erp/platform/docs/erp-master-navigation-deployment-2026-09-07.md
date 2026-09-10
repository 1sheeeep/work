# 主商品往返修复发布 · 2026-09-07

继续用户已授权的 ERP 前端优化与部署流程，仅更新 Web。后端、数据库、Connector、客服 UAT 和原生产客服不部署、不接入；不修改业务数据或权限。

## 版本与交付

- 源提交：`d1a0a7ea8dbc54f4ef2b124c166781c6e5dacdd4`，仅使用该提交的 platform/frontend 归档构建，未包含工作区环境文件或未跟踪暂停页面。
- 发布：`20260907T125100Z-usability-d1a0a7ea`。
- 镜像：`xz-erp-web:20260907T125100Z-usability-d1a0a7ea`。
- 镜像 ID：`sha256:449358e94f9a0e12a25c350526c55edee17a5dd3815e76b7d51463dba5b15ec8`。
- Web 容器：`8f74758ac9085d2e415d8b7adbe695e257076e079f8eeb207fc781df7af349ed`；UTC 启动 `2026-09-07T12:53:24.284674363Z`，healthy、重启 0。
- 主入口：`/assets/index-Bnz2INBt.js`，446.79 kB / gzip 137.38 kB；CSS `/assets/index-CKHuvA_z.css`；平台管理独立块 `/assets/PlatformAdminConsolePage-By_FWTJw.js`。
- 客服入口构建参数仍 `https://kf-uat.xzkj.ai`，未启用 VITE_STORE_APP_READ_PREPARATION。

## 核验

- 前端 152 文件、1205 项完整测试通过；工作区与精确发布镜像 TypeScript / Vite 构建均通过，无大包警告。本轮没有后端改动，未运行 Java 全量。
- 本地交互证据及 Chrome 未保存确认框控制限制见 [改进记录](erp-master-navigation-review-2026-09-07.md)，不是全部业务或用户视觉验收。
- 受保护发布脚本返回 `ERP_WEB_RELEASE_PASSED`；回环 /readyz、/login、新入口通过。公网 /readyz、/login、新 JS/CSS、平台管理独立块均 HTTP 200，登录页引用新入口。
- Chrome 已有 ERP 会话刷新后 DOM 脚本为新入口。只读设置每页 50 条与创建时间排序，查看已有主商品并通过面包屑返回；URL 与实际每页控件保留。再经功能查找返回，实际控件仍为 50，无可见 alert。
- 检查后恢复 `/products?view=master`，列表显示原 3 行与每页 25。恢复时有短暂浏览器选择器超时，随后 DOM 确认页面与分页已正常加载。
- 未登录新账号、未读取凭据、未操作真实店铺、未进入或修改生产客服。没有商品保存、归档、图片上传等业务写入。

## 保护和回退

- 发布前验证固定上一版 Web 镜像 `xz-erp-web:20260907T121600Z-usability-db108360`、容器 `8c85eff1e35aff11e3eb79f79487b965c5e88389faab93b10137db0c570297cb`、健康和传输哈希。
- 仅执行 Web 的 `up -d --no-deps --pull never --wait`，环境仅 ERP_WEB_IMAGE 一行改变，Compose 逐字不变。
- 后端容器 `33da666966aab4257539c0308174d1f2490c299afcd517dc2b898142aa11778b`，镜像 `xz-erp-backend:20260905T131900Z-shared-erp-f83c0b0f`，启动 `2026-09-05T13:21:35.337690672Z`。
- PostgreSQL 容器 `50f96a912857a8ea6899f24d12149005ae4c5a39749783091f038f2e7f89b352`，镜像 `xz-erp-postgres:16-alpine-57c72fd2a128`，启动 `2026-08-08T07:14:50.350787232Z`。
- 上述两服务前后快照逐字一致，最终 healthy、重启 0。没有数据库迁移或恢复。
- 回退备份 `/opt/xz-erp-test/backups/web-20260907T125100Z-usability-d1a0a7ea`，权限 700；旧镜像保留，本次未触发回退。回退必须核对当前版本和备份，仅回退 Web，不运行全栈部署。
- 发布包 `/opt/xz-erp-test/releases/20260907T125100Z-usability-d1a0a7ea/` 保留 images.tar、source.tar、deploy-web.sh；目录权限 700。临时传输副本亦保留。
- images.tar SHA-256：`807386b73c224979a3feeb6251afeca13351ec664699172080358be9f10f2b11`。
- source.tar SHA-256：`b707593e53cc46ed689f4b7c7dbf7eee408d4b54e7084ec8e5eebfc186219513`。
- deploy-web.sh SHA-256：`69ab423b00952b6fe9cf8b1ec58f59c1d42ce847a0c585a569b1776b6c5a5f2a`。
- 本地、服务器传输文件哈希一致；发布包的源码与镜像再次验证一致。

用户业务与视觉验收未代办。生产客服接入仍等待明确命令；本轮未重新核验其状态。

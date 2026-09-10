# ERP 前端 UI 发布 · 2026-09-07

按用户“部署后继续接入准备；等命令才接入，现在不动生产客服系统”的要求，仅发布 ERP Web。未发布 ERP 后端、数据库、复制客服 UAT、共享 Connector 或原生产客服；未启用接入面板、未变更账号或业务数据。

## 精确版本与检查

- 源提交：`2de2cc34`，只使用该提交的 `platform/frontend` 归档，不打包脏工作区。
- 发布：`20260907T062200Z-global-ui-2de2cc34`。
- 镜像：`xz-erp-web:20260907T062200Z-global-ui-2de2cc34`；镜像 ID `sha256:6dd50513c3fa3589df7d5674aa29d92367d574403883f6a1a511924129d864a5`。
- 精确镜像内 TypeScript 与 Vite 构建通过，保留大包提示。工作区与提交范围测试证据见 [整理记录](workspace-curation-2026-09-07.md)，不是本轮重新跑 Java 全量。
- 客服入口继续使用 `https://kf-uat.xzkj.ai`；`VITE_STORE_APP_READ_PREPARATION` 未开启。没有把 ERP 入口改到生产客服。
- 新 Web 容器 `a3df42f4d5c04009e4a61bf83272d4df0c49b465c970ef1db38b34d63eaef977`，UTC `2026-09-07T06:25:56.229349372Z` 启动，healthy，restart count 0。
- 回环及公网 `/readyz` 通过，公网 `/login` HTTP 200，精确入口资源 `/assets/index-O3ir2kDk.js` 与 CSS `/assets/index-Bbu3lKRt.css` 生效。浏览器显示 ERP 原生登录页，未读取或代填凭据，未代替用户登录后的业务/视觉验收。
- ERP 后端保持 `20260905T131900Z-shared-erp-f83c0b0f`；后端与 PostgreSQL 容器 ID、镜像、启动时间、重启次数前后一致。Compose 逐字一致，环境文件只有 `ERP_WEB_IMAGE` 一行变化。
- 没有执行生产客服的登录、配置、数据库、容器、代理或店铺操作。未重新核验原生产客服实际运行版本。

## 发布包与回退

服务目录：`/opt/xz-erp-test`。发布包保留在其 `releases/20260907T062200Z-global-ui-2de2cc34/`，包含镜像、精确源归档和受限发布脚本。

- `images.tar` SHA-256：`5ed5f34f9198f04974356514a79f8f42d8fd4423c966f75a390ed71aa9e452b1`。
- `source.tar` SHA-256：`0259b7bb505d484fd5d7eed201e8745ada01687ba36ca2c1d9654498e6ac2ce3`。
- 本地及服务器校验一致。临时传输的三份 `/tmp` 副本已清理，正式发布包与回退备份保留，可从正式包恢复传输副本。

备份：`/opt/xz-erp-test/backups/web-20260907T062200Z-global-ui-2de2cc34`，保留原环境文件、Compose、旧镜像标识及保护对象快照；备份校验通过，目录权限 700。此次前端发布不迁移数据库，不生成或恢复业务库备份。

旧镜像 `xz-erp-web:20260905T133200Z-shared-entry-b145d96f` 保留。发布脚本只执行 `up -d --no-deps --pull never --wait web`，检查失败时自动恢复原环境文件并仅切回 Web；本次未触发回退。后续手工回退须先核对当前版本与备份、确认无并发发布，再只恢复对应 Web 镜像；不得恢复整个数据库或调用旧完整栈部署脚本。

接入准备后续仅在 ERP 本地独占环境开展，原生产客服保持不动；见 [原生兼容演练](native-customer-service-identity-preparation.md)。

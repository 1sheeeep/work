# ERP 暖白 / 鼠尾草绿主题发布回执

2026-09-07，用户确认正式推广与部署后，仅更新 ERP Web。业务、权限、后端、数据库、原生产客服及 One 不在本轮变更范围。

## 版本与构建

- 源提交：`358f5c51f3b041a6c6d308f92634c7194e3f8770`，单一 main。
- 发布：`20260907T133200Z-usability-358f5c51`。
- 镜像：`xz-erp-web:20260907T133200Z-usability-358f5c51`。
- Docker inspect 镜像 ID：`sha256:6a8c9f955f77dd5feca9a019528aa72ef94c782714ab7edae29850eeafffeb25`。
- Web 容器：`9ee55b4047bfd49b3f453f8c537d610f0d042b2c13f4db327b8c9c012f0f0c4c`，启动 `2026-09-07T13:43:08.128954781Z`，healthy、重启 0。
- 本机 Docker BuildKit 启动停滞，两个引擎端点 ping 超时；仅取消本轮阻塞命令，未重置 Docker、关闭 WSL 或清理其他项目。没有声称本机 Docker 已恢复。
- 替代构建：`git archive HEAD:platform/frontend` 的干净源码在本机 Node v24.16.0 / npm 11.13.0 执行 `npm ci --no-audit --no-fund`、`npm run build`，通过 TypeScript 与 Vite。未使用工作区的未提交环境配置。
- 固定客服入口 `https://kf-uat.xzkj.ai`，未启用 `VITE_STORE_APP_READ_PREPARATION`。
- 锁文件 SHA256：`0d886d9389571fa08ca09bd1a91ccb352a1e9b80f04041c1672bb7bd3b18e770`。
- 服务器只封装预编译 dist、nginx.conf、readiness；沿用源码 Dockerfile 固定 Nginx 运行阶段（含 pid 路径与 nginx 用户），不运行 Node/npm/前端编译，不混入旧静态资源。基础镜像 `nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236`，build 使用 `--network=none`；基础元数据仍由 Docker 正常访问 registry。

## 校验与浏览器

- 完整已跟踪前端：152 文件、1205 项通过；另 4 项主题/颜色检查通过。本地呈现覆盖与限制见 `erp-sage-theme-review-2026-09-07.md`。未运行后端全量测试。
- 守护脚本校验精确前任容器/镜像、归档 SHA、镜像 ID，先备份，随后仅 `web up --no-deps --pull never --wait`；结果 `ERP_WEB_RELEASE_PASSED`。
- 公网 `https://erp.xzkj.ai`：`/readyz`、`/login`、`/assets/index-zcWvbShL.js`、`/assets/index-hgmWwQXM.css`、`/assets/PlatformAdminConsolePage-CJye91uo.js` 均 200，login 包含新入口。
- 入口 446796 字节（Vite 446.79 kB / gzip 137.39 kB）；CSS 235513 字节；平台管理独立块 65882 字节。
- Chrome 已有 ERP 会话实际刷新并只读检查工作台、在线商品、主 SKU、仓库。DOM 加载新入口与新 CSS，正式主色 `#4f694a`、页面背景 `rgb(238,239,232)`；无可见 alert 或整页横向溢出。工作台、主 SKU、仓库截图在工具输出中人工查看，未另存截图文件。
- 主 SKU 和仓库均呈现已有 3 行；只检查现有 ERP 列表，不触发 Shopify 预览/同步，不修改或保存业务数据。结束恢复初始工作台 `/`。
- 这是发布健康与代表性只读呈现证据，不替代全部角色、真实长数据、内部弹窗、写入流程及用户视觉验收。

## 保护范围与回退

- 后端容器 `33da666966aab4257539c0308174d1f2490c299afcd517dc2b898142aa11778b`，镜像 `xz-erp-backend:20260905T131900Z-shared-erp-f83c0b0f`，启动 `2026-09-05T13:21:35.337690672Z`，healthy、重启 0。
- PostgreSQL 容器 `50f96a912857a8ea6899f24d12149005ae4c5a39749783091f038f2e7f89b352`，镜像 `xz-erp-postgres:16-alpine-57c72fd2a128`，启动 `2026-08-08T07:14:50.350787232Z`，healthy、重启 0。
- 以上容器 ID、镜像、启动时间和重启次数与发布前一致；Compose 完全不变，环境除 `ERP_WEB_IMAGE` 外逐字一致。没有读取凭据内容，没有访问生产客服。
- 前任镜像 `xz-erp-web:20260907T125100Z-usability-d1a0a7ea` 保留。
- 回退备份：`/opt/xz-erp-test/backups/web-20260907T133200Z-usability-358f5c51`，包含环境/Compose、前任 Web 信息和前后保护快照。脚本异常会恢复旧环境并仅回退 Web；本轮成功，无回退触发。
- 正式归档目录：`/opt/xz-erp-test/releases/20260907T133200Z-usability-358f5c51`，目录 700，归档 600，部署脚本 700。源码、运行上下文、脚本传输前后哈希一致；镜像在服务器封装后保存，正式归档哈希再次核验。
- 不执行全栈 down/up，不删除卷或旧镜像。此脚本绑定前任和本次发布，不应直接当作通用重部署/回退脚本使用。

| 归档文件 | SHA256 |
| --- | --- |
| images.tar | `dc4d6d955e6b3b09ce32a05f1fff9ab42608ca32b634d6bd460f812a3e9a891d` |
| source.tar | `b9562d55bfbe561c99b16123a1d0c8d06712fffaa5b9c29bead2ee5ff2526d33` |
| runtime.tar | `595ef5b6f121b6caec2949e3b4e82fdedc0de132b6fc2cc889f8cd5e1eeabc3b` |
| deploy-web.sh | `f8fee3cfa0621238122178dec5e737f1496c143b2974303437fa0119fd6f9e53` |

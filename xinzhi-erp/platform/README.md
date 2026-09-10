# XZ ERP Platform

ERP-first web platform. Read the repository-root README before local setup.
The customer-service directory is a historical local-development/Connector copy,
not a mirror of the current production customer-service release. Production
customer service is maintained separately; do not publish this copy over it.

## Architecture

- `backend/`: Java 25 + Spring Boot 4.1 modular monolith
- `frontend/`: React + TypeScript + Vite
- PostgreSQL: independent ERP database
- Docker Compose: isolated local stack bound to loopback only
- Customer service: copied Go service and existing frontend/business behavior;
  the original repository and production instance are not modified

The browser ERP entry does not require a Wails runtime. The imported Go/React/Wails
source supports isolated local development and is not rewritten into the Java ERP
application. Product scope and entry boundaries are defined in the locked scope document.

See [docs/architecture.md](docs/architecture.md) for technical ownership,
deployment boundaries and customer-service source reuse.

Shopify App 上架和内部 connector 联调边界见 [docs/shopify-xz-erp-app-readiness.md](docs/shopify-xz-erp-app-readiness.md)。

## 日常实时开发：Vite HMR + 后端自动编译/重启

For daily rough development, use the checked-in PowerShell commands from the
repository root:

```powershell
.\platform\scripts\start-local-dev.ps1
# 浏览 http://127.0.0.1:18888；“客服”菜单进入同一仓库内的导入副本。
# 前端保存后通过 Vite HMR 更新；后端保存后自动编译并快速重启。

.\platform\scripts\stop-local-dev.ps1
```

先由用户手动启动 Docker Desktop。日常脚本只以 `--pull never --no-build`
启动 Compose PostgreSQL；`compose.dev.yaml` 只把数据库发布到
`127.0.0.1:5432`（可用 `ERP_DB_HOST_PORT` 覆盖）。后端是主机上的 Maven
离线 `spring-boot:run` 进程，绑定 `127.0.0.1:8080`；它监视
`backend/pom.xml` 和 `backend/src/main`，防抖后自动编译并快速重启。
这不是 Java 类热替换。Vite 仅绑定 `127.0.0.1:18888`，并将 `/api` 代理到
该 loopback 后端。脚本同时启动 `platform/customer-service` 的独立 Go
进程与前端开发进程，以及绑定 `127.0.0.1:8790` 的独立 Shopify connector；
ERP、客服和 connector 复用同一本地 workload credential。ERP 后端签发
一次性入口 grant，Go 服务兑换后创建自己的短会话；客服的
`connection.v3` 转发明确指向该 connector。客服后端、客服前端和 connector
分别通过 `8787/healthz`、`5173/`、`8790/healthz` 验证，不依赖原客服项目进程。

联合本地编排不会读取客服 `.env`、持久 `platform-dev-data.json` 或当前 shell 中的
真实 Shopify/provider 凭据。客服和 connector 每轮分别获得启动前已证明不存在的
随机 scratch Store/repository；strict-offline 模式不注册 provider 后台，并在默认
client 与邮件显式 network transport 上统一阻断非 loopback HTTP 出站。connector 的随机 identity 行为检查必须返回
`NOT_CONFIGURED`，但该检查不用于推断全仓状态；空仓事实来自本轮唯一 scratch。
编排不会执行 OAuth、历史迁移或访问真实店铺。需要单独调试导入
客服副本时可运行 `platform/customer-service/tools/start-erp-local.ps1`；该入口
明确不启动 connector，完整联合运行仍使用根启动脚本。

首次主机后端启动前，在 `platform/.env` 设置本地 `ERP_DB_PASSWORD`
（或在当前进程中设置同名变量）；脚本不会把密码写入命令行或日志。它依次
查找 `ERP_DEV_JAVA_HOME`/`ERP_DEV_MAVEN_HOME`、合法的
`JAVA_HOME`/`MAVEN_HOME`/PATH，以及当前机器已有的离线工具链候选。最后一项
只是本机 fallback，不是长期工具链保证。缺少 Docker daemon、离线 Maven 缓存、
Vite 缓存、所需镜像或可用端口时，脚本会 fail-closed；不会下载依赖、拉取镜像、
构建镜像、启动 Docker Desktop、终止未知端口进程、执行 `down -v` 或删除卷。
任何 Compose stop/up、PID 写入或进程启动前，脚本先验证五个服务端口、数据库
发布端口、PID 命令行，以及 Compose working directory/config labels；另一 checkout
或模糊 owner 会在零状态变化下失败。
若既有静态预览 PostgreSQL 容器尚未带本地端口映射，日常启动只会重建该容器以应用
覆盖；命名卷保持原样，不会重建或清空数据库。

停止脚本只验证并停止由本项目 PID 记录识别的 ERP Vite、后端 supervisor、
导入客服进程、独立 connector 及其进程树，随后停止 PostgreSQL 容器，保留
数据库卷；本轮客服/connector scratch 仅按 owner record 清理，历史持久数据文件
不会被读取或删除。PID 与后端日志均位于受控 runtime/系统
临时目录；停止只接受精确 PID、可执行文件和命令行所有权，不按端口杀进程。

## 完整 Docker 静态预览 / 发布构建

这是完整镜像的静态、近发布预览，不是日常开发入口。前端或后端变更需要重新构建镜像。
在 `platform` 目录执行：

```powershell
Set-Location .\platform
Copy-Item .env.example .env
# Replace ERP_DB_PASSWORD in .env before first start.
docker compose up --build -d
```

Open `http://127.0.0.1:18888`. The database and backend ports are not exposed to the host.

Stop the stack:

```powershell
docker compose down
```

Do not add `-v` unless you intentionally want to delete the local ERP database.

## Safety boundaries

- Never point ERP staging at the customer-service production database.
- Never reuse customer-service production secrets.
- Never connect development or staging to real stores.
- Keep staging HTTP bound to `127.0.0.1` until a dedicated test domain and TLS route are approved.

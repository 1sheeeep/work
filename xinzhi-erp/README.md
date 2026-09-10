# Xinzhi ERP

Xinzhi ERP 企业业务管理平台，包含订单、商品、采购、库存、组织权限及业务系统集成。

## 快速开始

克隆仓库：

```powershell
git clone https://github.com/jason564335/ERP.git
cd ERP
```

先读 `AGENTS.md`、`platform/docs/locked-product-scope-boundaries.md` 和 `DEV_STATE.md`。状态文档是历史交接记录，不是当前生产验收证明。

### 前端

安装支持本项目锁文件的 Node.js LTS 与 npm 后：

```powershell
cd platform/frontend
npm ci
npm run dev
# 另一个终端
npm run build
npm test -- src/modules/customerServiceEntry.test.ts src/pages/CustomerServiceEntryPage.test.tsx src/components/AppShell.test.tsx
```

前端访问业务 API 需要本地后端；不要将代理指向生产。使用项目既有 Vite 配置输出的本地地址。

### 完整本地环境

后端 Java 25、Maven；客服/Connector 本地副本 Go 1.25+；数据库 PostgreSQL。详见 `platform/README.md` 的 Docker 本地预览与开发脚本。

新电脑没有离线缓存时，先准备 Java/Maven/Go/Node、Docker 镜像及锁文件依赖，再使用离线启动脚本。不要复制生产 `.env` 或真实用户数据。

```powershell
cd platform
Copy-Item .env.example .env
# 在本地 .env 设置自选 ERP_DB_PASSWORD；不要提交 .env
docker compose up --build -d
```

仅运行本地 compose，不运行 deploy/生产迁移/账号绑定脚本。不会因推送代码自动部署生产。

## 开发流程

以 `main` 为集成分支，功能开发和问题修复使用独立分支，通过 Pull Request 进行代码评审与合并。具体分工、评审人员和发布安排由项目维护者管理。

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/example
# 完成开发并运行相关测试后，按文件暂存本次变更
git add <本次修改的文件>
git commit -m "feat: describe change"
git push -u origin feature/example
```

推送后创建目标分支为 `main` 的 Pull Request，说明变更内容、验证结果及数据库影响。合并前同步最新 `main` 并解决冲突，不强制覆盖共享分支。数据库迁移编号需避免冲突，已发布迁移不能改写。

## 范围与安全

- 产品范围以 `platform/docs/locked-product-scope-boundaries.md` 为准。
- 不提交凭据、真实用户数据、依赖缓存、构建产物和部署备份。
- 初始版本的导入范围、历史隔离和验证记录见 [PUBLICATION.md](PUBLICATION.md)。
- `platform/customer-service` 是历史导入的本地源码/Connector，**不是原生产客服最新版本的镜像**；原生产客服独立维护，不得用此目录覆盖发布。
- 仓库访问权限与生产环境权限独立管理。

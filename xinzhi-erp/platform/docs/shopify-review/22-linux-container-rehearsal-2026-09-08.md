# Linux Connector 容器验证

本地 Linux 容器演练通过；不是生产发布或 Shopify 送审完成。2026-09-08，本机 Docker Desktop 服务端 29.6.2 已正常响应；没有重置 Docker、WSL 或已有容器。

## 范围与精确产物

运行 `node platform/scripts/shopify-linux-container-rehearsal.mjs`，仅接受本地 desktop-linux / Docker Desktop，不接受外部路径、URL 或凭据参数。验证前序合成备份和候选/备用二进制 SHA256 后封装。候选源码 `0c429e37`，备用仅替换 App Home 模板，详见 21 号报告。

- 基础镜像：本机已有 `alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce`，未安装新包。
- 候选镜像 ID：`sha256:e1d640370e596039e784cfd68f8f8270a9f09a8f190f6c0db948307ac28e7546`。
- 备用镜像 ID：`sha256:bd489b0b7a5fd681364437e820db78d06b1ac49498fac8b9c6b854180ed9452e`。
- 本轮回执：`.codex-doc-build/linux-connector-0erIMS/receipt.json`。
- 镜像和已停止容器前缀 `erp-connector-rehearsal-d1199e8a-d3b1-4887-82cc-da6de400b932`；专用卷为该前缀加 `-synthetic`。

测试容器使用 `--network=none`，无映射端口、只读根文件系统、UID/GID 65532、移除全部 capability、禁止提权、128 MiB/0.5 CPU，仅挂载本轮新建的合成数据卷。只在容器环回访问 HTTP；未挂载 Docker socket、生产/现有卷或主机部署配置。密钥及应用参数全部为固定合成值，公开公司/隐私字段明确是夹具，不对外发布。

## 实际运行结果

候选 → 备用 → 候选，严格先停止前一容器再启动后一容器：

- 三次均达到 Docker healthy；七个公开页均 HTTP 200，包含 frame-ancestors 'none'、no-referrer。
- App Home 故障提示仅在备用版本出现，正常候选恢复正常模板。
- 两个新增 session 接口 link-grant/chat-setup 未带认证时每次均 **401**；没有为便于送审开放匿名业务接口。
- 三次优雅停止均 exit 0；未用强制删除代替健康退出。
- 首次启动执行过期合成 pending 清理后，三阶段加密文件 SHA256 均为 `7d6136828d7727195676cf1689642af826e6f6a4b929937b9ea17a765d1140cc`，切换未再次改变稳定数据。该值不应与清理前快照相同。
- 原数据结构、卸载重放、撤销不复活、过期及陈旧写入拒绝的断言由前序 15 阶段 Go 演练覆盖；本轮容器只验证真实主进程、健康、HTTP、启停和稳定数据切换，不夸大成真实 Shopify 生命周期。

测试容器已全部停止，保留镜像、三个退出容器及合成卷便于核查，没有删除已有资源。单写者由演练顺序保证，**未证明多个服务同时写同一文件具备跨进程互斥**；发布继续禁止新旧实例共享卷并行写入。

## 仍然保留的限制

- 此测试镜像是精确二进制加 Alpine 的隔离运行包装，尚未核对未来共享发布包装与现有 Compose 的全部差异，不能直接把测试标签填入生产。
- 备用仅处理 App Home 脚本/呈现故障，后台实现与候选相同，不能解决该后台自身的缺陷；旧 fd5e0085 直接降级仍禁止。
- 没有真实 Shopify 外连、安装/授权、账号操作、证书链外连验证或生产完整 Caddy 配置加载。前序真实 Caddy/Nginx Windows 环回结果保持独立证据，不称为本轮 Linux 三层生产等价验证。
- `productionAccess=false`、`deploymentAllowed=false`、`backendRollbackAvailable=false`。

## 下一步需要的共享发布授权

在获得明确授权后，先重新只读核对实时基线和完整目标部署包装，再只变更：ERP Web 两条精确路由、共享 Connector 单个服务，以及共用 Caddy 中 ERP 域名七个公开路径的响应头。必须保留其他域名、账号、凭据、业务数据库及原生产客服接入现状，不整体替换 Caddyfile、不重启整个 Compose。

Connector 替换和共用代理热加载可能短暂影响 Shopify 相关请求；不能承诺对生产客服绝对零影响。若要求任何共享请求也不能短暂受影响，应维持现状，另行确定维护窗口/隔离方案。不得因“继续”静默绕过该冲突。

共享部署健康与公网 smoke 完成后，还需用户完成真实审核店闭环、最终媒体、公司/隐私/权限批准引用和 Partner 检查，之后才可通知可以送审。正式提交仍由用户操作。

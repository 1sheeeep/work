# App Home 兼容恢复构建与代理隔离

本轮完成本地构建、数据演练及真实代理程序的环回验证。**没有部署，共享发布及正式送审仍 NO-GO**。未访问生产系统、真实店铺、凭据或生产数据卷。主分支正常 Connector 的页面和业务行为未替换为恢复模式。

## 恢复范围：页面故障，不是通用后台回退

旧版 fd5e0085 写回会静默丢失新状态，继续禁止直接降级。此次备用构建从冻结候选 `0c429e37232b9cf14de8114f02fc90703a1d1f80` 归档生成，**仅替换 embeddedAppHTML** 为无脚本的中英文临时故障提示，保留工作人员授权规则、ERP 和支持链接；不自动登录、安装、授权、读业务数据或引导卸载。

脚本逐文件核对候选/备用归档，唯一差异为 `internal/connectors/shopify/installations/embedded_app.go` 的末尾模板，模板之前的服务端代码保持原字节。存储、撤销、权限、后台清理、原生关联及 API 实现不降级。这是 App Home 前端故障时的**降级可用性方案**，不能修复新版后台逻辑或存储本身的故障；启用后 App Home 暂时不可用，因此不能拿备用版送审，也未授权直接启用它。

本地运行 `node platform/scripts/shopify-connector-rollback-rehearsal.mjs`：

- 旧写→新读、新写→备用写→新读，原安装和新增 pending/卸载回执均保留。
- 备用执行卸载、重复投递、过期清理及陈旧文件写入拒绝；再用候选重开，撤销状态保留、访问和刷新凭据为空、过期记录已清、重复卸载不再生成事件或改变代数。
- 历史旧写导致丢失的负向场景仍保留；无并发的合成备份恢复仍通过，不能据此覆盖在线新数据。
- 15 个演练阶段通过；候选与备用七个公开页面的安全头及工作人员授权文案检查通过。备用安装包另跑 FileRepository/Pending/Uninstall/Native/ManagedInstall/ShopRedact 定向测试通过；未把旧 App Home 完整功能断言用于故障提示页，也不声称备用页面具备正常 App Home 功能。

本轮最终回执：`.codex-doc-build/connector-rollback-2BhV0N/receipt.json`。
两个静态 Linux amd64 二进制由 `CGO_ENABLED=0 go build -trimpath -buildvcs=false` 构建，依赖下载关闭：

| 产物 | SHA256 |
| --- | --- |
| `shopify-connector-current-linux-amd64` | `efa2549944c1ffa431c85cdba3a2e5bec87e072915eba254d1a27b602f6a8723` |
| `shopify-connector-recovery-linux-amd64` | `d7fb6d48371cd351fee161a77b58f8256805ee6f2dfeb96b4e1d29189260faf5` |

产物均在上述回执同目录。**这是交叉构建产物，不是已验证 Linux 容器镜像**。回执保留 deploymentAllowed=false、productionReady=false。

## 代理发现及最小修复

当前 Web Nginx 的精确白名单遗漏 `/shopify/session/link-grant` 和 `/shopify/session/chat-setup`，即使 Connector 更新，这两条 App Home 请求也不会进入 Connector。
本轮只在既有 `session/(...)` 分支加入两个精确名称，无整段路径放开，无内部 Connector API 对外开放。新增 3 个契约测试覆盖 App Home 全部 5 条请求、既有公开/生命周期路径和内部/近似路径拒绝；当前 Shopify Node 全部 **154 项通过**。

## 真实 Caddy + Nginx 环回演练

`node platform/scripts/shopify-proxy-isolation-rehearsal.mjs` 使用本地 Caddy 2.11.4、Nginx 1.28.0 Windows 和合成 HTTP 上游。只监听随机 `127.0.0.1` 端口，Caddy admin/自动 HTTPS/配置持久化关闭，工作目录独立，进程结束时仅终止本脚本创建的子进程；未触碰任何既有服务。

Nginx 使用项目真实 Shopify location 块，仅把上游地址替换成环回并加测试识别头；其他路径使用合成上游标记，不模拟全部 ERP 权限。Caddy 使用合成的 ERP/客服域名：仅 ERP 七个公开路径取消 X-Frame-Options，保留上游验证后的 CSP；缺头时默认拒绝嵌入、no-referrer。其他域名/非目标路径保持旧规则。

**19 项实测通过**：七页安全头和路由、合成已验证店铺 CSP 保留、两个新增 POST 路由、七个非目标路径、其他域名不变、503 缺头时安全默认值。回执 `.codex-doc-build/proxy-isolation-GSfWFx/receipt.json`。这里的“已验证店铺”是上游合成响应，不是 Shopify 签名或真实审核店验收；真实签名规则仍由已有 Go 测试覆盖。

工具来自官方发行：Caddy ZIP SHA256 `1708333f79e274c7697285afe6d592ab39314e0b131e9ec6bea08ad27df62ebf`，另对照官方 SHA512 清单校验；Nginx ZIP 从 nginx.org HTTPS 获取，SHA256 `db8c7a529f84c819702bd1c50926b27d961a48b4f72fc7c46b30314fc2bbfd7c`（该值为本地实测，不是已验证官方签名）。工具只留 `.codex-doc-build`，不提交二进制。

依据：[Caddy 条件响应头](https://caddyserver.com/docs/caddyfile/directives/header)、[Caddy 校验与运行](https://caddyserver.com/docs/command-line)、[Nginx Windows 限制](https://nginx.org/en/docs/windows.html)。Windows 环回结果不能冒充 Linux 容器、生产完整配置或并发负载验收。

## 下一步发布门槛

1. 以精确源码/产物封装并验证 Linux 候选及备用容器，验证启停、单写者约束和健康检查。备用仅覆盖页面故障；后台故障需修复前进或经明确授权的维护/写入冻结与事件处理方案，不能承诺通用无损降级。
2. 共享变更必须获得具体发布范围授权：Connector 容器 + ERP 域名七条路径的 Caddy 响应头；Web 仅上述两条路由。不替换整个 Caddyfile，不重启整个 Compose，不改客服账号、业务数据库或原生产接入。
3. 发布前重新核实实际代理配置和镜像，避免其他任务期间的配置漂移；备份不等于授权读取/恢复凭据或覆盖新事件。共享热加载也影响公共入口，不能称为绝对零风险。
4. 公网七页 smoke、接口路径/拒绝边界和组件健康通过后，再由用户做真实审核店安装/重授权、两业务与插件闭环、最终媒体及 Partner 检查。当前材料 NO-GO 不变。

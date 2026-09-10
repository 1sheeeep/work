# Connector 本地隔离与回退演练

结论：**演练完成，直接降级不安全；共享发布仍 NO-GO**。本次只运行本地合成演练，没有 SSH、真实 Shopify 请求、生产凭据/数据访问或部署；没有修改生产代码的数据格式。

## 精确版本与方法

- 线上旧版本源码：`fd5e0085885140810102e46ee3e0253b362fd57e`，对应前序只读核实的 Connector `20260827T061555Z-shopify-returns-fd5e0085`。本次未重新访问服务器。
- 候选源码：`0c429e37232b9cf14de8114f02fc90703a1d1f80`。
- 运行 `node platform/scripts/shopify-connector-rollback-rehearsal.mjs`，不接受路径、URL 或凭据参数。分别 git archive 两个精确版本，在本地唯一临时目录加入测试夹具，调用两个版本各自真实的 FileRepository 实现，不用模拟旧 JSON 结构代替旧代码。
- 合成 AES 密钥、店铺、安装与授权记录仅存在本机演练目录；不加载部署环境。Go 依赖下载关闭，不启动 Connector 主进程、后台任务或 Docker，不接生产卷。公开页面使用 httptest 内存请求，不访问真实店铺。
- 方法依据：Go 官方说明 JSON 默认忽略未知字段，所以必须验证旧程序后续写回行为，而不能只验证“文件能打开”。见 [encoding/json 官方文档](https://pkg.go.dev/encoding/json)。

## 实测结果

| 阶段 | 结果与限制 |
| --- | --- |
| 旧代码写合成安装，新代码读取 | 原安装、归属及合成凭据保留；不代表全部生产记录已验证 |
| 新代码写待关联授权、卸载回执并重开 | 新字段及 pendingRevision 保留 |
| 旧代码只读新版文件 | 打开成功、旧安装可读，文件字节未变化 |
| 旧代码执行一次既有 SaveBinding 写入 | **pendingInstallations、pendingRevision、uninstallReceipts 丢失**；旧安装仍存在。这是危险的静默丢失，不是启动失败 |
| 从合成备份恢复后用新代码打开 | SHA256 相同，旧安装和上述新状态恢复；只证明无并发写入的合成恢复 |
| 新代码公开七页 | HTTP 200、frame-ancestors 'none'、no-referrer、nosniff 通过；App Home/terms/support/guide 的三条工作人员授权标记通过。不是共用代理运行时或 Shopify 嵌入验收 |

脚本 10 个阶段通过；另复跑 Connector 根包、adminapi、installations、migration、cmd/shopify-connector 共 5 包，Go JSON **501 个通过事件（包含子测试）、0 跳过、0 失败**；go vet 通过。不是 501 个独立业务流程。

本次回执：`.codex-doc-build/connector-rollback-H3Cj8I/receipt.json`。
合成备份 SHA256：`c79a11a6bffe5e5aca3a3e45d747a8035142c7ee490b9b809f1bc86bdd6be2fa`。随机加密 nonce 使不同运行的密文哈希不同，不影响断言。
回执明确 `legacyWriteDropsNewFields=true`、`concurrentWriteRestoreSafe=false`、`deploymentAllowed=false`、`productionReady=false`。

## 已确定的发布约束

1. **禁止把 fd5e0085 或更早镜像作为候选版本写入后的直接回退镜像**。镜像还在、health 通过、文件可解密都不能解除此限制。
2. 不允许新旧容器同时写同一加密文件。并发状态及新事件可能被旧结构写回覆盖；单次恢复成功不代表在线恢复安全。
3. 不得在已恢复流量后直接覆盖发布前备份，会丢掉期间的新授权/撤销/事件。不能为回退而恢复旧有效凭据或消除卸载回执。
4. 推荐下一切片准备**保留新版存储/撤销语义的兼容回退构建**，仅回退经过识别的业务变更，再以“新版写入→回退构建写入→新版重读”、卸载去重、待授权过期、撤销不复活和并发写入拒绝验证；尚未实现/验证，不能宣称可用。
5. 在兼容回退闭合以前，保留生产现状，不用无回退的发布换取门禁变绿。若必须依赖冻结写入、事件补偿或维护窗口，须先明确它们对共用服务的影响并获得具体授权。

## 路由隔离依据（前序只读核查）

实际链路：ERP 域名 → 生产共用 `deploy-web-1` Caddy → `xz-erp-test-web-1` Nginx → `xz-erp-shopify-connector-1`。
旧 Connector 自身返回旧 framing/说明；共用 Caddy 的 ERP 站点还统一设置 SAMEORIGIN 和旧 Referrer-Policy。只发布 Web 无法解决两层问题。

Caddy 站点配置文件前序 SHA256 `7993c937a181e0420ac7174c7ac1eeca8bfc9589cd01230cb6511ac72b0612fa`；Connector Compose `7f6d5234fc519efc5d79698728c96ecfb00aad24edc0a6675d282d729d193780`。这些是核查时的磁盘文件证据，不替代下一次发布前运行配置核实。不得整体复制仓库历史 Caddy 模板；后续只考虑 ERP Shopify 相关路径，保持其他域名/身份边界不变。

剩余：兼容回退构建与隔离代理演练、明确的共享组件发布范围授权、真实审核店人工验收、最终媒体和负责人证据。负责人以前的政策批准仍有效引用，不重复索取相同批准。

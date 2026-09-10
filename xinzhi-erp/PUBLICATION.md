# 协作源码初始版本检查（2026-09-10）

本次只发布源码，不部署、不访问生产数据库，不变更生产环境访问权限。

- 独立源码快照，不导入原仓库的 903 个历史提交；原工作区文件与历史不改动。
- 原跟踪文件采用工作区当前内容；补入统一客服入口的新后端源码/测试和构建准备模板。
- 未批准的财务、供应商独立功能、商品合规与仓库加工页面未导入，原处保留。
- 不含真实运行证据、审核/教程截图、参考资料、One、备份和依赖缓存。
- 历史客服帮助页的部分教程图片未导入，相应图片暂缺，不影响 ERP 前端构建。
- 客服 sourcepage 测试里的订单免登录 URL 与账号示例替换为虚构数据。没有访问这些链接，也不声称生产凭据已轮换。
- Gitleaks v8.30.1 对待提交内容扫描通过。`.gitleaks.toml` 只对白名单文件中的精确虚构测试值和浏览器存储键放行，不忽略整个业务目录。
- 独立目录执行前端 `npm ci --ignore-scripts`、`npm run build` 成功；客服入口 3 个测试文件共 33 项通过。
- `go test ./internal/sourcepage -count=1` 通过。
- 当前 Docker daemon 未运行，Java/Maven 不在 PATH，本次未重新运行 Java 后端测试、完整数据库启动或生产验收；既往结果仅见状态文件。

后续从本仓库 clone，使用独立功能分支和 PR。不要将原仓库 main 的历史 push/merge 到这里，也不要使用 `--allow-unrelated-histories` 或强推合并两套历史。

Gitleaks 官方项目：https://github.com/gitleaks/gitleaks 。在仓库根目录使用 `gitleaks git . --redact` 检查提交历史，或 `gitleaks git . --staged --redact` 检查暂存区。

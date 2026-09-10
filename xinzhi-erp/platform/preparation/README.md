# 接入准备执行边界

当前目录不是可直接上线的部署包。变更性 SQL 只在独占合成数据库演练执行，没有自动迁移、账号初始化或凭据加载。native-cs-schema-readonly.sql 仅查询结构目录；native-cs-access-summary-readonly.sql 仅查询另行授权的登录/权限/已保存安装授权聚合。两者均不由启动流程执行。2026-09-07 授权证据位于 evidence/，无人员/店铺标识、凭据或业务内容。

库存命令、两来源实际客户端、共享预算/事件候选见 `platform/docs/inventory-command-preparation-rehearsal.md`；原生迁移保护、39 表快照、实际备份恢复和无适配器回退见 `platform/docs/native-customer-service-identity-preparation.md`。均为未挂载本地子检查，不是完整双业务切换；身份源码清单不包含这些全部切片，不能作为整个接入发布包。

## 已有可重复检查

- `node platform/scripts/windows-maven-agent-path-gate.mjs --store-app-preparation`：固定身份、同源表单、双库恢复、读取、库存双来源和预算/事件 PostgreSQL 检查。
- `node platform/scripts/windows-maven-agent-path-gate.mjs --full`：后台全量，结果独立记录。
- `node --test platform/scripts/identity-preparation-source-manifest.test.mjs`：准备源码清单自身检查。
- `node platform/scripts/identity-preparation-source-manifest.mjs`：只读输出身份准备相关文件的 SHA-256 摘要，不创建包、不读取环境凭据、不运行部署。
- `node --test platform/scripts/native-cs-schema-baseline-rehearsal.test.mjs`：只读结构比较器与 SQL 保护测试；6 项通过。
- `node --test platform/scripts/native-cs-access-summary.test.mjs`：聚合查询保护、分类计数与数据最小化检查；7 项通过，不调用生产。
- `node platform/scripts/native-cs-schema-baseline-rehearsal.mjs`：仅固定 ERP 自有归档、本机断网空库结构重建；拒绝任何额外参数。本机 Docker 按授权重启后实际流程通过；工具不会自动恢复 Docker/WSL。
- 客服相关 Go 测试和保护快照检查见 `platform/docs/customer-service-identity-preparation-rehearsal.md` 与 `customer-service-preservation-check.md`。

源码清单严格固定范围，不接受调用者提供目录/凭据文件，不包含 .env、图片或用户参考资料。清单只是此刻源码指纹，**不证明这些文件全属本次修改、测试与源码一致、可以部署或生产就绪**。文件中若混有既有改动，必须按差异另行审查；不能将整个脏工作区直接打包上线。

## 发布前检查顺序

1. 冻结本次明确源文件与变更范围，记录基准提交、实际变更和清单摘要；未确认的既有改动不纳入。
2. 在隔离副本构建精确候选版本，重新运行对应测试并保留版本关联证据；禁止以较旧测试报告覆盖新代码。
3. 验证默认启动不挂载新登录、不运行 SQL、不外连、不迁账号、不切换店铺，不影响原生认证及业务。
4. 证明可回退程序/路由，原数据持续归各业务所有。**不恢复旧数据库覆盖新增消息/订单**；未知写入必须先核对。
5. 只有上述满足后才考虑用户已许可的准备性部署。正式接入、真实人员合并/店铺切换、UAT 停用或删除仍须用户另行通知。

## 当前不具备的放行证据

真实浏览器完整流程尚未验证：Chrome 报客户端拦截；内置浏览器表单 POST 已到达本地服务，但 Origin 不等于演练页同源地址，安全过滤拒绝为 403。未放宽 Origin/CSRF 或改浏览器安全设置。Java HTTP 正负向表单检查通过不能替代真实浏览器。

库存双来源日志/claim、现有客户端与共同预算的本地 HTTP 闭环已通过，事件有持久候选，但全部业务写入共同入口、原有调用路径预算接管、Webhook/补拉 Worker 尚未闭合。真实预算容量/成本也未核验。源端 39 表保护、聊天/邮件存储连续性及回退在固定原生合成库通过，不替代完整插件/邮箱网络流程或生产核验。最新只读生产版本标识为 5f8a1f3，结构目录含 39 表，额外历史关联已用合成记录补保护，固定空库差异与 39 表结构匹配、恢复、回退均通过；本机 Docker 已恢复。授权内登录/权限分类和 238 条已保存安装授权摘要已核验，但未实时验权、查询资源余量或峰值使用；详见 ../docs/native-customer-service-access-review-2026-09-07.md。详见 ../docs/native-customer-service-production-baseline-2026-09-07.md，当前状态以根目录 DEV_STATE 为准。

这些缺口不能由源码清单、SQL 成功、接口测试或容器健康替代。保持 NO-GO，不把“不用每步问”解释为生产接入许可。

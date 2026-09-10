# 原生产客服：登录、权限与已保存安装授权核验

状态：**授权内只读核验完成；接入仍 NO-GO**。观察时间 2026-09-07 19:10—19:13（Asia/Shanghai）。用户本轮“确认”仅允许核验当前登录方式、权限配置、安装记录中已保存的授权摘要；不包含修改账号/店铺、读取密码或 Token、调用真实 Shopify API 或正式接入。

## 检查方式与限制

- 使用既有 SSH 通道；查询固定原生源码/公开登录静态资源，以及生产 PostgreSQL 聚合统计。不读取环境凭据、密码散列、访问凭据、会话、聊天/邮件或订单内容。
- [SQL](../preparation/sql/native-cs-access-summary-readonly.sql) 为重复读只读事务，语句 5 秒、锁 2 秒、空闲事务 10 秒上限，最后 ROLLBACK。只输出白名单分类与计数；未导出人员姓名、邮箱、主键、店铺域名、应用 ID、身份关联值或原始 metadata。
- [聚合回执](../preparation/evidence/2026-09-07-native-cs-access-summary.json) 确认 readOnly=on；这是保存记录的快照，不是实时 Shopify 授权验证或可上线许可。7 项本地保护/计数核对测试通过，未执行生产写入测试或真实登录。

## 登录事实

原客服健康接口仍报告 green / 20260905T160517Z-5f8a1f3ab3a3 / postgres ok。公开 /login 返回 200，未认证 /api/v1/auth/me 返回 401，没有携带用户会话。

登录页面加载 /assets/index-qnu1e5ph.js，SHA-256 为 fec201f302662cc6c42dbf46c801ef6a99fbc1e5590db7536daec1d6f6e11ead。公开脚本存在 /api/v1/auth/login，未发现 /api/v1/auth/one、/auth/one 或 one.xzkj.ai 字符串。固定发布源码的 AuthPanel 是邮箱/密码表单，api.ts 向原生登录接口提交；server.go 校验账号有效状态及密码后创建原生会话。公开入口/源码证据支持原生直登，**并非真实账号登录验收，也不能仅凭字符串扫描排除所有历史配置**。

关键副作用：原生 handleLogin 会让具备 workbench.access 的客服部坐席上线，handleLogout 会使相应坐席下线。因此身份验证/会话兑换不能转调原生 login/logout 来省略独立协议；本轮没有调用它们，未改变接待状态。

历史 one_identity_links 实有 1 条关联，涉及 1 个原用户。仅查询数量，没有读取 issuer、subject 或关联主键；不能删除该表，不能把该关联自动认领为 ERP 人员映射，也不能因此重新启用 One。前序 39 表合成保护覆盖表结构和虚构关联，不是复制了此真实记录。

## 权限配置摘要

- 原账号 18 个，均为 active；其中 admin 角色 4 个，agent 角色 14 个。system_admin=true 只有 1 个，不能把另外 3 个 admin 自动提升为系统管理员。
- 17 个账号 permissions_customized=true。13 个 agent 属客服部，1 个 agent 属综合部；原生逻辑会限制非客服部门 agent 的权限，不能直接按存储 permissions 数组放行。
- shop_scope：15 个 all、3 个 assigned；workbench_shop_scope：2 个 all、16 个 assigned。没有 selected 店铺数组内容的账号；分配表有 247 条关联，涉及 9 个账号、246 个店铺。分配集合不等同 Shopify 安装集合，不能据 246 与 238 的差异判断数据错误。
- 六个 data_scopes 模块在全部 18 个账号中均保存 all；但原生 effectiveModuleScope/userHasPermission 仍按模块权限、部门和 shop_scope 判定，**这不代表所有账号拥有所有模块或店铺权限**。
- 存储数组中 orders.view 为 12 个、orders.refund/orders.disputes 各 10 个、shops.channels.manage 为 16 个、workbench.access 为 15 个。它们是存储计数，不是最终有效权限人数；系统管理员、默认权限、旧权限展开和部门限制必须继续由原客服逻辑处理。
- 权限数组、模块范围对象、selected 店铺数组均没有发现 JSON 类型异常。没有修改权限或重放原 SQL。

## 已保存的 Shopify 安装授权

238 条安装均映射到 active 店铺，均有 App profile，保存域名匹配；无空 scope、无重复域名或重复 shop_id 分组。未核验真实凭据有效性、实际 Shopify Shop ID、上游限额或安装当前是否仍有效。保存记录 updated_at 范围为 2026-07-20T07:33:57Z 至 2026-09-07T10:01:18Z，该时间不能充当“最近实时验权时间”。

| 能力相关保存字段 | 安装数 | 准备约束 |
| --- | ---: | --- |
| write_orders | 238 | 保存记录覆盖订单读/写 scope；并非具体操作、业务权限或上游调用已验收 |
| read_products / read_inventory / read_locations / read_customers | 各 238 | 可以按能力继续做隔离读取准备，仍需原来源按操作重新核验 |
| write_inventory | 0 | 原客服来源库存写入不可按当前记录放行；不自动补权或改走另一来源 |
| write_order_edits | 0 | 订单编辑保持不可用，不以 write_orders 代替 |
| read_all_orders | 0 | 不承诺超过默认窗口的历史订单完整性，不能把分页结束视为全部历史已同步 |
| write_products / write_customers | 各 0 | 不把读权限当作写权限，不扩展已批准产品范围 |
| write_returns | 232 | 另有 6 条保存 read_returns；汇总不证明两组互斥，仍按各自授予范围判定 |
| 三类 write_*_fulfillment_orders | 各 232 | 必须继续区分履约单服务归属，不能推断所有履约操作可用 |

write scope 包含相应 read scope，因此不能因为单独 read_orders 计数为 0 就认定不能读订单；默认订单可见窗口为最近 60 天，更早数据需要额外 read_all_orders。[Shopify 官方授权说明](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes)

## 对后续准备的影响

1. 不把 238 条保存 scope 当作实时可信绑定，不把合成库存写入成功套用于生产；现有库存候选缺 write_inventory 时拒绝，不启用真实请求。
2. 事件/增量补拉沿用原应用验签、安装归属及原队列；只有所选来源、操作、原业务权限均满足时才可取数。历史覆盖不足要明确暴露，不能推进成“全量完成”。本次未查询队列业务记录或调用上游。
3. 接入身份保持原用户主键、系统管理员标记、部门权限、店铺/工作台范围和历史关联；不按角色名、邮箱或历史关联自动合并，不使用原登录接口隐式上线。
4. 来源事件/实际补拉、全批准操作共同入口、预算接管、双业务冻结与原来源回执、真实浏览器等仍未全部闭合。本轮是只读事实核验，不代表这些代码/流程已经完成。
5. 正式接入、增权授权、真实登录/安装操作、业务流量切换及 UAT 退役继续等用户明确命令。当前无需为了完成本地准备先执行这些生产动作。

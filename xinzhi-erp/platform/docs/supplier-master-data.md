# 供应商主数据

> **状态：核心能力已启用。** 本模块服务采购闭环，提供供应商主档、SKU 供货关系、导入导出与采购单快捷新增。合同、KPI、质量、对账、第三方授权和供应商门户继续暂停。

## 业务模型

- 供应商主档：业务编码、名称、状态、联系人、地址、税务登记号、结算币种、账期与备注。
- SKU 供货关系：供应商 SKU、采购单价及币种、最小起订量、交期、状态和首选标记。
- 一个 SKU 可关联多个供应商，但同一租户内最多一个有效首选关系；切换首选时由后端事务自动取消旧首选。
- 停用供应商保留历史并退出采购选择；归档供应商永久只读。有关联数据时不提供物理删除。
- 采购单只读取有效供应商与有效 SKU 关系，并保存下单时的供应商和供应商 SKU 快照。

## API

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET / POST | `/api/v1/suppliers` | `suppliers.read` / `suppliers.write` | 分页查询或新增供应商 |
| GET / PUT | `/api/v1/suppliers/{supplierId}` | `suppliers.read` / `suppliers.write` | 读取或按版本更新供应商 |
| POST | `/api/v1/suppliers/import` | `suppliers.write` | 原子导入 1–200 家供应商 |
| POST | `/api/v1/suppliers/with-sku-mapping` | `suppliers.write` | 原子新增供应商并绑定 SKU |
| GET / POST | `/api/v1/suppliers/{supplierId}/sku-mappings` | `suppliers.read` / `suppliers.write` | 查询或新增 SKU 供货关系 |
| PUT | `/api/v1/suppliers/{supplierId}/sku-mappings/{mappingId}` | `suppliers.write` | 按版本更新供货关系 |
| GET | `/api/v1/suppliers/preferred-sku-summaries` | `suppliers.read` | 批量读取首选供应商摘要 |

租户只能来自认证后的 `ErpPrincipal.tenantId`，请求中的租户模拟头不参与查询或授权。不存在和跨租户资源使用安全的 404 响应，响应不暴露 `tenantId`。所有写操作记录操作者、动作、资源标识和安全元数据，不把联系人、地址、税号或备注写入审计详情。

## 导入导出

CSV 导入使用固定表头，前端先校验格式、长度、邮箱、币种、账期和文件内重复编码，后端再次校验并整批提交。任一行失败时整批不写入。导出使用当前筛选条件，最多导出 10,000 条。

## 数据迁移

- `V38__supplier_master_data.sql`：供应商基础表与权限目录。
- `V39__supplier_sku_mappings.sql`：供应商 SKU 关系。
- `V111__supplier_management_core.sql`：结算、税务、采购价与 MOQ 字段及数据库约束。

历史记录和既有授权保持不变；迁移不删除或重写用户数据。

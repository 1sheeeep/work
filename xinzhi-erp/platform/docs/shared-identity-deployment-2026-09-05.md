# 共享账号部署交接 · 2026-09-05

仅部署已授权的 ERP 测试与复制客服 UAT。没有操作原生产客服、One、真实 Shopify 店铺或正式送审。用户业务及视觉验收未代为宣告。

## 当前版本

- ERP 前端：20260905T133200Z-shared-entry-b145d96f，源提交 b145d96f；线上主资源 /assets/index-ChsGu7ef.js。
- ERP 后端、复制客服 API/前端：20260905T131900Z-shared-erp-f83c0b0f，源提交 f83c0b0f。
- 四个应用容器 healthy，两组 loopback readyz 返回 ready。ERP /login、/customer-service 公网 200；客服 bootstrap 返回 erp_sso、needsBootstrap=false，ERP 登录目标为 https://erp.xzkj.ai/customer-service。
- 共享 Connector 未更新，仍为 20260827T061555Z-shopify-returns-fd5e0085。暂停模块和其他任务的测试框架升级未带入发布。

## 已实现与验证

ERP 顶部导航和应用切换器均在当前标签页经 /customer-service 签发并 POST 单次凭证。无第二套客服密码，不传 ERP 密码/bearer token。保留 ERP 的 sessionStorage 安全边界：全新标签页无 ERP 会话时需要先登录 ERP，不宣称跨所有标签页无条件免登录。

客服只使用既有租户，保留原坐席、停用状态、固定 ERP 主键及本地权限/店铺配置。ERP 权限与本地权限取交集，ERP 身份验证缓存最多 5 秒、实时连接每 15 秒复核。客服重启后需经 ERP 重新进入。没有重置密码、认领邮箱或新增数据库迁移。

自动化通过：ERP 前端全量 175 文件 / 1213 项、Java 定向 3 套件 / 14 项、Go 7 个相关包 test 及 3 个定向包 vet、Node 7 文件 / 118 项；前端修正另跑 3 文件 / 24 项。定版镜像构建通过，保留既有大包警告；不宣称 Java 全量测试通过。

Chrome 本机真实客服 API + 合成 ERP 跑通一次签发/一次消费、无第二次密码、撤权后返回登录提示。线上 Chrome 已验证真实客服独立网址的“使用 ERP 账号登录”；新的 ERP 验证标签页停在原生登录表单，已请用户人工登录。未读取或代填密码，实际账号端到端尚未完成。

客服运行配置到达 ERP 的兑换/复核接口，合成无效凭证均返回 403 customer_service_entry_invalid；这是服务认证/路由与无效证明拒绝证据，不是真实登录成功证据。

## 备份和回滚

备份目录：/opt/xz-erp-test/backups/shared-identity-20260905T131900Z-shared-erp-f83c0b0f，包含两数据库归档、旧 env/compose 和镜像记录。SHA256、归档检查及无网络临时 PostgreSQL 实际恢复通过：ERP 145 表、客服 39 表、Flyway 123。临时恢复容器与副本已清理，原数据库及备份完整保留。

前端补丁配置备份：/opt/xz-erp-test/backups/web-20260905T133200Z-shared-entry-b145d96f。发布脚本包含失败回滚，本次没有触发切回。旧原生恢复 operator.sh 已替换为禁用 apply 的版本，旧副本留在初始备份；未执行账号恢复。

## 送审仍未完成

实际账号跨业务及权限/消息验收、真实 Shopify 安装/关联/主题启用/双向消息/卸载重装、最终截图录屏和提交仍待人工步骤。门禁仍 NO-GO：两张最终图片、旧字幕缺 9 个 scope 标识（内部证据规则，不是 Shopify 强制逐字朗读）、78 项未勾选、14 处占位。

无既有 ERP 账号的新商家开户尚未闭合；共享 Connector 的本地新实现尚未部署，因其涉及原生产客服，不能默认随本次 UAT 切换。不能据此声称整个公开应用已可正式送审。

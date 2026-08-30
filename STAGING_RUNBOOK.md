# 预发布与本地 BOSS CDP 连接器试运行

## 环境准备

1. 为预发布准备独立主机、数据库卷和域名，不复用生产数据。
2. 复制 `.env.staging.example` 为 `.env.staging`，设置真实预发布域名。
3. 创建数据库和管理员密码文件，权限设为 `0600`。
4. 每个 BOSS 测试账号准备独立 Chrome Profile，由 HR 手动登录，不复制 Cookie 或 Profile。

## 发布

```sh
docker compose --env-file .env.staging -f compose.staging.yaml config
docker compose --env-file .env.staging -f compose.staging.yaml up -d --build
docker compose --env-file .env.staging -f compose.staging.yaml ps
scripts/smoke-test.sh https://recruitment-staging.example.com
```

## 试运行顺序

1. 为每个测试账号配置不同的 `profileKey` 和 CDP 本地端口，运行本地连接器的 `login` 命令，在打开的独立 Chrome Profile 中由 HR 手动登录。
2. 在招聘控制台为目标账号生成 10 分钟一次性配对码，运行本地连接器的 `pair` 命令完成设备配对。
3. 运行本地连接器的 `start` 命令，先只监测会话、消息方向和时间，不开启自动发送。
4. 验证登录失效、验证码、风险提示、DOM 变化、后端失联和人工接管均能停止发送。
5. 分别制造非阻断消息通知和页面覆盖提示：前者不得导致页面卡死，后者必须暂停；连接器不得关闭弹窗、切换会话或点击页面。
6. 验证会话切换、消息列表加载和页面重绘时需要连续稳定快照，期间不得申请发送或执行页面动作。
7. 仅验证后台安全草稿：确认超时判定、岗位资料和模板变量正确，由 HR 在 BOSS 页面手动发送。
8. 真实自动发送尚未实现；必须完成实页适配、单账号只读观察和单独书面验收后，才可讨论受控试发。

## 真实账号上线门禁

- 四项准备检查必须全部通过：账号已连接、招聘系统在线、会话页面已识别、人工解除本机紧急停止。
- 每个账号使用独立 Chrome Profile；不复制 Profile、Cookie、Local Storage 或登录令牌。
- 首次适配只能由授权 HR 在测试会话中学习选择器，选择器摘要和脱敏诊断留档。
- 只监测至少一个工作日，覆盖新消息弹窗、切换会话、前后台切换、重新登录和页面刷新。
- 草稿模式至少验证超时前人工回复不触发、托管到期不触发、人工接管不触发。
- 未取得平台允许、实页验证和企业内部授权前，不进入自动发送实现或试运行。

## 停止条件

- 任何验证码、风险提示、登录异常、误识别、误发、重复发送、平台告警或投诉都必须立即关闭该账号策略并撤销设备。
- 不允许导出 Cookie、调用网页私有接口、伪造指纹或绕过验证码/风控。
## 真实账号只监测试运行

当前测试阶段必须同时保持：

- `APP_AUTO_REPLY_ENABLED=false`
- `APP_BROWSER_MONITOR_ONLY=true`
- 本地连接器以 `start` 或 `observe` 命令运行
- 不同步消息正文

学习页面结构时不进行导航、点击、输入或发送。只监测模式下连接器仅同步未读计数、岗位标题和不可逆摘要；服务端保持 `MONITOR_ONLY`，不会签发或执行发送动作。

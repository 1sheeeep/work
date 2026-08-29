# 预发布与 BOSS 浏览器伴随端试运行

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

1. 在已登录 BOSS 招聘端的 Chrome Profile 中加载 `boss-browser-extension`。
2. 在招聘控制台为目标账号生成 10 分钟一次性配对码，完成设备配对。
3. 学习真实聊天页面 DOM，先只监测会话、消息方向和时间，不开启自动发送。
4. 验证登录失效、验证码、风险提示、DOM 变化、后端失联和人工接管均能停止发送。
5. 分别制造非阻断消息通知和覆盖输入区域的弹窗：前者不得导致页面卡死，后者必须在填写或点击前停机，扩展不得自动关闭弹窗。
6. 验证会话切换、消息列表加载和页面重绘时需要连续稳定快照，期间不得申请发送或点击按钮。
7. 进入仅草稿模式，确认超时判定和模板变量正确。
8. 使用可控候选人会话开启单账号小配额试发，观察至少一个工作日后再扩大。

## 真实账号上线门禁

- 四项准备检查必须全部通过：账号已连接、招聘系统在线、会话页面已识别、人工解除本机紧急停止。
- 每个账号使用独立 Chrome Profile；不复制 Profile、Cookie、Local Storage 或登录令牌。
- 首次适配只能由授权 HR 在测试会话中学习选择器，选择器摘要和脱敏诊断留档。
- 只监测至少一个工作日，覆盖新消息弹窗、切换会话、前后台切换、重新登录和页面刷新。
- 草稿模式至少验证超时前人工回复不触发、托管到期不触发、人工接管不触发。
- 自动试发从单账号、单会话、极低日配额开始；结果不确定时禁止自动重试。
- 未取得平台允许或企业内部授权前，不进入正式自动发送。

## 停止条件

- 任何验证码、风险提示、登录异常、误识别、误发、重复发送、平台告警或投诉都必须立即关闭该账号策略并撤销设备。
- 不允许导出 Cookie、调用网页私有接口、伪造指纹或绕过验证码/风控。
## 真实账号只监测试运行

当前测试阶段必须同时保持：

- `APP_AUTO_REPLY_ENABLED=false`
- `APP_BROWSER_MONITOR_ONLY=true`
- 扩展设置中的“只监测模式”开启
- “同步消息正文”关闭

学习页面选择器时保持“本机紧急停止”开启；需要验证消息状态同步时，可以关闭紧急停止，但不得关闭“只监测模式”。只监测模式下扩展后台拒绝发送租约，服务端也返回 `MONITOR_ONLY`，不会填写输入框或点击发送按钮。

# BOSS 会话伴随助手（开发中）

这是原招聘项目的 Chrome Manifest V3 网页伴随端，用于在没有官方招聘消息 API 时识别已登录页面中的超时未回复会话。

## 安全边界

- 不读取、导出或上传 Cookie、Token 和密码。
- 不调用网页私有接口，不伪造指纹，不绕过验证码或风险提示。
- 新安装默认开启本机紧急停止；页面选择器不完整时失败关闭。
- 是否启用、自动发送、超时、配额、时段和回复模板均从后端账号策略读取；未配对或后端不可达时自动发送强制关闭。
- 后端先为最新来信签发单次 45 秒发送租约，发送前再等待 3 秒复核。
- 点击后必须在 DOM 中看到文本一致的外发消息才记账；结果不确定时停发且禁止自动重试。
- 多标签页使用主标签租约互斥，消息 ID 缺失、方向未知或时间无效时不猜测。
- 按 Chrome Profile 隔离多账号，每个 Profile 只登录一个招聘账号。

## 开发者加载

1. Chrome 打开 `chrome://extensions` 并启用开发者模式。
2. 选择“加载已解压的扩展程序”，指向本目录。
3. 在招聘控制台“自动跟进”页为目标账号生成一次性配对令牌，10 分钟内输入扩展设置页。
4. 每个 Chrome Profile 只配对一个 BOSS 账号；重新配对会撤销该账号的旧设备令牌。
5. 在获得合法的招聘端测试账号后，可在设置页用“从页面选取”学习 DOM；先保持紧急停止开启完成只读验收。

## 本地适配器夹具

在本目录执行 `python3 -m http.server 8091`，打开 `http://localhost:8091/fixtures/boss-chat.html`。选择器配置为：

- 当前会话 `.active-chat`，会话 ID 属性 `data-conversation-id`
- 候选人 `.candidate-name`，职位 `.job-title`
- 消息 `.message`，消息 ID `data-message-id`，方向 `data-direction`，时间 `data-created-at`
- 输入框 `#editor`，发送按钮 `#send`

真实 BOSS 招聘端 DOM 尚未取得，因此选择器不会在代码中猜测或预置。

后端地址如果不是 localhost，保存或配对时 Chrome 会按该精确 origin 单独请求访问权限。

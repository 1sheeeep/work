# BOSS 会话伴随助手（开发中）

这是原招聘项目的 Chrome Manifest V3 网页伴随端，用于在没有官方招聘消息 API 时识别已登录页面中的超时未回复会话。

## 安全边界

- 不读取、导出或上传 Cookie、Token 和密码。
- 不调用网页私有接口，不伪造指纹，不绕过验证码或风险提示。
- 默认关闭监测和自动发送；页面选择器不完整时失败关闭。
- 发送前等待 3 秒并再次确认最新消息仍来自候选人。
- 按 Chrome Profile 隔离多账号，每个 Profile 只登录一个招聘账号。

## 开发者加载

1. Chrome 打开 `chrome://extensions` 并启用开发者模式。
2. 选择“加载已解压的扩展程序”，指向本目录。
3. 在获得合法的招聘端测试账号后，先只配置选择器并开启监测，不开启自动发送。

## 本地适配器夹具

在本目录执行 `python3 -m http.server 8091`，打开 `http://localhost:8091/fixtures/boss-chat.html`。选择器配置为：

- 当前会话 `.active-chat`，会话 ID 属性 `data-conversation-id`
- 候选人 `.candidate-name`，职位 `.job-title`
- 消息 `.message`，消息 ID `data-message-id`，方向 `data-direction`，时间 `data-created-at`
- 输入框 `#editor`，发送按钮 `#send`

真实 BOSS 招聘端 DOM 尚未取得，因此选择器不会在代码中猜测或预置。

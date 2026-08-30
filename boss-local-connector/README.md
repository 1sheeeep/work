# 本地 BOSS 连接器

本工具在 HR 电脑上为多个 BOSS 账号分别启动可见的 Chrome Profile，并通过本机 CDP 端口建立连接。它不安装浏览器插件，不导出 Cookie、密码、Token 或 Chrome Profile。

当前版本只完成多账号 Profile、手动登录、一次性连接令牌和安全心跳。会话读取、受控回复、简历操作和 AI 分析将在后续版本逐项接入；未接入前所有账号都会以 `PAUSED` 心跳上报，绝不发送消息。

## 初次配置

1. 在后台为每个 BOSS 账号建立“本地 Chrome 连接器”账号，复制其账号 UUID。
2. 将 `connector.config.example.json` 复制为本机私有的 `connector.config.json`，每个账号填写不同的 `profileKey` 和 `cdpPort`。
3. 安装依赖：`npm install`。
4. 为一个账号启动浏览器并由 HR 手动登录：

   ```bash
   node src/index.mjs login --config connector.config.json --account <账号UUID>
   ```

5. 在招聘系统“账号连接”中生成一次性连接令牌，并立即在本机配对：

   ```bash
   node src/index.mjs pair --config connector.config.json --account <账号UUID> --pairing-token <令牌>
   ```

6. 启动全部已启用账号：

   ```bash
   node src/index.mjs start --config connector.config.json
   ```

## 多账号隔离

- 一个账号对应一个 `profileKey`、一个 Chrome 用户数据目录和一个 CDP 端口。
- 一个账号掉线、登录失效或出现验证码，只暂停该账号；其他账号不受影响。
- CDP 仅监听 `127.0.0.1`，不对局域网开放。
- 连接器本地状态默认位于 `~/.recruitment-boss-connector/`，其中只保存后台设备令牌；目录权限为当前操作系统用户可读。

不要将 `connector.config.json`、连接令牌或本地状态目录提交到 Git。

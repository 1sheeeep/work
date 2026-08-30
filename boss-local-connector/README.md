# 本地 BOSS 连接器

本工具在 HR 电脑上为多个 BOSS 账号分别启动可见的 Chrome Profile，并通过本机 CDP 端口建立连接。它不安装浏览器插件，不导出 Cookie、密码、Token 或 Chrome Profile。

当前版本完成多账号 Profile、手动登录、一次性连接令牌、安全心跳和未读会话只监测。连接器只从已打开的沟通页同步会话未读计数、岗位标题及不可逆摘要；若 HR 已手动打开某一会话，还会只读复核最后消息方向与时间，为后台安全草稿提供条件。每个账号每次心跳只建立一个 CDP 会话，并在同一会话内完成页面检查、双快照和当前会话复核。不会上传候选人姓名、会话 ID、消息正文、Cookie 或密码。页面结构、登录状态、风险/验证提示、会话身份或时间不稳定时会暂停相应读取；绝不点击、跳转、填写或发送消息。

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

7. 只检查当前页面状态、不启动常驻进程：

   ```bash
   node src/index.mjs observe --config connector.config.json
   ```

进入真实页面验收前运行综合自检：

```bash
node src/index.mjs preflight --config connector.config.json
```

自检只输出账号标签、检查项和状态，不显示账号 UUID、设备令牌、Cookie 或页面内容。阻断项包括远程 HTTP、状态文件权限过宽、Profile/端口未隔离、未配对和账号冻结；Chrome 尚未运行属于提示项。即使全部通过也只表示可以开始真实页面验收，`readyForProduction` 始终为 `false`。

账号因验证码、风险页或登录失效被冻结后，关闭或重启连接器不会自动恢复。HR 处理完成并停留在沟通页后，执行：

```bash
node src/index.mjs recover --config connector.config.json --account <账号UUID> --confirm-recovery
```

恢复命令会连续执行三次只读页面检查；全部稳定后仅恢复未读监测，页面写能力仍保持关闭。

## 多账号隔离

- 一个账号对应一个 `profileKey`、一个 Chrome 用户数据目录和一个 CDP 端口。
- 一个账号掉线、登录失效或出现验证码，只暂停该账号；其他账号不受影响。
- CDP 仅监听 `127.0.0.1`，不对局域网开放。
- 连接器本地状态默认位于 `~/.recruitment-boss-connector/`，其中只保存后台设备令牌和账号冻结状态；目录权限为当前操作系统用户可读。

不要将 `connector.config.json`、连接令牌或本地状态目录提交到 Git。

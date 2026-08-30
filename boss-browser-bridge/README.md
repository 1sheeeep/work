# BOSS 只读浏览器桥接

这是每个 BOSS 账号独立 Chrome Profile 中安装的最小 Manifest V3 桥接器。它用来替代会触发真实页面跳转的 CDP 只读附着方案。

## 安全边界

- 只读取已打开沟通页的会话 DOM，不会自动跳转。
- 在页面内将会话标识、预览和最后消息转换为 SHA-256 摘要；候选人姓名和消息正文不会上报。
- 岗位标题是唯一可逆页面字段，用于建立待 HR 核对的岗位草稿。
- 不申请 `cookies` / `webRequest` / `debugger` / 下载权限，不读取或传输 BOSS Cookie、Token 和密码。
- 当前版本不包含点击、输入、求简历、交换联系方式或发送消息代码。

## 本地安装（测试阶段）

1. 启动招聘值守台，确认 `http://localhost:8088` 可访问。
2. 在后台“账号与浏览器”为目标 BOSS 账号生成一次性接入码。
3. 在该账号独立 Chrome Profile 中打开 `chrome://extensions`，开启开发者模式。
4. 点击“加载已解压的扩展程序”，选择本目录 `boss-browser-bridge` 。
5. 打开扩展弹窗，粘贴一次性接入码完成配对。
6. 在同一 Profile 中由 HR 手动登录 BOSS，打开沟通页并刷新一次。

多账号部署时，每个 Profile 都单独加载一次此目录，并使用对应账号的一次性接入码。

## 验证

```bash
cd boss-browser-bridge
npm run check
npm test
```

设计参考了 OpenCLI 的“Profile 隔离 + MV3 后台桥接”思路，但本目录的实现为独立编写，不包含 OpenCLI 或 boss-cli 源码，也不调用 BOSS 私有接口。

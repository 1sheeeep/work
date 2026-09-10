# Gmail API 审核演示视频脚本

目标：给 Google 审核人员看清楚应用如何使用 `gmail.readonly`，并证明不使用 Gmail API 发信。

建议视频长度：2 到 4 分钟。

## 视频准备

- 使用测试 Gmail 账号
- 测试邮箱里准备 2 到 3 封未读客户邮件
- 邮件内容不要包含真实客户隐私
- 浏览器中登录测试 Gmail
- 软件中准备一个绑定该 Gmail 的店铺

## 视频脚本

### 1. 介绍应用

画面：打开 Xzdesk Agent 桌面软件。

旁白：

This is Xzdesk Agent with Xzdesk Mail, a local desktop customer service assistant. It helps customer service staff read customer support emails, view thread history, and prepare reply drafts.

### 2. 打开 Gmail 授权

画面：进入邮箱 API 设置页，选择 Gmail 店铺/邮箱，点击 API 授权。

旁白：

The user selects a Gmail account and clicks API authorization. The app opens the Google OAuth consent page.

### 3. 展示 Google OAuth 权限

画面：Google 授权页，重点停留在 Gmail read-only 权限。

旁白：

The app requests only Gmail read-only access. This permission is used to read customer support emails. The app does not request Gmail send permission and does not send emails through Gmail API.

### 4. 完成授权

画面：点击允许，回到软件，显示授权成功。

旁白：

After the user grants permission, the app stores the authorization locally and returns to the desktop app.

### 5. 读取 Gmail 未读邮件

画面：点击读取店铺/读取邮箱。软件显示 Gmail 未读邮件列表。

旁白：

The app reads unread customer support emails from Gmail and displays the sender, subject, received time, message body, and related thread history.

### 6. 展示邮件历史往来

画面：打开一封邮件详情，展示多条历史往来消息。

旁白：

The app displays the email thread in a customer service conversation view so the support agent can understand the customer issue.

### 7. 展示回复仍走 Gmail 网页

画面：点击回复/发送，软件打开 Gmail 网页线程。不要展示 API 自动发信。

旁白：

When replying, the app opens the Gmail web page. The user confirms and sends the reply in Gmail web. The app does not send emails through Gmail API.

### 8. 结束说明

画面：回到软件设置页或隐私政策页面。

旁白：

Gmail data is used only for customer service features in the local desktop app. The data is not sold, not used for advertising, and not shared with unrelated third parties.

## 上传要求

- 上传到 YouTube，设置为 Unlisted / 不公开
- 确保 Google 审核人员可以打开
- 视频链接填写到 OAuth Verification 表单

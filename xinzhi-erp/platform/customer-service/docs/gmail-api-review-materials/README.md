# Gmail API 审核材料包

用途：用于 Google OAuth / Gmail API 审核准备。

当前建议的审核口径：

- 应用：Xzdesk Mail / Xzdesk Agent 桌面软件
- Gmail 权限：只申请 `https://www.googleapis.com/auth/gmail.readonly`
- 使用方式：只读取用户授权邮箱中的未读客服邮件
- 发送方式：不使用 Gmail API 发信，回复仍由客服在 Gmail 网页中发送
- 数据处理：本地软件展示和辅助客服分析，不出售、不共享、不用于广告

文件说明：

- `homepage-copy.md`：Xzdesk Mail 首页/产品介绍页文案
- `privacy-policy.md`：隐私政策模板
- `oauth-verification-answers.md`：Google 审核表单可填内容
- `demo-video-script.md`：审核演示视频脚本
- `submission-checklist.md`：提交前检查清单

使用前需要替换的占位符：

- `[公司/个人名称]`
- `[应用官网 URL]`
- `[隐私政策 URL]`
- `[联系邮箱]`
- `[数据保存位置说明]`
- `[版本号]`

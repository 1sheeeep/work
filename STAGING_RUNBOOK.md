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
5. 进入仅草稿模式，确认超时判定和模板变量正确。
6. 使用可控候选人会话开启单账号小配额试发，观察至少一个工作日后再扩大。

## 停止条件

- 任何验证码、风险提示、登录异常、误识别、误发、重复发送、平台告警或投诉都必须立即关闭该账号策略并撤销设备。
- 不允许导出 Cookie、调用网页私有接口、伪造指纹或绕过验证码/风控。

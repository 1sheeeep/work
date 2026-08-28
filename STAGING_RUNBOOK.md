# 预发布环境与 HR 试运行

## 环境准备

1. 为预发布准备独立主机、数据库卷、域名和密钥，不复用生产数据。
2. 复制 `.env.staging.example` 为 `.env.staging`，将 `APP_DOMAIN` 改为真实预发布域名。
3. 从 `secrets/*.example` 创建对应密钥文件，设为 `0600`。Webhook 签名密钥两端必须一致。
4. 如果使用真实 HR Webhook，将 URL 换成 HTTPS，并设置 `APP_NOTIFICATION_ALLOW_INSECURE_HTTP=false`。
5. `APP_NOTIFICATION_TRIAL_RECIPIENT_IDS` 仅填入参与试运行的 HR UUID；`*` 只允许用于仓库内置的本地接收器。

## 发布

```sh
docker compose --env-file .env.staging -f compose.staging.yaml config
docker compose --env-file .env.staging -f compose.staging.yaml up -d --build
docker compose --env-file .env.staging -f compose.staging.yaml ps
scripts/smoke-test.sh https://recruitment-staging.example.com
```

仅在本机验证真实 HTTP 签名链路时，可叠加试运行配置：

```sh
docker compose -f compose.yaml -f compose.trial.yaml up -d --build
curl http://127.0.0.1:8090/events
```

该接收器只用于预发布验收，事件保存在内存中，重启即清空，不应作为正式 HR 系统。

## 试运行顺序

1. 先使用内置签名校验接收器，确认时间戳、HMAC 签名与幂等键。
2. 系统管理员在“运行保障”手动发送一条仅含匿名候选人引用、无姓名/联系方式的测试通知。
3. 将白名单限定为 1–3 名试运行 HR，完成真实面试确认和通知重试。
4. 核对 `hr_notifications`、`notification_attempts`、操作日志与接收端记录，确认无重复发送。
5. 观察至少一个工作日，再逐步扩大白名单。

## 停止条件

- 签名校验失败、同一幂等键重复通知、候选人数据越界、Webhook 5xx 持续或通知错误率超过 2%时，立即将 `APP_NOTIFICATION_TRIAL_ENABLED=false` 并回到 Mock 渠道。
- 外部 AI 只能在完成数据处理评估后开启；未获授权时保持 `APP_AI_ALLOW_CANDIDATE_DATA=false`。

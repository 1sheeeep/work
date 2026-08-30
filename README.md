# 公司内部招聘值守与 AI 简历助手

面向公司内部多个 BOSS 招聘账号的招聘值守工具：HR 离开时按账号策略进行一次受控接待，平台允许时协助处理简历和联系方式，并用 AI 对已授权简历提供证据化分析。最终决定始终由 HR 作出。

完整需求、边界与实施顺序见 [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)，当前开发状态见 [`DEV_STATE.md`](DEV_STATE.md)。

## 当前架构

```text
招聘管理后台（Java / Vue / PostgreSQL）
             ↓
本地 BOSS CDP 连接器（每账号独立 Chrome Profile）
             ↓
       HR 手动登录的 BOSS 网页
```

项目不再以浏览器插件作为运行主链路。每个 BOSS 账号由本地连接器启动独立、可见的 Chrome Profile；系统不保存 BOSS 密码、Cookie、Token 或浏览器 Profile。

## 当前完成情况

- 多账号的企业、账号、岗位、HR 权限、托管策略、审计和运行保障。
- `LOCAL_CDP_CONNECTOR` 正式账号类型，现有正式账号会由 Flyway V30 自动迁移。
- [`boss-local-connector`](boss-local-connector/) 支持每账号独立 Profile/端口、手动登录、一次性连接令牌和安全心跳。
- 后台默认只监测；连接器只同步已打开沟通页的未读计数、岗位标题和不可逆摘要。HR 手动打开会话时，它可只读复核最后消息方向与时间，用于生成安全草稿；不读取候选人姓名或消息正文，也不执行点击、填写或发送。
- 简历分析已接入 OpenAI 的受控调用：仅在 HR 审核简历来源、每次分析再次确认后，才发送本次粘贴的必要文本；简历原文不会写入本地数据库，只保留摘要、结构化结果和审计记录。AI 不会自动淘汰、录用或对 BOSS 发送消息。
- 已支持经 HR 确认的 PDF/DOCX 单次解析和可选 PNG/JPG 扫描件 OCR：文件先在本机临时处理区校验，再返回 HR 可修改的文本预览；只有 HR 单独确认后才会发送给 OpenAI。原文件不写入业务数据库或持久卷。
- AI 简历分析的结构化结果、摘要和 HR 对该结果的复核默认保留 90 天；到期后系统自动清除这些内容，保留输入 SHA-256 摘要、时间、模型标识和不可变审计日志。候选人主记录不会被此任务删除。
- 管理后台已重构为“招聘值守台”：导航按值守、消息、岗位、人才和运行管理分组；首页在没有真实 BOSS 账号时展示真实接入准备与安全边界，不再用虚构账号或岗位填充操作卡片。
- “账号与浏览器”页在准备阶段只管理内部账号标识；本机接入码、独立浏览器 Profile 和页面验证说明默认收起，避免将尚未需要的技术步骤暴露给 HR。
- 已清除所有明确标记为 E2E、Mock、UI 的测试招聘数据，保留正式企业、账号和岗位。

## 本地启动

项目根目录已包含 Docker Compose：

```bash
docker compose up -d --build
docker compose ps
```

管理后台：<http://localhost:8088>

初始管理员账号来自本地 `.env` 中的 `APP_BOOTSTRAP_ADMIN_USERNAME` 与 `APP_BOOTSTRAP_ADMIN_PASSWORD`。生产环境必须配置 HTTPS、独立密钥和备份策略。

### 启用 OpenAI 简历分析

默认关闭。完整接入步骤如下：

1. 由公司确认简历可交由外部 AI 服务处理，并确定可发送字段、保留期和 HR 责任人。
2. 使用公司管理的 OpenAI 项目，在 <https://platform.openai.com/api-keys> 创建服务端 API Key。不要把 Key 发到聊天、后台页面、日志或 Git。
3. 在 OpenAI 项目中确认一个已开通且支持 Structured Outputs 的模型名称。
4. 复制 `.env.example` 为项目根目录的 `.env`（已有 `.env` 时只修改对应项），填写：

```bash
APP_OPENAI_ENABLED=true
OPENAI_API_KEY=你的服务端OpenAI密钥
OPENAI_MODEL=你已启用且支持Structured Outputs的模型
OPENAI_TIMEOUT=60s
```

5. 在项目根目录只重建后端容器，让新的服务端环境变量生效：

```bash
docker compose up -d --no-build --force-recreate backend
docker compose ps
```

6. 登录 <http://localhost:8088>，系统管理员进入左侧“AI 接入”，点击“刷新状态”。页面只显示 Key 是否已配置，不会显示 Key 内容。
7. 状态为“可用”后点击“运行无简历数据测试”。测试只发送固定探针，不包含候选人、简历或岗位信息；成功后页面显示模型、延迟和 OpenAI 请求 ID。
8. 进入“简历审核与分析”：登记来源 → HR 批准 AI → 粘贴已脱敏文本或本机提取文件 → HR 校对 → 勾选本次外部处理确认 → 提交分析 → 人工复核证据、缺口和追问建议。

连通性测试失败时，页面会分别提示密钥/权限错误、模型不可用、限额或速率限制、网络请求失败。先按提示修正 `.env` 或 OpenAI 项目配置，再重新创建后端容器并测试。

API Key 只存在于后端进程环境，不能写入前端、数据库或 Git。HR 在完成来源审核后，仍须在每一次提交时确认对外处理。请求设置为 `store=false`，但外部服务仍适用其自身的数据处理政策；使用前应按公司隐私制度取得必要授权。

### AI 分析结果保留期

默认 90 天后自动清除 AI 结构化结果、摘要和关联 HR 复核内容。此策略不会保留原始简历文件，也不会删除候选人主记录、输入摘要或审计日志。可在 `.env` 中调整（范围为 1 至 3650 天）：

```bash
APP_RESUME_ANALYSIS_RETENTION_ENABLED=true
APP_RESUME_ANALYSIS_RETENTION_DAYS=90
```

清除后的记录仍会在简历工作台显示“已按保留策略清除”，而不会被误报为一次分析失败。

### 启用简历病毒扫描

默认不启动 ClamAV，以避免在没有简历处理需求时占用较多内存。生产启用前请为 Docker 预留至少 4GB 内存，然后在 `.env` 设置 `APP_RESUME_MALWARE_SCAN_ENABLED=true`，并用下面命令启动内部扫描服务；扫描端口只在 Docker 网络内开放，不会映射到电脑或公网：

```bash
COMPOSE_PROFILES=malware-scan docker compose up -d --build
```

启用后，扫描器不可用、超时、检出风险文件或返回异常时，系统会拒绝文件文本提取和 OpenAI 发送，并写入不包含文件内容的审计记录。

### 启用扫描件 OCR 与人工校验

OCR 仅处理 PNG、JPG/JPEG 图片，并且强制要求上述病毒扫描门禁已启用和通过。在 `.env` 同时设置 `APP_RESUME_OCR_ENABLED=true` 后，以以下方式启动两个内部服务：

```bash
COMPOSE_PROFILES=malware-scan,ocr docker compose up -d --build
```

OCR 只在本机 Docker 网络中调用 Tesseract，不会把图片发送到外部服务。流程固定为“扫描 → OCR 临时提取 → HR 核对/修改文本 → 按次确认 OpenAI”；HR 可以放弃，不会触发外部分析。

## 多账号连接器

连接器的首次配置和命令见 [`boss-local-connector/README.md`](boss-local-connector/README.md)。

每个账号必须使用不同的：

- Chrome Profile；
- CDP 本地端口；
- 后台账号 ID；
- 本地连接器凭据。

账号掉线、登录失效、验证码、风险提示或页面不确定时，只暂停该账号，不影响其他账号。

### 离线动作演练

连接器包含与 BOSS 页面隔离的 `FIXTURE_ONLY` 动作执行器，用于验证发送消息、索要简历、交换微信和交换电话的前后证据、回执和熔断协议。运行连接器测试即可执行这些演练测试：

```bash
cd boss-local-connector
npm test
npm run drill
npm run drill:faults
npm run drill:isolation
```

`npm run drill` 会依次演练四类受控动作，并只输出动作类型、结果和证据来源。演练不会启动 Chrome、不会读取真实账号页面、不会写入业务数据库、不会创建生产批准，也不会解锁页面写能力。真实页面执行器在逐动作人工验收完成前保持不存在。

`npm run drill:faults` 会注入目标漂移、风险页、状态不变、浏览器输入企图和执行超时五类故障；所有故障都必须被阻断，否则命令以失败状态退出。运行保障页显示的是该版本的离线构建清单，不等同于真实页面验收。

`npm run drill:isolation` 会验证多账号隔离：异常只冻结当前账号、健康探测不能自动解冻、人工恢复必须有三次稳定只读探测，并且恢复后仍保持写能力关闭。

## 安全边界

- HR 手动完成登录、扫码、短信验证和验证码；
- 不调用网页私有接口，不导出 Cookie，不使用无头浏览器；
- 已审核简历向 OpenAI 的外部传输必须由 HR 逐次确认；不保存简历原文或 API Key；
- 只在平台当前可见且允许的页面入口中执行操作；
- 发送、求简历、接受简历、交换联系方式均需策略控制、日志和人工接管；
- 自动化只能降低遗漏，不能保证第三方平台账号绝不受限制。

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

公司内部 HR、招聘负责人，以及负责系统运行与账号接入的系统管理员。

## Product Purpose

招聘值守台将多招聘账号的未读消息、安全回复草稿、真实岗位核对、简历接收和 AI 辅助分析集中在同一个日常工作区。成功意味着 HR 能快速发现当天最需要处理的事项，并在人工确认边界内完成处理。

## Positioning

系统围绕“挂机值守和人工确认”组织招聘运营，不建设完整 ATS，也不让 AI 替代 HR 决策。

## Operating Context

核心链路为：HR 开启挂机，系统监测未读消息，生成安全回复草稿，HR 审核或人工接管，接收简历，AI 分析，HR 查看并复核结果。

## Capabilities and Constraints

- 日常导航固定为今日值守、招聘账号、岗位资料、简历分析。
- 系统管理员额外可见项目运行日志。
- 保留 Vue 3、TypeScript、Element Plus、现有路由、接口、权限和数据结构。
- 不暴露 Cookie、Token、密码、API Key 或候选人消息正文。
- AI 结果仅供参考，最终判断由 HR 作出。
- 不新增候选人 ATS、企业资料、HR 用户、独立自动回复、旧值守规则或独立 AI 配置入口。

## Brand Commitments

产品名为“招聘值守台”。整体定位专业、稳定、可信、高效，保留深海蓝导航与青绿色品牌操作色。

## Evidence on Hand

现有产品真相与验收标准记录于 `FRONTEND_DESIGN_REQUIREMENTS.md`。页面必须只使用真实接口数据；缺少趋势数据时展示空状态，不生成模拟图表。

## Product Principles

- 关键任务优先于装饰。
- 状态必须一眼可见且使用业务中文表达。
- 自动化动作保持人工确认边界。
- 同一事实只表达一次。
- 中高信息密度下仍保持清晰和可操作。

## Accessibility & Inclusion

支持键盘焦点、减少动态效果、文字化状态表达以及 320px 以上视口。移动端主操作高度不少于 44px。

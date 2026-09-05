# Recruitment Duty Console Design System

## Direction

这是一个 Operate 模式的招聘运营工作台。视觉以深海蓝应用骨架、冷灰工作区、白色业务表面和青绿色主操作构成。信息密度优先，装饰保持克制。

## Design Dials

- Design variance: 4
- Motion intensity: 3
- Visual density: 8

## Color

- Sidebar: `#111C2D`
- Workspace: `#F5F7F9`
- Surface: `#FFFFFF`
- Raised surface: `#FFFFFF`
- Primary: `#0F766E`
- Accent: `#14B8A6`
- Main text: `#172033`
- Secondary text: `#667085`
- Border: `#DFE5EA`
- Success: `#16805B`
- Warning: `#B76E00`
- Danger: `#B42318`

### Semantic surfaces

卡片不再全部使用同一种纯白底色。色彩只承担业务分组和状态识别，不替代文字：

- Teal surface `#EEF9F6`: 在线、采集、接收和品牌相关摘要
- Blue surface `#F1F6FD`: 未读、同步、趋势和普通信息
- Violet surface `#F6F3FB`: AI 分析过程与辅助决策
- Amber surface `#FFF7E9`: 待处理、待核对和需要关注
- Rose surface `#FFF3F1`: 分析失败和风险阻断
- White surface: 表格、队列和需要长时间阅读的主体内容

主操作色始终为青绿色；蓝、紫、琥珀和玫瑰只用于语义表面、状态与小范围图标容器。

## Shape and Depth

- Page panels: 16px radius
- Interactive controls: 8-10px radius
- Pills: full radius only for compact status and filters
- Static surfaces use `shadow-rest`
- Interactive entities may use `shadow-hover`
- Dialogs and drawers use `shadow-floating`

## Card Semantics

- `card-panel`: structural business section, no hover movement
- `card-indicator`: static summary, no hover movement
- `card-entity`: selectable or actionable entity, maximum 2px hover feedback
- `card-emphasis`: warning, failure, AI conclusion, or human confirmation

## Shared UI Components

- `MetricCard`: 统一静态指标的标题、数值、说明和语义色；不承载点击行为。
- `StatusBadge`: 使用状态点、中文标签与低饱和表面共同表达状态，不能只依赖颜色。
- `AsyncState`: 统一页面级和容器内的 loading、empty、error 与重试入口；`embedded` 仅用于已有容器内部，避免形成嵌套卡片。
- `PageHeader`: 统一页面标题、简短说明和右侧主操作的响应式排列。

## Motion

Transitions are 150-200ms and communicate selection, loading, focus, or state change. Only transform and opacity may move. Reduced-motion disables nonessential transitions.

## Responsive Rules

- Desktop sidebar becomes a drawer below 900px.
- Two-column workspaces collapse below their content breakpoint.
- Tables become entity cards before primary status or actions would be hidden.
- No page-level horizontal overflow at 320px, 760px, 900px, or desktop widths.

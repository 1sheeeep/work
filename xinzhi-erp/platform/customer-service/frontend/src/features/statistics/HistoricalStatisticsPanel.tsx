import { FormEvent, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Download, RefreshCw, Save } from "lucide-react";
import {
  HistoricalStatisticsFilters,
  HistoricalStatisticsResponse,
  HistoricalStatisticsView,
  PlatformAPI,
  Shop,
  SLASettings,
  User
} from "../../api";
import { Empty } from "../../components/ui";
import { durationLabel, errorText } from "../shared/helpers";
import type { ToastTone } from "../shared/types";
import type { AdminViewKey } from "../navigation/adminNavigation";
import { readViewDataCache, writeViewDataCache } from "../shared/viewDataCache";

const viewConfig: Record<string, {
  apiView: HistoricalStatisticsView;
  title: string;
  description: string;
  breakdownTitle: string;
}> = {
  conversationStats: {
    apiView: "conversation",
    title: "会话统计",
    description: "查看会话流入、接待、结束和响应效率的历史变化。",
    breakdownTitle: "渠道明细"
  },
  customerStats: {
    apiView: "customer",
    title: "客户统计",
    description: "同一店铺优先按邮箱识别客户，无邮箱会话按独立客户计算。",
    breakdownTitle: "客户明细（最多显示100项）"
  },
  agentStats: {
    apiView: "agent",
    title: "客服统计",
    description: "查看客服接待、回复、完成和响应 SLA；管理员不计入客服绩效。",
    breakdownTitle: "客服绩效明细"
  },
  skillStats: {
    apiView: "skill",
    title: "技能组统计",
    description: "按当前技能组归属汇总接待量、完成量和响应效率。",
    breakdownTitle: "技能组绩效明细"
  },
  serviceSummaryStats: {
    apiView: "service",
    title: "服务总结统计",
    description: "按结束会话的处理分类统计服务结构，并单独展示未分类数量。",
    breakdownTitle: "服务分类明细（一级 / 二级 / 三级）"
  },
  slaStats: {
    apiView: "sla",
    title: "SLA统计",
    description: "按统计工作时间衡量首响、后续回复和会话解决是否达标。",
    breakdownTitle: "店铺 SLA 明细"
  }
};

type DraftFilters = Omit<HistoricalStatisticsFilters, "view">;
const historicalStatisticsCacheMs = 120_000;

export function HistoricalStatisticsPanel(props: {
  view: AdminViewKey;
  api: PlatformAPI;
  shops: Shop[];
  users: User[];
  canManageSLA: boolean;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const config = viewConfig[props.view] || viewConfig.conversationStats;
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [draft, setDraft] = useState<DraftFilters>({
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    shopId: "",
    agentId: "",
    skillGroup: "",
    channel: ""
  });
  const [applied, setApplied] = useState<DraftFilters>(draft);
  const [data, setData] = useState<HistoricalStatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState("");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [slaDraft, setSLADraft] = useState<SLASettings>({
    firstResponseMinutes: 30,
    responseMinutes: 30,
    resolutionMinutes: 1440
  });
  const [savingSLA, setSavingSLA] = useState(false);

  const agents = useMemo(
    () => props.users
      .filter((user) => user.role === "agent")
      .sort((left, right) => (left.displayName || left.email).localeCompare(right.displayName || right.email, "zh-CN")),
    [props.users]
  );

  useEffect(() => {
    setSortKey("");
  }, [config.apiView]);

  useEffect(() => {
    let active = true;
    const cacheKey = `historical:${config.apiView}:${JSON.stringify(applied)}`;
    const cached = readViewDataCache<HistoricalStatisticsResponse>(props.api, cacheKey, historicalStatisticsCacheMs);
    if (cached) {
      setData(cached);
      if (cached.slaSettings) setSLADraft(cached.slaSettings);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }
    setData(null);
    setLoading(true);
    setError("");
    props.api.getHistoricalStatistics({ view: config.apiView, ...applied })
      .then((next) => {
        if (!active) return;
        setData(next);
        writeViewDataCache(props.api, cacheKey, next);
        if (next.slaSettings) setSLADraft(next.slaSettings);
      })
      .catch((reason) => {
        if (!active) return;
        setError(`加载${config.title}失败：${errorText(reason)}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [props.api, config.apiView, config.title, applied]);

  const sortedBreakdown = useMemo(() => {
    const rows = [...(data?.breakdown || [])];
    const key = sortKey || data?.columns[0]?.key || "";
    rows.sort((left, right) => {
      const comparison = key === "name"
        ? left.name.localeCompare(right.name, "zh-CN")
        : (left.values[key] || 0) - (right.values[key] || 0);
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return rows;
  }, [data, sortKey, sortDirection]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
      setError("请选择有效的开始日期和结束日期。");
      return;
    }
    setApplied({ ...draft });
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const file = await props.api.exportHistoricalStatistics({ view: config.apiView, ...applied });
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      props.setToast({ tone: "success", text: `${config.title}已导出：${file.filename}` });
    } catch (reason) {
      props.setToast({ tone: "error", text: `导出失败：${errorText(reason)}` });
    } finally {
      setExporting(false);
    }
  }

  async function saveSLA(event: FormEvent) {
    event.preventDefault();
    setSavingSLA(true);
    try {
      const saved = await props.api.saveSLASettings(slaDraft);
      setSLADraft(saved);
      props.setToast({ tone: "success", text: "SLA目标已保存" });
      setApplied((current) => ({ ...current }));
    } catch (reason) {
      props.setToast({ tone: "error", text: `保存SLA目标失败：${errorText(reason)}` });
    } finally {
      setSavingSLA(false);
    }
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "name" ? "asc" : "desc");
  }

  return (
    <section className="historical-stats-page">
      <header className="historical-stats-header">
        <div>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        <button type="button" onClick={() => void exportExcel()} disabled={loading || exporting || !data}>
          <Download size={15} />{exporting ? "导出中" : "导出 Excel"}
        </button>
      </header>

      <form className="historical-stats-filters" onSubmit={applyFilters}>
        <label><span>开始日期</span><input type="date" value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label><span>结束日期</span><input type="date" value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label><span>店铺</span><select value={draft.shopId} onChange={(event) => setDraft((current) => ({ ...current, shopId: event.target.value }))}><option value="">全部店铺</option>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select></label>
        <label><span>技能组</span><select value={draft.skillGroup} onChange={(event) => setDraft((current) => ({ ...current, skillGroup: event.target.value, agentId: "" }))}><option value="">全部技能组</option><option value="咨询接待">咨询接待</option><option value="售后">售后</option></select></label>
        <label><span>客服</span><select value={draft.agentId} onChange={(event) => setDraft((current) => ({ ...current, agentId: event.target.value }))}><option value="">全部客服</option>{agents.filter((agent) => !draft.skillGroup || agent.skillGroup === draft.skillGroup).map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName || agent.email}</option>)}</select></label>
        <label><span>渠道</span><select value={draft.channel} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value }))}><option value="">全部渠道</option><option value="chat">在线聊天</option><option value="email">邮件</option></select></label>
        <button className="primary" type="submit" disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />查询</button>
      </form>

      <div className="historical-stats-scope-note">
        {data?.dateBasis || "北京时间统计；页面只提供自定义日期范围。"}；当前默认显示本月，可直接修改日期后查询。
      </div>

      {config.apiView === "sla" ? (
        <form className="sla-settings-strip" onSubmit={saveSLA}>
          <div><strong>SLA目标</strong><span>全局设置，时长按“统计工作时间”累计</span></div>
          <label><span>首次响应</span><input type="number" min={1} value={slaDraft.firstResponseMinutes} disabled={!props.canManageSLA} onChange={(event) => setSLADraft((current) => ({ ...current, firstResponseMinutes: Number(event.target.value) }))} /><em>分钟</em></label>
          <label><span>后续响应</span><input type="number" min={1} value={slaDraft.responseMinutes} disabled={!props.canManageSLA} onChange={(event) => setSLADraft((current) => ({ ...current, responseMinutes: Number(event.target.value) }))} /><em>分钟</em></label>
          <label><span>会话解决</span><input type="number" min={1} value={slaDraft.resolutionMinutes} disabled={!props.canManageSLA} onChange={(event) => setSLADraft((current) => ({ ...current, resolutionMinutes: Number(event.target.value) }))} /><em>分钟</em></label>
          {props.canManageSLA ? <button type="submit" disabled={savingSLA}><Save size={15} />{savingSLA ? "保存中" : "保存目标"}</button> : null}
        </form>
      ) : null}

      {error ? <div className="historical-stats-error" role="alert">{error}</div> : null}

      <div className="historical-stat-card-grid" aria-busy={loading}>
        {(data?.summary || []).map((metric) => (
          <article className="historical-stat-card" key={metric.key}>
            <span>{metric.label}</span>
            <strong>{formatHistoricalValue(metric.value, metric.unit)}</strong>
            <small>{metric.note || `${data?.startDate || ""} 至 ${data?.endDate || ""}`}</small>
          </article>
        ))}
        {loading && !data ? Array.from({ length: 5 }, (_, index) => <div className="historical-stat-card skeleton" key={index} />) : null}
      </div>

      <section className="historical-stats-chart-section">
        <div className="historical-stats-section-title">
          <div><h3>每日趋势</h3><p>按业务事件发生日期汇总，悬停当天区域可查看全部精确值。</p></div>
          <span>{data ? `${data.startDate} 至 ${data.endDate}` : ""}</span>
        </div>
        {data && hasTrendData(data) ? <HistoricalTrendChart data={data} /> : !loading ? <Empty text="当前日期范围暂无趋势数据" /> : null}
      </section>

      <section className="historical-stats-table-section">
        <div className="historical-stats-section-title">
          <div><h3>{config.breakdownTitle}</h3><p>点击列标题可切换排序。</p></div>
          <span>{data ? `${data.breakdown.length} 项` : ""}</span>
        </div>
        <div className="historical-stats-table" role="region" aria-label={config.breakdownTitle} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th aria-sort={sortKey === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}><button type="button" onClick={() => toggleSort("name")}>名称</button></th>
                <th>补充信息</th>
                {(data?.columns || []).map((column) => (
                  <th key={column.key} aria-sort={sortKey === column.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => toggleSort(column.key)}>{column.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedBreakdown.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.secondary || "--"}</td>
                  {(data?.columns || []).map((column) => <td key={column.key}>{formatHistoricalValue(row.values[column.key] || 0, column.unit)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data && !data.breakdown.length ? <Empty text="当前筛选范围暂无明细数据" /> : null}
        </div>
      </section>
    </section>
  );
}

function HistoricalTrendChart({ data }: { data: HistoricalStatisticsResponse }) {
  const width = 920;
  const height = 250;
  const margin = { top: 20, right: 24, bottom: 42, left: 54 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const allValues = data.trend.flatMap((point) => data.trendSeries.map((series) => point.values[series.key] || 0));
  const maximum = Math.max(...allValues, 1);
  const colors = ["#1769e0", "#0f8a69", "#c77b00"];
  const x = (index: number) => margin.left + (data.trend.length <= 1 ? innerWidth / 2 : index * innerWidth / (data.trend.length - 1));
  const y = (value: number) => margin.top + innerHeight - value / maximum * innerHeight;
  const safeActiveIndex = activeIndex === null || !data.trend.length
    ? null
    : Math.min(activeIndex, data.trend.length - 1);
  const activePoint = safeActiveIndex === null ? null : data.trend[safeActiveIndex];
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex);
  const pointSpacing = data.trend.length > 1 ? innerWidth / (data.trend.length - 1) : innerWidth;
  const hoverBandLeft = activeX === null ? 0 : Math.max(margin.left, activeX - pointSpacing / 2);
  const hoverBandRight = activeX === null ? 0 : Math.min(width - margin.right, activeX + pointSpacing / 2);
  const tooltipWidth = 190;
  const tooltipHeight = 34 + data.trendSeries.length * 20;
  const tooltipX = activeX === null
    ? margin.left
    : activeX + 14 + tooltipWidth <= width - margin.right
      ? activeX + 14
      : activeX - tooltipWidth - 14;
  const tooltipY = margin.top + 8;
  const labelIndexes = new Set<number>();
  const labelStep = Math.max(1, Math.ceil(data.trend.length / 7));
  data.trend.forEach((_, index) => {
    if (index % labelStep === 0 || index === data.trend.length - 1) labelIndexes.add(index);
  });

  function updateActiveFromPointer(event: ReactPointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || !data.trend.length) return;
    const bounds = svg.getBoundingClientRect();
    const chartX = (event.clientX - bounds.left) / bounds.width * width;
    const ratio = Math.max(0, Math.min(1, (chartX - margin.left) / innerWidth));
    setActiveIndex(data.trend.length <= 1 ? 0 : Math.round(ratio * (data.trend.length - 1)));
  }

  function handleChartKeyDown(event: ReactKeyboardEvent<SVGRectElement>) {
    if (!data.trend.length) return;
    if (event.key === "Escape") {
      setActiveIndex(null);
      event.currentTarget.blur();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      setActiveIndex(data.trend.length - 1);
      return;
    }
    const direction = event.key === "ArrowRight" ? 1 : -1;
    setActiveIndex((current) => Math.max(0, Math.min(data.trend.length - 1, (current ?? 0) + direction)));
  }

  const activeValueLabel = activePoint
    ? `${activePoint.date}，${data.trendSeries.map((series) => `${series.label}${formatHistoricalValue(activePoint.values[series.key] || 0, series.unit)}`).join("，")}`
    : "使用左右方向键查看每日数据";

  return (
    <div className="historical-trend-wrap">
      <div className="historical-trend-legend">
        {data.trendSeries.map((series, index) => <span key={series.key}><i style={{ backgroundColor: colors[index % colors.length] }} />{series.label}</span>)}
      </div>
      <svg className="historical-trend-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${data.startDate}至${data.endDate}每日趋势图`}>
        <title>{`${data.startDate}至${data.endDate}每日趋势图。悬停图表，或聚焦后使用左右方向键查看每日数据。`}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum * ratio;
          return <g key={ratio}><line x1={margin.left} y1={y(value)} x2={width - margin.right} y2={y(value)} className="historical-chart-grid" /><text x={margin.left - 9} y={y(value) + 4} textAnchor="end">{formatAxisValue(value, data.trendSeries[0]?.unit)}</text></g>;
        })}
        {data.trend.map((point, index) => labelIndexes.has(index) ? <text key={point.date} x={x(index)} y={height - 15} textAnchor="middle">{point.date.slice(5)}</text> : null)}
        {activeX !== null ? <rect className="historical-chart-hover-band" x={hoverBandLeft} y={margin.top} width={Math.max(hoverBandRight - hoverBandLeft, 1)} height={innerHeight} /> : null}
        {data.trendSeries.map((series, seriesIndex) => {
          const points = data.trend.map((point, index) => `${x(index)},${y(point.values[series.key] || 0)}`).join(" ");
          return (
            <g key={series.key}>
              <polyline className="historical-chart-line" points={points} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="2" strokeDasharray={seriesIndex === 1 ? "7 4" : seriesIndex === 2 ? "2 4" : undefined} />
              {data.trend.map((point, index) => (
                <circle
                  className={safeActiveIndex === index ? "historical-chart-point is-active" : "historical-chart-point"}
                  key={point.date}
                  cx={x(index)}
                  cy={y(point.values[series.key] || 0)}
                  r={safeActiveIndex === index ? 4.25 : 2.5}
                  fill="#fff"
                  stroke={colors[seriesIndex % colors.length]}
                  strokeWidth={safeActiveIndex === index ? 2 : 1.5}
                />
              ))}
            </g>
          );
        })}
        {activeX !== null ? <line className="historical-chart-guide" x1={activeX} y1={margin.top} x2={activeX} y2={margin.top + innerHeight} /> : null}
        <rect
          className="historical-chart-interaction"
          x={margin.left}
          y={margin.top}
          width={innerWidth}
          height={innerHeight}
          tabIndex={0}
          role="slider"
          aria-label="每日趋势数据"
          aria-valuemin={1}
          aria-valuemax={Math.max(data.trend.length, 1)}
          aria-valuenow={(safeActiveIndex ?? 0) + 1}
          aria-valuetext={activeValueLabel}
          onPointerEnter={updateActiveFromPointer}
          onPointerMove={updateActiveFromPointer}
          onPointerLeave={() => setActiveIndex(null)}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onBlur={() => setActiveIndex(null)}
          onKeyDown={handleChartKeyDown}
        />
        {activePoint && activeX !== null ? (
          <g className="historical-chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`} aria-hidden="true">
            <rect width={tooltipWidth} height={tooltipHeight} rx="6" />
            <text className="historical-chart-tooltip-date" x="12" y="20">{activePoint.date}</text>
            {data.trendSeries.map((series, index) => (
              <g key={series.key} transform={`translate(0 ${34 + index * 20})`}>
                <circle cx="14" cy="0" r="3" fill={colors[index % colors.length]} />
                <text x="24" y="4">{series.label}</text>
                <text className="historical-chart-tooltip-value" x={tooltipWidth - 12} y="4" textAnchor="end">{formatHistoricalValue(activePoint.values[series.key] || 0, series.unit)}</text>
              </g>
            ))}
          </g>
        ) : null}
      </svg>
      <details className="historical-trend-data">
        <summary>查看趋势数据表</summary>
        <div><table><thead><tr><th>日期</th>{data.trendSeries.map((series) => <th key={series.key}>{series.label}</th>)}</tr></thead><tbody>{data.trend.map((point) => <tr key={point.date}><td>{point.date}</td>{data.trendSeries.map((series) => <td key={series.key}>{formatHistoricalValue(point.values[series.key] || 0, series.unit)}</td>)}</tr>)}</tbody></table></div>
      </details>
    </div>
  );
}

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return { startDate: `${year}-${month}-01`, endDate: `${year}-${month}-${day}` };
}

function formatHistoricalValue(value: number, unit: string) {
  if (unit === "seconds") return durationLabel(value);
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return Math.round(value).toLocaleString("zh-CN");
}

function formatAxisValue(value: number, unit?: string) {
  if (unit === "percent") return `${Math.round(value)}%`;
  return Math.round(value).toLocaleString("zh-CN");
}

function hasTrendData(data: HistoricalStatisticsResponse) {
  return data.trend.some((point) => data.trendSeries.some((series) => (point.values[series.key] || 0) > 0));
}

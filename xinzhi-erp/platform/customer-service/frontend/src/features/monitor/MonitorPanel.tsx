import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw, X } from "lucide-react";
import { MonitorOverview, MonitorWorkSchedule, PlatformAPI, ResponseMetrics, Shop } from "../../api";
import { Badge, Empty } from "../../components/ui";
import { durationLabel, errorText, timeLabel } from "../shared/helpers";
import type { T, ToastTone } from "../shared/types";
import { readViewDataCache, writeViewDataCache } from "../shared/viewDataCache";
import { subscribePlatformEvents } from "../shared/platformEvents";

const monitorTimeCopy: T = { unknownTime: "未知时间" };
const skillGroups = ["咨询接待", "售后"] as const;
const emptyOverview: MonitorOverview = {
  totals: {
    agents: 0,
    shops: 0,
    activeChannels: 0,
    queued: 0,
    assigned: 0,
    emailPending: 0,
    closedToday: 0,
    anomaly: 0
  },
  agentOptions: [],
  agents: [],
  skillGroups: [],
  shops: []
};

type MonitorSnapshot = { overview: MonitorOverview; metrics: ResponseMetrics };
const monitorSnapshotMaxAgeMs = 15_000;

export function MonitorPanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  canManageSchedule: boolean;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [tab, setTab] = useState<"agents" | "groups" | "shops" | "anomaly">("agents");
  const [shopId, setShopId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [skillGroup, setSkillGroup] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const initialSnapshot = readViewDataCache<MonitorSnapshot>(props.api, "monitor:||||", monitorSnapshotMaxAgeMs);
  const [overview, setOverview] = useState<MonitorOverview>(initialSnapshot?.overview || emptyOverview);
  const [metrics, setMetrics] = useState<ResponseMetrics | null>(initialSnapshot?.metrics || null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<MonitorWorkSchedule | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = useCallback(async (force = false) => {
    const cacheKey = `monitor:${shopId}|${agentId}|${skillGroup}|${channel}|${status}`;
    const cached = force ? null : readViewDataCache<MonitorSnapshot>(props.api, cacheKey, monitorSnapshotMaxAgeMs);
    if (cached) {
      setOverview(cached.overview);
      setMetrics(cached.metrics);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    const filters = { shopId, agentId, skillGroup, channel, status };
    try {
      const [nextOverview, nextMetrics] = await Promise.all([
        props.api.getMonitorOverview(filters),
        props.api.getResponseMetrics(filters)
      ]);
      const normalizedOverview = {
        ...nextOverview,
        agentOptions: Array.isArray(nextOverview.agentOptions) ? nextOverview.agentOptions : [],
        agents: Array.isArray(nextOverview.agents) ? nextOverview.agents : [],
        skillGroups: Array.isArray(nextOverview.skillGroups) ? nextOverview.skillGroups : [],
        shops: Array.isArray(nextOverview.shops) ? nextOverview.shops : []
      };
      setOverview(normalizedOverview);
      setMetrics(nextMetrics);
      writeViewDataCache(props.api, cacheKey, { overview: normalizedOverview, metrics: nextMetrics });
    } catch (reason) {
      setError(`加载实时监控失败：${errorText(reason)}`);
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [props.api, shopId, agentId, skillGroup, channel, status]);

  useEffect(() => {
    const loadWhenVisible = () => {
      if (!document.hidden) void load(true);
    };
    let refreshTimer: number | null = null;
    void load();
    document.addEventListener("visibilitychange", loadWhenVisible);
    const unsubscribe = subscribePlatformEvents((event) => {
      if (!event.type.startsWith("message.") && !event.type.startsWith("conversation.") && !event.type.startsWith("user.")) return;
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
		refreshTimer = null;
        if (!document.hidden) void load(true);
      }, 750);
    });
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", loadWhenVisible);
      unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    props.api.getMonitorWorkSchedule()
      .then(setSchedule)
      .catch((reason) => props.setToast({ tone: "error", text: `加载统计工作时间失败：${errorText(reason)}` }));
  }, [props.api, props.setToast]);

  const anomalyAgents = overview.agents.filter((agent) => agent.anomaly > 0);
  const anomalyShops = overview.shops.filter((shop) => shop.anomaly > 0);
  const durationBasis = schedule?.enabled ? "统计工作时间" : "自然时间";

  return (
    <section className="monitor-page">
      <div className={`monitor-toolbar ${props.canManageSchedule ? "has-schedule-action" : ""}`}>
        <select value={shopId} onChange={(event) => { setShopId(event.target.value); setAgentId(""); }}>
          <option value="">全部店铺</option>
          {props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
        </select>
        <select value={skillGroup} onChange={(event) => { setSkillGroup(event.target.value); setAgentId(""); }}>
          <option value="">全部技能组</option>
          {skillGroups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
        <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
          <option value="">全部客服</option>
          {overview.agentOptions.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}{agent.skillGroup ? `（${agent.skillGroup}）` : ""}
            </option>
          ))}
        </select>
        <select value={channel} onChange={(event) => setChannel(event.target.value)}>
          <option value="">全部渠道</option>
          <option value="chat">在线聊天</option>
          <option value="email">邮件</option>
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="open">排队</option>
          <option value="assigned">接待中</option>
          <option value="closed">已结束</option>
        </select>
        <button type="button" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />刷新
        </button>
        {props.canManageSchedule ? (
          <button type="button" onClick={() => setScheduleOpen(true)}>
            <CalendarClock size={15} />统计工作时间
          </button>
        ) : null}
        <span className="monitor-refresh-note">
          实时快照，每 30 秒自动更新；{monitorScheduleSummary(schedule)}
        </span>
      </div>

      {error ? <div className="monitor-error" role="alert">{error}</div> : null}

      <div className="metric-grid monitor-metrics">
        <MetricCard title="在线客服数" value={overview.totals.agents} note="不包含管理员账号" />
        <MetricCard title="当前范围店铺数" value={overview.totals.shops} note="跟随店铺、技能组和客服筛选" />
        <MetricCard title="已接入渠道数" value={overview.totals.activeChannels} note="当前范围内已启用渠道" />
        <MetricCard title="当前排队会话" value={overview.totals.queued} note="等待客服接入" />
        <MetricCard title="当前接待中会话" value={overview.totals.assigned} note="已分配给客服" />
        <MetricCard title="邮件待处理数" value={overview.totals.emailPending} note="邮箱渠道未结束会话" />
        <MetricCard title="今日已结束会话" value={overview.totals.closedToday} note="北京时间自然日" />
        <MetricCard title="异常/超时会话" value={overview.totals.anomaly} note={`累计 30 分钟${durationBasis}无更新且未结束`} />
        <MetricCard title="平均响应时长" value={durationLabel(metrics?.averageResponseSec)} note={`客户消息到客服回复，按${durationBasis}累计`} />
        <MetricCard title="平均首响时长" value={durationLabel(metrics?.firstResponseSec)} note={`首次客服回复，按${durationBasis}累计`} />
      </div>

      <div className="monitor-tabs">
        <button type="button" className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>客服视角</button>
        <button type="button" className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}>技能组视角</button>
        <button type="button" className={tab === "shops" ? "active" : ""} onClick={() => setTab("shops")}>店铺视角</button>
        <button type="button" className={tab === "anomaly" ? "active" : ""} onClick={() => setTab("anomaly")}>异常监控</button>
      </div>

      {tab === "agents" ? (
        <section className="monitor-section">
          <h3>客服接待数据</h3>
          <div className="monitor-table agent-monitor-table">
            <div className="monitor-table-head"><span>客服</span><span>技能组</span><span>在线状态</span><span>负责店铺</span><span>当前接待</span><span>接待上限</span><span>负载率</span><span>排队待接</span><span>今日结束</span><span>异常</span></div>
            {overview.agents.map((agent) => (
              <div className="monitor-table-row" key={agent.id}>
                <span className="monitor-agent-identity"><strong>{agent.name}</strong><small>在线客服</small></span>
                <span>{agent.skillGroup || "咨询接待"}</span>
                <Badge tone={agent.online ? "green" : "muted"}>{agent.online ? "在线" : "离线"}</Badge>
                <span title={agent.shopNames.join("、")}>{agent.shopNames.length ? agent.shopNames.join("、") : "未分配店铺"}</span>
                <span>{agent.assigned}</span>
                <span>{agent.receptionLimit}</span>
                <span>{agent.receptionPercent}%</span>
                <span>{agent.queued}</span>
                <span>{agent.closedToday}</span>
                <span>{agent.anomaly}</span>
              </div>
            ))}
            {!loading && !overview.agents.length ? <Empty text="当前范围暂无客服数据" /> : null}
          </div>
        </section>
      ) : tab === "groups" ? (
        <section className="monitor-section">
          <h3>技能组接待数据</h3>
          <div className="monitor-table skill-group-monitor-table">
            <div className="monitor-table-head"><span>技能组</span><span>客服数</span><span>在线客服</span><span>当前接待</span><span>可接排队</span><span>今日结束</span><span>异常</span></div>
            {overview.skillGroups.map((group) => (
              <div className="monitor-table-row" key={group.name}>
                <strong>{group.name}</strong><span>{group.agents}</span><span>{group.online}</span><span>{group.assigned}</span><span>{group.queued}</span><span>{group.closedToday}</span><span>{group.anomaly}</span>
              </div>
            ))}
            {!loading && !overview.skillGroups.length ? <Empty text="当前范围暂无技能组数据" /> : null}
          </div>
        </section>
      ) : tab === "shops" ? (
        <section className="monitor-section">
          <h3>店铺接待数据</h3>
          <div className="monitor-table shop-monitor-table">
            <div className="monitor-table-head"><span>店铺</span><span>Shopify 渠道</span><span>邮箱渠道</span><span>负责客服</span><span>排队</span><span>接待中</span><span>今日结束</span><span>异常</span><span>最后消息</span></div>
            {overview.shops.map((shop) => (
              <div className="monitor-table-row" key={shop.id}>
                <strong>{shop.name}</strong>
                <span>{shop.shopifyReady ? "已接入" : "未接入"}</span>
                <span>{shop.emailReady ? "已接入" : "未接入"}</span>
                <span title={shop.agentNames.join("、")}>{shop.agentNames.length ? shop.agentNames.join("、") : "未分配客服"}</span>
                <span>{shop.queued}</span>
                <span>{shop.assigned}</span>
                <span>{shop.closedToday}</span>
                <span>{shop.anomaly}</span>
                <span>{shop.lastMessageAt ? timeLabel(shop.lastMessageAt, monitorTimeCopy) : "--"}</span>
              </div>
            ))}
            {!loading && !overview.shops.length ? <Empty text="当前范围暂无店铺数据" /> : null}
          </div>
        </section>
      ) : (
        <section className="monitor-section">
          <h3>异常汇总</h3>
          <div className="monitor-anomaly-grid">
            <div className="monitor-table compact">
              <div className="monitor-table-head"><span>客服</span><span>在线</span><span>接待中</span><span>异常</span><span>负责店铺</span></div>
              {anomalyAgents.map((agent) => <div className="monitor-table-row" key={agent.id}><strong>{agent.name}</strong><span>{agent.online ? "在线" : "离线"}</span><span>{agent.assigned}</span><span>{agent.anomaly}</span><span>{agent.shopNames.join("、") || "-"}</span></div>)}
              {!anomalyAgents.length ? <Empty text="暂无客服异常" /> : null}
            </div>
            <div className="monitor-table compact">
              <div className="monitor-table-head"><span>店铺</span><span>排队</span><span>接待中</span><span>异常</span><span>最后消息</span></div>
              {anomalyShops.map((shop) => <div className="monitor-table-row" key={shop.id}><strong>{shop.name}</strong><span>{shop.queued}</span><span>{shop.assigned}</span><span>{shop.anomaly}</span><span>{shop.lastMessageAt ? timeLabel(shop.lastMessageAt, monitorTimeCopy) : "--"}</span></div>)}
              {!anomalyShops.length ? <Empty text="暂无店铺异常" /> : null}
            </div>
          </div>
        </section>
      )}

      {scheduleOpen && schedule ? (
        <MonitorScheduleDialog
          api={props.api}
          initial={schedule}
          onClose={() => setScheduleOpen(false)}
          onSaved={(next) => {
            setSchedule(next);
            setScheduleOpen(false);
            props.setToast({ tone: "success", text: "统计工作时间已保存" });
            void load();
          }}
          onError={(text) => props.setToast({ tone: "error", text })}
        />
      ) : null}
    </section>
  );
}

function MetricCard(props: { title: string; value: number | string; note: string }) {
  return <div className="metric-card"><span>{props.title}</span><strong>{props.value}</strong><small>{props.note}</small></div>;
}

const weekdayOptions = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" }
];

function MonitorScheduleDialog(props: {
  api: PlatformAPI;
  initial: MonitorWorkSchedule;
  onClose: () => void;
  onSaved: (value: MonitorWorkSchedule) => void;
  onError: (text: string) => void;
}) {
  const [enabled, setEnabled] = useState(props.initial.enabled);
  const [startMinute, setStartMinute] = useState(props.initial.startMinute);
  const [endMinute, setEndMinute] = useState(props.initial.endMinute);
  const [weekdays, setWeekdays] = useState<number[]>(props.initial.weekdays);
  const [saving, setSaving] = useState(false);
  const endOfDay = endMinute === 24 * 60;
  const valid = weekdays.length > 0 && startMinute >= 0 && startMinute < endMinute && endMinute <= 24 * 60;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, saving]);

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const value = await props.api.saveMonitorWorkSchedule({ enabled, startMinute, endMinute, weekdays });
      props.onSaved(value);
    } catch (reason) {
      props.onError(`保存统计工作时间失败：${errorText(reason)}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleWeekday(value: number) {
    setWeekdays((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value].sort((left, right) => left - right));
  }

  return (
    <div className="workflow-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) props.onClose(); }}>
      <section className="workflow-dialog monitor-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="monitor-schedule-title">
        <header>
          <div>
            <CalendarClock size={18} />
            <div>
              <strong id="monitor-schedule-title">统计工作时间</strong>
              <span>全局设置 · 北京时间（Asia/Shanghai）</span>
            </div>
          </div>
          <button type="button" aria-label="关闭" onClick={props.onClose} disabled={saving}><X size={17} /></button>
        </header>

        <div className="monitor-schedule-body">
          <label className="monitor-schedule-enable">
            <span>
              <strong>仅按工作时间累计时长</strong>
              <small>影响平均响应、首次响应、异常超时和后续 SLA；会话量、处理量、回复量与完成量仍全部计入。</small>
            </span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>

          <fieldset disabled={!enabled}>
            <legend>每天的统计时段</legend>
            <div className="monitor-schedule-time-grid">
              <label>
                <span>开始时间</span>
                <input type="time" step={60} value={minuteToTime(startMinute)} onChange={(event) => setStartMinute(timeToMinute(event.target.value))} />
              </label>
              <label>
                <span>结束时间</span>
                <input
                  type="time"
                  step={60}
                  value={minuteToTime(endOfDay ? 23 * 60 + 59 : endMinute)}
                  onChange={(event) => setEndMinute(timeToMinute(event.target.value))}
                  disabled={endOfDay}
                />
              </label>
            </div>
            <label className="monitor-end-of-day">
              <input
                type="checkbox"
                checked={endOfDay}
                onChange={(event) => setEndMinute(event.target.checked ? 24 * 60 : Math.max(startMinute + 1, 18 * 60))}
              />
              工作到当天 24:00
            </label>

            <div className="monitor-weekday-field">
              <span>启用日期</span>
              <div>
                {weekdayOptions.map((option) => (
                  <label key={option.value} className={weekdays.includes(option.value) ? "active" : ""}>
                    <input type="checkbox" checked={weekdays.includes(option.value)} onChange={() => toggleWeekday(option.value)} />
                    {option.label}
                  </label>
                ))}
              </div>
              {!weekdays.length ? <small role="alert">至少选择一天。</small> : null}
            </div>
          </fieldset>

          <div className="monitor-schedule-example">
            <strong>计算示例</strong>
            <span>设置 09:00–24:00 后，02:00 收到消息、09:20 回复，响应时长记为 20 分钟；夜间消息仍计入消息量和处理量。</span>
          </div>
          <p className="monitor-schedule-history-note">
            {props.initial.configured
              ? "本次修改从保存时间开始生效，已形成的历史报表继续使用当时的工作时间规则。"
              : "首次启用会用这套规则重新计算已有会话的响应时长；以后修改只从保存时间开始生效。"}
          </p>
        </div>

        <footer>
          <button type="button" onClick={props.onClose} disabled={saving}>取消</button>
          <button type="button" className="primary" onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "保存中..." : "保存设置"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function monitorScheduleSummary(schedule: MonitorWorkSchedule | null) {
  if (!schedule?.enabled) return "响应与异常按自然时间计算，“今日”按北京时间";
  const allDays = schedule.weekdays.length === 7;
  return `响应与异常按${allDays ? "每天" : "所选日期"} ${minuteToTime(schedule.startMinute)}–${schedule.endMinute === 24 * 60 ? "24:00" : minuteToTime(schedule.endMinute)} 工作时间计算`;
}

function minuteToTime(value: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { PlatformAPI, Shop, ShopifyAuthorizationStatus, ShopifyDispute } from "../../api";
import { Badge, Empty } from "../../components/ui";
import { errorText } from "../shared/helpers";
import { ToastMessage } from "../shared/types";

type Props = {
  api: PlatformAPI;
  shops: Shop[];
  setToast: (value: ToastMessage) => void;
};

type DisputeFilter = "open" | "closed" | "all";

const terminalStatuses = new Set(["ACCEPTED", "LOST", "PREVENTED", "WON", "CHARGE_REFUNDED"]);

function money(value?: { amount?: string; currencyCode?: string }) {
  if (!value?.amount) return "-";
  return `${value.currencyCode || ""} ${value.amount}`.trim();
}

function dueTime(dispute: ShopifyDispute) {
  if (!dispute.evidenceDueBy) return Number.POSITIVE_INFINITY;
  const value = Date.parse(dispute.evidenceDueBy);
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function isOpen(dispute: ShopifyDispute) {
  return !dispute.finalizedOn && !terminalStatuses.has(dispute.status);
}

function dueLabel(dispute: ShopifyDispute) {
  if (!dispute.evidenceDueBy) return "未提供截止时间";
  const due = dueTime(dispute);
  const day = dispute.evidenceDueBy.slice(0, 10);
  if (due < Date.now()) return `${day} · 已逾期`;
  const remainingDays = Math.ceil((due - Date.now()) / 86_400_000);
  if (remainingDays <= 3) return `${day} · 剩 ${remainingDays} 天`;
  return day;
}

function statusTone(dispute: ShopifyDispute): "green" | "warning" | "danger" | "muted" {
  if (["ACCEPTED", "WON", "PREVENTED"].includes(dispute.status)) return "green";
  if (dispute.finalizedOn || terminalStatuses.has(dispute.status)) return "muted";
  if (dueTime(dispute) < Date.now()) return "danger";
  return "warning";
}

function dateLabel(value?: string) {
  return value ? value.slice(0, 10) : "-";
}

export function DisputeManagementPanel(props: Props) {
  const [shopID, setShopID] = useState("");
  const [disputes, setDisputes] = useState<ShopifyDispute[]>([]);
  const [selectedDisputeID, setSelectedDisputeID] = useState("");
  const [filter, setFilter] = useState<DisputeFilter>("open");
  const [loading, setLoading] = useState(false);
  const [authorizationStatus, setAuthorizationStatus] = useState<ShopifyAuthorizationStatus | null>(null);

  useEffect(() => {
    if (!shopID && props.shops.length) setShopID(props.shops[0].id);
  }, [shopID, props.shops]);

  async function loadDisputes(targetShopID = shopID) {
    if (!targetShopID) {
      setDisputes([]);
      setSelectedDisputeID("");
      return;
    }
    setLoading(true);
    try {
      const result = await props.api.listShopifyDisputes(targetShopID);
      const next = [...(result.disputes || [])].sort((left, right) => {
        const openDifference = Number(isOpen(right)) - Number(isOpen(left));
        return openDifference || dueTime(left) - dueTime(right);
      });
      setDisputes(next);
      setSelectedDisputeID((current) => next.some((item) => item.id === current) ? current : next[0]?.id || "");
    } catch (error) {
      setDisputes([]);
      setSelectedDisputeID("");
      props.setToast({ tone: "error", text: `加载拒付列表失败：${errorText(error)}` });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDisputes(shopID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopID]);

  useEffect(() => {
    if (!shopID) {
      setAuthorizationStatus(null);
      return;
    }
    let active = true;
    void props.api.getShopifyAuthorizationStatus("dispute", shopID).then((result) => {
      if (active) setAuthorizationStatus(result.shops?.[0] || null);
    }).catch(() => {
      if (active) setAuthorizationStatus(null);
    });
    return () => { active = false; };
  }, [props.api, shopID]);

  const counts = useMemo(() => ({
    total: disputes.length,
    open: disputes.filter(isOpen).length,
    urgent: disputes.filter((item) => isOpen(item) && dueTime(item) <= Date.now() + 3 * 86_400_000).length,
    closed: disputes.filter((item) => !isOpen(item)).length,
  }), [disputes]);

  const visibleDisputes = useMemo(() => disputes.filter((item) => {
    if (filter === "open") return isOpen(item);
    if (filter === "closed") return !isOpen(item);
    return true;
  }), [disputes, filter]);

  const selectedDispute = disputes.find((item) => item.id === selectedDisputeID) || null;

  useEffect(() => {
    if (!visibleDisputes.length) {
      setSelectedDisputeID("");
      return;
    }
    if (!visibleDisputes.some((item) => item.id === selectedDisputeID)) setSelectedDisputeID(visibleDisputes[0].id);
  }, [selectedDisputeID, visibleDisputes]);

  return <section className="dispute-management-page">
    <header>
      <div><h3>拒付管理</h3><span>查看 Shopify Payments 拒付状态、金额、原因和处理截止时间。</span></div>
      <div className="dispute-toolbar">
        <select aria-label="拒付所属店铺" value={shopID} onChange={(event) => setShopID(event.target.value)}>{props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}</select>
        <button type="button" className="icon-button" title="刷新拒付" aria-label="刷新拒付列表" disabled={loading} onClick={() => void loadDisputes()}><RefreshCw size={15} /></button>
      </div>
    </header>

    {authorizationStatus?.needsReauthorization ? <div className="shopify-reauthorization-notice" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <div><strong>拒付读取需要重新授权</strong><span>当前店铺尚未授予拒付元数据读取权限。重新授权后可同步拒付状态和截止时间。</span></div>
    </div> : null}

    <div className="shopify-reauthorization-notice" role="note">
      <ShieldAlert size={18} aria-hidden="true" />
      <div><strong>证据材料在 Shopify Admin 中处理</strong><span>当前版本不读取、编辑或提交拒付证据，只同步拒付元数据。</span></div>
    </div>

    <div className="dispute-summary">
      <div><span>全部拒付</span><strong>{counts.total}</strong></div>
      <div><span>处理中</span><strong>{counts.open}</strong></div>
      <div className={counts.urgent ? "urgent" : ""}><span>3 天内到期/逾期</span><strong>{counts.urgent}</strong></div>
      <div><span>已结束</span><strong>{counts.closed}</strong></div>
    </div>

    <nav className="dispute-filters" aria-label="拒付状态筛选">
      <button type="button" aria-pressed={filter === "open"} className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>处理中 {counts.open}</button>
      <button type="button" aria-pressed={filter === "closed"} className={filter === "closed" ? "active" : ""} onClick={() => setFilter("closed")}>已结束 {counts.closed}</button>
      <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {counts.total}</button>
    </nav>

    <div className="dispute-management-grid">
      <section className="dispute-list">
        <header><strong>拒付单</strong><span>{visibleDisputes.length} 条</span></header>
        {visibleDisputes.map((item) => <button type="button" className={selectedDispute?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedDisputeID(item.id)}>
          <div><strong>{item.orderName || "未关联订单"}</strong><span>{money(item.amount)} · {item.reason || item.type || "未说明原因"}</span></div>
          <div><Badge tone={statusTone(item)}>{item.status || "未知状态"}</Badge><small>{dueLabel(item)}</small></div>
        </button>)}
        {!visibleDisputes.length ? <Empty text={loading ? "正在加载拒付" : "当前筛选下暂无拒付"} /> : null}
      </section>

      <section className="dispute-detail">
        {selectedDispute ? <>
          <header><div><strong>{selectedDispute.orderName || "未关联订单"}</strong><span>{selectedDispute.id}</span></div><Badge tone={statusTone(selectedDispute)}>{selectedDispute.status || "未知状态"}</Badge></header>
          <div className="dispute-facts">
            <div><span>拒付金额</span><strong>{money(selectedDispute.amount)}</strong></div>
            <div><span>拒付类型</span><strong>{selectedDispute.type || "-"}</strong></div>
            <div><span>拒付原因</span><strong>{selectedDispute.reason || "-"}</strong></div>
            <div><span>原因代码</span><strong>{selectedDispute.networkReasonCode || "-"}</strong></div>
            <div><span>发起时间</span><strong>{dateLabel(selectedDispute.initiatedAt)}</strong></div>
            <div><span>处理截止</span><strong>{dueLabel(selectedDispute)}</strong></div>
            <div><span>材料发送时间</span><strong>{dateLabel(selectedDispute.evidenceSentOn)}</strong></div>
            <div><span>结束时间</span><strong>{dateLabel(selectedDispute.finalizedOn)}</strong></div>
          </div>
        </> : <Empty text="从左侧选择拒付单查看元数据" />}
      </section>
    </div>
  </section>;
}

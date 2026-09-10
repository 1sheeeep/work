import { ChevronRight, ExternalLink, FileQuestion, FormInput, HelpCircle, PieChart } from "lucide-react";
import { Badge } from "../../components/ui";
import { type AdminMenuItem, type ImplementedAdminViewKey, adminViewLabel } from "./adminNavigation";

export function PlannedAdminPanel(props: { item: AdminMenuItem; onOpenRelated: (view: ImplementedAdminViewKey) => void }) {
  const relatedLabel = props.item.relatedView ? adminViewLabel(props.item.relatedView) : "";
  return (
    <section className="planned-page">
      <div className="planned-hero">
        <div className="planned-icon"><FileQuestion size={24} /></div>
        <div>
          <h3>{props.item.label}</h3>
          <p>{props.item.summary || "该模块已经进入 Xzdesk 后台菜单规划，但还不能在第一阶段伪装成完整功能。"}</p>
        </div>
        <Badge tone={props.item.status === "live" ? "green" : "muted"}>{props.item.status === "live" ? "已可用" : "规划中"}</Badge>
      </div>

      <div className="planned-grid">
        <div className="planned-card">
          <div className="planned-card-head"><PieChart size={18} /><strong>为什么先不完整上线</strong></div>
          <p>完整服务台页面不是简单菜单。统计、记录和服务应用都依赖会话事实、消息事实、客服状态、接待方案、评价、SLA 和订单归因。先铺空页面会让运营判断失真。</p>
        </div>
        <div className="planned-card">
          <div className="planned-card-head"><FormInput size={18} /><strong>依赖条件</strong></div>
          <p>{props.item.dependsOn || "需要先完成 Shopify 插件接入、访客方案、接待方案和客服工作台闭环。"}</p>
        </div>
        <div className="planned-card">
          <div className="planned-card-head"><HelpCircle size={18} /><strong>当前可做</strong></div>
          <p>{props.item.nextStep || "先把入口保留在菜单里，后续按核心接待闭环逐步补齐数据模型和页面。"}</p>
          {props.item.relatedView ? (
            <button type="button" className="primary" onClick={() => props.onOpenRelated(props.item.relatedView!)}>
              <ExternalLink size={14} /> 打开{relatedLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}


import { Check, LogIn, Search, ShieldCheck, Store, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PlatformAPI, Shop, ShopSource } from "../../api";
import { errorText } from "../shared/helpers";
import { ToastMessage } from "../shared/types";

function chatSource(sources: ShopSource[]) {
  return sources.find((source) => source.type === "shopify_chat");
}

function loginRequired(source?: ShopSource) {
  return !source || source.metadata?.customerLoginRequired !== "false";
}

export function CustomerLoginPanel(props: {
  api: PlatformAPI;
  shops: Shop[];
  sourcesByShopId: Record<string, ShopSource[]>;
  onSourcesChanged: (sources: ShopSource[]) => void;
  setToast: (value: ToastMessage) => void;
}) {
  const [search, setSearch] = useState("");
  const [savingShopId, setSavingShopId] = useState("");
  const [bulkRequired, setBulkRequired] = useState(true);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [pendingModes, setPendingModes] = useState<Record<string, boolean>>({});
  const allRows = useMemo(() => props.shops.map((shop) => ({
    shop,
    source: chatSource(props.sourcesByShopId[shop.id] || [])
  })), [props.shops, props.sourcesByShopId]);
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword
      ? allRows.filter(({ shop }) => shop.displayName.toLowerCase().includes(keyword))
      : allRows;
  }, [allRows, search]);
  const connectedRows = allRows.filter((row) => row.source);
  const protectedCount = connectedRows.filter((row) => loginRequired(row.source)).length;

  async function change(shopId: string, required: boolean) {
    setPendingModes((current) => ({ ...current, [shopId]: required }));
    setSavingShopId(shopId);
    try {
      const updated = await props.api.updateCustomerLoginRequirement(shopId, required);
      props.onSourcesChanged([updated]);
      setPendingModes((current) => {
        const next = { ...current };
        delete next[shopId];
        return next;
      });
      props.setToast({ tone: "success", text: required ? "已要求客户登录后聊天" : "已允许游客聊天" });
    } catch (error) {
      setPendingModes((current) => {
        const next = { ...current };
        delete next[shopId];
        return next;
      });
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      setSavingShopId("");
    }
  }

  async function applyToAll() {
    if (!connectedRows.length) return;
    const mode = bulkRequired ? "要求登录" : "允许游客聊天";
    if (!window.confirm(`将全部 ${connectedRows.length} 家已接入 Xzdesk Chat 的店铺统一设为“${mode}”？`)) return;
    setPendingModes(Object.fromEntries(connectedRows.map(({ shop }) => [shop.id, bulkRequired])));
    setBulkSaving(true);
    try {
      const result = await props.api.updateAllCustomerLoginRequirements(bulkRequired);
      props.onSourcesChanged(result.sources);
      setPendingModes({});
      props.setToast({ tone: "success", text: `已统一更新 ${result.updated} 家店铺` });
    } catch (error) {
      setPendingModes({});
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      setBulkSaving(false);
    }
  }

  return <section className="customer-login-page">
    <header className="customer-login-header">
      <div>
        <h2>客户登录</h2>
        <p>控制 Shopify 前台聊天身份，设置即时生效。</p>
      </div>
      <div className="customer-login-summary">
        <ShieldCheck size={18} />
        <strong>{protectedCount}/{connectedRows.length}</strong>
        <span>家已接入店铺要求登录</span>
      </div>
    </header>

    <div className="customer-login-bulk">
      <div className="customer-login-bulk-copy">
        <strong>统一配置</strong>
        <span>一次覆盖全部已接入 Xzdesk Chat 的店铺</span>
      </div>
      <div className="customer-login-choice" role="group" aria-label="统一客户登录方式">
        <button type="button" className={bulkRequired ? "active" : ""} onClick={() => setBulkRequired(true)} disabled={bulkSaving}>
          <LogIn size={16} />要求登录{bulkRequired ? <Check size={14} /> : null}
        </button>
        <button type="button" className={!bulkRequired ? "active" : ""} onClick={() => setBulkRequired(false)} disabled={bulkSaving}>
          <Users size={16} />允许游客{!bulkRequired ? <Check size={14} /> : null}
        </button>
      </div>
      <button type="button" className="primary customer-login-apply" disabled={!connectedRows.length || bulkSaving} onClick={() => void applyToAll()}>
        <Check size={16} />{bulkSaving ? "应用中..." : `应用到 ${connectedRows.length} 家店铺`}
      </button>
    </div>

    <div className="customer-login-list-tools">
      <div className="customer-login-toolbar">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索店铺" aria-label="搜索店铺" />
      </div>
      <span>显示 {rows.length} / {allRows.length} 家店铺</span>
    </div>
    <div className="customer-login-table" role="table" aria-label="客户登录设置">
      <div className="customer-login-row customer-login-table-head" role="row">
        <span role="columnheader">店铺</span>
        <span role="columnheader">聊天渠道</span>
        <span role="columnheader">客户进入方式</span>
        <span className="customer-login-note-head" role="columnheader">规则说明</span>
      </div>
      {rows.map(({ shop, source }) => {
        const required = pendingModes[shop.id] ?? loginRequired(source);
        const saving = savingShopId === shop.id;
        return <div className="customer-login-row" role="row" key={shop.id}>
          <span className="customer-login-shop" role="cell"><Store size={17} /><strong>{shop.displayName}</strong></span>
          <span className={`customer-login-channel ${source ? "status-live" : "status-muted"}`} role="cell" data-label="聊天渠道">{source ? "Xzdesk Chat 已接入" : "尚未接入 Chat"}</span>
          <span className="customer-login-mode-cell" role="cell" data-label="客户进入方式">
            <span className="customer-login-choice" role="group" aria-label={`${shop.displayName}客户进入方式`}>
              <button
                type="button"
                className={source && required ? "active" : ""}
                disabled={!source || saving || bulkSaving}
                onClick={() => void change(shop.id, true)}
              >
                <LogIn size={15} />要求登录{source && required ? <Check size={13} /> : null}
              </button>
              <button
                type="button"
                className={source && !required ? "active" : ""}
                disabled={!source || saving || bulkSaving}
                onClick={() => void change(shop.id, false)}
              >
                <Users size={15} />允许游客{source && !required ? <Check size={13} /> : null}
              </button>
            </span>
          </span>
          <small className="customer-login-note-cell" role="cell" data-label="规则说明">{source ? (required ? "发送消息前验证 Shopify 客户身份" : "访客无需登录即可发送消息") : "接入后默认要求客户登录"}</small>
        </div>;
      })}
      {!rows.length && <div className="customer-login-empty">没有匹配的店铺</div>}
    </div>
  </section>;
}

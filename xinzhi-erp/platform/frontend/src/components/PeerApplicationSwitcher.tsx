import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { customerServiceEntryOrigin } from "../modules/customerServiceEntry";
import "./PeerApplicationSwitcher.css";

export function PeerApplicationSwitcher() {
  const { session } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const chatEnabled = session?.applications?.some((app) => app.code === "CHAT") === true;
  const chatOrigin = customerServiceEntryOrigin();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="peer-app-switcher" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="app-switcher-button" type="button" aria-label={t("切换应用")} title={t("切换应用")} aria-expanded={open} aria-controls="peer-applications" onClick={() => setOpen((value) => !value)}><LayoutGrid size={18} aria-hidden="true" /></button>
    {open && <nav id="peer-applications" className="peer-app-panel" aria-label={t("业务应用")}>
      <strong>{t("当前企业的应用")}</strong>
      <span aria-current="page">Xinzhi ERP · {t("当前应用")}</span>
      {chatEnabled && (chatOrigin ? <a href="/customer-service">{t("客服工作台")}</a> : <p role="status">{t("客服地址尚未配置，请联系管理员。")}</p>)}
      {!chatEnabled && <p>{t("当前账号未获其他业务应用授权。")}</p>}
    </nav>}
  </div>;
}

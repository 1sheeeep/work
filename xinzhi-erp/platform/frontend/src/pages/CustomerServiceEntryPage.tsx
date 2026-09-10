import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import { customerServiceEntryOrigin, customerServiceEntryErrorMessage, openCustomerServiceEntry } from "../modules/customerServiceEntry";

export function CustomerServiceEntryPage() {
  const { session, hasPermission } = useAuth();
  const { t } = useI18n();
  const attempted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = customerServiceEntryOrigin();
  const allowed = session?.applications?.some((app) => app.code === "CHAT") === true && hasPermission("customer_service.read");
  async function enter() {
    if (!origin || !allowed || busy) return;
    setBusy(true);
    setError("");
    try { await openCustomerServiceEntry(origin, "same-window"); }
    catch (cause) { setError(customerServiceEntryErrorMessage(cause)); setBusy(false); }
  }
  useEffect(() => {
    if (allowed && origin && !attempted.current) {
      attempted.current = true;
      void enter();
    }
  }, [allowed, origin]);
  return <section className="full-page-state" aria-busy={busy}>
    <h1>{t("客服工作台")}</h1>
    {!allowed ? <p role="alert">{t("当前账号没有客服访问权限，请联系企业管理员开通。")}</p>
      : !origin ? <p role="alert">{t("客服地址尚未配置，请联系管理员。")}</p>
      : <><p role="status">{t(busy ? "正在安全进入客服工作台，无需再次登录…" : "使用当前 ERP 账号进入客服工作台。")}</p>
        {error && <p role="alert">{t(error)}</p>}
        <button className="button button-primary" type="button" disabled={busy} onClick={() => void enter()}>{t(error ? "重试" : "进入客服工作台")}</button></>}
    <a href="/">{t("返回 ERP 工作台")}</a>
  </section>;
}

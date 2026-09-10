import { Link } from "@tanstack/react-router";
import { ArrowRight, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { resolveSecondaryNavigationTarget, splitNavigationTarget, type PrimaryNavigationItem } from "../modules/navigationDefinitions";
import "./QuickNavigation.css";

/** Search only the navigation already filtered by the current user's permissions. */
export function QuickNavigation({ navigation, locationKey, currentPrimaryId, search }: {
  navigation: PrimaryNavigationItem[];
  locationKey: string;
  currentPrimaryId?: string;
  search: string;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const titleId = useId();
  const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, "");
  const results = useMemo(() => navigation.flatMap(primary => {
    const entries = primary.groups.length ? primary.groups.flatMap(group => group.items.map(item => ({
      id: item.id, label: item.label, context: `${t(primary.label)} / ${t(group.label)}`,
      target: resolveSecondaryNavigationTarget(item, primary.id === currentPrimaryId ? search : "", locationKey.split("?", 1)[0]),
      icon: item.icon,
    }))) : [{ id: primary.id, label: primary.label, context: t(primary.label), target: primary.to, icon: primary.icon }];
    return entries.filter(entry => normalize(`${entry.label}${t(entry.label)}${entry.context}`).includes(normalize(query)));
  }), [navigation, currentPrimaryId, locationKey, search, query, t]);

  useEffect(() => { setOpen(false); }, [locationKey]);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
    };
  }, [open]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.altKey || event.isComposing) return;
      if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).some(element => !element.closest('[hidden]'))
        || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [inert]'))) return;
      event.preventDefault();
      setQuery("");
      setOpen(true);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  return <>
    <button ref={triggerRef} className="quick-navigation-trigger" type="button" aria-haspopup="dialog" aria-label={t("查找功能")} aria-keyshortcuts="Control+k Meta+k" onClick={() => { setQuery(""); setOpen(true); }}>
      <Search size={16} aria-hidden="true" /><span>{t("查找功能")}</span><kbd>Ctrl K</kbd>
    </button>
    <dialog ref={dialogRef} className="quick-navigation-dialog" aria-labelledby={titleId} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header><h2 id={titleId}>{t("查找功能")}</h2><button className="icon-button" type="button" aria-label={t("关闭功能查找")} onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={18} aria-hidden="true" /></button></header>
      <label className="quick-navigation-search"><Search size={18} aria-hidden="true" /><input ref={inputRef} type="search" aria-label={t("功能名称或所属模块")} placeholder={t("输入功能名称，例如库存、采购、店铺")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          dialogRef.current?.querySelector<HTMLAnchorElement>("nav a")?.focus();
        }
      }} /></label>
      <p className="quick-navigation-summary" role="status">{t("可访问功能 {count} 项", { count: results.length })}</p>
      <nav className="quick-navigation-results" aria-label={t("功能查找结果")}>
        {results.map(result => {
          const target = splitNavigationTarget(result.target);
          const Icon = result.icon;
          return <Link key={result.id} to={target.pathname as never} search={target.search as never} onClick={() => setOpen(false)} className="quick-navigation-result">
            <Icon size={18} aria-hidden="true" /><span><strong>{t(result.label)}</strong><small>{result.context}</small></span><ArrowRight size={16} aria-hidden="true" />
          </Link>;
        })}
        {!results.length && <p className="quick-navigation-empty">{t("未找到可访问的功能，请换个关键词。")}</p>}
      </nav>
      <footer>{t("仅查找当前账号可访问的功能，不搜索业务数据。")}</footer>
    </dialog>
  </>;
}

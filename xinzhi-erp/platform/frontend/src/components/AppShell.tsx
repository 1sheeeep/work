import {
  Building2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Languages,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Outlet, useMatches, useRouterState } from "@tanstack/react-router";
import { useAuth } from "../auth/AuthContext";
import { changeTenantPassword } from "../auth/authApi";
import { sessionStore } from "../auth/sessionStore";
import { PasswordDialog } from "./PasswordDialog";
import { PeerApplicationSwitcher } from "./PeerApplicationSwitcher";
import { QuickNavigation } from "./QuickNavigation";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { type ErpRouteHandle } from "../modules/moduleDefinitions";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher";
import { useI18n } from "../i18n/I18nContext";
import {
  getAccessibleTenantNavigation,
  getCurrentPrimaryNavigation,
  getCurrentSecondaryNavigation,
  resolveSecondaryNavigationTarget,
  splitNavigationTarget,
  type OrderNavigationStage,
} from "../modules/navigationDefinitions";
import { orderCenterApi, type DashboardSummary } from "../modules/orderCenterApi";
import {
  ENTERPRISE_BRANDING_CHANGED,
  enterpriseBrandingApi,
  type EnterpriseBranding,
} from "../modules/enterpriseBrandingApi";

const DEFAULT_SIDEBAR_WIDTH = 224;
const MIN_SIDEBAR_WIDTH = 176;
const MAX_SIDEBAR_WIDTH = 360;
const COLLAPSED_SIDEBAR_WIDTH = 52;
const SIDEBAR_WIDTH_KEY = "xz-erp.sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "xz-erp.sidebar-collapsed";

function clampSidebarWidth(value: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

function readStoredWidth() {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!stored?.trim()) return DEFAULT_SIDEBAR_WIDTH;
    const value = Number(stored);
    return Number.isFinite(value) ? clampSidebarWidth(value) : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function readStoredCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function orderNavigationCount(
  stage: OrderNavigationStage | undefined,
  summary: DashboardSummary | undefined,
) {
  if (!stage || !summary) return undefined;
  switch (stage) {
    case "ALL":
      return summary.totalOrders;
    case "UNPAID":
      return summary.unpaidOrders;
    case "REVIEW_PENDING":
      return summary.reviewPendingOrders;
    case "MERGE_PENDING":
      return summary.mergePendingOrders;
    case "PROCESSING":
      return summary.receivedOrders + summary.holdOrders + summary.readyToFulfillOrders;
    case "FULFILLING":
      return summary.fulfillingOrders;
    case "SHIPPED":
      return summary.shippedOrders;
    case "DELIVERED":
      return summary.deliveredOrders;
    case "CANCELLED":
      return summary.cancelledOrders;
  }
}

export function AppShell() {
  const { t } = useI18n();
  const { session, currentTenant, currentUser, hasPermission, logout } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const matches = useMatches();
  const mainRef = useRef<HTMLElement>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const navigationCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const orderNavigationSummaryRequest = useRef(0);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [compactViewport, setCompactViewport] = useState(() => window.matchMedia?.("(max-width: 820px)").matches ?? false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredCollapsed);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [applicationEntryNotice, setApplicationEntryNotice] = useState<string | null>(null);
  const [branding, setBranding] = useState<EnterpriseBranding>();
  const [brandingReload, setBrandingReload] = useState(0);
  const [watermarkClock, setWatermarkClock] = useState(() => new Date());
  const [orderNavigationSummary, setOrderNavigationSummary] = useState<DashboardSummary>();

  const currentHandle = matches.at(-1)?.staticData as ErpRouteHandle | undefined;
  const navigation = useMemo(
    () => getAccessibleTenantNavigation(hasPermission),
    [hasPermission],
  );
  const currentPrimary = getCurrentPrimaryNavigation(pathname, hasPermission);
  const orderNavigationShopId = currentPrimary?.id === "orders"
    ? new URLSearchParams(search).get("shopId") ?? ""
    : "";
  const canLoadOrderNavigationSummary =
    currentPrimary?.id === "orders" && hasPermission("orders.read");
  const secondaryGroups = currentPrimary?.groups ?? [];
  const currentSecondaryMatch = getCurrentSecondaryNavigation(
    secondaryGroups.flatMap((group) => group.items),
    pathname,
    search,
  );
  const currentSecondary = currentSecondaryMatch?.item;
  const activeGroupId = secondaryGroups.find((group) =>
    group.items.some((item) => item.id === currentSecondary?.id),
  )?.id;
  const currentSecondaryGroup = secondaryGroups.find((group) => group.id === activeGroupId);
  const hasSidebar = secondaryGroups.length > 0;
  const currentLabel =
    currentSecondaryMatch?.matchType === "path-prefix"
      ? t(currentHandle?.title ?? currentSecondary?.label ?? currentPrimary?.label ?? "工作台")
      : t(currentSecondary?.label ?? currentHandle?.title ?? currentPrimary?.label ?? "工作台");
  const showSecondaryGroupBreadcrumb =
    currentPrimary?.id === "settings" &&
    currentSecondaryGroup?.label !== undefined &&
    currentSecondaryGroup.label !== currentLabel;
  const platformTenantSession = Boolean(session?.platformAdmin);

  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 820px)");
    if (!query) return;
    const update = () => {
      setCompactViewport(query.matches);
      if (!query.matches) setMobileNavigationOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const closeMobileNavigation = useCallback((restoreFocus = true) => {
    setMobileNavigationOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => navigationTriggerRef.current?.focus());
    }
  }, []);

  const closeAccountMenu = useCallback((restoreFocus = false) => {
    setAccountMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => accountMenuTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    setMobileNavigationOpen(false);
    setAccountMenuOpen(false);
    // Announce the new content without jumping past its breadcrumb/filter bar.
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, search]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        closeAccountMenu();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAccountMenu(true);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen, closeAccountMenu]);

  useEffect(() => {
    if (!canLoadOrderNavigationSummary) {
      orderNavigationSummaryRequest.current += 1;
      setOrderNavigationSummary(undefined);
      return;
    }

    const requestId = ++orderNavigationSummaryRequest.current;
    setOrderNavigationSummary(undefined);
    void orderCenterApi.dashboardSummary(orderNavigationShopId || undefined)
      .then((summary) => {
        if (requestId === orderNavigationSummaryRequest.current) {
          setOrderNavigationSummary(summary);
        }
      })
      .catch(() => {
        if (requestId === orderNavigationSummaryRequest.current) {
          setOrderNavigationSummary(undefined);
        }
      });

    return () => {
      if (requestId === orderNavigationSummaryRequest.current) {
        orderNavigationSummaryRequest.current += 1;
      }
    };
  }, [canLoadOrderNavigationSummary, orderNavigationShopId]);

  useEffect(() => {
    if (!activeGroupId) return;
    setExpandedGroups((previous) =>
      previous.includes(activeGroupId) ? previous : [...previous, activeGroupId],
    );
  }, [activeGroupId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Local UI preferences are non-essential and must not affect navigation.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // Local UI preferences are non-essential and must not affect navigation.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!mobileNavigationOpen || !compactViewport) return;
    navigationCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation();
      }
      if (event.key !== "Tab") return;
      const items = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [])
        .filter(element => element.checkVisibility?.() ?? true);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMobileNavigation, compactViewport, mobileNavigationOpen]);

  useEffect(() => {
    const controller = new AbortController();
    setBranding(undefined);
    if (!currentTenant) return () => controller.abort();
    void enterpriseBrandingApi.get(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setBranding(value);
    }).catch(() => {
      if (!controller.signal.aborted) setBranding(undefined);
    });
    return () => controller.abort();
  }, [brandingReload, currentTenant]);

  useEffect(() => {
    const reloadBranding = () => setBrandingReload((value) => value + 1);
    window.addEventListener(ENTERPRISE_BRANDING_CHANGED, reloadBranding);
    return () => window.removeEventListener(ENTERPRISE_BRANDING_CHANGED, reloadBranding);
  }, []);

  useEffect(() => {
    if (!branding?.watermarkEnabled || !branding.watermarkTime) return;
    setWatermarkClock(new Date());
    const interval = window.setInterval(() => setWatermarkClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, [branding?.watermarkEnabled, branding?.watermarkTime]);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const updateWidth = (clientX: number) =>
      setSidebarWidth(clampSidebarWidth(startWidth + clientX - startX));
    const onMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSidebarCollapsed(false);
      setSidebarWidth((value) => clampSidebarWidth(value - 8));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setSidebarCollapsed(false);
      setSidebarWidth((value) => clampSidebarWidth(value + 8));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSidebarCollapsed(false);
      setSidebarWidth(MIN_SIDEBAR_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setSidebarCollapsed(false);
      setSidebarWidth(MAX_SIDEBAR_WIDTH);
    }
  };

  const handleLogout = async () => {
    closeAccountMenu();
    setSigningOut(true);
    try {
      if (platformTenantSession) {
        await logout();
        window.location.assign("/platform-admin/logout");
      } else {
        await logout();
        // Customer service revalidates this ERP session and expires its own session.
        window.location.assign("/login");
      }
    } finally {
      setSigningOut(false);
    }
  };

  const returnToPlatform = async () => {
    closeAccountMenu();
    try {
      await logout();
      window.location.assign("/platform-admin");
    } catch {
      setApplicationEntryNotice("暂时无法返回平台后台，请稍后重试。");
    }
  };

  const sidebarStyle = {
    "--sidebar-width": `${sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth}px`,
  } as CSSProperties;
  const watermarkText = useMemo(() => {
    if (!branding?.watermarkEnabled) return "";
    const values: string[] = [];
    if (branding.watermarkUserName && currentUser?.displayName) values.push(currentUser.displayName);
    if (branding.watermarkCompanyName && currentTenant?.name) values.push(currentTenant.name);
    if (branding.watermarkTime) values.push(new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(watermarkClock));
    const phone = currentUser?.phoneNumber?.replace(/\D/g, "") ?? "";
    if (branding.watermarkPhoneSuffix && phone.length >= 4) values.push(`手机尾号 ${phone.slice(-4)}`);
    return values.join(" · ");
  }, [branding, currentTenant?.name, currentUser?.displayName, currentUser?.phoneNumber, watermarkClock]);

  return (
    <div className="app-shell" style={sidebarStyle}>
      <a className="skip-link" href="#main-content">{t("跳到主要内容")}</a>

      <header className="topbar" inert={compactViewport && mobileNavigationOpen}>
        <div className="topbar-leading">
          {hasSidebar && (
            <button
              className="icon-button mobile-menu-button"
              type="button"
              ref={navigationTriggerRef}
              aria-label={t("打开二级导航")}
              aria-expanded={mobileNavigationOpen}
              aria-controls="primary-navigation"
              onClick={() => setMobileNavigationOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          )}
          <Link className="brand" to="/" aria-label={`Xinzhi ERP ${t("工作台")}`}>
            <span className="brand-mark has-product-logo" aria-hidden="true">
              <img src="/assets/xinzhi-erp-logo.png" alt="" />
            </span>
            <strong>Xinzhi ERP</strong>
          </Link>
          <PeerApplicationSwitcher />
        </div>

        <nav className="top-module-nav" aria-label={t("一级业务模块")}>
          {navigation.map((item) => {
            const className = `top-module-link ${currentPrimary?.id === item.id ? "active" : ""}`;
            return (
              <NavigationLink className={className} target={item.to} key={item.id} aria-current={currentPrimary?.id === item.id ? "page" : undefined}>
                {t(item.label)}
              </NavigationLink>
            );
          })}
          {session?.applications?.some((app) => app.code === "CHAT") && hasPermission("customer_service.read") && <Link className="top-module-link" to="/customer-service">{t("客服工作台")}</Link>}
        </nav>
        <div className="topbar-context" aria-label={t("当前身份")}>
          <QuickNavigation navigation={navigation} locationKey={`${pathname}${search}`} currentPrimaryId={currentPrimary?.id} search={search} />
          <div className={`account-menu ${accountMenuOpen ? "open" : ""}`} ref={accountMenuRef}>
            <button
              className="account-menu-trigger"
              type="button"
              ref={accountMenuTriggerRef}
              aria-label={t("打开账号设置")}
              aria-expanded={accountMenuOpen}
              aria-controls="account-settings-menu"
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              <UserRound size={17} aria-hidden="true" />
              <span className="account-menu-trigger-copy">
                <small>{currentTenant?.name}</small>
                <strong>{currentUser?.displayName ?? t("账号设置")}</strong>
              </span>
              <ChevronDown className="account-menu-chevron" size={15} aria-hidden="true" />
            </button>

            {accountMenuOpen && (
              <section id="account-settings-menu" className="account-menu-panel" aria-label={t("账号设置")}>
                <div className="account-menu-header">
                  <span className="account-menu-avatar" aria-hidden="true"><UserRound size={18} /></span>
                  <div>
                    <small>{t("账号设置")}</small>
                    <strong>{currentUser?.displayName ?? "—"}</strong>
                    <span>{currentTenant?.name ?? "—"}</span>
                  </div>
                </div>

                <div className="account-menu-section">
                  <ThemeSwitcher />
                  <div className="account-menu-preference">
                    <span><Languages size={16} aria-hidden="true" />{t("界面语言")}</span>
                    <div onClick={() => closeAccountMenu()}>
                      <LanguageSwitcher className="account-menu-language-switcher" />
                    </div>
                  </div>
                  {currentUser && !platformTenantSession && (
                    sessionStore.accessToken()?.startsWith("cs-native_") ?
                    <a className="account-menu-action" href="/customer-service" onClick={() => closeAccountMenu()}>
                      <KeyRound size={16} aria-hidden="true" /><span>到客服修改密码</span>
                    </a> :
                    <button className="account-menu-action" type="button" onClick={() => {
                      closeAccountMenu();
                      setPasswordNotice(null);
                      setChangingPassword(true);
                    }}>
                      <KeyRound size={16} aria-hidden="true" />
                      <span>{t("修改密码")}</span>
                    </button>
                  )}
                  {platformTenantSession && (
                    <button className="account-menu-action" type="button" onClick={() => void returnToPlatform()}>
                      <Building2 size={16} aria-hidden="true" />
                      <span>{t("返回平台后台")}</span>
                    </button>
                  )}
                </div>

                <div className="account-menu-section account-menu-signout-section">
                  <button className="account-menu-action account-menu-signout" type="button" aria-label={t("退出登录")} disabled={signingOut} onClick={() => void handleLogout()}>
                    <LogOut size={16} aria-hidden="true" />
                    <span>{signingOut ? t("退出中") : t("退出")}</span>
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </header>

      <div className={`workspace ${hasSidebar ? "" : "workspace-without-sidebar"}`}>
        {watermarkText && <div className="enterprise-watermark-layer" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <span key={index}>{watermarkText}</span>)}</div>}
        {hasSidebar && mobileNavigationOpen && (
          <button className="navigation-scrim" type="button" aria-label={t("关闭二级导航")} onClick={() => closeMobileNavigation()} />
        )}

        {hasSidebar && (
          <>
            <aside
              ref={sidebarRef}
              id="primary-navigation"
              inert={compactViewport && !mobileNavigationOpen}
              role={compactViewport && mobileNavigationOpen ? "dialog" : undefined}
              aria-modal={compactViewport && mobileNavigationOpen ? true : undefined}
              className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileNavigationOpen ? "sidebar-open" : ""}`}
              aria-label={`${t(currentPrimary?.label ?? "当前模块")} ${t("功能")}`}
            >
              <div className="sidebar-heading">
                <span>{currentPrimary ? t(currentPrimary.label) : ""}</span>
                {!compactViewport && <button className="sidebar-collapse-button" type="button" title={t(sidebarCollapsed ? "展开二级导航" : "折叠二级导航")} aria-label={t(sidebarCollapsed ? "展开二级导航" : "折叠二级导航")} onClick={() => setSidebarCollapsed((value) => !value)}>
                  {sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
                </button>}
                <button className="icon-button sidebar-close" type="button" ref={navigationCloseRef} aria-label={t("关闭二级导航")} onClick={() => closeMobileNavigation()}>
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <div className="sidebar-navigation-scroll">
                <nav className="secondary-navigation" aria-label={`${t(currentPrimary?.label ?? "当前模块")} ${t("功能")}`}>
                  {secondaryGroups.map((group) => {
                    const expanded = expandedGroups.includes(group.id);
                    return (
                      <section className="navigation-group" key={group.id}>
                        <button className="navigation-group-toggle" type="button" aria-label={t(group.label)} aria-expanded={expanded} onClick={() => setExpandedGroups((previous) => expanded ? previous.filter((item) => item !== group.id) : [...previous, group.id])}>
                          <span>{t(group.label)}</span>
                          <ChevronRight aria-hidden="true" size={15} />
                        </button>
                        {expanded && (
                          <div className="navigation-group-items" role="group" aria-label={`${t(group.label)} ${t("功能")}`}>
                            {group.items.map((item) => {
                              const active = currentSecondary?.id === item.id;
                              const ItemIcon = item.icon;
                              const count = orderNavigationCount(
                                item.orderStage,
                                orderNavigationSummary,
                              );
                              return (
                                <NavigationLink
                                  activeOptions={{ exact: true, includeSearch: true }}
                                  activeProps={{}}
                                  className={`nav-item ${count !== undefined ? "nav-item-with-count" : ""} ${active ? "active" : ""}`}
                                  target={resolveSecondaryNavigationTarget(item, search, pathname)}
                                  key={item.id}
                                  title={t(item.label)}
                                  aria-current={active ? "page" : undefined}
                                >
                                  <ItemIcon aria-hidden="true" size={16} />
                                  <span>{t(item.label)}</span>
                                  {count !== undefined && (
                                    <strong className="nav-item-count">{count.toLocaleString("zh-CN")}</strong>
                                  )}
                                </NavigationLink>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </nav>
              </div>
            </aside>

            <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label={t(sidebarCollapsed ? "展开二级导航" : "调整二级导航宽度")} aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={MAX_SIDEBAR_WIDTH} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={handleResizeStart} onKeyDown={handleResizeKeyDown} onDoubleClick={() => {
              setSidebarCollapsed(false);
              setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            }} />
          </>
        )}

        <div className="content-column" inert={compactViewport && mobileNavigationOpen}>
          <div className="breadcrumb" aria-label={t("面包屑")}>
            <Link to="/">{t("工作台")}</Link>
            {currentPrimary && currentPrimary.id !== "dashboard" && (
              <>
                <span className="breadcrumb-separator" aria-hidden="true">/</span>
                <NavigationLink target={currentPrimary.to}>{t(currentPrimary.label)}</NavigationLink>
              </>
            )}
            {showSecondaryGroupBreadcrumb && currentSecondaryGroup && (
              <>
                <span className="breadcrumb-separator" aria-hidden="true">/</span>
                <span>{t(currentSecondaryGroup.label)}</span>
              </>
            )}
            {currentSecondary && (
              <>
                <span className="breadcrumb-separator" aria-hidden="true">/</span>
                {currentSecondaryMatch?.matchType === "path-prefix" && currentLabel !== t(currentSecondary.label) && <>
                  <NavigationLink target={resolveSecondaryNavigationTarget(currentSecondary, search, pathname)}>{t(currentSecondary.label)}</NavigationLink>
                  <span className="breadcrumb-separator" aria-hidden="true">/</span>
                </>}
                <span aria-current="page">{currentLabel}</span>
              </>
            )}
          </div>
          <main id="main-content" className="main-content" ref={mainRef} tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>

      {passwordNotice && <div className="password-toast" role="status">{passwordNotice}</div>}
      {applicationEntryNotice && <div className="password-toast" role="alert">{applicationEntryNotice}</div>}
      {changingPassword && currentUser && !platformTenantSession && (
        <PasswordDialog
          accountName={currentUser.username}
          description="修改后请使用新密码登录。当前已登录会话不会自动退出。"
          requireCurrentPassword
          submitLabel="修改密码"
          title="修改我的密码"
          onClose={() => setChangingPassword(false)}
          onSubmit={({ currentPassword, newPassword }) => changeTenantPassword({ currentPassword: currentPassword ?? "", newPassword })}
          onSuccess={() => setPasswordNotice("密码已修改。")}
        />
      )}
    </div>
  );
}

function NavigationLink({
  target,
  children,
  ...props
}: {
  target: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Link>, "to" | "search">) {
  const { pathname, search } = splitNavigationTarget(target);
  return (
    <Link {...props} to={pathname as never} search={search as never}>
      {children}
    </Link>
  );
}

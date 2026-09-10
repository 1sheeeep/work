import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  Boxes,
  Cable,
  Download,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  LogOut,
  Plus,
  Pencil,
  Rocket,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { ApiError } from "../api/client";
import { DialogCloseButton } from "../components/DialogCloseButton";
import {
  displayLoginPhone,
  normalizeBusinessEmail,
  normalizeLoginPhone,
} from "../auth/identity";
import {
  MAXIMUM_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  meetsPasswordPolicy,
} from "../auth/passwordPolicy";
import { PasswordDialog } from "../components/PasswordDialog";
import { CredentialDialog } from "../platform/CredentialDialog";
import {
  httpPlatformAdminAdapter,
  resetPlatformAdminOwnPassword,
} from "../platform/platformAdminApi";
import { usePlatformAdmin } from "../platform/PlatformAdminContext";
import type {
  ActivationCredential,
  Enterprise,
  EnterpriseAdminPasswordTarget,
  LogisticsProviderConfig,
  PlatformPage,
  ShopifyAppRelease,
  ShopifyComplianceRequest,
  SystemAdmin,
  TenantEntitlements,
} from "../platform/types";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200] as const;
type Query = {
  adminPage: number;
  adminSize: number;
  tenantPage: number;
  tenantSize: number;
  q: string;
  section: PlatformSection;
  tenantId?: string;
};
type PlatformSection =
  | "tenants"
  | "admins";
type Load<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: PlatformPage<T> }
  | { kind: "error"; message: string }
  | { kind: "denied" };

const safePage = (value: string | null) =>
  value && /^\d+$/.test(value) && Number(value) < 1_000_000 ? Number(value) : 0;

const safePageSize = (value: string | null) => {
  const parsed = Number(value);
  return value &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= 200
    ? parsed
    : DEFAULT_PAGE_SIZE;
};

const safeSection = (value: string | null): PlatformSection =>
  value === "admins"
    ? value
    : "tenants";

const safeTenantId = (value: string | null) =>
  value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;

export const parsePlatformQuery = (search: string): Query => {
  const params = new URLSearchParams(search);
  return {
    adminPage: safePage(params.get("adminPage")),
    adminSize: safePageSize(params.get("adminSize")),
    tenantPage: safePage(params.get("tenantPage")),
    tenantSize: safePageSize(params.get("tenantSize")),
    q: (params.get("q") ?? "").slice(0, 100),
    section: safeSection(params.get("section")),
    tenantId: safeTenantId(params.get("tenantId")),
  };
};

export const toPlatformUrl = (query: Query) => {
  const params = new URLSearchParams({
    adminPage: String(query.adminPage),
    adminSize: String(query.adminSize),
    tenantPage: String(query.tenantPage),
    tenantSize: String(query.tenantSize),
    ...(query.q ? { q: query.q } : {}),
    ...(query.section !== "tenants" ? { section: query.section } : {}),
    ...(query.tenantId ? { tenantId: query.tenantId } : {}),
  });
  return `/platform-admin?${params}`;
};

const safeMessage = (error: unknown, action: string) => {
  if (error instanceof ApiError && error.status === 400)
    return action === "创建企业"
      ? "无法创建企业：企业标识只能使用 1–64 位小写英文、数字、下划线或短横线，请同时检查管理员账号、姓名和密码。"
      : `无法${action}：输入内容不符合要求，请检查后重试。`;
  if (error instanceof ApiError && error.status === 403)
    return `当前账号没有${action}的权限。`;
  if (error instanceof ApiError && error.status === 409)
    return "操作未完成：资源状态已变化，或系统必须至少保留一位有效管理员。请刷新后确认。";
  if (error instanceof ApiError && error.status === 404)
    return "目标资源不存在或当前无权访问。";
  return `暂时无法${action}，请稍后重试。`;
};

const identityDescription = (identity: {
  username: string;
  email?: string;
  phoneNumber?: string;
}) =>
  identity.email ??
  (identity.phoneNumber
    ? displayLoginPhone(identity.phoneNumber)
    : `旧账号 / 兼容登录账号：${identity.username}`);

const identityInputValue = (identity: {
  username: string;
  email?: string;
  phoneNumber?: string;
}) =>
  identity.email ??
  (identity.phoneNumber
    ? displayLoginPhone(identity.phoneNumber)
    : identity.username);

function normalizedAccountFromForm(
  form: HTMLFormElement,
  name: string,
): { email: string } | { phoneNumber: string } | null {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) return null;
  const email = normalizeBusinessEmail(input.value);
  const phoneNumber = normalizeLoginPhone(input.value);
  input.setCustomValidity(
    email || phoneNumber
      ? ""
      : "请输入有效邮箱或手机号，例如 admin@example.com 或 18002629295。",
  );
  if (!email && !phoneNumber) {
    input.reportValidity();
    return null;
  }
  input.value = email ?? displayLoginPhone(phoneNumber!);
  return email ? { email } : { phoneNumber: phoneNumber! };
}

function matchingPasswordFromForm(
  form: HTMLFormElement,
  passwordName: string,
  confirmationName: string,
): string | null {
  const passwordInput = form.elements.namedItem(passwordName);
  const confirmationInput = form.elements.namedItem(confirmationName);
  if (
    !(passwordInput instanceof HTMLInputElement) ||
    !(confirmationInput instanceof HTMLInputElement)
  )
    return null;
  const policySatisfied = meetsPasswordPolicy(passwordInput.value);
  passwordInput.setCustomValidity(
    policySatisfied ? "" : PASSWORD_POLICY_MESSAGE,
  );
  if (!policySatisfied) {
    passwordInput.reportValidity();
    passwordInput.focus();
    return null;
  }
  const matches = passwordInput.value === confirmationInput.value;
  confirmationInput.setCustomValidity(
    matches ? "" : "两次输入的密码不一致。",
  );
  if (!matches) {
    confirmationInput.reportValidity();
    confirmationInput.focus();
    return null;
  }
  return passwordInput.value;
}

function normalizedTenantCodeFromForm(
  form: HTMLFormElement,
  name: string,
): string | null {
  const input = form.elements.namedItem(name);
  if (!(input instanceof HTMLInputElement)) return null;
  const code = input.value.trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(code);
  input.setCustomValidity(
    valid
      ? ""
      : "企业标识只能使用 1–64 位小写英文、数字、下划线或短横线。",
  );
  if (!valid) {
    input.reportValidity();
    input.focus();
    return null;
  }
  input.value = code;
  return code;
}

export function PlatformAdminConsolePage() {
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parsePlatformQuery(search), [search]);
  const { session, logout, enterTenant } = usePlatformAdmin();
  const [admins, setAdmins] = useState<Load<SystemAdmin>>({ kind: "loading" });
  const [tenants, setTenants] = useState<Load<Enterprise>>({ kind: "loading" });
  const [credential, setCredential] = useState<ActivationCredential | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requests = useRef({ admins: 0, tenants: 0 });
  const actionInFlight = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const [activeSection, setActiveSection] = useState<PlatformSection>(
    query.section,
  );
  const patchQuery = useCallback(
    (patch: Partial<Query>) =>
      router.history.push(toPlatformUrl({ ...query, ...patch })),
    [query, router.history],
  );
  const loadAdmins = useCallback(async () => {
    const version = ++requests.current.admins;
    setAdmins((current) =>
      current.kind === "ready" ? current : { kind: "loading" },
    );
    try {
      const data = await httpPlatformAdminAdapter.listSystemAdmins({
        page: query.adminPage,
        size: query.adminSize,
      });
      if (version === requests.current.admins)
        setAdmins({ kind: "ready", data });
    } catch (error) {
      if (version === requests.current.admins)
        setAdmins(
          error instanceof ApiError && error.status === 403
            ? { kind: "denied" }
            : { kind: "error", message: safeMessage(error, "读取系统管理员") },
        );
    }
  }, [query.adminPage, query.adminSize]);
  const loadTenants = useCallback(async () => {
    const version = ++requests.current.tenants;
    setTenants((current) =>
      current.kind === "ready" ? current : { kind: "loading" },
    );
    try {
      const data = await httpPlatformAdminAdapter.listTenants({
        page: query.tenantPage,
        size: query.tenantSize,
      });
      if (version === requests.current.tenants)
        setTenants({ kind: "ready", data });
    } catch (error) {
      if (version === requests.current.tenants)
        setTenants(
          error instanceof ApiError && error.status === 403
            ? { kind: "denied" }
            : { kind: "error", message: safeMessage(error, "读取企业") },
        );
    }
  }, [query.tenantPage, query.tenantSize]);

  useEffect(() => {
    void loadAdmins();
  }, [loadAdmins, refresh]);
  useEffect(() => {
    void loadTenants();
  }, [loadTenants, refresh]);
  useEffect(() => {
    setActiveSection(query.section);
  }, [query.section]);

  const filteredAdmins =
    admins.kind === "ready"
      ? admins.data.items.filter((item) =>
          `${item.username} ${item.displayName}`
            .toLowerCase()
            .includes(query.q.toLowerCase()),
        )
      : [];
  const filteredTenants =
    tenants.kind === "ready"
      ? tenants.data.items.filter((item) =>
          `${item.code} ${item.name}`
            .toLowerCase()
            .includes(query.q.toLowerCase()),
        )
      : [];
  const refreshLists = () => setRefresh((value) => value + 1);
  const selectSection = (section: PlatformSection) => {
    setActiveSection(section);
    patchQuery({ section, tenantId: undefined });
  };
  const action = async (work: () => Promise<unknown>, label: string) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionPending(true);
    try {
      await work();
      setNotice(null);
      refreshLists();
    } catch (error) {
      setNotice(safeMessage(error, label));
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
  };

  return (
    <section className="platform-console" aria-labelledby="platform-title">
      <header className="platform-console-header">
        <div className="platform-console-heading">
          <h1 id="platform-title">平台管理</h1>
          <p>统一维护企业、平台管理员和企业可用的业务应用。</p>
        </div>
        <div className="platform-console-utilities">
          <span className="platform-console-identity">
            <small>当前管理员</small>
            <strong>{session?.admin.displayName}</strong>
          </span>
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={() => {
              setNotice(null);
              setPasswordNotice(null);
              setChangingPassword(true);
            }}
          >
            <KeyRound size={17} aria-hidden="true" />
            重置我的密码
          </button>
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={refreshLists}
          >
            <RefreshCw size={17} aria-hidden="true" />
            刷新
          </button>
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={() => void logout()}
          >
            <LogOut size={17} aria-hidden="true" />
            退出平台
          </button>
        </div>
      </header>

      {notice && (
        <div className="form-error" role="alert">
          {notice}
        </div>
      )}

      {passwordNotice && (
        <div className="warehouse-success" role="status">
          {passwordNotice}
        </div>
      )}

      <div className="platform-console-workspace">
        <aside className="platform-console-menu" aria-label="平台管理菜单">
          <p className="platform-menu-label">管理菜单</p>
          <nav className="platform-console-tabs" role="tablist" aria-label="平台管理功能">
          <button
            id="platform-tab-tenants"
            className="platform-console-tab"
            type="button"
            role="tab"
            aria-label="企业"
            aria-selected={activeSection === "tenants"}
            aria-controls="platform-panel-tenants"
            onClick={() => selectSection("tenants")}
          >
            <Building2 size={17} aria-hidden="true" />
            企业
            {tenants.kind === "ready" && (
              <span className="platform-tab-count" aria-hidden="true">
                {tenants.data.totalElements}
              </span>
            )}
          </button>
          <button
            id="platform-tab-admins"
            className="platform-console-tab"
            type="button"
            role="tab"
            aria-label="系统管理员"
            aria-selected={activeSection === "admins"}
            aria-controls="platform-panel-admins"
            onClick={() => selectSection("admins")}
          >
            <ShieldCheck size={17} aria-hidden="true" />
            系统管理员
            {admins.kind === "ready" && (
              <span className="platform-tab-count" aria-hidden="true">
                {admins.data.totalElements}
              </span>
            )}
          </button>
          </nav>
        </aside>

        <div className="platform-console-content">

        {(activeSection === "admins" ||
          (activeSection === "tenants" && !query.tenantId)) && (
          <form
            className="platform-toolbar"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              patchQuery({
                q: String(
                  new FormData(event.currentTarget).get("q") ?? "",
                ).trim(),
                adminPage: 0,
                tenantPage: 0,
                section: activeSection,
              });
            }}
          >
            <label className="platform-search-field">
              <span className="sr-only">搜索当前列表</span>
              <span className="platform-search-input">
                <Search size={17} aria-hidden="true" />
                <input
                  key={`${activeSection}-${query.q}`}
                  name="q"
                  defaultValue={query.q}
                  maxLength={100}
                  placeholder={
                    activeSection === "tenants"
                      ? "搜索企业名称或企业标识"
                      : "搜索管理员账号或姓名"
                  }
                />
              </span>
            </label>
            <button className="button button-secondary button-compact">搜索</button>
            {query.q && (
              <button
                className="text-button platform-clear-search"
                type="button"
                onClick={() =>
                  patchQuery({
                    q: "",
                    adminPage: 0,
                    tenantPage: 0,
                    section: activeSection,
                  })
                }
              >
                清除
              </button>
            )}
          </form>
          )}

          {activeSection === "tenants" && (
            <div
              id="platform-panel-tenants"
              className="platform-console-panel"
              role="tabpanel"
              aria-labelledby="platform-tab-tenants"
            >
              <TenantSection
                tenants={tenants}
                items={filteredTenants}
                onRefresh={refreshLists}
                onAction={action}
                actionPending={actionPending}
                onEnter={async (tenant) =>
                  action(async () => {
                    await enterTenant(tenant.id);
                    window.location.assign("/");
                  }, "进入企业")
                }
                onPage={(tenantPage) => patchQuery({ tenantPage })}
                onPageSize={(tenantSize) =>
                  patchQuery({ tenantPage: 0, tenantSize })
                }
                onNotice={setPasswordNotice}
                selectedTenantId={query.tenantId}
                onSelect={(tenantId) =>
                  patchQuery({ tenantId, section: "tenants" })
                }
                onBack={() => patchQuery({ tenantId: undefined })}
              />
            </div>
          )}

          {activeSection === "admins" && (
            <div
              id="platform-panel-admins"
              className="platform-console-panel"
              role="tabpanel"
              aria-labelledby="platform-tab-admins"
            >
              <AdminSection
                admins={admins}
                items={filteredAdmins}
                onRefresh={refreshLists}
                onCredential={setCredential}
                onAction={action}
                actionPending={actionPending}
                currentAdminId={session?.admin.id ?? null}
                onPage={(adminPage) => patchQuery({ adminPage })}
                onPageSize={(adminSize) =>
                  patchQuery({ adminPage: 0, adminSize })
                }
              />
            </div>
          )}

        </div>
      </div>

      {credential && (
        <CredentialDialog
          credential={credential}
          onClose={() => setCredential(null)}
        />
      )}

      {changingPassword && session && (
        <PasswordDialog
          accountName={identityDescription(session.admin)}
          description="直接设置新密码，不需要输入原密码。重置后全部登录会话都会失效，请使用新密码重新登录。"
          requireCurrentPassword={false}
          submitLabel="重置密码"
          title="重置我的密码"
          onClose={() => setChangingPassword(false)}
          onSubmit={({ newPassword }) =>
            resetPlatformAdminOwnPassword({ newPassword })
          }
          onSuccess={() => window.location.assign("/platform-admin/login")}
        />
      )}
    </section>
  );
}

type ShopifyReleaseLoad =
  | { kind: "loading" }
  | { kind: "ready"; data: ShopifyAppRelease }
  | { kind: "error"; message: string };

const shopifyReleaseStatus = (status: ShopifyAppRelease["status"]) =>
  ({
    NOT_CONFIGURED: { label: "未配置", tone: "disabled" },
    CONFIGURED: { label: "可以发布", tone: "active" },
    RUNNING: { label: "发布中", tone: "pending_activation" },
    SUCCEEDED: { label: "发布成功", tone: "active" },
    FAILED: { label: "发布失败", tone: "disabled" },
  })[status];

const shopifyReleaseError = (error: unknown, action: string) => {
  if (error instanceof ApiError && error.status === 409) {
    return `无法${action}：配置状态已经变化，请刷新后重试。`;
  }
  if (error instanceof ApiError && error.status === 502) {
    return `无法${action}：Shopify 发布失败，错误原因已保存在下方，可修改令牌后重试。`;
  }
  if (error instanceof ApiError && error.status === 400) {
    return `无法${action}：请输入当前 Xinzhi ERP 应用完整的 Automation Token。`;
  }
  return `暂时无法${action}，请稍后重试。`;
};

export function ShopifyAppReleaseSection() {
  const [state, setState] = useState<ShopifyReleaseLoad>({ kind: "loading" });
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<"save" | "publish" | "clear" | null>(
    null,
  );
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);
  const [confirmation, setConfirmation] = useState<"publish" | "clear" | null>(
    null,
  );

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({
        kind: "ready",
        data: await httpPlatformAdminAdapter.getShopifyAppRelease(),
      });
    } catch (error) {
      setState({
        kind: "error",
        message: shopifyReleaseError(error, "读取应用发布状态"),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "ready" || pending || token.trim().length < 20) return;
    setPending("save");
    setNotice(null);
    try {
      const saved = await httpPlatformAdminAdapter.saveShopifyAppReleaseToken({
        automationToken: token.trim(),
        version: state.data.version,
      });
      setToken("");
      setState({ kind: "ready", data: saved });
      setNotice({
        tone: "success",
        text: "Automation Token 已加密保存，现在可以直接发布。",
      });
    } catch (error) {
      setNotice({ tone: "error", text: shopifyReleaseError(error, "保存令牌") });
    } finally {
      setPending(null);
    }
  };

  const publish = async () => {
    if (state.kind !== "ready" || pending || !state.data.tokenConfigured) return;
    setConfirmation(null);
    setPending("publish");
    setNotice(null);
    const running: ShopifyAppRelease = {
      ...state.data,
      status: "RUNNING",
      message: undefined,
    };
    setState({ kind: "ready", data: running });
    try {
      const released = await httpPlatformAdminAdapter.publishShopifyApp(
        state.data.version,
      );
      setState({ kind: "ready", data: released });
      setNotice({
        tone: "success",
        text: `Shopify 应用 ${released.releaseVersion ?? "新版本"} 已发布。`,
      });
    } catch (error) {
      setNotice({ tone: "error", text: shopifyReleaseError(error, "发布应用") });
      await load();
    } finally {
      setPending(null);
    }
  };

  const clear = async () => {
    if (state.kind !== "ready" || pending || !state.data.tokenConfigured) return;
    setConfirmation(null);
    setPending("clear");
    setNotice(null);
    try {
      const cleared = await httpPlatformAdminAdapter.clearShopifyAppReleaseToken(
        state.data.version,
      );
      setToken("");
      setState({ kind: "ready", data: cleared });
      setNotice({ tone: "success", text: "Automation Token 已清除。" });
    } catch (error) {
      setNotice({ tone: "error", text: shopifyReleaseError(error, "清除令牌") });
    } finally {
      setPending(null);
    }
  };

  const data = state.kind === "ready" ? state.data : null;
  const status = data ? shopifyReleaseStatus(data.status) : null;

  return (
    <section
      className="detail-card platform-section shopify-release-section"
      aria-labelledby="shopify-release-title"
    >
      <div className="platform-section-heading">
        <div className="platform-section-title">
          <span className="platform-section-icon" aria-hidden="true">
            <Rocket size={20} />
          </span>
          <div>
            <h2 id="shopify-release-title">Shopify 应用发布</h2>
            <p>保存一次应用级 Automation Token，之后直接从这里发布 Xinzhi ERP 和 Xinzhi Chat。</p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={notice.tone === "success" ? "warehouse-success" : "form-error"}
          role={notice.tone === "success" ? "status" : "alert"}
        >
          {notice.text}
        </div>
      )}

      {state.kind === "loading" && (
        <p className="platform-state" aria-busy="true">正在加载…</p>
      )}
      {state.kind === "error" && (
        <div className="platform-state" role="alert">
          <p>{state.message}</p>
          <button className="button button-secondary" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {data && status && (
        <>
          <div className="shopify-release-overview">
            <div>
              <span>应用</span>
              <strong>{data.appName}</strong>
              <small>插件：{data.extensionName}</small>
            </div>
            <div>
              <span>令牌</span>
              <strong>{data.tokenConfigured ? "已安全配置" : "尚未配置"}</strong>
              <small>保存后不会回显原文</small>
            </div>
            <div>
              <span>发布状态</span>
              <strong>
                <span className={`platform-status platform-status-${status.tone}`}>
                  {status.label}
                </span>
              </strong>
              <small>{data.releaseVersion ?? "尚无发布记录"}</small>
            </div>
            <div>
              <span>最近发布</span>
              <strong>
                {data.releasedAt
                  ? new Date(data.releasedAt).toLocaleString("zh-CN")
                  : "—"}
              </strong>
              <small>点击发布后自动更新</small>
            </div>
          </div>

          {data.message && (
            <div
              className={data.status === "FAILED" ? "form-error" : "shopify-release-message"}
              role={data.status === "FAILED" ? "alert" : "status"}
            >
              {data.message}
            </div>
          )}

          <form className="shopify-release-token-form" onSubmit={(event) => void save(event)}>
            <label htmlFor="shopify-automation-token">
              App Automation Token
              <input
                id="shopify-automation-token"
                name="automationToken"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                minLength={20}
                maxLength={4096}
                required
                autoComplete="new-password"
                placeholder={data.tokenConfigured ? "输入新令牌可替换现有令牌" : "粘贴 Xinzhi ERP 应用的 Automation Token"}
                disabled={pending !== null}
              />
              <small>只用于发布 Shopify 应用，不用于店铺业务 API；保存后仅显示配置状态。</small>
            </label>
            <button
              className="button button-secondary"
              disabled={pending !== null || token.trim().length < 20}
            >
              {pending === "save" ? "正在保存…" : data.tokenConfigured ? "替换令牌" : "保存令牌"}
            </button>
          </form>

          <div className="shopify-release-actions">
            <div>
              <button
                className="button button-primary"
                type="button"
                disabled={pending !== null || !data.tokenConfigured || data.status === "RUNNING"}
                onClick={() => setConfirmation("publish")}
              >
                <Rocket size={16} aria-hidden="true" />
                {pending === "publish" || data.status === "RUNNING"
                  ? "正在发布…"
                  : data.status === "FAILED"
                    ? "重新发布"
                    : "发布 Shopify 应用"}
              </button>
              <p>将立即发布当前服务器内置的应用配置和 Xinzhi Chat 插件，不打开浏览器。</p>
            </div>
            {data.tokenConfigured && (
              <button
                className="text-button danger-text"
                type="button"
                disabled={pending !== null || data.status === "RUNNING"}
                onClick={() => setConfirmation("clear")}
              >
                清除令牌
              </button>
            )}
          </div>
        </>
      )}

      {confirmation && data && (
        <DialogShell
          title={confirmation === "publish" ? "确认发布 Shopify 应用" : "确认清除 Automation Token"}
          description={
            confirmation === "publish"
              ? "系统将立即向 Shopify 发布当前 Xinzhi ERP 应用配置与 Xinzhi Chat 插件。"
              : "清除后不能继续发布，重新保存 Automation Token 即可恢复。"
          }
          onClose={() => setConfirmation(null)}
          disabled={pending !== null}
        >
          <div className="platform-dialog-form">
            <p className={confirmation === "clear" ? "danger-copy" : "platform-form-note"}>
              {confirmation === "publish"
                ? "这会生成并启用一个新的 Shopify 应用版本；不会安装店铺、重新授权或修改主题开关。"
                : "历史发布状态会从当前配置页清除，但已发布的 Shopify 版本不会被删除。"}
            </p>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={() => setConfirmation(null)}>
                取消
              </button>
              <button
                className={`button ${confirmation === "clear" ? "button-danger" : "button-primary"}`}
                type="button"
                onClick={() => void (confirmation === "publish" ? publish() : clear())}
              >
                {confirmation === "publish" ? "确认发布" : "确认清除"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}
    </section>
  );
}

type PrivacyRequestLoad =
  | { kind: "loading" }
  | { kind: "ready"; data: ShopifyComplianceRequest[] }
  | { kind: "error"; message: string };

type PrivacyConfirmation = {
  request: ShopifyComplianceRequest;
  action: "delivery" | "redaction";
};

const privacyTopicLabel = (topic: ShopifyComplianceRequest["topic"]) =>
  ({
    CUSTOMER_DATA_REQUEST: "客户数据查询",
    CUSTOMER_REDACT: "客户数据删除",
    SHOP_REDACT: "店铺数据删除",
  })[topic];

const privacyStatusLabel = (status: ShopifyComplianceRequest["status"]) =>
  ({
    PENDING: "待处理",
    EXPORT_READY: "导出待交付",
    LOCAL_REDACTION_COMPLETE: "已匿名化，待同步",
    RETRY_REQUIRED: "需要重试",
    COMPLETED: "已完成",
  })[status];

const formatPrivacyTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));

const privacyErrorMessage = (error: unknown, action: string) => {
  if (error instanceof ApiError && error.status === 503) {
    return `暂时无法${action}：Shopify 连接服务不可用，请稍后重试。`;
  }
  if (error instanceof ApiError && error.status === 409) {
    return `无法${action}：请求状态已经变化，请刷新后重试。`;
  }
  if (error instanceof ApiError && error.status === 404) {
    return "该隐私请求已处理或已不在待办列表中，请刷新确认。";
  }
  return `暂时无法${action}，请稍后重试。`;
};

export function ShopifyComplianceSection() {
  const [state, setState] = useState<PrivacyRequestLoad>({ kind: "loading" });
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<PrivacyConfirmation | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setState({ kind: "loading" });
    try {
      const data = await httpPlatformAdminAdapter.listShopifyComplianceRequests();
      if (version === requestVersion.current) {
        setState({ kind: "ready", data });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setState({
          kind: "error",
          message: privacyErrorMessage(error, "读取隐私请求"),
        });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (request: ShopifyComplianceRequest) => {
    if (busyEventId) return;
    setBusyEventId(request.eventId);
    setNotice(null);
    try {
      const blob = await httpPlatformAdminAdapter.exportShopifyComplianceData(
        request.eventId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `shopify-customer-data-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice("客户数据文件已生成并下载。发送给店主后，请单独确认已交付。");
      await load();
    } catch (error) {
      setNotice(privacyErrorMessage(error, "生成客户数据文件"));
    } finally {
      setBusyEventId(null);
    }
  };

  const confirmAction = async () => {
    if (!confirmation || busyEventId) return;
    const target = confirmation;
    setBusyEventId(target.request.eventId);
    setNotice(null);
    try {
      if (target.action === "delivery") {
        await httpPlatformAdminAdapter.confirmShopifyComplianceExportDelivery(
          target.request.eventId,
        );
        setNotice("已记录交付并完成这项客户数据查询请求。");
      } else {
        await httpPlatformAdminAdapter.redactShopifyComplianceData(
          target.request.eventId,
        );
        setNotice("个人信息已匿名化，处理结果已同步。");
      }
      setConfirmation(null);
      await load();
    } catch (error) {
      setNotice(
        privacyErrorMessage(
          error,
          target.action === "delivery" ? "确认数据交付" : "执行数据匿名化",
        ),
      );
    } finally {
      setBusyEventId(null);
    }
  };

  return (
    <section className="surface platform-section privacy-compliance-section">
      <header className="platform-section-heading">
        <div className="platform-section-title">
          <span className="platform-section-icon privacy-section-icon">
            <ShieldAlert size={18} aria-hidden="true" />
          </span>
          <div>
            <h2>Shopify 隐私请求</h2>
            <p>处理客户数据查询与删除请求；个人信息删除后保留必要的交易和审计事实。</p>
          </div>
        </div>
        <div className="platform-section-actions">
          {state.kind === "ready" && (
            <span>待处理 {state.data.length} 项</span>
          )}
          <button
            className="button button-secondary button-compact"
            type="button"
            disabled={busyEventId !== null}
            onClick={() => void load()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        </div>
      </header>

      <div className="privacy-compliance-note">
        查询请求需先下载文件并交付给店主，再点击“确认已交付”；删除请求只匿名化个人信息，不删除订单金额、履约状态和审计记录。
      </div>

      {notice && (
        <div className="privacy-compliance-feedback" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      {state.kind === "loading" && (
        <p className="platform-state" aria-busy="true">正在读取隐私请求…</p>
      )}
      {state.kind === "error" && (
        <div className="platform-state" role="alert">
          <p>{state.message}</p>
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      )}
      {state.kind === "ready" && state.data.length === 0 && (
        <p className="platform-state">当前没有待处理的 Shopify 隐私请求。</p>
      )}
      {state.kind === "ready" && state.data.length > 0 && (
        <div className="platform-table-container">
          <table className="shop-table platform-table privacy-compliance-table">
            <thead>
              <tr>
                <th>店铺</th>
                <th>请求类型</th>
                <th>收到 / 截止时间</th>
                <th>处理状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((request) => {
                const busy = busyEventId === request.eventId;
                const dataRequest = request.topic === "CUSTOMER_DATA_REQUEST";
                return (
                  <tr key={request.eventId}>
                    <td>
                      <strong>{request.shopDomain}</strong>
                    </td>
                    <td>{privacyTopicLabel(request.topic)}</td>
                    <td className="privacy-time-cell">
                      <span>{formatPrivacyTime(request.occurredAt)}</span>
                      <small className={request.overdue ? "is-overdue" : undefined}>
                        截止 {formatPrivacyTime(request.dueAt)}
                        {request.overdue ? " · 已逾期" : ""}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`privacy-status privacy-status-${request.status.toLowerCase()}`}
                      >
                        {privacyStatusLabel(request.status)}
                      </span>
                      {request.recordCount !== undefined && (
                        <small className="privacy-record-count">
                          {request.recordCount} 条订单记录
                        </small>
                      )}
                    </td>
                    <td>
                      <div className="platform-row-actions privacy-row-actions">
                        {dataRequest ? (
                          <>
                            <button
                              className="button button-secondary button-compact"
                              type="button"
                              disabled={busyEventId !== null}
                              onClick={() => void download(request)}
                            >
                              <Download size={16} aria-hidden="true" />
                              {busy ? "生成中…" : request.exportPreparedAt ? "重新下载" : "下载数据"}
                            </button>
                            {request.exportPreparedAt && (
                              <button
                                className="button button-primary button-compact"
                                type="button"
                                disabled={busyEventId !== null}
                                onClick={() =>
                                  setConfirmation({ request, action: "delivery" })
                                }
                              >
                                确认已交付
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            className="button button-danger button-compact"
                            type="button"
                            disabled={busyEventId !== null}
                            onClick={() =>
                              setConfirmation({ request, action: "redaction" })
                            }
                          >
                            {busy
                              ? "处理中…"
                              : request.status === "LOCAL_REDACTION_COMPLETE"
                                ? "重试结果同步"
                                : "执行匿名化"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmation && (
        <DialogShell
          title={
            confirmation.action === "delivery"
              ? "确认数据已交付"
              : "确认匿名化个人信息"
          }
          description={
            confirmation.action === "delivery"
              ? "仅在客户数据文件已经安全交付给店主后继续。"
              : "该操作会清除 ERP 中与请求关联的客户联系方式和地址，无法恢复。"
          }
          disabled={busyEventId !== null}
          onClose={() => setConfirmation(null)}
        >
          <div className="platform-dialog-form privacy-confirmation-dialog">
            <dl>
              <div>
                <dt>店铺</dt>
                <dd>{confirmation.request.shopDomain}</dd>
              </div>
              <div>
                <dt>请求</dt>
                <dd>{privacyTopicLabel(confirmation.request.topic)}</dd>
              </div>
            </dl>
            <p
              className={
                confirmation.action === "redaction"
                  ? "privacy-danger-copy"
                  : "privacy-delivery-copy"
              }
            >
              {confirmation.action === "delivery"
                ? "确认后该请求会从待办中完成；系统只记录交付事实，不会再次发送文件。"
                : "订单金额、履约状态和审计记录会保留，但个人信息将被永久匿名化。"}
            </p>
            <div className="form-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={busyEventId !== null}
                onClick={() => setConfirmation(null)}
              >
                取消
              </button>
              <button
                className={`button ${
                  confirmation.action === "redaction"
                    ? "button-danger"
                    : "button-primary"
                }`}
                type="button"
                disabled={busyEventId !== null}
                onClick={() => void confirmAction()}
              >
                {busyEventId
                  ? "正在处理…"
                  : confirmation.action === "delivery"
                    ? "确认已交付"
                    : "确认匿名化"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}
    </section>
  );
}

type ProviderConfigLoad =
  | { kind: "loading" }
  | { kind: "ready"; data: LogisticsProviderConfig[] }
  | { kind: "error"; message: string };

export function LogisticsProviderConfigSection() {
  const [state, setState] = useState<ProviderConfigLoad>({ kind: "loading" });
  const [editing, setEditing] = useState<LogisticsProviderConfig | null>(null);
  const [renaming, setRenaming] = useState<LogisticsProviderConfig | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({
        kind: "ready",
        data: await httpPlatformAdminAdapter.listLogisticsProviderConfigs(),
      });
    } catch (error) {
      setState({
        kind: "error",
        message: safeMessage(error, "读取物流接口配置"),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);
    try {
      const saved = await httpPlatformAdminAdapter.updateLogisticsProviderConfig(
        editing.providerCode,
        {
          customerCode: String(form.get("customerCode") ?? "").trim(),
          authorizationCode: String(form.get("authorizationCode") ?? ""),
          secret: String(form.get("secret") ?? ""),
          version: editing.version,
        },
      );
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              data: current.data.map((item) =>
                item.providerCode === saved.providerCode ? saved : item,
              ),
            }
          : { kind: "ready", data: [saved] },
      );
      setEditing(null);
      setMessage(`${saved.providerName}接口凭据已安全保存。`);
    } catch (error) {
      setMessage(safeMessage(error, "保存物流接口配置"));
    } finally {
      setPending(false);
    }
  };

  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renaming || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);
    try {
      const saved = await httpPlatformAdminAdapter.renameLogisticsProvider(
        renaming.providerCode,
        {
          providerName: String(form.get("providerName") ?? "").trim(),
          version: renaming.nameVersion,
        },
      );
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              data: current.data.map((item) =>
                item.providerCode === saved.providerCode ? saved : item,
              ),
            }
          : { kind: "ready", data: [saved] },
      );
      setRenaming(null);
      setMessage(`物流商名称已更新为“${saved.providerName}”。`);
    } catch (error) {
      setMessage(safeMessage(error, "修改物流商名称"));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="detail-card platform-section" aria-labelledby="provider-config-title">
      <div className="platform-section-heading">
        <div className="platform-section-title">
          <span className="platform-section-icon" aria-hidden="true">
            <Cable size={20} />
          </span>
          <div>
            <h2 id="provider-config-title">物流商接口配置</h2>
            <p>系统级接口凭据仅供连接器使用，企业员工和货代授权页面均不可见。</p>
          </div>
        </div>
      </div>

      {message && (
        <div className={message.includes("已安全保存") || message.includes("名称已更新") ? "warehouse-success" : "form-error"} role="status">
          {message}
        </div>
      )}

      {state.kind === "loading" && (
        <p className="platform-state" aria-busy="true">正在加载…</p>
      )}
      {state.kind === "error" && (
        <div className="platform-state" role="alert">
          <p>{state.message}</p>
          <button className="button button-secondary" type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {state.kind === "ready" && (
        <div className="platform-table-container">
          <table className="shop-table platform-table">
            <thead>
              <tr>
                <th>物流商</th>
                <th>连接器</th>
                <th>使用范围</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((item) => (
                <tr key={item.providerCode}>
                  <td>
                    <strong>{item.providerName}</strong>
                    <small>{item.providerCode}</small>
                  </td>
                  <td>
                    <span className={`platform-status platform-status-${item.configured ? "active" : "disabled"}`}>
                      {item.configurationMode === "BUILT_IN"
                        ? "已启用"
                        : item.configured
                          ? "已配置"
                          : "未配置"}
                    </span>
                  </td>
                  <td>
                    <span>{item.configurationSummary}</span>
                    <small>{item.endpointSummary}</small>
                  </td>
                  <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : "—"}</td>
                  <td>
                    <div className="platform-row-actions">
                      <a
                        className="text-button"
                        href={item.documentationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        接口文档 <ExternalLink size={14} aria-hidden="true" />
                      </a>
                      <button className="text-button" type="button" onClick={() => {
                        setMessage(null);
                        setRenaming(item);
                      }}>
                        修改名称
                      </button>
                      {item.configurationMode === "SYSTEM_CREDENTIALS" && (
                        <button className="text-button" type="button" onClick={() => {
                          setMessage(null);
                          setEditing(item);
                        }}>
                          {item.configured ? "替换凭据" : "配置凭据"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DialogShell
          title={`配置${editing.providerName}接口凭据`}
          description="此配置属于平台系统，不会显示在企业员工使用的货代授权页面。"
          onClose={() => setEditing(null)}
          disabled={pending}
        >
          <form className="platform-dialog-form" onSubmit={(event) => void submit(event)}>
            {editing.configured && (
              <p className="platform-form-note">为保护敏感信息，已保存内容不会回显；本次保存将整体替换原凭据。</p>
            )}
            <div className="platform-form-grid platform-provider-config-grid">
              <label>
                客户编码
                <input name="customerCode" required maxLength={256} autoComplete="off" />
              </label>
              <label>
                授权码
                <input name="authorizationCode" type="password" required maxLength={2048} autoComplete="new-password" />
              </label>
              <label>
                密钥
                <input name="secret" type="password" required maxLength={2048} autoComplete="new-password" />
              </label>
            </div>
            <p className="platform-form-note">三个字段均由物流商提供。保存后只显示配置状态，不显示原始内容。</p>
            <div className="form-actions">
              <button className="button button-secondary" type="button" disabled={pending} onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="button button-primary" disabled={pending}>
                {pending ? "正在保存…" : "安全保存"}
              </button>
            </div>
          </form>
        </DialogShell>
      )}

      {renaming && (
        <DialogShell
          title="修改物流商名称"
          description="此名称用于平台目录和企业货代授权页面；接口编码与连接配置不会改变。"
          onClose={() => setRenaming(null)}
          disabled={pending}
        >
          <form className="platform-dialog-form" onSubmit={(event) => void submitName(event)}>
            <div className="platform-form-grid">
              <label>
                物流商名称
                <input
                  name="providerName"
                  required
                  maxLength={120}
                  defaultValue={renaming.providerName}
                  autoComplete="organization"
                  autoFocus
                />
              </label>
            </div>
            <p className="platform-form-note">名称修改后企业员工会看到新名称，物流接口编码保持不变。</p>
            <div className="form-actions">
              <button className="button button-secondary" type="button" disabled={pending} onClick={() => setRenaming(null)}>
                取消
              </button>
              <button className="button button-primary" disabled={pending}>
                {pending ? "正在保存…" : "保存名称"}
              </button>
            </div>
          </form>
        </DialogShell>
      )}
    </section>
  );
}

function TenantSection({
  tenants,
  items,
  onRefresh,
  onAction,
  actionPending,
  onEnter,
  onPage,
  onPageSize,
  onNotice,
  selectedTenantId,
  onSelect,
  onBack,
}: {
  tenants: Load<Enterprise>;
  items: Enterprise[];
  onRefresh: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  actionPending: boolean;
  onEnter: (tenant: Enterprise) => Promise<void>;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onNotice: (message: string | null) => void;
  selectedTenantId?: string;
  onSelect: (tenantId: string) => void;
  onBack: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const total = tenants.kind === "ready" ? tenants.data.totalElements : null;
  const selectedTenant =
    tenants.kind === "ready" && selectedTenantId
      ? tenants.data.items.find((tenant) => tenant.id === selectedTenantId)
      : undefined;

  if (selectedTenantId) {
    if (tenants.kind === "loading") {
      return <p className="platform-state" aria-busy="true">正在读取企业详情…</p>;
    }
    if (!selectedTenant) {
      return (
        <section className="detail-card platform-section platform-detail-missing">
          <h2>无法打开企业</h2>
          <p>企业不在当前列表页、已被删除，或当前账号无权访问。</p>
          <button className="button button-secondary" type="button" onClick={onBack}>
            <ArrowLeft size={17} aria-hidden="true" />
            返回企业列表
          </button>
        </section>
      );
    }
    return (
      <TenantDetailSection
        tenant={selectedTenant}
        actionPending={actionPending}
        onAction={onAction}
        onBack={onBack}
        onEnter={onEnter}
        onNotice={onNotice}
      />
    );
  }

  return (
    <section className="detail-card platform-section">
      <div className="platform-section-heading">
        <div className="platform-section-title">
          <span className="platform-section-icon" aria-hidden="true">
            <Building2 size={20} />
          </span>
          <div>
            <h2>企业</h2>
            <p>
              仅为已获我们批准的用户开户。创建企业时设置首位管理员，使用范围由企业应用授权和账号权限共同控制；Shopify 安装不授予系统使用权。
            </p>
          </div>
        </div>
        <div className="platform-section-actions">
          {total !== null && <span>共 {total} 家企业</span>}
          <button
            className="button button-primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus size={17} aria-hidden="true" />
            新建企业
          </button>
        </div>
      </div>

      <LoadView state={tenants} onRetry={onRefresh} empty="暂无企业。">
        {() =>
          items.length ? (
            <>
              <div className="platform-table-container">
                <table className="shop-table platform-table platform-tenant-table">
                  <thead>
                    <tr>
                      <th>企业</th>
                      <th>状态</th>
                      <th>管理员</th>
                      <th>成员</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <button
                            className="platform-tenant-name"
                            type="button"
                            onClick={() => onSelect(tenant.id)}
                          >
                            {tenant.name}
                          </button>
                          <small>企业标识：{tenant.code}</small>
                        </td>
                        <td><EnterpriseStatusChip status={tenant.status} /></td>
                        <td>
                          <span className="platform-count"><ShieldCheck size={16} aria-hidden="true" />{tenant.adminCount} 位</span>
                        </td>
                        <td>
                          <span className="platform-count"><Users size={16} aria-hidden="true" />{tenant.memberCount} 位</span>
                        </td>
                        <td>
                          <div className="platform-row-actions">
                            <button
                              className="button button-primary button-compact"
                              type="button"
                              disabled={actionPending}
                              onClick={() => onSelect(tenant.id)}
                            >
                              管理企业
                            </button>
                            <button
                              className="button button-secondary button-compact"
                              type="button"
                              disabled={actionPending || tenant.status !== "ACTIVE"}
                              onClick={() => void onEnter(tenant)}
                            >
                              进入企业
                              <ExternalLink size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                data={tenants.kind === "ready" ? tenants.data : null}
                label="企业列表分页"
                onPage={onPage}
                onPageSize={onPageSize}
              />
            </>
          ) : (
            <p className="platform-empty-filter">当前页没有匹配的企业。</p>
          )
        }
      </LoadView>

      {creating && (
        <TenantCreateDialog
          actionPending={actionPending}
          onClose={() => setCreating(false)}
          onAction={onAction}
        />
      )}

    </section>
  );
}

function TenantDetailSection({
  tenant,
  actionPending,
  onAction,
  onBack,
  onEnter,
  onNotice,
}: {
  tenant: Enterprise;
  actionPending: boolean;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onBack: () => void;
  onEnter: (tenant: Enterprise) => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [admins, setAdmins] = useState<Load<EnterpriseAdminPasswordTarget>>({
    kind: "loading",
  });
  const [adminPage, setAdminPage] = useState(0);
  const [adminSize, setAdminSize] = useState(DEFAULT_PAGE_SIZE);
  const [adminRefresh, setAdminRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [entitlements, setEntitlements] = useState(false);
  const [passwordAdmin, setPasswordAdmin] =
    useState<EnterpriseAdminPasswordTarget | null>(null);
  const [statusAdmin, setStatusAdmin] =
    useState<EnterpriseAdminPasswordTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const adminRequest = useRef(0);

  const loadEnterpriseAdmins = useCallback(async () => {
    const request = ++adminRequest.current;
    setAdmins((current) =>
      current.kind === "ready" ? current : { kind: "loading" },
    );
    try {
      const data = await httpPlatformAdminAdapter.listEnterpriseAdmins(
        tenant.id,
        { page: adminPage, size: adminSize },
      );
      if (request === adminRequest.current) setAdmins({ kind: "ready", data });
    } catch (error) {
      if (request !== adminRequest.current) return;
      setAdmins(
        error instanceof ApiError && error.status === 403
          ? { kind: "denied" }
          : { kind: "error", message: safeMessage(error, "读取企业管理员") },
      );
    }
  }, [adminPage, adminSize, tenant.id]);

  useEffect(() => {
    void loadEnterpriseAdmins();
    return () => {
      adminRequest.current += 1;
    };
  }, [adminRefresh, loadEnterpriseAdmins]);

  const refreshAdmins = () => setAdminRefresh((value) => value + 1);
  const adminPageData = admins.kind === "ready" ? admins.data : null;

  return (
    <div className="platform-tenant-detail">
      <button className="platform-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" />
        企业列表
      </button>

      <section className="detail-card platform-detail-hero">
        <div className="platform-detail-heading">
          <span className="platform-section-icon" aria-hidden="true">
            <Building2 size={21} />
          </span>
          <div>
            <div className="platform-detail-title-line">
              <h2>{tenant.name}</h2>
              <EnterpriseStatusChip status={tenant.status} />
            </div>
            <p>企业标识：{tenant.code}</p>
          </div>
        </div>
        <div className="platform-detail-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={actionPending || tenant.status !== "ACTIVE"}
            onClick={() => void onEnter(tenant)}
          >
            进入企业
            <ExternalLink size={16} aria-hidden="true" />
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={() => setEditing(true)}
          >
            <Pencil size={16} aria-hidden="true" />
            编辑企业
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={() => setEntitlements(true)}
          >
            <Settings2 size={16} aria-hidden="true" />
            应用与模块
          </button>
        </div>
      </section>

      <dl className="platform-detail-facts" aria-label="企业概览">
        <div><dt>企业管理员</dt><dd>{tenant.adminCount} 位</dd></div>
        <div><dt>企业成员</dt><dd>{tenant.memberCount} 位</dd></div>
        <div><dt>创建时间</dt><dd>{new Date(tenant.createdAt).toLocaleString("zh-CN")}</dd></div>
        <div><dt>最近更新</dt><dd>{new Date(tenant.updatedAt).toLocaleString("zh-CN")}</dd></div>
      </dl>

      <section className="detail-card platform-section platform-admin-management">
        <div className="platform-section-heading">
          <div className="platform-section-title">
            <span className="platform-section-icon platform-section-icon-admin" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2>企业管理员</h2>
              <p>管理员拥有当前企业全部权限。停用后账号立即不能登录，可随时重新启用。</p>
            </div>
          </div>
          <div className="platform-section-actions">
            {adminPageData && <span>共 {adminPageData.totalElements} 位</span>}
            <button
              className="button button-primary"
              type="button"
              disabled={actionPending || tenant.status !== "ACTIVE"}
              onClick={() => setAddingAdmin(true)}
            >
              <UserPlus size={17} aria-hidden="true" />
              添加管理员
            </button>
          </div>
        </div>

        <LoadView
          state={admins}
          onRetry={refreshAdmins}
          empty="该企业暂无管理员。"
        >
          {(adminItems) => (
            <>
              <div className="platform-table-container">
                <table className="shop-table platform-table platform-enterprise-admin-table">
                  <thead>
                    <tr>
                      <th>登录账号</th>
                      <th>姓名</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminItems.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <strong>{identityDescription(admin)}</strong>
                          {admin.phoneNumber && <small>{displayLoginPhone(admin.phoneNumber)}</small>}
                        </td>
                        <td>{admin.displayName}</td>
                        <td>
                          <span className={`platform-status platform-status-${admin.status.toLowerCase()}`}>
                            {admin.status === "ACTIVE" ? "正常" : "已停用"}
                          </span>
                        </td>
                        <td>
                          <div className="platform-row-actions platform-enterprise-admin-actions">
                            <button
                              className="button button-secondary button-compact"
                              type="button"
                              disabled={actionPending || admin.status !== "ACTIVE"}
                              onClick={() => setPasswordAdmin(admin)}
                            >
                              <KeyRound size={15} aria-hidden="true" />
                              重置密码
                            </button>
                            <button
                              className={`button button-compact ${admin.status === "ACTIVE" ? "button-danger" : "button-secondary"}`}
                              type="button"
                              disabled={actionPending}
                              onClick={() => setStatusAdmin(admin)}
                            >
                              {admin.status === "ACTIVE" ? (
                                <><UserRoundX size={15} aria-hidden="true" />停用</>
                              ) : (
                                <><UserRoundCheck size={15} aria-hidden="true" />重新启用</>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                data={adminPageData}
                label="企业管理员分页"
                onPage={setAdminPage}
                onPageSize={(size) => {
                  setAdminPage(0);
                  setAdminSize(size);
                }}
              />
            </>
          )}
        </LoadView>
      </section>

      <section className="detail-card platform-danger-zone">
        <div>
          <h2>删除企业</h2>
          <p>删除后停止该企业登录并从企业列表隐藏，业务数据继续保留。</p>
        </div>
        <button
          className="button button-danger"
          type="button"
          disabled={actionPending}
          onClick={() => setDeleting(true)}
        >
          删除企业
        </button>
      </section>

      {editing && (
        <TenantEditDialog
          tenant={tenant}
          actionPending={actionPending}
          onClose={() => setEditing(false)}
          onAction={onAction}
          onSuccess={() => onNotice("企业信息已更新。")}
        />
      )}
      {addingAdmin && (
        <EnterpriseAdminDialog
          tenant={tenant}
          actionPending={actionPending}
          onClose={() => setAddingAdmin(false)}
          onAction={onAction}
          onSuccess={() => {
            refreshAdmins();
            onNotice("企业管理员已添加。")
          }}
        />
      )}
      {entitlements && (
        <TenantEntitlementDialog
          tenant={tenant}
          actionPending={actionPending}
          onClose={() => setEntitlements(false)}
          onAction={onAction}
        />
      )}
      {passwordAdmin && (
        <PasswordDialog
          accountName={identityDescription(passwordAdmin)}
          description={`平台管理员直接为 ${tenant.name} 的企业管理员设置新密码，不需要输入原密码。`}
          requireCurrentPassword={false}
          submitLabel="重置密码"
          title="重置企业管理员密码"
          onClose={() => setPasswordAdmin(null)}
          onSubmit={({ newPassword }) =>
            httpPlatformAdminAdapter.resetEnterpriseAdminPassword(
              tenant.id,
              passwordAdmin.id,
              { newPassword, version: passwordAdmin.version },
            )
          }
          onSuccess={() => {
            refreshAdmins();
            onNotice(`${identityDescription(passwordAdmin)} 的密码已重置。`);
          }}
        />
      )}
      {statusAdmin && (
        <EnterpriseAdminStatusDialog
          tenant={tenant}
          admin={statusAdmin}
          actionPending={actionPending}
          onClose={() => setStatusAdmin(null)}
          onAction={onAction}
          onSuccess={() => {
            refreshAdmins();
            onNotice(
              statusAdmin.status === "ACTIVE"
                ? "企业管理员已停用。"
                : "企业管理员已重新启用。",
            );
          }}
        />
      )}
      {deleting && (
        <TenantDeleteDialog
          tenant={tenant}
          actionPending={actionPending}
          onClose={() => setDeleting(false)}
          onAction={onAction}
          onDeleted={onBack}
        />
      )}
    </div>
  );
}

function EnterpriseAdminStatusDialog({
  tenant,
  admin,
  actionPending,
  onClose,
  onAction,
  onSuccess,
}: {
  tenant: Enterprise;
  admin: EnterpriseAdminPasswordTarget;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const disabling = admin.status === "ACTIVE";
  return (
    <DialogShell
      title={`${disabling ? "停用" : "重新启用"}企业管理员`}
      description={
        disabling
          ? "停用后该账号不能登录，但记录会保留并可重新启用。系统必须保留至少一位正常管理员。"
          : "重新启用后，该账号将恢复当前企业的全部管理员权限。"
      }
      onClose={onClose}
      disabled={actionPending}
    >
      <dl className="password-account">
        <dt>管理员</dt>
        <dd>{admin.displayName} · {identityDescription(admin)}</dd>
      </dl>
      <div className="form-actions">
        <button className="button button-secondary" type="button" disabled={actionPending} onClick={onClose}>取消</button>
        <button
          className={`button ${disabling ? "button-danger" : "button-primary"}`}
          type="button"
          disabled={actionPending}
          onClick={() => {
            void onAction(async () => {
              await httpPlatformAdminAdapter.updateEnterpriseAdmin(
                tenant.id,
                admin.id,
                {
                  displayName: admin.displayName,
                  status: disabling ? "DISABLED" : "ACTIVE",
                  version: admin.version,
                },
              );
              onSuccess();
              onClose();
            }, disabling ? "停用企业管理员" : "重新启用企业管理员");
          }}
        >
          {actionPending ? "正在保存…" : disabling ? "确认停用" : "确认启用"}
        </button>
      </div>
    </DialogShell>
  );
}

function TenantDeleteDialog({
  tenant,
  actionPending,
  onClose,
  onAction,
  onDeleted,
}: {
  tenant: Enterprise;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  return (
    <DialogShell
      title={`删除企业 · ${tenant.name}`}
      description="这是危险操作。企业将停止登录并从列表隐藏，业务数据继续保留。"
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmation !== tenant.code) return;
          void onAction(async () => {
            await httpPlatformAdminAdapter.deleteTenant(tenant.id, tenant.version);
            onDeleted();
          }, "删除企业");
        }}
      >
        <label>
          输入企业标识 <strong>{tenant.code}</strong> 确认
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.currentTarget.value)}
            autoComplete="off"
            autoFocus
          />
        </label>
        <div className="form-actions">
          <button className="button button-secondary" type="button" disabled={actionPending} onClick={onClose}>取消</button>
          <button className="button button-danger" disabled={actionPending || confirmation !== tenant.code}>
            {actionPending ? "正在删除…" : "确认删除企业"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function TenantEntitlementDialog({
  tenant,
  actionPending,
  onClose,
  onAction,
}: {
  tenant: Enterprise;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
}) {
  const [entitlements, setEntitlements] =
    useState<TenantEntitlements | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void httpPlatformAdminAdapter.getTenantEntitlements(tenant.id)
      .then((value) => {
        if (!active) return;
        setEntitlements(value);
        setSelected(Object.fromEntries(
          value.applications
            .filter((application) => application.enabled)
            .map((application) => [
              application.code,
              application.modules
                .filter((module) => module.enabled)
                .map((module) => module.code),
            ]),
        ));
      })
      .catch((reason) => {
        if (active) setError(safeMessage(reason, "读取应用配置"));
      });
    return () => {
      active = false;
    };
  }, [tenant.id]);

  const toggleApplication = (
    application: TenantEntitlements["applications"][number],
  ) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[application.code]) {
        delete next[application.code];
      } else {
        next[application.code] = application.modules.map((module) => module.code);
      }
      return next;
    });
  };

  const toggleModule = (applicationCode: string, moduleCode: string) => {
    setSelected((current) => {
      const modules = current[applicationCode] ?? [];
      const nextModules = modules.includes(moduleCode)
        ? modules.filter((code) => code !== moduleCode)
        : [...modules, moduleCode];
      return { ...current, [applicationCode]: nextModules };
    });
  };

  return (
    <DialogShell
      title={`应用配置 · ${tenant.name}`}
      description="先开通业务系统，再选择企业可使用的模块；关闭后保留已有数据与连接配置。"
      onClose={onClose}
      disabled={actionPending}
    >
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {!entitlements && !error && (
        <div className="platform-entitlement-loading">
          <RefreshCw size={17} aria-hidden="true" />正在读取应用配置…
        </div>
      )}
      {entitlements && (
        <form
          className="platform-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            const applications = entitlements.applications
              .filter((application) =>
                application.integrationStatus === "AVAILABLE" &&
                (selected[application.code]?.length ?? 0) > 0)
              .map((application) => ({
                code: application.code,
                modules: selected[application.code],
              }));
            void onAction(async () => {
              await httpPlatformAdminAdapter.updateTenantEntitlements(
                tenant.id,
                { version: entitlements.version, applications },
              );
              onClose();
            }, "保存应用配置");
          }}
        >
          <div className="platform-entitlement-grid">
            {entitlements.applications.map((application) => {
              const available = application.integrationStatus === "AVAILABLE";
              const enabled = (selected[application.code]?.length ?? 0) > 0;
              return (
                <fieldset
                  className={`platform-entitlement-card ${enabled ? "is-enabled" : ""}`}
                  key={application.code}
                  disabled={!available || actionPending}
                >
                  <legend className="sr-only">{application.name}</legend>
                  <div className="platform-entitlement-heading">
                    <span className="platform-entitlement-icon" aria-hidden="true">
                      <Boxes size={19} />
                    </span>
                    <span>
                      <strong>{application.name}</strong>
                      <small>{application.description}</small>
                    </span>
                    <label className="platform-entitlement-switch">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleApplication(application)}
                      />
                      <span>{available ? (enabled ? "已开通" : "未开通") : "待接入"}</span>
                    </label>
                  </div>
                  <div className="platform-entitlement-modules">
                    {application.modules.map((module) => (
                      <label key={module.code}>
                        <input
                          type="checkbox"
                          checked={selected[application.code]?.includes(module.code) ?? false}
                          disabled={!available || !enabled || actionPending}
                          onChange={() => toggleModule(application.code, module.code)}
                        />
                        <span>{module.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <p className="platform-form-note">
            账号安全、企业组织与权限、核心系统设置始终可用，不作为收费模块重复配置。
          </p>
          <div className="form-actions">
            <button className="button" type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="button button-primary"
              type="submit"
              disabled={actionPending}
            >
              {actionPending ? "正在保存…" : "保存应用配置"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

function TenantCreateDialog({
  actionPending,
  onClose,
  onAction,
}: {
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
}) {
  return (
    <DialogShell
      title="新建企业"
      description="企业与首位企业管理员将一次创建完成，并立即使用设置的初始密码登录。"
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const code = normalizedTenantCodeFromForm(formElement, "code");
          if (!code) return;
          const adminAccount = normalizedAccountFromForm(
            formElement,
            "adminLoginIdentifier",
          );
          if (!adminAccount) return;
          const adminInitialPassword = matchingPasswordFromForm(
            formElement,
            "adminInitialPassword",
            "adminInitialPasswordConfirmation",
          );
          if (adminInitialPassword === null) return;
          void onAction(async () => {
            await httpPlatformAdminAdapter.createTenant({
              code,
              name: String(form.get("name")).trim(),
              ...( "email" in adminAccount
                ? { adminEmail: adminAccount.email }
                : { adminPhoneNumber: adminAccount.phoneNumber }),
              adminDisplayName: String(form.get("adminDisplayName")).trim(),
              adminInitialPassword,
            });
            formElement.reset();
            onClose();
          }, "创建企业");
        }}
      >
        <fieldset>
          <legend>企业信息</legend>
          <div className="platform-form-grid">
            <label>
              企业标识（英文）
              <input
                name="code"
                aria-label="企业标识"
                placeholder="例如 xzkj"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={64}
                onChange={(event) => event.currentTarget.setCustomValidity("")}
                required
                autoFocus
                spellCheck={false}
              />
              <small>用于登录和系统识别，仅支持英文、数字、下划线和短横线；大写会自动转为小写。</small>
            </label>
            <label>
              企业名称
              <input
                name="name"
                placeholder="例如 公司名称"
                autoComplete="organization"
                maxLength={160}
                required
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>首位企业管理员</legend>
          <p>该管理员仅管理本企业员工、角色与业务数据。</p>
          <div className="platform-form-grid">
            <label>
              管理员账号
              <input
                name="adminLoginIdentifier"
                aria-label="管理员邮箱或手机号"
                placeholder="admin@example.com 或 18002629295"
                autoComplete="username"
                maxLength={254}
                onInput={(event) => event.currentTarget.setCustomValidity("")}
                required
                type="text"
              />
              <small>可使用邮箱或手机号；邮箱转为小写，手机号统一保存为国际格式。</small>
            </label>
            <label>
              管理员姓名
              <input
                name="adminDisplayName"
                placeholder="请输入真实姓名"
                autoComplete="name"
                maxLength={160}
                required
              />
            </label>
            <label>
              初始密码
              <input
                name="adminInitialPassword"
                aria-label="管理员初始密码"
                autoComplete="new-password"
                maxLength={MAXIMUM_PASSWORD_LENGTH}
                onChange={(event) => event.currentTarget.setCustomValidity("")}
                required
                type="password"
              />
            </label>
            <label>
              确认初始密码
              <input
                name="adminInitialPasswordConfirmation"
                aria-label="确认管理员初始密码"
                autoComplete="new-password"
                maxLength={MAXIMUM_PASSWORD_LENGTH}
                onChange={(event) => event.currentTarget.setCustomValidity("")}
                required
                type="password"
              />
            </label>
          </div>
        </fieldset>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={actionPending}
          >
            {actionPending ? "正在创建…" : "创建企业"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function TenantEditDialog({
  tenant,
  actionPending,
  onClose,
  onAction,
  onSuccess,
}: {
  tenant: Enterprise;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onSuccess?: () => void;
}) {
  return (
    <DialogShell
      title={`编辑企业 · ${tenant.name}`}
      description={`企业标识 ${tenant.code} 用于系统识别，创建后保持不变。`}
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onAction(async () => {
            await httpPlatformAdminAdapter.updateTenant(tenant.id, {
              name: String(form.get("name") ?? "").trim(),
              status: String(form.get("status")) as Enterprise["status"],
              version: tenant.version,
            });
            onSuccess?.();
            onClose();
          }, "编辑企业");
        }}
      >
        <div className="platform-form-grid">
          <label>
            企业名称
            <input
              name="name"
              defaultValue={tenant.name}
              maxLength={160}
              autoComplete="organization"
              required
              autoFocus
            />
          </label>
          <label>
            企业状态
            <select name="status" defaultValue={tenant.status}>
              <option value="ACTIVE">正常</option>
              <option value="SUSPENDED">暂停</option>
              <option value="DISABLED">停用</option>
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={onClose}
          >
            取消
          </button>
          <button className="button button-primary" disabled={actionPending}>
            {actionPending ? "正在保存…" : "保存企业信息"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function EnterpriseAdminDialog({
  tenant,
  actionPending,
  onClose,
  onAction,
  onSuccess,
}: {
  tenant: Enterprise;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onSuccess?: () => void;
}) {
  return (
    <DialogShell
      title={`为 ${tenant.name} 添加管理员`}
      description="新管理员只属于当前企业，并立即使用设置的初始密码登录。"
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const account = normalizedAccountFromForm(
            formElement,
            "loginIdentifier",
          );
          if (!account) return;
          const initialPassword = matchingPasswordFromForm(
            formElement,
            "initialPassword",
            "initialPasswordConfirmation",
          );
          if (initialPassword === null) return;
          void onAction(async () => {
            await httpPlatformAdminAdapter.createEnterpriseAdmin(tenant.id, {
              ...account,
              displayName: String(form.get("displayName")).trim(),
              initialPassword,
            });
            onSuccess?.();
            formElement.reset();
            onClose();
          }, "添加企业管理员");
        }}
      >
        <div className="platform-form-grid">
          <label>
            管理员账号
            <input
              name="loginIdentifier"
              aria-label={`${tenant.name}管理员邮箱或手机号`}
              placeholder="admin@example.com 或 18002629295"
              autoComplete="username"
              maxLength={254}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
              required
              type="text"
              autoFocus
            />
            <small>可使用邮箱或手机号登录。</small>
          </label>
          <label>
            管理员姓名
            <input
              name="displayName"
              aria-label={`${tenant.name}管理员姓名`}
              placeholder="请输入真实姓名"
              autoComplete="name"
              required
            />
          </label>
          <label>
            初始密码
            <input
              name="initialPassword"
              aria-label={`${tenant.name}管理员初始密码`}
              autoComplete="new-password"
              maxLength={MAXIMUM_PASSWORD_LENGTH}
              onChange={(event) => event.currentTarget.setCustomValidity("")}
              required
              type="password"
            />
          </label>
          <label>
            确认初始密码
            <input
              name="initialPasswordConfirmation"
              aria-label={`${tenant.name}确认管理员初始密码`}
              autoComplete="new-password"
              maxLength={MAXIMUM_PASSWORD_LENGTH}
              onChange={(event) => event.currentTarget.setCustomValidity("")}
              required
              type="password"
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={actionPending}
          >
            {actionPending ? "正在添加…" : "添加管理员"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function AdminSection({
  admins,
  items,
  onRefresh,
  onCredential,
  onAction,
  actionPending,
  currentAdminId,
  onPage,
  onPageSize,
}: {
  admins: Load<SystemAdmin>;
  items: SystemAdmin[];
  onRefresh: () => void;
  onCredential: (credential: ActivationCredential) => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  actionPending: boolean;
  currentAdminId: string | null;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SystemAdmin | null>(null);
  const [passwordAdmin, setPasswordAdmin] = useState<SystemAdmin | null>(null);
  const total = admins.kind === "ready" ? admins.data.totalElements : null;

  return (
    <section className="detail-card platform-section">
      <div className="platform-section-heading">
        <div className="platform-section-title">
          <span className="platform-section-icon platform-section-icon-admin">
            <ShieldCheck size={20} aria-hidden="true" />
          </span>
          <div>
            <h2>平台系统管理员</h2>
            <p>
              管理平台最高权限账号。系统必须始终保留至少一位有效管理员。
            </p>
          </div>
        </div>
        <div className="platform-section-actions">
          {total !== null && <span>共 {total} 位</span>}
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <UserPlus size={17} aria-hidden="true" />
            新建系统管理员
          </button>
        </div>
      </div>

      <LoadView state={admins} onRetry={onRefresh} empty="暂无系统管理员。">
        {() =>
          items.length ? (
            <>
              <div className="platform-table-container">
                <table className="shop-table platform-table platform-admin-table">
                  <thead>
                    <tr>
                      <th>邮箱 / 手机号</th>
                      <th>姓名</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <strong>{identityDescription(admin)}</strong>
                        </td>
                        <td>
                          {admin.displayName}
                        </td>
                        <td>
                          <StatusChip status={admin.status} />
                        </td>
                        <td>
                          <div className="platform-row-actions platform-admin-actions">
                            <button
                              className="text-button"
                              type="button"
                              disabled={
                                actionPending || admin.status === "DELETED"
                              }
                              onClick={() => setEditing(admin)}
                            >
                              编辑
                            </button>
                            {admin.status === "ACTIVE" ||
                            admin.status === "DISABLED" ? (
                              <button
                                className="text-button"
                                type="button"
                                disabled={actionPending}
                                onClick={() => {
                                  const actionName =
                                    admin.status === "ACTIVE"
                                      ? "disable"
                                      : "activate";
                                  if (
                                    actionName === "disable" &&
                                    !window.confirm(
                                      `确认停用系统管理员 ${identityDescription(admin)}？其所有会话将被撤销。`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void onAction(
                                    () =>
                                      httpPlatformAdminAdapter.setSystemAdminStatus(
                                        admin.id,
                                        actionName,
                                        admin.version,
                                      ),
                                    "更新系统管理员",
                                  );
                                }}
                              >
                                {admin.status === "ACTIVE" ? "停用" : "启用"}
                              </button>
                            ) : admin.status === "PENDING_ACTIVATION" ? (
                              <span className="platform-pending-copy">
                                等待激活
                              </span>
                            ) : null}
                            <button
                              className="text-button"
                              type="button"
                              disabled={
                                actionPending ||
                                (admin.status !== "ACTIVE" &&
                                  admin.status !== "DISABLED")
                              }
                              onClick={() => setPasswordAdmin(admin)}
                            >
                              重置密码
                            </button>
                            <button
                              className="text-button danger-text"
                              type="button"
                              disabled={
                                actionPending || admin.status === "DELETED"
                              }
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `确认删除系统管理员 ${identityDescription(admin)}？此操作将撤销其凭证与会话。`,
                                  )
                                ) {
                                  return;
                                }
                                void onAction(
                                  () =>
                                    httpPlatformAdminAdapter.setSystemAdminStatus(
                                      admin.id,
                                      "delete",
                                      admin.version,
                                    ),
                                  "删除系统管理员",
                                );
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                data={admins.kind === "ready" ? admins.data : null}
                label="系统管理员列表分页"
                onPage={onPage}
                onPageSize={onPageSize}
              />
            </>
          ) : (
            <p className="platform-empty-filter">当前页没有匹配的管理员。</p>
          )
        }
      </LoadView>

      {creating && (
        <AdminCreateDialog
          actionPending={actionPending}
          onClose={() => setCreating(false)}
          onAction={onAction}
          onCredential={onCredential}
        />
      )}

      {editing && (
        <SystemAdminEditDialog
          admin={editing}
          actionPending={actionPending}
          onClose={() => setEditing(null)}
          onAction={onAction}
        />
      )}

      {passwordAdmin && (
        <PasswordDialog
          accountName={identityDescription(passwordAdmin)}
          description="设置后该管理员的全部已登录会话会被撤销，请使用新密码重新登录。"
          requireCurrentPassword={false}
          submitLabel="重置密码"
          title="重置系统管理员密码"
          onClose={() => setPasswordAdmin(null)}
          onSubmit={({ newPassword }) =>
            httpPlatformAdminAdapter.resetSystemAdminPassword(
              passwordAdmin.id,
              { newPassword, version: passwordAdmin.version },
            )
          }
          onSuccess={() => {
            setPasswordAdmin(null);
            if (passwordAdmin.id === currentAdminId) {
              window.location.assign("/platform-admin/login");
            } else {
              onRefresh();
            }
          }}
        />
      )}
    </section>
  );
}

function SystemAdminEditDialog({
  admin,
  actionPending,
  onClose,
  onAction,
}: {
  admin: SystemAdmin;
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
}) {
  return (
    <DialogShell
      title="编辑系统管理员"
      description="修改登录账号后，邮箱或手机号会成为该管理员的新登录凭据。"
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const account = normalizedAccountFromForm(
            formElement,
            "loginIdentifier",
          );
          if (!account) return;
          const loginIdentifier = "email" in account
            ? account.email
            : account.phoneNumber;
          void onAction(async () => {
            await httpPlatformAdminAdapter.updateSystemAdmin(admin.id, {
              loginIdentifier,
              displayName: String(form.get("displayName") ?? "").trim(),
              version: admin.version,
            });
            onClose();
          }, "编辑系统管理员");
        }}
      >
        <div className="platform-form-grid">
          <label>
            登录账号
            <input
              name="loginIdentifier"
              defaultValue={identityInputValue(admin)}
              autoComplete="username"
              maxLength={254}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
              required
              autoFocus
            />
            <small>支持邮箱或手机号。</small>
          </label>
          <label>
            姓名
            <input
              name="displayName"
              defaultValue={admin.displayName}
              maxLength={160}
              autoComplete="name"
              required
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={onClose}
          >
            取消
          </button>
          <button className="button button-primary" disabled={actionPending}>
            {actionPending ? "正在保存…" : "保存"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function AdminCreateDialog({
  actionPending,
  onClose,
  onAction,
  onCredential,
}: {
  actionPending: boolean;
  onClose: () => void;
  onAction: (work: () => Promise<unknown>, label: string) => Promise<void>;
  onCredential: (credential: ActivationCredential) => void;
}) {
  return (
    <DialogShell
      title="新建系统管理员"
      description="这是平台最高权限账号，可管理企业并进入任意企业。"
      onClose={onClose}
      disabled={actionPending}
    >
      <form
        className="platform-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const account = normalizedAccountFromForm(
            formElement,
            "loginIdentifier",
          );
          if (!account) return;
          void onAction(async () => {
            const result = await httpPlatformAdminAdapter.createSystemAdmin({
              ...account,
              displayName: String(form.get("displayName")).trim(),
            });
            formElement.reset();
            onClose();
            onCredential(result.credential);
          }, "创建系统管理员");
        }}
      >
        <div className="platform-form-grid">
          <label>
            登录账号
            <input
              name="loginIdentifier"
              aria-label="邮箱或手机号"
              placeholder="admin@example.com 或 18002629295"
              autoComplete="username"
              maxLength={254}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
              required
              type="text"
              autoFocus
            />
            <small>可使用邮箱或手机号登录。</small>
          </label>
          <label>
            姓名
            <input
              name="displayName"
              placeholder="请输入真实姓名"
              autoComplete="name"
              required
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actionPending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button-primary"
            disabled={actionPending}
          >
            {actionPending ? "正在创建…" : "创建管理员"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function DialogShell({
  title,
  description,
  onClose,
  disabled,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined"
      ? null
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
  );
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  onCloseRef.current = onClose;
  disabledRef.current = disabled;
  const titleId = useMemo(
    () => `platform-dialog-${title.replace(/\s+/g, "-")}`,
    [title],
  );

  useEffect(() => {
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
          [],
      );
    if (
      dialogRef.current &&
      !dialogRef.current.contains(document.activeElement)
    ) {
      focusableElements()[0]?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disabledRef.current) {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="platform-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="platform-dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <DialogCloseButton
            disabled={disabled}
            onClick={onClose}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: SystemAdmin["status"] }) {
  const label = {
    ACTIVE: "正常",
    DISABLED: "已停用",
    DELETED: "已删除",
    PENDING_ACTIVATION: "待激活",
  }[status];
  return (
    <span className={`platform-status platform-status-${status.toLowerCase()}`}>
      {label}
    </span>
  );
}

function EnterpriseStatusChip({
  status,
}: {
  status: Enterprise["status"];
}) {
  const label = {
    ACTIVE: "正常",
    SUSPENDED: "暂停",
    DISABLED: "停用",
  }[status];
  return (
    <span className={`platform-status platform-status-${status.toLowerCase()}`}>
      {label}
    </span>
  );
}

function LoadView<T>({
  state,
  onRetry,
  empty,
  children,
}: {
  state: Load<T>;
  onRetry: () => void;
  empty: string;
  children: (items: T[]) => ReactNode;
}) {
  if (state.kind === "loading")
    return <p className="platform-state" aria-busy="true">正在加载…</p>;
  if (state.kind === "denied")
    return (
      <p className="platform-state" role="alert">
        当前账号没有读取权限。
      </p>
    );
  if (state.kind === "error")
    return (
      <div className="platform-state" role="alert">
        <p>{state.message}</p>
        <button className="button button-secondary" type="button" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  return state.data.items.length ? (
    <>{children(state.data.items)}</>
  ) : (
    <p className="platform-state">{empty}</p>
  );
}

function Pager({
  data,
  label,
  onPage,
  onPageSize,
}: {
  data: PlatformPage<unknown> | null;
  label: string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (!data) return null;
  const pageSizes = [...new Set([...PAGE_SIZE_OPTIONS, data.size])].sort(
    (left, right) => left - right,
  );
  return (
    <nav className="pagination" aria-label={label}>
      <label>
        每页
        <select
          aria-label={`${label}每页条数`}
          value={data.size}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size} 条
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={data.page === 0}
        onClick={() => onPage(data.page - 1)}
      >
        上一页
      </button>
      <span>
        第 {data.page + 1} / {Math.max(data.totalPages, 1)} 页
      </span>
      <button
        type="button"
        disabled={data.page + 1 >= data.totalPages}
        onClick={() => onPage(data.page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BookOpenCheck,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SettingsPageHeader } from "../components/SettingsPageLayout";
import {
  type AuditLog,
  type Member,
  type Page,
  type Permission,
  type Role,
  iamAdminApi,
} from "../modules/iamAdminApi";
import {
  IAM_MEMBER_PAGE_SIZES,
  MemberSection,
  Pagination,
  type LoadState,
} from "./iam/MemberSection";
import { RoleSection } from "./iam/RoleSection";

const SIZE = 20;
const MEMBER_DEFAULT_SIZE = 10;
const READ_PERMISSIONS = [
  "iam:user:read",
  "iam:role:read",
  "iam:permission:read",
  "iam:audit:read",
] as const;

type Query = {
  view: IamView;
  memberPage: number;
  memberSize: number;
  memberQuery: string;
  memberStatus: "" | Member["status"];
  memberRoleId: string;
  rolePage: number;
  roleSize: number;
  permissionPage: number;
  permissionSize: number;
  auditPage: number;
  auditSize: number;
  action: string;
  resourceType: string;
  from: string;
  to: string;
};

export type IamView = "members" | "roles" | "permissions" | "audit";

const VIEW_PERMISSIONS: Record<IamView, (typeof READ_PERMISSIONS)[number]> = {
  members: "iam:user:read",
  roles: "iam:role:read",
  permissions: "iam:permission:read",
  audit: "iam:audit:read",
};

const VIEWS = [
  { id: "members", label: "员工管理", icon: Users },
  { id: "roles", label: "角色权限", icon: ShieldCheck },
  { id: "permissions", label: "权限目录", icon: BookOpenCheck },
  { id: "audit", label: "审计日志", icon: ClipboardList },
] as const;

const safeNumber = (value: string | null) =>
  value && /^\d+$/.test(value) && Number(value) <= 1_000_000
    ? Number(value)
    : 0;

const safePageSize = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return IAM_MEMBER_PAGE_SIZES.includes(
    parsed as (typeof IAM_MEMBER_PAGE_SIZES)[number],
  )
    ? parsed
    : fallback;
};

export function parseIamQuery(search: string): Query {
  const params = new URLSearchParams(search);
  const candidate = params.get("view");
  return {
    view: VIEWS.some((view) => view.id === candidate)
      ? (candidate as IamView)
      : "members",
    memberPage: safeNumber(params.get("memberPage")),
    memberSize: safePageSize(params.get("memberSize"), MEMBER_DEFAULT_SIZE),
    memberQuery: (params.get("memberQuery") ?? "").slice(0, 101),
    memberStatus: ["ACTIVE", "DISABLED"].includes(
      params.get("memberStatus") ?? "",
    )
      ? (params.get("memberStatus") as Member["status"])
      : "",
    memberRoleId: (params.get("memberRoleId") ?? "").slice(0, 100),
    rolePage: safeNumber(params.get("rolePage")),
    roleSize: safePageSize(params.get("roleSize"), SIZE),
    permissionPage: safeNumber(params.get("permissionPage")),
    permissionSize: safePageSize(params.get("permissionSize"), SIZE),
    auditPage: safeNumber(params.get("auditPage")),
    auditSize: safePageSize(params.get("auditSize"), SIZE),
    action: (params.get("action") ?? "").slice(0, 160),
    resourceType: (params.get("resourceType") ?? "").slice(0, 100),
    from: (params.get("from") ?? "").slice(0, 30),
    to: (params.get("to") ?? "").slice(0, 30),
  };
}

export function toIamUrl(query: Query) {
  const params = new URLSearchParams({
    view: query.view,
    memberPage: String(query.memberPage),
    memberSize: String(query.memberSize),
    rolePage: String(query.rolePage),
    roleSize: String(query.roleSize),
    permissionPage: String(query.permissionPage),
    permissionSize: String(query.permissionSize),
    auditPage: String(query.auditPage),
    auditSize: String(query.auditSize),
  });
  if (query.action) params.set("action", query.action);
  if (query.memberQuery) params.set("memberQuery", query.memberQuery);
  if (query.memberStatus) params.set("memberStatus", query.memberStatus);
  if (query.memberRoleId) params.set("memberRoleId", query.memberRoleId);
  if (query.resourceType) params.set("resourceType", query.resourceType);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return `/settings/iam?${params.toString()}`;
}

export function safeIamMessage(error: unknown, subject: string) {
  if (error instanceof ApiError && error.status === 403)
    return `当前账号没有${subject}所需权限。登录状态保持不变。`;
  if (error instanceof ApiError && error.status === 401)
    return "登录已失效，请重新登录后重试。";
  if (error instanceof ApiError && error.status === 404)
    return "请求的 IAM 资源不存在，或当前账号无法访问。";
  if (error instanceof ApiError && error.status === 409)
    return "数据状态已变化，请刷新后重试。";
  return `暂时无法${subject}，请稍后重试。`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

export function IamConsolePage() {
  const { hasPermission, session } = useAuth();
  const router = useRouter();
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const query = useMemo(() => parseIamQuery(search), [search]);
  const [refresh, setRefresh] = useState(0);
  const [members, setMembers] = useState<LoadState<Member>>({ kind: "denied" });
  const [roles, setRoles] = useState<LoadState<Role>>({ kind: "denied" });
  const [permissions, setPermissions] = useState<LoadState<Permission>>({
    kind: "denied",
  });
  const [audit, setAudit] = useState<LoadState<AuditLog>>({ kind: "denied" });
  const versions = useRef({ members: 0, roles: 0, permissions: 0, audit: 0 });
  const can = useCallback(
    (permission: string) => hasPermission(permission),
    [hasPermission],
  );
  const any = READ_PERMISSIONS.some(can);
  const visibleViews = useMemo(
    () => VIEWS.filter((view) => can(VIEW_PERMISSIONS[view.id])),
    [can],
  );
  const activeView = can(VIEW_PERMISSIONS[query.view])
    ? query.view
    : visibleViews[0]?.id;
  const updateQuery = useCallback(
    (patch: Partial<Query>) => {
      router.history.push(toIamUrl({ ...query, ...patch }));
    },
    [query, router.history],
  );

  const load = useCallback(
    async <T,>(
      key: keyof typeof versions.current,
      allowed: boolean,
      request: () => Promise<Page<T>>,
      set: (state: LoadState<T>) => void,
      subject: string,
    ) => {
      const version = ++versions.current[key];
      if (!allowed) {
        set({ kind: "denied" });
        return;
      }
      set({ kind: "loading" });
      try {
        const data = await request();
        if (version === versions.current[key]) set({ kind: "ready", data });
      } catch (error) {
        if (version === versions.current[key])
          set({ kind: "error", message: safeIamMessage(error, subject) });
      }
    },
    [],
  );

  const loadMembers = useCallback(
    () =>
      load(
        "members",
        can("iam:user:read"),
        () =>
          iamAdminApi.listMembers({
            page: query.memberPage,
            size: query.memberSize,
            query: query.memberQuery || undefined,
            status: query.memberStatus || undefined,
            roleId: query.memberRoleId || undefined,
          }),
        setMembers,
        "读取成员",
      ),
    [
      can,
      load,
      query.memberPage,
      query.memberSize,
      query.memberQuery,
      query.memberRoleId,
      query.memberStatus,
    ],
  );
  const loadRoles = useCallback(
    () =>
      load(
        "roles",
        can("iam:role:read"),
        () =>
          iamAdminApi.listRoles({
            page: query.rolePage,
            size: query.roleSize,
          }),
        setRoles,
        "读取角色",
      ),
    [can, load, query.rolePage, query.roleSize],
  );
  const loadPermissions = useCallback(
    () =>
      load(
        "permissions",
        can("iam:permission:read"),
        () =>
          iamAdminApi.listPermissions({
            page: query.permissionPage,
            size: query.permissionSize,
          }),
        setPermissions,
        "读取权限目录",
      ),
    [can, load, query.permissionPage, query.permissionSize],
  );
  const loadAudit = useCallback(
    () =>
      load(
        "audit",
        can("iam:audit:read"),
        () =>
          iamAdminApi.listAuditLogs({
            page: query.auditPage,
            size: query.auditSize,
            action: query.action || undefined,
            resourceType: query.resourceType || undefined,
            from: query.from || undefined,
            to: query.to || undefined,
          }),
        setAudit,
        "读取审计日志",
      ),
    [
      can,
      load,
      query.action,
      query.auditPage,
      query.auditSize,
      query.from,
      query.resourceType,
      query.to,
    ],
  );
  const refreshAll = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    if (activeView === "members") void loadMembers();
    if (activeView === "roles") void loadRoles();
    if (activeView === "permissions") void loadPermissions();
    if (activeView === "audit") void loadAudit();
  }, [
    activeView,
    loadAudit,
    loadMembers,
    loadPermissions,
    loadRoles,
    refresh,
  ]);

  useEffect(() => {
    if (activeView && activeView !== query.view)
      router.history.replace(toIamUrl({ ...query, view: activeView }));
  }, [activeView, query, router.history]);

  const applyAudit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const iso = (value: FormDataEntryValue | null) => {
      const raw = String(value ?? "");
      const date = new Date(raw);
      return raw && !Number.isNaN(date.valueOf()) ? date.toISOString() : "";
    };
    updateQuery({
      action: String(values.get("action") ?? "")
        .trim()
        .slice(0, 160),
      resourceType: String(values.get("resourceType") ?? "")
        .trim()
        .slice(0, 100),
      from: iso(values.get("from")),
      to: iso(values.get("to")),
      auditPage: 0,
    });
  };

  if (!any)
    return (
      <section className="empty-panel forbidden-page" role="alert">
        <ShieldAlert aria-hidden="true" size={30} />
        <p className="eyebrow">403 无权访问</p>
        <h1>无权访问组织与权限管理台</h1>
        <p>需要至少一项 IAM 只读权限。</p>
      </section>
    );

  return (
    <section className="iam-page settings-page" aria-labelledby="iam-title">
      <SettingsPageHeader
        id="iam-title"
        section="组织与权限"
        title="员工与权限"
        description="管理当前企业的员工账号、角色权限与安全审计。"
        actions={<button
          className="button button-secondary"
          onClick={refreshAll}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          刷新
        </button>}
      />
      <nav className="iam-view-tabs" aria-label="组织与权限功能">
        {visibleViews.map(({ id, icon: Icon, label }) => (
          <button
            aria-current={activeView === id ? "page" : undefined}
            className={activeView === id ? "is-active" : undefined}
            key={id}
            onClick={() => updateQuery({ view: id })}
            type="button"
          >
            <Icon aria-hidden="true" size={16} />
            {label}
          </button>
        ))}
      </nav>
      {activeView === "members" && (
        <MemberSection
          canResetPassword={can("iam:user:write")}
          canRoleRead={can("iam:role:read")}
          canRoleWrite={can("iam:role:write")}
          canWarehouseScopeRead={can("iam:warehouse:scope:read")}
          canWarehouseScopeWrite={can("iam:warehouse:scope:write")}
          canWrite={can("iam:user:write")}
          currentUserId={session?.user?.id}
          filters={{
            query: query.memberQuery,
            roleId: query.memberRoleId,
            status: query.memberStatus,
          }}
          onFiltersApply={(filters) =>
            updateQuery({
              memberPage: 0,
              memberQuery: filters.query,
              memberRoleId: filters.roleId,
              memberStatus: filters.status,
            })
          }
          onPageChange={(memberPage) => updateQuery({ memberPage })}
          onPageSizeChange={(memberSize) =>
            updateQuery({ memberPage: 0, memberSize })
          }
          pageSize={query.memberSize}
          onRefresh={refreshAll}
          state={members}
        />
      )}
      {activeView === "roles" && (
        <RoleSection
          canPermissionAssign={can("iam:permission:assign")}
          canPermissionRead={can("iam:permission:read")}
          canWrite={can("iam:role:write")}
          onPageChange={(rolePage) => updateQuery({ rolePage })}
          onPageSizeChange={(roleSize) =>
            updateQuery({ rolePage: 0, roleSize })
          }
          pageSize={query.roleSize}
          onRefresh={refreshAll}
          state={roles}
        />
      )}
      {activeView === "permissions" && (
        <PermissionSection
          onPageChange={(permissionPage) => updateQuery({ permissionPage })}
          onPageSizeChange={(permissionSize) =>
            updateQuery({ permissionPage: 0, permissionSize })
          }
          onRefresh={refreshAll}
          pageSize={query.permissionSize}
          state={permissions}
        />
      )}
      {activeView === "audit" && (
        <AuditSection
          onApply={applyAudit}
          onPageChange={(auditPage) => updateQuery({ auditPage })}
          onPageSizeChange={(auditSize) =>
            updateQuery({ auditPage: 0, auditSize })
          }
          onRefresh={refreshAll}
          pageSize={query.auditSize}
          query={query}
          state={audit}
        />
      )}
    </section>
  );
}

function PermissionSection({
  onPageChange,
  onPageSizeChange,
  onRefresh,
  pageSize,
  state,
}: {
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  pageSize: number;
  state: LoadState<Permission>;
}) {
  return (
    <ReadSection
      title="权限目录"
      state={state}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onRefresh={onRefresh}
      pageSize={pageSize}
      headers={["代码", "模块", "名称", "说明"]}
      rows={(items) =>
        items.map((item) => [
          item.code,
          item.module,
          item.name,
          item.description ?? "—",
        ])
      }
    />
  );
}

function AuditSection({
  onApply,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  pageSize,
  query,
  state,
}: {
  onApply: (event: FormEvent<HTMLFormElement>) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  pageSize: number;
  query: Query;
  state: LoadState<AuditLog>;
}) {
  return (
    <section
      className="detail-card iam-section"
      aria-labelledby="iam-audit-title"
    >
      <div className="table-heading">
        <div>
          <p className="eyebrow">审计</p>
          <h2 id="iam-audit-title">审计日志</h2>
        </div>
      </div>
      {state.kind !== "denied" && (
        <form
          className="iam-filters"
          key={`${query.action}:${query.resourceType}:${query.from}:${query.to}`}
          onSubmit={onApply}
        >
          <label>
            操作
            <input defaultValue={query.action} maxLength={160} name="action" />
          </label>
          <label>
            资源类型
            <input
              defaultValue={query.resourceType}
              maxLength={100}
              name="resourceType"
            />
          </label>
          <label>
            起始时间
            <input
              defaultValue={query.from.slice(0, 16)}
              name="from"
              type="datetime-local"
            />
          </label>
          <label>
            结束时间
            <input
              defaultValue={query.to.slice(0, 16)}
              name="to"
              type="datetime-local"
            />
          </label>
          <button className="button button-primary" type="submit">
            应用筛选
          </button>
        </form>
      )}
      <ReadSection
        paginationLabel="审计日志分页"
        title=""
        state={state}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onRefresh={onRefresh}
        pageSize={pageSize}
        headers={["操作者", "操作", "资源类型", "资源 ID", "请求 ID", "时间"]}
        rows={(items) =>
          items.map((item) => [
            item.actorUserId ?? "系统",
            item.action,
            item.resourceType,
            item.resourceId,
            item.requestId ?? "—",
            formatTime(item.createdAt),
          ])
        }
      />
    </section>
  );
}

function ReadSection<T>({
  headers,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  paginationLabel,
  pageSize,
  rows,
  state,
  title,
}: {
  headers: string[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onRefresh: () => void;
  paginationLabel?: string;
  pageSize?: number;
  rows: (items: T[]) => string[][];
  state: LoadState<T>;
  title: string;
}) {
  const className = title ? "detail-card iam-section" : "iam-read-section";
  if (state.kind === "denied")
    return (
      <section className={className}>
        <h2>{title}</h2>
        <p className="muted-cell">当前账号没有读取此区块的权限。</p>
      </section>
    );
  if (state.kind === "loading")
    return (
      <section className={className} aria-busy="true">
        正在加载{title}
      </section>
    );
  if (state.kind === "error")
    return (
      <section className={className} role="alert">
        <p>{state.message}</p>
        <button
          className="button button-secondary"
          onClick={onRefresh}
          type="button"
        >
          重试
        </button>
      </section>
    );
  return (
    <section className={className}>
      <div className="table-heading">
        {title && <h2>{title}</h2>}
        <span>{state.data.totalElements} 条</span>
      </div>
      {state.data.items.length === 0 ? (
        <p className="muted-cell">暂无可显示数据。</p>
      ) : (
        <div className="shop-table-scroll">
          <table className="shop-table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows(state.data.items).map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        label={paginationLabel ?? `${title}分页`}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        page={state.data}
        pageSize={pageSize}
        pageSizeOptions={IAM_MEMBER_PAGE_SIZES}
      />
    </section>
  );
}

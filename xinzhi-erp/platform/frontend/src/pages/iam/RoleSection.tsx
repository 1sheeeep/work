import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleDashed, ShieldAlert } from "lucide-react";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import {
  type Permission,
  type Page,
  type Role,
  iamAdminApi,
} from "../../modules/iamAdminApi";
import { DialogActions, formValues, IamDialog } from "./Dialog";
import {
  IAM_MEMBER_PAGE_SIZES,
  Pagination,
  type LoadState,
} from "./MemberSection";

const CATALOG_SIZE = 100;
const PERMISSION_MODULE_LABELS: Record<string, string> = {
  analytics: "报表分析",
  customer_service: "客服",
  finance: "财务",
  iam: "组织与权限",
  inventory: "库存",
  logistics: "物流",
  orders: "订单与履约",
  platform: "经营平台",
  procurement: "采购",
  products: "商品",
  settings: "系统设置",
  shop: "店铺",
  suppliers: "供应商",
  warehouses: "仓库",
};

export function permissionModuleLabel(module: string) {
  return PERMISSION_MODULE_LABELS[module] ?? module;
}

function permissionInEnabledModule(
  permission: Permission,
  hasApplicationModule: (application: string, module: string) => boolean,
) {
  if (permission.module === "iam" || permission.module === "settings") return true;
  if (permission.module === "customer_service") {
    if (permission.code.startsWith("customer_service.conversation."))
      return hasApplicationModule("CHAT", "CONVERSATIONS");
    if (permission.code.startsWith("customer_service.ticket."))
      return hasApplicationModule("CHAT", "TICKETS");
    return hasApplicationModule("CHAT", "WORKSPACE");
  }
  const applicationModule: Record<string, string> = {
    platform: "CHANNELS",
    shop: "CHANNELS",
    products: "PRODUCTS",
    orders: "ORDERS",
    procurement: "PROCUREMENT",
    suppliers: "PROCUREMENT",
    warehouses: "WAREHOUSE",
    inventory: "WAREHOUSE",
    logistics: "LOGISTICS",
    analytics: "ANALYTICS",
  };
  const module = applicationModule[permission.module];
  return Boolean(module && hasApplicationModule("ERP", module));
}

function errorMessage(error: unknown, operation: string) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录已失效，请重新登录后重试。";
    if (error.status === 403)
      return "当前账号没有执行此操作的权限。";
    if (error.status === 404)
      return "目标角色不存在，或本企业无权访问。";
    if (error.status === 409)
      return "角色已被其他操作更新；当前选择仍保留，请刷新后重试。";
  }
  return `暂时无法${operation}，请稍后重试。`;
}
type Editor =
  | { kind: "create" }
  | { kind: "edit"; role: Role }
  | { kind: "permissions"; role: Role };

export function RoleSection({
  canWrite,
  canPermissionRead,
  canPermissionAssign,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  pageSize,
  state,
}: {
  canWrite: boolean;
  canPermissionRead: boolean;
  canPermissionAssign: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  pageSize: number;
  state: LoadState<Role>;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  return (
    <section
      className="detail-card iam-section"
      aria-labelledby="iam-roles-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="iam-roles-title">角色权限</h2>
          <p className="muted-cell">
            预设角色可直接分配给员工；预设角色与系统角色受保护。
          </p>
        </div>
        {canWrite && (
          <button
            className="button button-primary"
            onClick={() => setEditor({ kind: "create" })}
            type="button"
          >
            新增角色
          </button>
        )}
      </div>
      {state.kind === "denied" && (
        <p className="muted-cell">当前账号没有查看角色的权限。</p>
      )}
      {state.kind === "loading" && (
        <p aria-busy="true">
          <CircleDashed aria-hidden="true" className="spin" size={20} />{" "}
          正在加载角色
        </p>
      )}
      {state.kind === "error" && (
        <div role="alert">
          <ShieldAlert size={20} />
          <p>{state.message}</p>
          <button
            className="button button-secondary"
            onClick={onRefresh}
            type="button"
          >
            重试
          </button>
        </div>
      )}
      {state.kind === "ready" &&
        (state.data.items.length === 0 ? (
          <p className="muted-cell">本企业还没有可显示的角色。</p>
        ) : (
          <>
            <div className="shop-table-scroll">
              <table className="shop-table">
                <caption className="sr-only">当前页角色</caption>
                <thead>
                  <tr>
                    <th>角色名称</th>
                    <th>角色代码</th>
                    <th>类型</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((role) => (
                    <tr key={role.id}>
                      <td>{role.name}</td>
                      <td>
                        <code>{role.code}</code>
                      </td>
                      <td>
                        {role.systemRole
                          ? "系统保护"
                          : role.presetRole
                            ? "预设角色"
                            : "自定义"}
                      </td>
                      <td>
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(role.updatedAt))}
                      </td>
                      <td>
                        <span className="row-actions">
                          {canWrite &&
                            !role.systemRole &&
                            !role.presetRole && (
                            <button
                              className="text-button"
                              onClick={() => setEditor({ kind: "edit", role })}
                              type="button"
                            >
                              编辑
                            </button>
                          )}
                          {canPermissionRead && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setEditor({ kind: "permissions", role })
                              }
                              type="button"
                            >
                              权限
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              label="角色列表分页"
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              page={state.data}
              pageSize={pageSize}
              pageSizeOptions={IAM_MEMBER_PAGE_SIZES}
            />
          </>
        ))}
      {editor &&
        (editor.kind === "permissions" ? (
          <PermissionDialog
            canAssign={canPermissionAssign}
            onClose={() => setEditor(null)}
            onDone={() => {
              setEditor(null);
              onRefresh();
            }}
            role={editor.role}
          />
        ) : (
          <RoleDialog
            editor={editor}
            onClose={() => setEditor(null)}
            onDone={() => {
              setEditor(null);
              onRefresh();
            }}
          />
        ))}
    </section>
  );
}

function RoleDialog({
  editor,
  onClose,
  onDone,
}: {
  editor: Exclude<Editor, { kind: "permissions" }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const role = editor.kind === "edit" ? editor.role : undefined;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = formValues(event);
    setSubmitting(true);
    setError(null);
    try {
      const description =
        String(values.get("description") ?? "").trim() || undefined;
      if (editor.kind === "create")
        await iamAdminApi.createRole({
          code: String(values.get("code")).trim(),
          name: String(values.get("name")).trim(),
          description,
        });
      else
        await iamAdminApi.updateRole(role!.id, {
          name: String(values.get("name")).trim(),
          description,
          version: role!.version,
        });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught, "保存角色"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <IamDialog
      onClose={onClose}
      title={editor.kind === "create" ? "新增角色" : "编辑角色"}
    >
      <form className="warehouse-dialog-form" onSubmit={submit}>
        {editor.kind === "create" && (
          <label>
            角色代码
            <input
              maxLength={100}
              name="code"
              pattern="[a-z][a-z0-9_-]{0,99}"
              required
            />
          </label>
        )}
        <label>
          角色名称
          <input
            defaultValue={role?.name ?? ""}
            maxLength={160}
            name="name"
            required
          />
        </label>
        <label>
          角色说明
          <textarea
            defaultValue={role?.description ?? ""}
            maxLength={500}
            name="description"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <DialogActions
          onClose={onClose}
          submitting={submitting}
          submitLabel="保存"
        />
      </form>
    </IamDialog>
  );
}

export function groupPermissionsByModule(
  permissions: Permission[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const groups = new Map<string, Permission[]>();
  permissions
    .filter(
      (permission) =>
        !normalized ||
        `${permission.module} ${permissionModuleLabel(permission.module)} ${permission.name} ${permission.code} ${
          permission.description ?? ""
        }`
          .toLocaleLowerCase("zh-CN")
          .includes(normalized),
    )
    .forEach((permission) => {
      const group = groups.get(permission.module) ?? [];
      group.push(permission);
      groups.set(permission.module, group);
    });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([module, items]) => ({
      module,
      items: items.sort((left, right) =>
        left.code.localeCompare(right.code, "zh-CN"),
      ),
    }));
}

function PermissionDialog({
  role,
  canAssign,
  onClose,
  onDone,
}: {
  role: Role;
  canAssign: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { hasApplicationModule } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permissionPage, setPermissionPage] = useState<Page<Permission> | null>(
    null,
  );
  const [catalogPage, setCatalogPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [version, setVersion] = useState<number>();
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const assignmentRequest = useRef(0);
  const catalogRequest = useRef(0);
  useEffect(() => {
    const current = ++assignmentRequest.current;
    void iamAdminApi
      .getRolePermissions(role.id)
      .then((assignment) => {
        if (current !== assignmentRequest.current) return;
        setSelected(assignment.assignmentIds);
        setVersion(assignment.version);
      })
      .catch(
        (caught) =>
          current === assignmentRequest.current &&
          setAssignmentError(
            errorMessage(caught, "读取角色权限"),
          ),
      )
      .finally(
        () => current === assignmentRequest.current && setLoading(false),
      );
    return () => {
      assignmentRequest.current++;
    };
  }, [role.id]);
  useEffect(() => {
    const current = ++catalogRequest.current;
    setCatalogLoading(true);
    setCatalogError(null);
    setPermissions([]);
    setPermissionPage(null);
    void iamAdminApi
      .listPermissions({ page: catalogPage, size: CATALOG_SIZE })
      .then((page) => {
        if (current !== catalogRequest.current) return;
        setPermissions(page.items.filter((permission) =>
          permissionInEnabledModule(permission, hasApplicationModule),
        ));
        setPermissionPage(page);
      })
      .catch(
        (caught) =>
          current === catalogRequest.current &&
          setCatalogError(errorMessage(caught, "读取权限目录")),
      )
      .finally(
        () => current === catalogRequest.current && setCatalogLoading(false),
      );
    return () => {
      catalogRequest.current++;
    };
  }, [catalogPage, catalogRetry, hasApplicationModule]);
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  const groups = useMemo(
    () => groupPermissionsByModule(permissions, search),
    [permissions, search],
  );
  const updateGroup = (ids: string[], checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  const readOnly = role.systemRole || role.presetRole || !canAssign;
  const submit = async () => {
    if (readOnly || version === undefined || assignmentError) return;
    setSubmitting(true);
    setMutationError(null);
    try {
      await iamAdminApi.replaceRolePermissions(role.id, {
        ids: selected,
        version,
      });
      onDone();
    } catch (caught) {
      setMutationError(errorMessage(caught, "保存角色权限"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <IamDialog onClose={onClose} title={`角色权限：${role.name}`}>
      <div className="warehouse-dialog-form">
        {(role.systemRole || role.presetRole) && (
          <p className="confirmation-copy">
            {role.systemRole ? "系统角色" : "预设角色"}受保护，仅可查看权限。
          </p>
        )}
        <label>
          搜索权限
          <input
            maxLength={120}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="模块、名称或权限"
            type="search"
            value={search}
          />
        </label>
        {loading && <p aria-busy="true">正在读取已分配权限…</p>}
        {catalogLoading && <p aria-busy="true">正在加载权限目录…</p>}
        {!catalogLoading && groups.length === 0 && (
          <p className="muted-cell">当前页没有符合条件的权限。</p>
        )}
        {!catalogLoading &&
          groups.map((group) => {
            const ids = group.items.map((permission) => permission.id);
            const selectedCount = ids.filter((id) =>
              selected.includes(id),
            ).length;
            return (
              <fieldset className="iam-permission-group" key={group.module}>
                <legend>
                  <span>{permissionModuleLabel(group.module)}</span>
                  <small>
                    已选 {selectedCount}/{ids.length}
                  </small>
                </legend>
                {!readOnly && (
                  <div className="iam-group-actions">
                    <button
                      className="text-button"
                      disabled={submitting || loading}
                      onClick={() => updateGroup(ids, true)}
                      type="button"
                    >
                      {search.trim() ? "全选匹配项" : "全选本组"}
                    </button>
                    <button
                      className="text-button"
                      disabled={submitting || loading}
                      onClick={() => updateGroup(ids, false)}
                      type="button"
                    >
                      {search.trim() ? "清空匹配项" : "清空本组"}
                    </button>
                  </div>
                )}
                <div className="iam-permission-options">
                  {group.items.map((permission) => (
                    <label className="checkbox-label" key={permission.id}>
                      <input
                        checked={selected.includes(permission.id)}
                        disabled={
                          readOnly ||
                          submitting ||
                          loading ||
                          version === undefined ||
                          Boolean(assignmentError)
                        }
                        onChange={() => toggle(permission.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{permission.name || permission.code}</strong>
                        <small>{permission.code}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        {assignmentError && <p role="alert">{assignmentError}</p>}
        {catalogError && <p role="alert">{catalogError}</p>}
        {mutationError && <p role="alert">{mutationError}</p>}
        {catalogError && (
          <div className="form-actions">
            {catalogPage > 0 && (
              <button
                className="button button-secondary"
                onClick={() => setCatalogPage((value) => value - 1)}
                type="button"
              >
                上一页权限
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={() => setCatalogRetry((value) => value + 1)}
              type="button"
            >
              重试权限目录
            </button>
          </div>
        )}
        {permissionPage && (
          <Pagination
            label="角色权限目录分页"
            onPageChange={setCatalogPage}
            page={{ ...permissionPage, page: catalogPage }}
          />
        )}
        <p className="muted-cell">
          当前已开通模块中选择了 {permissions.filter((permission) =>
            selected.includes(permission.id)).length} 项权限。
        </p>
        <div className="form-actions">
          <button
            className="button button-secondary"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          {!readOnly && (
            <button
              className="button button-primary"
              disabled={
                loading ||
                catalogLoading ||
                submitting ||
                version === undefined ||
                Boolean(assignmentError)
              }
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? "正在保存" : "保存权限"}
            </button>
          )}
        </div>
      </div>
    </IamDialog>
  );
}

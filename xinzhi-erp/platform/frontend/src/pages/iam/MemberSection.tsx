import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleDashed, ShieldAlert } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  displayLoginPhone,
  normalizeBusinessEmail,
  normalizeLoginPhone,
} from "../../auth/identity";
import {
  MAXIMUM_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  meetsPasswordPolicy,
} from "../../auth/passwordPolicy";
import { PasswordDialog } from "../../components/PasswordDialog";
import {
  type Member,
  type Page,
  type Role,
  type WarehouseScope,
  iamAdminApi,
} from "../../modules/iamAdminApi";
import {
  type Warehouse,
  warehouseCenterApi,
} from "../../modules/warehouseCenterApi";
import { DialogActions, formValues, IamDialog } from "./Dialog";

const SIZE = 20;
const CATALOG_SIZE = 100;
export const IAM_MEMBER_PAGE_SIZES = [10, 20, 50, 100] as const;
export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: Page<T> }
  | { kind: "error"; message: string }
  | { kind: "denied" };

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; member: Member }
  | { kind: "status"; member: Member }
  | { kind: "reset"; member: Member }
  | { kind: "roles"; member: Member }
  | { kind: "warehouseScope"; member: Member };

export type MemberFilters = {
  query: string;
  status: "" | Member["status"];
  roleId: string;
};

async function loadRoleDirectory() {
  const first = await iamAdminApi.listRoles({ page: 0, size: CATALOG_SIZE });
  if (first.totalPages > 100)
    throw new Error("Role catalog is too large to load safely");
  const pages = await Promise.all(
    Array.from({ length: Math.max(first.totalPages - 1, 0) }, (_, index) =>
      iamAdminApi.listRoles({ page: index + 1, size: CATALOG_SIZE }),
    ),
  );
  return [first, ...pages].flatMap((page) => page.items);
}

function message(error: unknown, operation: string) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录已失效，请重新登录后重试。";
    if (error.status === 403)
      return "当前账号没有执行此操作的权限。";
    if (error.status === 404)
      return "目标员工不存在，或本企业无权访问。";
    if (error.status === 409)
      return "员工数据已被其他操作更新，请刷新后重试。";
  }
  return `暂时无法${operation}，请稍后重试。`;
}

const time = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const memberLoginIdentifier = (member: Member) =>
  member.email ??
  (member.phoneNumber
    ? displayLoginPhone(member.phoneNumber)
    : member.username);

const memberIdentityDescription = (member: Member) =>
  member.email ??
  (member.phoneNumber
    ? displayLoginPhone(member.phoneNumber)
    : `旧账号 / 兼容登录账号：${member.username}`);

function MemberIdentity({ member }: { member: Member }) {
  return member.email || member.phoneNumber ? (
    <span>{member.email ?? displayLoginPhone(member.phoneNumber!)}</span>
  ) : (
    <span>
      {member.username}
      <small className="muted-cell">旧账号 · 兼容登录账号</small>
    </span>
  );
}

export function MemberSection({
  canResetPassword,
  canWrite,
  canRoleRead,
  canRoleWrite,
  canWarehouseScopeRead,
  canWarehouseScopeWrite,
  filters,
  onFiltersApply,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  pageSize,
  state,
  currentUserId,
}: {
  canResetPassword: boolean;
  canWrite: boolean;
  canRoleRead: boolean;
  canRoleWrite: boolean;
  canWarehouseScopeRead: boolean;
  canWarehouseScopeWrite: boolean;
  filters: MemberFilters;
  onFiltersApply: (filters: MemberFilters) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  pageSize: number;
  state: LoadState<Member>;
  currentUserId?: string;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [draftFilters, setDraftFilters] = useState<MemberFilters>(filters);
  const [filterRoles, setFilterRoles] = useState<Role[]>([]);
  const [roleDirectoryLoading, setRoleDirectoryLoading] = useState(false);
  const [roleDirectoryError, setRoleDirectoryError] = useState(false);
  const [roleDirectoryRetry, setRoleDirectoryRetry] = useState(0);
  const roleDirectoryRequest = useRef(0);
  useEffect(
    () => setDraftFilters(filters),
    [filters.query, filters.roleId, filters.status],
  );
  useEffect(() => {
    const request = ++roleDirectoryRequest.current;
    if (!canRoleRead) {
      setFilterRoles([]);
      setRoleDirectoryLoading(false);
      setRoleDirectoryError(false);
      return;
    }
    setRoleDirectoryLoading(true);
    setRoleDirectoryError(false);
    void loadRoleDirectory()
      .then((roles) => {
        if (request === roleDirectoryRequest.current) setFilterRoles(roles);
      })
      .catch(() => {
        if (request === roleDirectoryRequest.current) {
          setFilterRoles([]);
          setRoleDirectoryError(true);
        }
      })
      .finally(() => {
        if (request === roleDirectoryRequest.current)
          setRoleDirectoryLoading(false);
      });
    return () => {
      roleDirectoryRequest.current++;
    };
  }, [canRoleRead, roleDirectoryRetry]);
  const close = () => setDialog(null);
  const done = () => {
    close();
    onRefresh();
  };
  const activeFilters = Boolean(
    filters.query || filters.status || filters.roleId,
  );
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = draftFilters.query.trim();
    if (query.length > 100) return;
    onFiltersApply({ ...draftFilters, query });
  };
  const clearFilters = () => {
    const cleared: MemberFilters = { query: "", roleId: "", status: "" };
    setDraftFilters(cleared);
    onFiltersApply(cleared);
  };
  return (
    <section
      className="detail-card iam-section"
      aria-labelledby="iam-members-title"
    >
      <div className="table-heading">
        <div>
          <h2 id="iam-members-title">员工管理</h2>
          <p className="muted-cell">
            员工账号仅来自本企业。筛选作用于完整员工列表。
          </p>
        </div>
        {canWrite && (
          <button
            className="button button-primary"
            onClick={() => setDialog({ kind: "create" })}
            type="button"
          >
            新增员工账号
          </button>
        )}
      </div>
      {state.kind === "denied" && (
        <p className="muted-cell">当前账号没有查看员工列表的权限。</p>
      )}
      {state.kind !== "denied" && (
        <form
          aria-label="员工列表筛选"
          className="iam-filters"
          onSubmit={applyFilters}
          role="search"
        >
          <label>
            关键词
            <input
              aria-invalid={draftFilters.query.length > 100 || undefined}
              maxLength={100}
              onChange={(event) => {
                const query = event.currentTarget.value;
                setDraftFilters((current) => ({
                  ...current,
                  query,
                }));
              }}
              placeholder="邮箱、兼容账号、手机号或员工姓名"
              type="search"
              value={draftFilters.query}
            />
          </label>
          <label>
            账号状态
            <select
              onChange={(event) => {
                const status =
                  event.currentTarget.value as MemberFilters["status"];
                setDraftFilters((current) => ({
                  ...current,
                  status,
                }));
              }}
              value={draftFilters.status}
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">启用</option>
              <option value="DISABLED">停用</option>
            </select>
          </label>
          {canRoleRead && (
            <label>
              角色
              <select
                disabled={roleDirectoryLoading}
                onChange={(event) => {
                  const roleId = event.currentTarget.value;
                  setDraftFilters((current) => ({
                    ...current,
                    roleId,
                  }));
                }}
                value={draftFilters.roleId}
              >
                <option value="">全部角色</option>
                {draftFilters.roleId &&
                  !filterRoles.some(
                    (role) => role.id === draftFilters.roleId,
                  ) && (
                    <option value={draftFilters.roleId}>
                      当前角色筛选
                    </option>
                  )}
                {filterRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-actions">
            <button className="button button-primary" type="submit">
              应用筛选
            </button>
            <button
              className="button button-secondary"
              onClick={clearFilters}
              type="button"
            >
              清空筛选
            </button>
          </div>
          {roleDirectoryError && (
            <span className="toolbar-note" role="status">
              角色目录暂时不可用，关键词和状态筛选仍可使用。
              <button
                className="text-button"
                onClick={() => setRoleDirectoryRetry((value) => value + 1)}
                type="button"
              >
                重试角色目录
              </button>
            </span>
          )}
        </form>
      )}
      {state.kind === "loading" && (
        <p aria-busy="true" aria-live="polite">
          <CircleDashed aria-hidden="true" className="spin" size={20} />{" "}
          正在加载员工
        </p>
      )}
      {state.kind === "error" && (
        <ErrorState message={state.message} retry={onRefresh} />
      )}
      {state.kind === "ready" &&
        (state.data.items.length === 0 ? (
          <p className="muted-cell">
            {activeFilters
              ? "没有符合当前筛选条件的员工。"
              : "本企业还没有员工账号。"}
          </p>
        ) : (
          <>
            <p className="muted-cell" role="status">
              当前页显示 {state.data.items.length} 名员工，共{" "}
              {state.data.totalElements} 名。
            </p>
            <div className="shop-table-scroll">
              <table className="shop-table">
                  <caption className="sr-only">当前页员工账号</caption>
                  <thead>
                    <tr>
                      <th>邮箱 / 兼容登录账号</th>
                      <th>手机号</th>
                      <th>员工姓名</th>
                      <th>状态</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <MemberIdentity member={member} />
                        </td>
                        <td>{member.phoneNumber ?? "—"}</td>
                        <td>{member.displayName}</td>
                        <td>
                          {member.status === "ACTIVE" ? "启用" : "停用"}
                        </td>
                        <td>{time(member.updatedAt)}</td>
                        <td>
                          <span className="row-actions">
                            {canWrite && (
                              <>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setDialog({ kind: "edit", member })
                                  }
                                  type="button"
                                >
                                  编辑资料
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setDialog({ kind: "status", member })
                                  }
                                  type="button"
                                >
                                  {member.status === "ACTIVE"
                                    ? "停用"
                                    : "启用"}
                                </button>
                                {canResetPassword &&
                                  member.id !== currentUserId && (
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        setDialog({ kind: "reset", member })
                                      }
                                      type="button"
                                    >
                                      重置密码
                                    </button>
                                  )}
                              </>
                            )}
                            {canRoleRead && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setDialog({ kind: "roles", member })
                                }
                                type="button"
                              >
                                {canRoleWrite ? "查看/分配角色" : "查看角色"}
                              </button>
                            )}
                            {canWarehouseScopeRead && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setDialog({ kind: "warehouseScope", member })
                                }
                                type="button"
                              >
                                {canWarehouseScopeWrite
                                  ? "仓库范围"
                                  : "查看仓库范围"}
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
              page={state.data}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
              pageSize={pageSize}
              pageSizeOptions={IAM_MEMBER_PAGE_SIZES}
              label="员工列表分页"
            />
          </>
        ))}
      {dialog && (
        <MemberDialog
          dialog={dialog}
          canRoleWrite={canRoleWrite}
          canRoleRead={canRoleRead}
          canWarehouseScopeWrite={canWarehouseScopeWrite}
          canWrite={canWrite}
          onClose={close}
          onDone={done}
        />
      )}
    </section>
  );
}

function ErrorState({
  message: error,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert">
      <ShieldAlert size={20} />
      <p>{error}</p>
      <button className="button button-secondary" onClick={retry} type="button">
        重试
      </button>
    </div>
  );
}

function MemberDialog({
  dialog,
  canRoleWrite,
  canRoleRead,
  canWarehouseScopeWrite,
  canWrite,
  onClose,
  onDone,
}: {
  dialog: Dialog;
  canRoleWrite: boolean;
  canRoleRead: boolean;
  canWarehouseScopeWrite: boolean;
  canWrite: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  if (dialog.kind === "reset")
    return (
      <PasswordDialog
        accountName={memberIdentityDescription(dialog.member)}
        description="直接设置新密码；保存后该员工所有已登录设备将退出。"
        onClose={onClose}
        onSubmit={({ newPassword }) =>
          iamAdminApi.resetMemberPassword(dialog.member.id, {
            newPassword,
            version: dialog.member.version,
          })
        }
        onSuccess={onDone}
        requireCurrentPassword={false}
        submitLabel="重置密码"
        title="重置员工密码"
      />
    );
  if (dialog.kind === "roles")
    return (
      <AssignmentDialog
        member={dialog.member}
        canWrite={canRoleWrite}
        onClose={onClose}
        onDone={onDone}
      />
    );
  if (dialog.kind === "warehouseScope")
    return (
      <WarehouseScopeDialog
        canRoleRead={canRoleRead}
        canWrite={canWarehouseScopeWrite}
        member={dialog.member}
        onClose={onClose}
        onDone={onDone}
      />
    );
  return (
    <MutationDialog
      dialog={dialog}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function MutationDialog({
  dialog,
  onClose,
  onDone,
}: {
  dialog: Exclude<
    Dialog,
    | { kind: "roles" }
    | { kind: "sessions" }
    | { kind: "reset" }
    | { kind: "warehouseScope" }
  >;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createRoles, setCreateRoles] = useState<Role[]>([]);
  const [createRolesLoading, setCreateRolesLoading] = useState(false);
  const [createRolesError, setCreateRolesError] = useState<string | null>(null);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const inFlight = useRef(false);
  const member = dialog.kind === "create" ? undefined : dialog.member;
  useEffect(() => {
    if (dialog.kind !== "create") return;
    let active = true;
    setCreateRolesLoading(true);
    setCreateRolesError(null);
    void iamAdminApi
      .listRoles({ page: 0, size: CATALOG_SIZE })
      .then((result) => {
        if (active) {
          setCreateRoles(result.items.filter((role) => !role.systemRole));
          setCreateRolesLoading(false);
        }
      })
      .catch((caught) => {
        if (active) {
          setCreateRolesError(message(caught, "读取可分配角色"));
          setCreateRolesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [dialog.kind]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    const values = formValues(event);
    if (inFlight.current) return;
    const email =
      dialog.kind === "create"
        ? normalizeBusinessEmail(String(values.get("email") ?? ""))
        : null;
    const rawPhone = String(values.get("phoneNumber") ?? "").trim();
    const phoneNumber =
      dialog.kind === "create" || dialog.kind === "edit"
        ? rawPhone
          ? normalizeLoginPhone(rawPhone)
          : null
        : null;
    if (dialog.kind === "create" && !email && !phoneNumber) {
      setError("邮箱和手机号至少填写一项。");
      return;
    }
    if (rawPhone && !phoneNumber) {
      setError("请输入有效手机号，例如 18002629295 或 +8618002629295。");
      return;
    }
    if (
      dialog.kind === "create" &&
      !meetsPasswordPolicy(String(values.get("initialPassword") ?? ""))
    ) {
      setError(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (
      dialog.kind === "create" &&
      values.get("initialPassword") !==
        values.get("initialPasswordConfirmation")
    ) {
      setError("两次输入的初始密码不一致。");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      if (dialog.kind === "create") {
        if (createRolesLoading || createRolesError) {
          setError(createRolesError ?? "角色仍在加载，请稍后重试。");
          return;
        }
        await iamAdminApi.createMember({
          ...(email ? { email } : {}),
          ...(phoneNumber ? { phoneNumber } : {}),
          displayName: String(values.get("displayName")).trim(),
          initialPassword: String(values.get("initialPassword")),
          roleIds: values.getAll("roleIds").map(String),
        });
        onDone();
      } else if (dialog.kind === "edit") {
        await iamAdminApi.updateMember(member!.id, {
          displayName: String(values.get("displayName")).trim(),
          ...(member!.email ? { phoneNumber: phoneNumber ?? null } : {}),
          version: member!.version,
        });
        onDone();
      } else if (dialog.kind === "status") {
        await iamAdminApi.changeMemberStatus(member!.id, {
          status: member!.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
          version: member!.version,
        });
        onDone();
      }
    } catch (caught) {
      setError(message(caught, "保存员工账号"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  const title =
    dialog.kind === "create"
      ? "新增员工账号"
      : dialog.kind === "edit"
        ? "编辑员工资料"
        : `确认${member!.status === "ACTIVE" ? "停用" : "启用"}员工`;
  return (
    <IamDialog onClose={onClose} title={title}>
      <form className="warehouse-dialog-form" onSubmit={submit}>
        {dialog.kind === "create" && (
          <>
            <label>
              邮箱（与手机号至少填写一项）
              <input
                autoComplete="username"
                inputMode="email"
                maxLength={254}
                name="email"
                onBlur={(event) => {
                  const normalized = normalizeBusinessEmail(
                    event.currentTarget.value,
                  );
                  if (normalized) event.currentTarget.value = normalized;
                }}
                type="email"
              />
              <small className="password-requirements">
                创建后不可修改；保存时会去除首尾空格并转为小写。
              </small>
            </label>
            <label>
              手机号（与邮箱至少填写一项）
              <input
                autoComplete="tel"
                inputMode="tel"
                maxLength={32}
                name="phoneNumber"
                placeholder="18002629295"
                type="tel"
              />
              <small className="password-requirements">
                可直接用于登录；支持中国大陆 11 位号码或国际格式。
              </small>
            </label>
            <label>
              员工姓名
              <input maxLength={160} name="displayName" required />
            </label>
            <label>
              初始密码
              <input
                autoComplete="new-password"
                maxLength={MAXIMUM_PASSWORD_LENGTH}
                name="initialPassword"
                required
                type={showInitialPassword ? "text" : "password"}
              />
              <small className="password-requirements">
                密码不能为空；仅用于本次设置。
              </small>
            </label>
            <label>
              确认初始密码
              <input
                autoComplete="new-password"
                maxLength={MAXIMUM_PASSWORD_LENGTH}
                name="initialPasswordConfirmation"
                required
                type={showInitialPassword ? "text" : "password"}
              />
            </label>
            <button
              aria-pressed={showInitialPassword}
              className="text-button"
              onClick={() => setShowInitialPassword((visible) => !visible)}
              type="button"
            >
              {showInitialPassword ? "隐藏初始密码" : "显示初始密码"}
            </button>
            <fieldset>
              <legend>现有角色</legend>
              {createRoles.map((role) => (
                <label key={role.id}>
                  <input name="roleIds" type="checkbox" value={role.id} />
                  {role.name}
                </label>
              ))}
              {createRolesLoading && <p>正在加载可分配角色…</p>}
              {!createRolesLoading &&
                !createRolesError &&
                createRoles.length === 0 && (
                  <p>当前没有可分配的非系统角色。</p>
                )}
              {createRolesError && <p role="alert">{createRolesError}</p>}
            </fieldset>
          </>
        )}
        {dialog.kind === "edit" && (
          <>
            <label>
              {member!.email
                ? "邮箱"
                : member!.phoneNumber
                  ? "当前手机号登录账号"
                  : "旧账号 / 兼容登录账号"}
              <input readOnly value={memberLoginIdentifier(member!)} />
              <small className="password-requirements">
                {member!.email
                  ? "邮箱创建后不可修改。"
                  : member!.phoneNumber
                    ? "该手机号是主登录账号，当前不支持直接修改。"
                  : "该历史账号没有邮箱，仍可作为兼容登录账号使用且不可修改。"}
              </small>
            </label>
            {member!.email && (
              <label>
                手机号（可选）
                <input
                  autoComplete="tel"
                  defaultValue={member!.phoneNumber}
                  inputMode="tel"
                  maxLength={16}
                  name="phoneNumber"
                  pattern="\+[1-9][0-9]{7,14}"
                  placeholder="+8613800138000"
                  type="tel"
                />
                <small className="password-requirements">
                  可作为备用登录手机号；可修改或留空清除。
                </small>
              </label>
            )}
            <label>
              员工姓名
              <input
                defaultValue={member!.displayName}
                maxLength={160}
                name="displayName"
                required
              />
            </label>
          </>
        )}
        {dialog.kind === "status" && (
          <p className="confirmation-copy danger-copy">
            确认{member!.status === "ACTIVE" ? "停用" : "启用"}员工{" "}
            {member!.displayName}（{memberIdentityDescription(member!)}）？
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <DialogActions
          danger={dialog.kind === "status"}
          onClose={onClose}
          submitting={submitting}
          submitLabel={dialog.kind === "status" ? "确认" : "保存"}
        />
      </form>
    </IamDialog>
  );
}

function AssignmentDialog({
  member,
  canWrite,
  onClose,
  onDone,
}: {
  member: Member;
  canWrite: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolePage, setRolePage] = useState<Page<Role> | null>(null);
  const [catalogPage, setCatalogPage] = useState(0);
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
      .getMemberRoles(member.id)
      .then((assignment) => {
        if (current !== assignmentRequest.current) return;
        setSelected(assignment.assignmentIds);
        setVersion(assignment.version);
      })
      .catch(
        (caught) =>
          current === assignmentRequest.current &&
          setAssignmentError(message(caught, "读取员工角色")),
      )
      .finally(
        () => current === assignmentRequest.current && setLoading(false),
      );
    return () => {
      assignmentRequest.current++;
    };
  }, [member.id]);
  useEffect(() => {
    const current = ++catalogRequest.current;
    setCatalogLoading(true);
    setCatalogError(null);
    setRoles([]);
    setRolePage(null);
    void iamAdminApi
      .listRoles({ page: catalogPage, size: CATALOG_SIZE })
      .then((page) => {
        if (current !== catalogRequest.current) return;
        setRoles(page.items);
        setRolePage(page);
      })
      .catch(
        (caught) =>
          current === catalogRequest.current &&
          setCatalogError(message(caught, "读取角色目录")),
      )
      .finally(
        () => current === catalogRequest.current && setCatalogLoading(false),
      );
    return () => {
      catalogRequest.current++;
    };
  }, [catalogPage, catalogRetry]);
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  const submit = async () => {
    if (!canWrite || version === undefined || assignmentError) return;
    setSubmitting(true);
    setMutationError(null);
    try {
      await iamAdminApi.replaceMemberRoles(member.id, {
        ids: selected,
        version,
      });
      onDone();
    } catch (caught) {
      setMutationError(message(caught, "保存员工角色"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <IamDialog onClose={onClose} title={`员工角色：${member.displayName}`}>
      <div className="warehouse-dialog-form">
        <dl className="password-account">
          <dt>{member.email ? "邮箱" : "旧账号 / 兼容登录账号"}</dt>
          <dd>{memberLoginIdentifier(member)}</dd>
        </dl>
        {catalogLoading && <p aria-busy="true">正在加载角色目录…</p>}
        {loading && <p aria-busy="true">正在读取已分配角色…</p>}
        {!catalogLoading &&
          roles.map((role) => (
            <label className="checkbox-label" key={role.id}>
              <input
                checked={selected.includes(role.id)}
                disabled={
                  !canWrite ||
                  submitting ||
                  loading ||
                  version === undefined ||
                  Boolean(assignmentError)
                }
                onChange={() => toggle(role.id)}
                type="checkbox"
              />
              {role.name}
            </label>
          ))}
        {!catalogLoading && roles.length === 0 && (
          <p className="muted-cell">当前没有可查看的角色。</p>
        )}
        {rolePage && (
          <Pagination
            label="角色目录分页"
            onPageChange={setCatalogPage}
            page={{ ...rolePage, page: catalogPage }}
          />
        )}
        <p className="muted-cell">
          已在角色目录中选择 {selected.length} 个角色。
        </p>
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
                上一页角色
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={() => setCatalogRetry((value) => value + 1)}
              type="button"
            >
              重试角色目录
            </button>
          </div>
        )}
        <div className="form-actions">
          <button
            className="button button-secondary"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          {canWrite && (
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
              {submitting ? "正在保存" : "保存角色"}
            </button>
          )}
        </div>
      </div>
    </IamDialog>
  );
}

async function loadWarehouseDirectory() {
  const first = await warehouseCenterApi.listWarehouses({
    page: 0,
    size: CATALOG_SIZE,
  });
  if (first.totalPages > 100)
    throw new Error("Warehouse catalog is too large to load safely");
  const pages = await Promise.all(
    Array.from({ length: Math.max(first.totalPages - 1, 0) }, (_, index) =>
      warehouseCenterApi.listWarehouses({
        page: index + 1,
        size: CATALOG_SIZE,
      }),
    ),
  );
  return [first, ...pages]
    .flatMap((page) => page.items)
    .filter((warehouse) => warehouse.status !== "ARCHIVED");
}

async function loadProtectedMemberIds() {
  const first = await iamAdminApi.listRoles({ page: 0, size: CATALOG_SIZE });
  if (first.totalPages > 100)
    throw new Error("Role catalog is too large to load safely");
  const pages = await Promise.all(
    Array.from({ length: Math.max(first.totalPages - 1, 0) }, (_, index) =>
      iamAdminApi.listRoles({ page: index + 1, size: CATALOG_SIZE }),
    ),
  );
  return new Set(
    [first, ...pages]
      .flatMap((page) => page.items)
      .filter((role) => role.systemRole && role.code === "tenant_admin")
      .map((role) => role.id),
  );
}

function WarehouseScopeDialog({
  canRoleRead,
  canWrite,
  member,
  onClose,
  onDone,
}: {
  canRoleRead: boolean;
  canWrite: boolean;
  member: Member;
  onClose: () => void;
  onDone: () => void;
}) {
  const [scope, setScope] = useState<WarehouseScope | null>(null);
  const [mode, setMode] = useState<WarehouseScope["mode"]>("ALL");
  const [selected, setSelected] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [protectionLoading, setProtectionLoading] = useState(canRoleRead);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [protectedTarget, setProtectedTarget] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const request = useRef(0);

  const loadScope = () => {
    const current = ++request.current;
    setLoading(true);
    setCatalogLoading(true);
    setProtectionLoading(canRoleRead);
    setScopeError(null);
    setCatalogError(null);
    setMutationError(null);
    const scopeRequest = iamAdminApi.getMemberWarehouseScope(member.id);
    const catalogRequest = loadWarehouseDirectory();
    const protectionRequest = canRoleRead
      ? Promise.all([
          iamAdminApi.getMemberRoles(member.id),
          loadProtectedMemberIds(),
        ]).then(([assignment, protectedIds]) =>
          assignment.assignmentIds.some((id) => protectedIds.has(id)),
        )
      : Promise.resolve(false);

    void scopeRequest
      .then((value) => {
        if (current !== request.current) return;
        setScope(value);
        setMode(value.mode);
        setSelected(value.warehouseIds);
      })
      .catch((caught) => {
        if (current === request.current)
          setScopeError(message(caught, "读取仓库数据范围"));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
    void catalogRequest
      .then((items) => {
        if (current === request.current) setWarehouses(items);
      })
      .catch((caught) => {
        if (current === request.current)
          setCatalogError(message(caught, "读取仓库目录"));
      })
      .finally(() => {
        if (current === request.current) setCatalogLoading(false);
      });
    void protectionRequest
      .then((isProtected) => {
        if (current === request.current) setProtectedTarget(isProtected);
      })
      .catch(() => {
        // Role visibility is optional; the write API remains the authority.
      })
      .finally(() => {
        if (current === request.current) setProtectionLoading(false);
      });
  };

  useEffect(() => {
    loadScope();
    return () => {
      request.current++;
    };
  }, [member.id]);

  const catalogIds = useMemo(
    () => new Set(warehouses.map((warehouse) => warehouse.id)),
    [warehouses],
  );
  const unavailableCount =
    mode === "SELECTED"
      ? selected.filter((warehouseId) => !catalogIds.has(warehouseId)).length
      : 0;
  const readOnly = !canWrite || protectedTarget;
  const submit = async () => {
    if (
      readOnly ||
      !scope ||
      submitting ||
      catalogLoading ||
      protectionLoading ||
      catalogError ||
      (mode === "SELECTED" && unavailableCount > 0)
    )
      return;
    setSubmitting(true);
    setMutationError(null);
    try {
      await iamAdminApi.replaceMemberWarehouseScope(member.id, {
        mode,
        warehouseIds: mode === "ALL" ? [] : selected,
        version: scope.version,
      });
      onDone();
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.status === 409 &&
        caught.code === "protected_scope"
      )
        setProtectedTarget(true);
      setMutationError(message(caught, "保存仓库数据范围"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <IamDialog
      onClose={onClose}
      title={`仓库数据范围：${member.displayName}`}
    >
      <div className="warehouse-dialog-form">
        <dl className="password-account">
          <dt>{member.email ? "邮箱" : "旧账号 / 兼容登录账号"}</dt>
          <dd>{memberLoginIdentifier(member)}</dd>
        </dl>
        {loading && <p aria-busy="true">正在读取仓库数据范围…</p>}
        {catalogLoading && <p aria-busy="true">正在加载未归档仓库目录…</p>}
        {scopeError && <ErrorState message={scopeError} retry={loadScope} />}
        {scope && (
          <>
            {protectedTarget && (
              <p className="confirmation-copy">
                企业管理员为系统保护账号，仓库数据范围固定为全部仓库。
              </p>
            )}
            <fieldset disabled={readOnly || submitting || Boolean(catalogError)}>
              <legend>数据范围</legend>
              <label className="checkbox-label">
                <input
                  checked={mode === "ALL"}
                  name="warehouseScopeMode"
                  onChange={() => {
                    setMode("ALL");
                    setSelected([]);
                  }}
                  type="radio"
                />
                全部仓库
              </label>
              <label className="checkbox-label">
                <input
                  checked={mode === "SELECTED"}
                  name="warehouseScopeMode"
                  onChange={() => setMode("SELECTED")}
                  type="radio"
                />
                指定仓库
              </label>
            </fieldset>
            {mode === "SELECTED" && !catalogLoading && !catalogError && (
              <fieldset
                className="iam-choice-group"
                disabled={readOnly || submitting}
              >
                <legend>本企业未归档仓库</legend>
                {warehouses.map((warehouse) => (
                  <label className="checkbox-label" key={warehouse.id}>
                    <input
                      checked={selected.includes(warehouse.id)}
                      onChange={() =>
                        setSelected((ids) =>
                          ids.includes(warehouse.id)
                            ? ids.filter((id) => id !== warehouse.id)
                            : [...ids, warehouse.id],
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      {warehouse.name}
                      <small>{warehouse.businessCode}</small>
                    </span>
                  </label>
                ))}
                {warehouses.length === 0 && (
                  <p className="muted-cell">
                    本企业没有可选择的未归档仓库；保存后将拒绝访问全部仓库。
                  </p>
                )}
              </fieldset>
            )}
            {mode === "SELECTED" && unavailableCount > 0 && (
              <p role="alert">
                当前范围含 {unavailableCount}{" "}
                个不在可用目录中的仓库。请先确认仓库范围后再保存。
              </p>
            )}
            <p className="muted-cell">
              {mode === "ALL"
                ? "可访问本企业的全部仓库。"
                : `已选择 ${selected.length} 个仓库；选择 0 个表示拒绝访问全部仓库。`}
            </p>
          </>
        )}
        {catalogError && (
          <p role="alert">
            {catalogError} 请刷新后重试。
          </p>
        )}
        {mutationError && <p role="alert">{mutationError}</p>}
        <div className="form-actions">
          <button
            className="button button-secondary"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          {canWrite && !protectedTarget && (
            <button
              className="button button-primary"
              disabled={
                !scope ||
                submitting ||
                catalogLoading ||
                protectionLoading ||
                Boolean(scopeError) ||
                Boolean(catalogError) ||
                (mode === "SELECTED" && unavailableCount > 0)
              }
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? "正在保存" : "保存范围"}
            </button>
          )}
        </div>
      </div>
    </IamDialog>
  );
}

export function Pagination({
  page,
  onPageChange,
  onPageSizeChange,
  pageSize,
  pageSizeOptions,
  label,
}: {
  page: Page<unknown>;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  label: string;
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <span>
        第 {page.page + 1} / {Math.max(page.totalPages, 1)} 页
      </span>
      <div>
        {onPageSizeChange && pageSizeOptions && (
          <label>
            每页
            <select
              aria-label={`${label}每页条数`}
              onChange={(event) =>
                onPageSizeChange(Number(event.currentTarget.value))
              }
              value={pageSize ?? page.size}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="button button-secondary"
          disabled={page.page === 0}
          onClick={() => onPageChange(page.page - 1)}
          type="button"
        >
          上一页
        </button>
        <button
          className="button button-secondary"
          disabled={page.page + 1 >= page.totalPages}
          onClick={() => onPageChange(page.page + 1)}
          type="button"
        >
          下一页
        </button>
      </div>
    </nav>
  );
}

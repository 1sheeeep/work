import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDot, Copy, ExternalLink, FileQuestion, FormInput, HelpCircle, Languages, Mail, MessageSquareText, PackageSearch, Pencil, PieChart, Plus, RefreshCw, RotateCcw, Save, Send, Settings, ShieldCheck, Store, Truck, UserPlus, X } from "lucide-react";
import { AccountAuditLog, AISettings, cleanBaseUrl, Conversation, KnowledgeEntry, Message, PlatformAPI, PlatformAPIError, ResponseMetrics, Shop, ShopifyConnectionStatus, ShopifyOrderSummary, ShopSource, User, UserDepartment, UserRole } from "../../api";
import { Badge, Empty, Panel } from "../../components/ui";
import { allPermissionKeys, defaultPermissionsForRole, hasPermission, PERMISSIONS, permissionGroups, systemAdminCorePermissions, type PermissionKey } from "../../permissions";
import { DEFAULT_INSTANT_ANSWER, DEFAULT_WIDGET_LANGUAGE, SHOPIFY_STORE_ID_EXAMPLE, type InstantAnswerConfig, type Language, type ShopConfigMenuKey, type T, type ToastMessage, type ToastTone } from "../shared/types";
import { errorText, connectedShopChannelLabels, conversationStatusLabel, dateOnly, defaultShopifyInstallUrl, defaultShopifyOrderQuery, durationLabel, firstTracking, formatMoney, isConnectedSource, normalizeInstantAnswerOrder, normalizeShopifyDomain, parseInstantAnswers, roleLabel, selectedShopifyDomain, shopifyAPIStatusView, shopifyAppEmbedUrl, shopifyAppStatusView, shopifyEmbedStatusView, shopifyInstallUrl, shopifyRuntimeStatusView, sourceLabel, sourceStatusView, systemAdminUserId, timeLabel, userDisplayName, userStatusLabel } from "../shared/helpers";

const skillGroups = ["咨询接待", "售后"] as const;
const departments: UserDepartment[] = ["客服部", "财务部", "综合部"];
export function AgentsPanel(props: {
  t: T;
  api: PlatformAPI;
  busy: boolean;
  users: User[];
  shops: Shop[];
  agentsByShopId: Record<string, User[]>;
  currentUser: User;
  sharedIdentity?: boolean;
  onUserSaved: (user: User, assignedShopIds?: string[]) => void;
  onUserDeleted: (userId: string) => void;
  setBusy: (value: boolean) => void;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("agent-password");
  const [role, setRole] = useState<UserRole>("agent");
  const [department, setDepartment] = useState<UserDepartment>("客服部");
  const [skillGroup, setSkillGroup] = useState<"" | (typeof skillGroups)[number]>("咨询接待");
  const [filterRole, setFilterRole] = useState<"all" | UserRole>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "disabled">("all");
  const [filterDepartment, setFilterDepartment] = useState<"all" | UserDepartment>("all");
  const [filterSkillGroup, setFilterSkillGroup] = useState<"all" | (typeof skillGroups)[number]>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editTab, setEditTab] = useState<"basic" | "shops" | "permissions" | "audit">("basic");
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("agent");
  const [editStatus, setEditStatus] = useState("active");
  const [editDepartment, setEditDepartment] = useState<UserDepartment>("客服部");
  const [editSkillGroup, setEditSkillGroup] = useState<"" | (typeof skillGroups)[number]>("咨询接待");
  const [editReceptionLimit, setEditReceptionLimit] = useState(50);
  const [editPermissions, setEditPermissions] = useState<PermissionKey[]>([]);
  const [editPermissionsCustomized, setEditPermissionsCustomized] = useState(false);
  const [editShopScope, setEditShopScope] = useState<"assigned" | "selected" | "all">("assigned");
  const [editShopScopeIds, setEditShopScopeIds] = useState<string[]>([]);
  const [editWorkbenchShopScope, setEditWorkbenchShopScope] = useState<"assigned" | "all">("assigned");
  const [editConversationScope, setEditConversationScope] = useState<"assigned" | "all">("assigned");
  const [editShopIds, setEditShopIds] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AccountAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const { t } = props;
  const admins = props.users.filter((user) => user.role === "admin");
  const agents = props.users.filter((user) => user.role === "agent");
  const systemAdminId = systemAdminUserId(props.users);
  const canEditUsers = hasPermission(props.currentUser, PERMISSIONS.usersManage);
  const canAssignShops = hasPermission(props.currentUser, PERMISSIONS.shopsAssign);
  const canManagePermissions = hasPermission(props.currentUser, PERMISSIONS.permissionsManage);
  const canEditAccess = Boolean(editingUser && canManagePermissions && (!editingUser.systemAdmin || (props.currentUser.systemAdmin && editingUser.id === props.currentUser.id)));
  const editWorkbenchEnabled = editPermissions.includes(PERMISSIONS.workbenchAccess);
  const editEmailStatisticsEnabled = editPermissions.includes(PERMISSIONS.emailStatisticsView);
  const editShopManagementEnabled = editPermissions.includes(PERMISSIONS.shopsView) || editPermissions.includes(PERMISSIONS.shopChannelsManage);
  const visibleUsers = props.users.filter((user) => {
    const matchRole = filterRole === "all" || user.role === filterRole;
    const matchStatus = filterStatus === "all" || user.status === filterStatus;
    const userDepartment = user.role === "agent" ? (departments.includes(user.department as UserDepartment) ? user.department as UserDepartment : "客服部") : "";
    const matchDepartment = filterDepartment === "all" || userDepartment === filterDepartment;
    const matchSkillGroup = filterSkillGroup === "all" || (userDepartment === "客服部" && (user.skillGroup || "咨询接待") === filterSkillGroup);
    const text = `${user.displayName} ${user.email}`.toLowerCase();
    return matchRole && matchStatus && matchDepartment && matchSkillGroup && text.includes(query.trim().toLowerCase());
  });
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
  const pagedUsers = visibleUsers.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [filterRole, filterStatus, filterDepartment, filterSkillGroup, query]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    props.setBusy(true);
    try {
      const created = await props.api.createUser({ email, displayName, password, role, department: role === "agent" ? department : "", skillGroup: role === "agent" && department === "客服部" ? skillGroup : "" });
      setEmail("");
      setDisplayName("");
      setPassword("agent-password");
      setDepartment("客服部");
      setSkillGroup("咨询接待");
      setShowCreate(false);
      props.setToast({ tone: "success", text: t.accountCreated });
      props.onUserSaved(created);
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  async function toggleUserStatus(user: User) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    props.setBusy(true);
    try {
      const updated = await props.api.updateUser(user.id, { status: nextStatus });
      props.setToast({ tone: "success", text: nextStatus === "active" ? "账号已启用" : "账号已停用" });
      props.onUserSaved(updated);
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`确定删除账号 ${user.displayName || user.email} 吗？删除后会取消该客服的店铺分配。`)) return;
    props.setBusy(true);
    try {
      await props.api.deleteUser(user.id);
      props.setToast({ tone: "success", text: "账号已删除" });
      props.onUserDeleted(user.id);
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  function openEditor(user: User) {
    setEditingUser(user);
    setEditTab("basic");
    setEditEmail(user.email);
    setEditName(user.displayName || "");
    setEditPassword("");
    setEditRole(user.role);
    setEditStatus(user.status);
	const currentDepartment = user.role === "agent" && departments.includes(user.department as UserDepartment) ? user.department as UserDepartment : "客服部";
	setEditDepartment(currentDepartment);
    setEditSkillGroup(user.role === "agent" && currentDepartment === "客服部" ? (user.skillGroup === "售后" ? "售后" : "咨询接待") : "");
    setEditReceptionLimit(user.receptionLimit || 50);
    setEditPermissions((user.permissions || defaultPermissionsForRole(user.role, currentDepartment)).filter((permission): permission is PermissionKey => allPermissionKeys.includes(permission as PermissionKey)));
    setEditPermissionsCustomized(Boolean(user.permissionsCustomized));
    setEditShopScope(user.shopScope === "selected" ? "selected" : user.shopScope === "all" ? "all" : "assigned");
    setEditShopScopeIds(user.shopScopeIds || []);
    setEditWorkbenchShopScope(user.workbenchShopScope === "all" ? "all" : "assigned");
    setEditConversationScope(user.conversationScope === "all" ? "all" : "assigned");
    setEditShopIds(props.shops.filter((shop) => (props.agentsByShopId[shop.id] || []).some((agent) => agent.id === user.id)).map((shop) => shop.id));
    setAuditLogs([]);
  }

  async function openAuditTab() {
    if (!editingUser) return;
    setEditTab("audit");
    setAuditLoading(true);
    try {
      setAuditLogs(await props.api.listUserAuditLogs(editingUser.id));
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      setAuditLoading(false);
    }
  }

  function auditDescription(log: AccountAuditLog) {
    const shopId = typeof log.changes?.shopId === "string" ? log.changes.shopId : "";
    const shopName = props.shops.find((shop) => shop.id === shopId)?.displayName || shopId;
    if (log.action === "user.created") return "创建了账号";
    if (log.action === "user.deleted") return "删除了账号";
    if (log.action === "shop.assigned") return `分配店铺：${shopName || "未知店铺"}`;
    if (log.action === "shop.unassigned") return `取消店铺：${shopName || "未知店铺"}`;
    if (log.action === "user.updated") {
      const changes: string[] = [];
      if (log.changes?.emailChanged) changes.push("邮箱");
      if (log.changes?.passwordReset) changes.push("密码");
      if (log.changes?.displayName) changes.push("资料");
      if (log.changes?.role) changes.push("角色");
      if (log.changes?.status) changes.push("状态");
      if (log.changes?.permissionsCustomized !== undefined) changes.push("权限与数据范围");
      return `修改了${changes.length ? changes.join("、") : "账号设置"}`;
    }
    return log.action;
  }

  function toggleEditPermission(permission: PermissionKey) {
    if (editingUser?.systemAdmin && systemAdminCorePermissions.includes(permission)) return;
    if (permission === PERMISSIONS.workbenchAccess && !editPermissions.includes(permission)) {
      setEditWorkbenchShopScope("assigned");
      setEditConversationScope("assigned");
    }
    setEditPermissionsCustomized(true);
    setEditPermissions((current) => {
      if (current.includes(permission)) {
        const next = current.filter((item) => item !== permission);
        return permission === PERMISSIONS.workbenchAccess ? next.filter((item) => item !== PERMISSIONS.autoReception) : next;
      }
      if (permission === PERMISSIONS.autoReception && !current.includes(PERMISSIONS.workbenchAccess)) {
        return [...current, PERMISSIONS.workbenchAccess, permission];
      }
      return [...current, permission];
    });
  }

  function restoreRolePermissions() {
    setEditPermissions(defaultPermissionsForRole(editRole, editDepartment));
    setEditPermissionsCustomized(false);
    setEditShopScope(editRole === "admin" ? "all" : "assigned");
    setEditShopScopeIds([]);
    setEditWorkbenchShopScope("assigned");
    setEditConversationScope("assigned");
  }

  async function saveEditedUser(event: FormEvent) {
    event.preventDefault();
    if (!editingUser) return;
    if (canEditAccess && editShopManagementEnabled && editShopScope === "selected" && editShopScopeIds.length === 0) {
      props.setToast({ tone: "error", text: "请至少选择一个可管理店铺" });
      return;
    }
    props.setBusy(true);
    try {
      const updated = await props.api.updateUser(editingUser.id, {
        email: editEmail,
        displayName: editName,
        password: editPassword || undefined,
        role: editRole,
        status: editStatus,
        department: canManagePermissions ? (editRole === "agent" ? editDepartment : "") : undefined,
        skillGroup: editRole === "agent" && editDepartment === "客服部" ? (editSkillGroup || "咨询接待") : "",
        receptionLimit: editPermissions.includes(PERMISSIONS.autoReception) ? editReceptionLimit : undefined,
        permissions: canEditAccess ? editPermissions : undefined,
        permissionsCustomized: canEditAccess ? editPermissionsCustomized : undefined,
        shopScope: canEditAccess ? editShopScope : undefined,
        shopScopeIds: canEditAccess ? editShopScopeIds : undefined,
        workbenchShopScope: canEditAccess ? editWorkbenchShopScope : undefined,
        conversationScope: canEditAccess ? editConversationScope : undefined
      });

      if (canAssignShops && (!editingUser.systemAdmin || (props.currentUser.systemAdmin && editingUser.id === props.currentUser.id))) {
        const previous = new Set(props.shops.filter((shop) => (props.agentsByShopId[shop.id] || []).some((agent) => agent.id === editingUser.id)).map((shop) => shop.id));
        const next = new Set(editShopIds);
        const changes: Promise<unknown>[] = [];
        for (const shopId of next) if (!previous.has(shopId)) changes.push(props.api.assignAgent(shopId, editingUser.id));
        for (const shopId of previous) if (!next.has(shopId)) changes.push(props.api.unassignAgent(shopId, editingUser.id));
        await Promise.all(changes);
      }
      const successText = editTab === "basic"
        ? "基本资料已保存"
        : editTab === "shops"
          ? "店铺分配已保存"
          : "账号权限已保存";
      props.setToast({ tone: "success", text: successText });
      setEditingUser(updated);
      setEditPassword("");
      props.onUserSaved(updated, editShopIds);
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  return (
    <section className="seat-layout">
      <section className="seat-content">
        <div className="seat-toolbar">
          <select value={filterRole} onChange={(event) => setFilterRole(event.target.value as "all" | UserRole)}>
            <option value="all">全部角色</option>
            <option value="admin">管理员账号</option>
            <option value="agent">子账号</option>
          </select>
          <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as "all" | "active" | "disabled")}>
            <option value="all">全部账号状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已停用</option>
          </select>
          <select value={filterDepartment} onChange={(event) => setFilterDepartment(event.target.value as "all" | UserDepartment)}>
            <option value="all">全部部门</option>
            {departments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={filterSkillGroup} onChange={(event) => setFilterSkillGroup(event.target.value as "all" | (typeof skillGroups)[number])}>
            <option value="all">全部技能组</option>
            {skillGroups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <input placeholder="搜索姓名/账号/邮箱" value={query} onChange={(event) => setQuery(event.target.value)} />
          {props.sharedIdentity ? <p role="note">账号与密码在 ERP 管理；此处管理客服坐席权限与店铺分配。员工首次从 ERP 进入后显示在这里。</p> : canEditUsers ? <button type="button" className="primary" onClick={() => setShowCreate(true)}><Plus size={16} /> 新增子账号</button> : null}
        </div>

        <div className="role-summary-grid">
          <div><strong>{admins.length}</strong><span>管理员</span></div>
          <div><strong>{agents.filter((user) => !user.department || user.department === "客服部").length}</strong><span>客服部</span></div>
          <div><strong>{agents.filter((user) => user.department === "财务部").length}</strong><span>财务部</span></div>
          <div><strong>{agents.filter((user) => user.department === "综合部").length}</strong><span>综合部</span></div>
        </div>

        <div className="seat-table">
          <div className="seat-table-head">
            <span>姓名</span><span>角色</span><span>部门</span><span>技能组</span><span>账号状态</span><span>账号</span><span>创建日期</span><span>操作</span>
          </div>
          {pagedUsers.map((user) => (
            <div className="seat-table-row" key={user.id}>
              <strong>{user.displayName || user.email}</strong>
              <Badge tone={user.role === "admin" ? "blue" : "green"}>{user.id === systemAdminId ? "系统管理员" : user.role === "admin" ? "管理员" : "子账号"}</Badge>
              <span>{user.role === "admin" ? "系统管理" : user.department || "客服部"}</span>
              <span>{user.role === "agent" && (!user.department || user.department === "客服部") ? (user.skillGroup || "咨询接待") : "--"}</span>
              <Badge tone={user.status === "active" ? "green" : "muted"}>{userStatusLabel(user.status)}</Badge>
              <span>{user.email}</span>
              <span>{dateOnly(user.createdAt) || "--"}</span>
              <div className="seat-row-actions">
                {canEditUsers ? <button type="button" className="icon-text-button" onClick={() => openEditor(user)} disabled={props.busy}><Pencil size={14} /> 编辑</button> : null}
                {canEditUsers ? <button type="button" onClick={() => void toggleUserStatus(user)} disabled={props.busy || user.id === props.currentUser.id || user.id === systemAdminId}>{user.status === "active" ? "停用" : "启用"}</button> : null}
                {canEditUsers ? <button type="button" className="danger-action" onClick={() => void deleteUser(user)} disabled={props.busy || user.id === props.currentUser.id || user.id === systemAdminId}>删除</button> : null}
              </div>
            </div>
          ))}
          {!visibleUsers.length ? <Empty text="暂无账号" /> : null}
          {visibleUsers.length ? (
            <footer className="paged-list-controls seat-pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
              <span>第 {page} / {pageCount} 页，共 {visibleUsers.length} 个账号</span>
              <button type="button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一页</button>
            </footer>
          ) : null}
        </div>

      </section>

      {editingUser ? (
        <div className="drawer-backdrop">
          <aside className="account-drawer account-edit-drawer">
            <div className="drawer-head">
              <div><h3>编辑账号</h3><p>{editingUser.email}</p></div>
              <button type="button" onClick={() => setEditingUser(null)} aria-label="关闭"><X size={16} /></button>
            </div>
            <div className="account-edit-tabs" role="tablist">
              <button type="button" className={editTab === "basic" ? "active" : ""} onClick={() => setEditTab("basic")}>基本资料</button>
              <button type="button" className={editTab === "shops" ? "active" : ""} onClick={() => setEditTab("shops")}>分配店铺</button>
              <button type="button" className={editTab === "permissions" ? "active" : ""} onClick={() => setEditTab("permissions")}>账号权限</button>
              <button type="button" className={editTab === "audit" ? "active" : ""} onClick={() => void openAuditTab()}>操作记录</button>
            </div>
            <form className="account-edit-form" onSubmit={saveEditedUser}>
              {editingUser.systemAdmin ? <div className="system-admin-notice"><ShieldCheck size={17} /><span>系统管理员固定保留账号与权限管理；客服工作台、自动进线及其他后台功能可按需开启。</span></div> : null}
              {editTab === "basic" ? (
                <div className="account-edit-section form-grid">
                  <label>真实姓名<input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label>
                  <label>邮箱账号<input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} required /></label>
                  {!props.sharedIdentity && <label>重置密码<input type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="留空表示不修改" /></label>}
                  <label>角色
                    <select value={editRole} disabled={editingUser.systemAdmin || !canManagePermissions} onChange={(event) => {
                      const nextRole = event.target.value as UserRole;
                      setEditRole(nextRole);
                      setEditDepartment(nextRole === "agent" ? editDepartment : "客服部");
                      setEditSkillGroup(nextRole === "agent" && editDepartment === "客服部" ? (editSkillGroup || "咨询接待") : "");
                      if (!editPermissionsCustomized) {
                        setEditPermissions(defaultPermissionsForRole(nextRole, editDepartment));
                        setEditShopScope(nextRole === "admin" ? "all" : "assigned");
                        setEditShopScopeIds([]);
                        setEditWorkbenchShopScope("assigned");
                        setEditConversationScope("assigned");
                      }
                    }}>
                      <option value="agent">子账号</option>
                      <option value="admin">管理员账号</option>
                    </select>
                  </label>
                  {editRole === "agent" ? <label>所属部门
                    <select value={editDepartment} disabled={!canManagePermissions} onChange={(event) => {
                      const nextDepartment = event.target.value as UserDepartment;
                      setEditDepartment(nextDepartment);
                      setEditSkillGroup(nextDepartment === "客服部" ? (editSkillGroup || "咨询接待") : "");
                      if (!editPermissionsCustomized) {
                        setEditPermissions(defaultPermissionsForRole(editRole, nextDepartment));
                        setEditWorkbenchShopScope("assigned");
                      }
                    }}>
                      {departments.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label> : null}
                  {editRole === "agent" && editDepartment === "客服部" ? <label>主技能组
                    <select value={editSkillGroup || "咨询接待"} onChange={(event) => setEditSkillGroup(event.target.value as (typeof skillGroups)[number])}>
                      {skillGroups.map((group) => <option key={group} value={group}>{group}</option>)}
                    </select>
                  </label> : null}
                  <label>账号状态
                    <select value={editStatus} disabled={editingUser.systemAdmin} onChange={(event) => setEditStatus(event.target.value)}>
                      <option value="active">启用中</option><option value="disabled">已停用</option>
                    </select>
                  </label>
                  {editPermissions.includes(PERMISSIONS.autoReception) ? <>
                    <label>接待上限<input type="number" min={1} max={50} value={editReceptionLimit} onChange={(event) => setEditReceptionLimit(Number(event.target.value))} /></label>
                  </> : null}
                </div>
              ) : null}
              {editTab === "shops" ? (
                <div className="account-edit-section">
                  <div className="assignment-heading assignment-heading-first"><strong>分配店铺</strong><span>客服工作台或邮件统计选择“仅已分配店铺”时使用此列表</span></div>
                  <div className="shop-assignment-list">
                    {props.shops.map((shop) => <label key={shop.id} className="permission-check"><input type="checkbox" checked={editShopIds.includes(shop.id)} disabled={!canAssignShops} onChange={() => setEditShopIds((current) => current.includes(shop.id) ? current.filter((id) => id !== shop.id) : [...current, shop.id])} /><span>{shop.displayName}</span></label>)}
                    {!props.shops.length ? <Empty text="暂无店铺" /> : null}
                  </div>
                </div>
              ) : null}
              {editTab === "permissions" ? (
                <div className="account-edit-section">
                  <div className="permission-toolbar">
                    <div><strong>{editPermissionsCustomized ? "账号独立权限" : "跟随角色默认权限"}</strong></div>
                    {canEditAccess ? <button type="button" onClick={restoreRolePermissions}><RotateCcw size={14} /> 恢复角色默认</button> : null}
                  </div>
                  <div className="permission-group-list">
                    {permissionGroups.map((group) => <section key={group.label} className="permission-group"><h4>{group.label}</h4><div>{group.items.map((item) => {
                      const fixedCore = Boolean(editingUser.systemAdmin && systemAdminCorePermissions.includes(item.key));
                      const actorCanGrant = Boolean(props.currentUser.role === "admin" || hasPermission(props.currentUser, item.key));
                      return <label key={item.key} className="permission-check"><input type="checkbox" checked={fixedCore || editPermissions.includes(item.key)} disabled={fixedCore || !canEditAccess || !actorCanGrant} onChange={() => toggleEditPermission(item.key)} /><span>{item.label}</span></label>;
                    })}</div>
                    {group.items.some((item) => item.key === PERMISSIONS.shopsView) && editShopManagementEnabled ? (
                      <div className="workbench-scope-settings">
                        <div className="workbench-scope-heading"><strong>店铺与渠道数据范围</strong><span>不影响客服工作台进线范围</span></div>
                        <div className="scope-grid scope-grid-single">
                          <label>可查看和配置的店铺
                            <select value={editShopScope} disabled={!canEditAccess} onChange={(event) => {
                              const nextScope = event.target.value as "assigned" | "selected" | "all";
                              setEditShopScope(nextScope);
                              if (nextScope !== "selected") setEditShopScopeIds([]);
                            }}>
                              <option value="assigned">仅已分配店铺</option>
                              <option value="selected">指定店铺</option>
                              <option value="all">全部店铺</option>
                            </select>
                          </label>
                        </div>
                        {editShopScope === "selected" ? (
                          <div className="shop-scope-selection-list">
                            {props.shops.map((shop) => <label key={shop.id} className="permission-check"><input type="checkbox" checked={editShopScopeIds.includes(shop.id)} disabled={!canEditAccess} onChange={() => setEditShopScopeIds((current) => current.includes(shop.id) ? current.filter((id) => id !== shop.id) : [...current, shop.id])} /><span>{shop.displayName}</span></label>)}
                            {!props.shops.length ? <Empty text="暂无可选店铺" /> : null}
                          </div>
                        ) : null}
                        {editShopScope === "assigned" ? <div className="workbench-scope-note"><ShieldCheck size={15} /><span>店铺分配变化后，此范围自动同步，无需重新设置权限。</span></div> : null}
                        {editShopScope === "all" ? <div className="workbench-scope-warning"><CircleAlert size={15} /><span>该账号可查看并配置系统内全部店铺及渠道。</span></div> : null}
                      </div>
                    ) : null}
                    {group.items.some((item) => item.key === PERMISSIONS.workbenchAccess) && editWorkbenchEnabled ? (
                      <div className="workbench-scope-settings">
                        <div className="workbench-scope-heading"><strong>{editEmailStatisticsEnabled ? "客服工作台与邮件统计数据范围" : "工作台数据范围"}</strong></div>
                        <div className="scope-grid">
                          <label>在线客服店铺范围<select value={editWorkbenchShopScope} disabled={!canEditAccess} onChange={(event) => setEditWorkbenchShopScope(event.target.value as "assigned" | "all")}><option value="assigned">仅已分配店铺</option><option value="all">全部店铺</option></select></label>
                          <label>会话范围<select value={editConversationScope} disabled={!canEditAccess} onChange={(event) => setEditConversationScope(event.target.value as "assigned" | "all")}><option value="assigned">本人接待及排队会话</option><option value="all">可访问店铺的全部会话</option></select></label>
                        </div>
                        {editWorkbenchShopScope === "all" || editConversationScope === "all" ? <div className="workbench-scope-warning"><CircleAlert size={15} /><span>“全部”范围会加载更多工作台店铺或会话，仅建议跨店支援或工作台质检账号使用。</span></div> : null}
                      </div>
                    ) : null}
                    {group.items.some((item) => item.key === PERMISSIONS.emailStatisticsView) && editEmailStatisticsEnabled && !editWorkbenchEnabled && editRole === "agent" ? (
                      <div className="workbench-scope-settings">
                        <div className="workbench-scope-heading"><strong>邮件统计数据范围</strong><span>不授予客服工作台和进线权限</span></div>
                        <div className="scope-grid scope-grid-single">
                          <label>可查看的邮件店铺范围
                            <select value={editWorkbenchShopScope} disabled={!canEditAccess} onChange={(event) => setEditWorkbenchShopScope(event.target.value as "assigned" | "all")}>
                              <option value="assigned">仅已分配店铺</option>
                              <option value="all">全部店铺</option>
                            </select>
                          </label>
                        </div>
                        {editWorkbenchShopScope === "assigned" ? <div className="workbench-scope-note"><ShieldCheck size={15} /><span>店铺分配变化后，邮件统计范围自动同步。</span></div> : null}
                        {editWorkbenchShopScope === "all" ? <div className="workbench-scope-warning"><CircleAlert size={15} /><span>该账号可以查看、标记和导出全部店铺的非客户邮件。</span></div> : null}
                      </div>
                    ) : null}</section>)}
                  </div>
                </div>
              ) : null}
              {editTab === "audit" ? (
                <div className="account-edit-section account-audit-list">
                  {auditLoading ? <Empty text="正在读取操作记录" /> : auditLogs.map((log) => {
                    const actor = props.users.find((user) => user.id === log.actorUserId);
                    return <div className="account-audit-item" key={log.id}>
                      <div><strong>{auditDescription(log)}</strong><span>{actor?.displayName || actor?.email || "已删除账号"}</span></div>
                      <time>{timeLabel(log.createdAt, t)}</time>
                    </div>;
                  })}
                  {!auditLoading && !auditLogs.length ? <Empty text="暂无操作记录" /> : null}
                </div>
              ) : null}
              <div className="drawer-actions account-edit-actions">
                {editTab === "audit" ? (
                  <button type="button" onClick={() => setEditingUser(null)}>关闭</button>
                ) : (
                  <>
                    <button type="button" onClick={() => setEditingUser(null)}>取消</button>
                    <button className="primary" type="submit" disabled={props.busy}>
                      <Save size={15} />
                      {editTab === "basic" ? "保存基本资料" : editTab === "shops" ? "保存店铺分配" : "保存账号权限"}
                    </button>
                  </>
                )}
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {showCreate ? (
        <div className="drawer-backdrop">
          <aside className="account-drawer">
            <div className="drawer-head">
              <h3>添加子账号</h3>
              <button type="button" onClick={() => setShowCreate(false)}><X size={16} /></button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <label>真实姓名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
              <label>邮箱账号<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>{t.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label>{t.role}
                <select value={role} onChange={(event) => {
                  const nextRole = event.target.value as UserRole;
                  setRole(nextRole);
                  if (nextRole === "agent" && department === "客服部" && !skillGroup) setSkillGroup("咨询接待");
                }}>
                  <option value="agent">子账号</option>
                  <option value="admin">管理员账号</option>
                </select>
              </label>
              {role === "agent" ? <label>所属部门
                <select value={department} onChange={(event) => {
                  const nextDepartment = event.target.value as UserDepartment;
                  setDepartment(nextDepartment);
                  setSkillGroup(nextDepartment === "客服部" ? (skillGroup || "咨询接待") : "");
                }}>
                  {departments.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label> : <label>所属部门<input value="系统管理" readOnly /></label>}
              {role === "agent" && department === "客服部" ? <label>主技能组
                <select value={skillGroup} onChange={(event) => setSkillGroup(event.target.value as (typeof skillGroups)[number])}>
                  {skillGroups.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label> : <label>客服进线<input value={role === "admin" ? "管理员不参与客服进线" : "该部门不参与客服进线"} readOnly /></label>}
              <div className="drawer-actions">
                <button type="button" onClick={() => setShowCreate(false)}>取消</button>
                <button className="primary" type="submit" disabled={props.busy}><Plus size={16} /> 保存</button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

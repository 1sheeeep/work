import { Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  memberApplicationAccessApi,
  type MemberApplicationAccess,
  type MemberApplicationPage,
} from "../modules/memberApplicationAccessApi";

const APPLICATION_NAMES: Record<string, string> = {
  ERP: "Xinzhi ERP",
  CHAT: "Xinzhi Chat",
  ZHAOYAOJING: "照妖镜",
  ASSET_REGISTRY: "资产登记",
};

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: MemberApplicationPage };

export function MemberApplicationAccessPage() {
  const { currentTenant, session, hasPermission } = useAuth();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [editing, setEditing] = useState<MemberApplicationAccess | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const availableApplications = useMemo(
    () => session?.applications?.map((application) => application.code) ?? [],
    [session?.applications],
  );
  const canWrite = hasPermission("iam:user:write");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({
        status: "ready",
        data: await memberApplicationAccessApi.list({
          page,
          size: 20,
          query: submittedQuery || undefined,
        }),
      });
    } catch {
      setState({
        status: "error",
        message: "暂时无法读取员工应用权限，请稍后重试。",
      });
    }
  }, [page, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setSubmittedQuery(query.trim());
  };

  const openEditor = (member: MemberApplicationAccess) => {
    setEditing(member);
    setSelected(new Set(member.applications));
    setSaveError(null);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      const access = await memberApplicationAccessApi.replace(editing.id, {
        version: editing.version,
        applications: availableApplications.filter((code) => selected.has(code)),
      });
      setState((current) => current.status !== "ready" ? current : {
        status: "ready",
        data: {
          ...current.data,
          items: current.data.items.map((member) => member.id === editing.id
            ? { ...member, version: access.version, applications: access.applications }
            : member),
        },
      });
      setEditing(null);
    } catch {
      setSaveError("保存失败。权限可能已被其他管理员更新，请关闭后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="one-workspace one-access-page" id="main-content">
      <header className="one-access-heading">
        <div>
          <p className="eyebrow">企业设置</p>
          <h1>员工应用权限</h1>
          <p>维护本系统保存的员工应用访问范围；各业务独立登录，并由各自的角色和店铺权限控制实际操作。</p>
        </div>
        <div className="one-access-tenant"><span>当前企业</span><strong>{currentTenant?.name ?? "—"}</strong></div>
      </header>

      <section className="one-access-card" aria-labelledby="one-access-list-title">
        <div className="one-access-toolbar">
          <div><h2 id="one-access-list-title">员工</h2><span>{state.status === "ready" ? `共 ${state.data.totalElements} 人` : ""}</span></div>
          <form onSubmit={search}>
            <label className="sr-only" htmlFor="one-member-search">搜索员工</label>
            <input id="one-member-search" value={query} maxLength={100} placeholder="姓名、邮箱或手机号" onChange={(event) => setQuery(event.target.value)} />
            <button type="submit"><Search size={16} aria-hidden="true" />搜索</button>
          </form>
        </div>

        {state.status === "loading" && <div className="one-access-state" role="status">正在读取员工权限…</div>}
        {state.status === "error" && <div className="one-access-state is-error" role="alert">{state.message}<button type="button" onClick={() => void load()}>重试</button></div>}
        {state.status === "ready" && state.data.items.length === 0 && <div className="one-access-state">没有找到符合条件的员工。</div>}
        {state.status === "ready" && state.data.items.length > 0 && (
          <div className="one-access-table-wrap">
            <table className="one-access-table">
              <thead><tr><th>员工</th><th>状态</th><th>可用应用</th><th>操作</th></tr></thead>
              <tbody>{state.data.items.map((member) => (
                <tr key={member.id}>
                  <td><strong>{member.displayName}</strong><span>{member.email ?? member.phoneNumber ?? member.username}</span></td>
                  <td><span className={`one-member-status ${member.status === "ACTIVE" ? "is-active" : ""}`}>{member.status === "ACTIVE" ? "启用" : "停用"}</span></td>
                  <td>
                    <div className="one-application-tags">
                      {member.applications.map((code) => <span key={code}>{APPLICATION_NAMES[code] ?? code}</span>)}
                      {member.applications.length === 0 && <span className="is-empty">未分配</span>}
                    </div>
                    {member.enterpriseAdministrator && <small><ShieldCheck size={13} aria-hidden="true" />企业管理员自动拥有全部已开通应用</small>}
                  </td>
                  <td><button className="one-access-edit" type="button" disabled={!canWrite || member.enterpriseAdministrator || member.status !== "ACTIVE"} onClick={() => openEditor(member)}><SlidersHorizontal size={15} aria-hidden="true" />配置</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {state.status === "ready" && state.data.totalPages > 1 && <footer className="one-access-pagination"><span>第 {state.data.page + 1} / {state.data.totalPages} 页</span><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><button type="button" disabled={page + 1 >= state.data.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></footer>}
      </section>

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section className="one-access-dialog" role="dialog" aria-modal="true" aria-labelledby="one-access-dialog-title">
            <header><div><p className="eyebrow">应用权限</p><h2 id="one-access-dialog-title">{editing.displayName}</h2><span>仅列出当前企业已开通的业务系统。</span></div><button type="button" aria-label="关闭" disabled={saving} onClick={() => setEditing(null)}><X size={19} /></button></header>
            <div className="one-access-options">
              {availableApplications.map((code) => <label key={code}><input type="checkbox" checked={selected.has(code)} disabled={saving} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(code); else next.delete(code); return next; })} /><span><strong>{APPLICATION_NAMES[code] ?? code}</strong><small>{code === "ERP" ? "店铺、商品、订单、采购、仓库与物流" : code === "CHAT" ? "客户会话、工单与客服协作" : "独立业务系统"}</small></span></label>)}
            </div>
            {saveError && <div className="one-launch-notice" role="alert">{saveError}</div>}
            <footer><button type="button" disabled={saving} onClick={() => setEditing(null)}>取消</button><button className="is-primary" type="button" disabled={saving} onClick={() => void save()}>{saving ? "正在保存…" : "保存权限"}</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}

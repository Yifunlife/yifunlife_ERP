"use client";
import { type FormEvent, useEffect, useState } from "react";
import { parsePersonnelRows, type PersonnelInput } from "../../lib/personnel-import";
import PasswordField from "../password-field";
type ManagedUser = {
  username: string;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: string | null;
  employeeNo: string;
  email: string;
  name: string;
  role: string;
  status: "pending" | "active" | "suspended";
  createdAt: string;
};
const roleLabel: Record<string, string> = { admin: "管理员", ceo: "CEO", management: "管理层", cost_accountant: "核算人员", employee: "员工" };
export default function PersonnelPage() {
  const [role, setRole] = useState("");
  const [ready, setReady] = useState(false);
  const [staffUsers, setStaffUsers] = useState<ManagedUser[]>([]);
  const [staffError, setStaffError] = useState("");
  const canManageAccounts = role === "admin" || role === "ceo";
  const [accountEdit, setAccountEdit] = useState<{ email: string; username: string; password: string; name: string; employeeNo: string } | null>(null);
  const [addMode, setAddMode] = useState<"" | "single" | "import">("");
  const [newAccount, setNewAccount] = useState<PersonnelInput>({ username: "", name: "", password: "", role: "employee", employeeNo: "" });
  const [importUsers, setImportUsers] = useState<PersonnelInput[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importFile, setImportFile] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const loadStaff = async () => {
    setStaffError("");
    const r = await fetch("/api/admin/users");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStaffError(d.error || "员工列表加载失败。");
      return;
    }
    const users = d.users || [];
    setStaffUsers(users);

  };
  const updateStaffStatus = async (email: string, action: "approve" | "suspend" | "activate") => {
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setStaffError(d.error || "更新员工状态失败。");
    else void loadStaff();
  };
  const updateStaffRole = async (email: string, role: "employee" | "management" | "ceo" | "cost_accountant") => {
    const r = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action: "set_role", role }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setStaffError(d.error || "更新员工权限失败。");
    else void loadStaff();
  };
  const saveAccounts = async (event: FormEvent, editing: boolean) => {
    event.preventDefault();
    setStaffError(""); setAccountNotice(""); setAccountBusy(true);
    try {
      const payload = editing && accountEdit
        ? { email: accountEdit.email, action: "credentials", username: accountEdit.username, name: accountEdit.name, employeeNo: accountEdit.employeeNo, ...(accountEdit.password ? { password: accountEdit.password } : {}) }
        : { users: addMode === "single" ? [newAccount] : importUsers };
      const response = await fetch("/api/admin/users", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          const session = await (await fetch("/api/auth/session")).json();
          if (!session.authenticated) { window.location.assign("/"); return; }
        }
        setStaffError(data.error || "保存失败，请重试。"); return;
      }
      setAccountNotice(editing ? data.credentialsChanged ? "人员信息已更新，该账号需重新登录。" : "人员信息已保存。" : `已添加 ${data.count} 个账号。`);
      if (data.reauthenticate) { window.location.assign("/"); return; }
      if (editing) setAccountEdit(null); else { setNewAccount({ username: "", name: "", password: "", role: "employee", employeeNo: "" }); setImportUsers([]); setImportFile(""); setAddMode(""); }
      await loadStaff();
    } catch { setStaffError("保存失败，请检查网络后重试。"); }
    finally { setAccountBusy(false); }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["用户名", "姓名", "密码", "角色", "工号"]]);
    sheet["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "人员导入");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["填写说明"], ["在人员导入工作表中填写，每行一位人员，每次最多 100 位。"],
      ["用户名", "必填，不分大小写，不能有空格，不能重复，最多 80 位。"],
      ["姓名", "必填，最多 80 位。"], ["密码", "必填，至少 6 位；请将单元格设为文本以保留开头的 0。"],
      ["角色", "员工、管理层、CEO、核算人员；留空默认员工。"], ["工号", "选填，最多 40 位，请使用文本格式保留开头的 0。"],
    ]), "填写说明");
    XLSX.writeFile(workbook, "人员导入模板.xlsx");
  };
  const readImport = async (file: File) => {
    setImportUsers([]); setImportErrors([]); setImportFile(file.name); setStaffError("");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets["人员导入"] || workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
      const result = parsePersonnelRows(rows, staffUsers.map(user => user.username));
      setImportUsers(result.users); setImportErrors(result.errors);
    } catch (error) { setImportErrors([error instanceof Error ? error.message : "文件读取失败，请使用模板重新上传。"]); }
  };

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth/session");
        const session = await response.json();
        if (!session.authenticated) { window.location.assign("/"); return; }
        setRole(session.role);
        if (["admin", "ceo", "management"].includes(session.role)) await loadStaff();
      } catch { setStaffError("页面加载失败，请刷新重试。"); }
      finally { setReady(true); }
    })();
  }, []);
  return <main className="personnelPage">
    <header className="personnelHeader"><div><a href="/">返回报价系统</a><h1>人员及权限</h1>
      <p>{canManageAccounts ? "管理账号、角色与使用权限。密码至少 6 位，修改用户名或密码后需重新登录。" : "管理层可查看人员及权限；账号修改请联系管理员或 CEO。"}</p></div>
      {ready && ["admin", "ceo", "management"].includes(role) && <span>{staffUsers.length} 位人员{!canManageAccounts ? " · 只读" : ""}</span>}
    </header>
    {!ready ? <p role="status">正在加载人员及权限…</p> : !["admin", "ceo", "management"].includes(role) ? <p role="alert">{staffError || "无权查看人员及权限。"}</p> : <section aria-label="人员账号管理">
            {staffError && <div className="loginError">{staffError}</div>}
            {accountNotice && <p role="status">{accountNotice}</p>}
            {canManageAccounts && <div className="personnelAdd">
              <div className="personnelActions">
                <button type="button" className={addMode === "single" ? "primary" : "outline"} onClick={() => { setAddMode("single"); setAccountEdit(null); }}>新增人员</button>
                <button type="button" className={addMode === "import" ? "primary" : "outline"} onClick={() => { setAddMode("import"); setAccountEdit(null); }}>批量导入</button>
              </div>
              {addMode === "single" && <form className="personnelSingle" onSubmit={event => void saveAccounts(event, false)}>
                <h2>新增人员</h2>
                <div className="personnelFormGrid">
                  <label>姓名<input required maxLength={80} value={newAccount.name} onChange={event => setNewAccount({ ...newAccount, name: event.target.value })} /></label>
                  <label>工号（选填）<input maxLength={40} value={newAccount.employeeNo} onChange={event => setNewAccount({ ...newAccount, employeeNo: event.target.value })} /></label>
                  <label>用户名<input required maxLength={80} autoComplete="off" value={newAccount.username} onChange={event => setNewAccount({ ...newAccount, username: event.target.value })} /></label>
                  <PasswordField id="new-account-password" label="密码（至少 6 位）" required minLength={6} autoComplete="new-password" value={newAccount.password} onChange={password => setNewAccount({ ...newAccount, password })} />
                  <label>角色<select value={newAccount.role} onChange={event => setNewAccount({ ...newAccount, role: event.target.value })}><option value="employee">员工</option><option value="management">管理层</option><option value="ceo">CEO</option><option value="cost_accountant">核算人员</option></select></label>
                </div>
                <div className="personnelActions"><button className="primary" disabled={accountBusy}>{accountBusy ? "保存中…" : "添加人员"}</button><button type="button" className="outline" disabled={accountBusy} onClick={() => setAddMode("")}>取消</button></div>
              </form>}
              {addMode === "import" && <form className="personnelImport" onSubmit={event => void saveAccounts(event, false)}>
                <h2>批量导入人员</h2>
                <p>下载模板填写用户名、姓名、密码、角色和工号，每次最多 100 人。上传后预览，确认无误再导入。</p>
                <div className="personnelActions"><button type="button" className="outline" onClick={() => void downloadTemplate()}>下载 Excel 模板</button><label className="personnelFile">上传表格<input type="file" accept=".xlsx,.xls,.csv" disabled={accountBusy} onChange={event => { const file = event.target.files?.[0]; if (file) void readImport(file); event.target.value = ""; }} /></label></div>
                {importFile && <p>{importFile} · {importUsers.length} 位人员</p>}
                {importErrors.length > 0 && <div className="loginError" role="alert">{importErrors.map((error, index) => <p key={index}>{error}</p>)}</div>}
                {importUsers.length > 0 && <div className="personnelTableWrap"><table className="personnelTable"><thead><tr><th>用户名</th><th>姓名 / 工号</th><th>密码</th><th>角色</th></tr></thead><tbody>{importUsers.map((user, index) => <tr key={index}><td>{user.username}</td><td>{user.name}<small className="personnelEmployeeNo">{user.employeeNo || "未填写工号"}</small></td><td>••••••••</td><td>{roleLabel[user.role] || "无效角色"}</td></tr>)}</tbody></table></div>}
                <div className="personnelActions"><button className="primary" disabled={accountBusy || !importUsers.length || importErrors.length > 0}>{accountBusy ? "导入中…" : "确认导入"}</button><button type="button" className="outline" disabled={accountBusy} onClick={() => { setAddMode(""); setImportUsers([]); setImportErrors([]); setImportFile(""); }}>取消</button></div>
              </form>}
            </div>}
            {canManageAccounts && accountEdit && <form className="accountEdit" onSubmit={event => void saveAccounts(event, true)}>
              <strong>修改账号：{staffUsers.find(user => user.email === accountEdit.email)?.name}</strong>
              <label>姓名<input value={accountEdit.name} maxLength={80} required onChange={event => setAccountEdit({ ...accountEdit, name: event.target.value })} /></label>
              <label>工号（选填）<input value={accountEdit.employeeNo} maxLength={40} onChange={event => setAccountEdit({ ...accountEdit, employeeNo: event.target.value })} /></label>
              <label>用户名<input value={accountEdit.username} maxLength={80} required autoComplete="off" onChange={event => setAccountEdit({ ...accountEdit, username: event.target.value })} /></label>
              <PasswordField key={accountEdit.email} id="account-password" label="新密码（留空保留原密码）" minLength={6} autoComplete="new-password" value={accountEdit.password} onChange={password => setAccountEdit({ ...accountEdit, password })} />
              <button className="primary" disabled={accountBusy}>{accountBusy ? "保存中…" : "保存人员信息"}</button>
              <button type="button" className="outline" disabled={accountBusy} onClick={() => setAccountEdit(null)}>取消</button>
            </form>}
            <div className="personnelTableWrap"><table className="personnelTable">
              <thead><tr><th>姓名</th><th>用户名</th><th>邮箱</th><th>角色与权限</th><th>状态</th><th>创建日期</th><th>操作</th></tr></thead>
              <tbody>{staffUsers.map(user => <tr key={user.email}>
                <td><strong>{user.name}</strong><small className="personnelEmployeeNo">工号：{user.employeeNo || "未填写"}</small></td>
                <td className="personnelUsername">{user.username}</td>
                <td className="personnelUsername">{user.recoveryEmail || "未填写"}{user.recoveryEmail && <small className="personnelEmployeeNo">{user.recoveryEmailVerifiedAt ? "已验证" : "待验证"}</small>}</td>
                <td>{canManageAccounts && user.role !== "admin" ? <select aria-label={`${user.name} 的账号权限`} value={user.role} onChange={event => void updateStaffRole(user.email, event.target.value as "employee" | "management" | "ceo" | "cost_accountant")}>
                  <option value="employee">员工</option><option value="cost_accountant">核算人员</option><option value="management">管理层</option><option value="ceo">CEO</option>
                </select> : roleLabel[user.role] || user.role}</td>
                <td><span className={`staffStatus ${user.status}`}>{user.status === "pending" ? "待审批" : user.status === "active" ? "已启用" : "已停用"}</span></td>
                <td>{new Date(user.createdAt).toLocaleDateString("zh-CN")}</td>
                <td><div className="personnelActions">
                  {canManageAccounts && <button className="outline" onClick={() => { setAddMode(""); setAccountEdit({ email: user.email, username: user.username, password: "", name: user.name, employeeNo: user.employeeNo || "" }); setAccountNotice(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>编辑人员</button>}
                  {canManageAccounts && user.role !== "admin" && <button className="outline" onClick={() => void updateStaffStatus(user.email, user.status === "pending" ? "approve" : user.status === "active" ? "suspend" : "activate")}>{user.status === "pending" ? "批准" : user.status === "active" ? "停用" : "启用"}</button>}
                </div></td>
              </tr>)}</tbody>
            </table></div>
            {!staffUsers.length && !staffError && <p className="staffEmpty">暂无人员账号。</p>}
    </section>}
  </main>;
}

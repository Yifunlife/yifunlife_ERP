export type PersonnelInput = { username: string; name: string; password: string; role: string; employeeNo: string };
export const personnelRoles: Record<string, string> = { 员工: "employee", 管理层: "management", CEO: "ceo", 核算人员: "cost_accountant", employee: "employee", management: "management", ceo: "ceo", cost_accountant: "cost_accountant" };
export function parsePersonnelRows(rows: string[][], existing: string[]) {
  if (rows.length < 2 || ["用户名", "姓名", "密码", "角色", "工号"].some((header, index) => rows[0]?.[index]?.trim() !== header)) throw new Error("请使用导入模板，表头依次为：用户名、姓名、密码、角色、工号。");
  const seen = new Set(existing.map(value => value.trim().toLowerCase()));
  const users: PersonnelInput[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((row, index) => {
    if (row.every(value => !String(value).trim())) return;
    const [username = "", name = "", password = "", role = "", employeeNo = ""] = row;
    const user = { employeeNo: employeeNo.trim(), username: username.trim().toLowerCase(), name: name.trim(), password, role: (Object.hasOwn(personnelRoles, role.trim()) ? personnelRoles[role.trim()] : role.trim() ? "" : "employee") };
    if (!user.username || user.username.length > 80 || /\s/.test(user.username)) errors.push(`第 ${index + 2} 行：用户名为 1–80 位，不能包含空格。`);
    if (user.employeeNo.length > 40) errors.push(`第 ${index + 2} 行：工号最多 40 位。`);
    if (!user.name || user.name.length > 80) errors.push(`第 ${index + 2} 行：姓名为 1–80 位。`);
    if (user.password.length < 6) errors.push(`第 ${index + 2} 行：密码至少 6 位。`);
    if (!user.role) errors.push(`第 ${index + 2} 行：角色无效，请填写员工、管理层、CEO 或核算人员。`);
    if (seen.has(user.username)) errors.push(`第 ${index + 2} 行：用户名重复或已存在。`);
    seen.add(user.username); users.push(user);
  });
  if (!users.length || users.length > 100) errors.unshift("每次请导入 1–100 位人员。");
  return { users, errors };
}

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers, loginSessions } from "../../../../db/schema";
import { ADMIN_EMAIL, getLoginSession, createPasswordRecord, normalizeEmail, passwordError } from "../../../../lib/auth";

async function requireAdmin(request: Request) {
  const session = await getLoginSession(request);
  return session?.role === "admin" || session?.role === "ceo" ? session : null;
}

async function requireStaffViewer(request: Request) {
  const session = await getLoginSession(request);
  return session?.role === "admin" || session?.role === "management" || session?.role === "ceo" ? session : null;
}

export async function GET(request: Request) {
  if (!(await requireStaffViewer(request))) return Response.json({ error: "无权限" }, { status: 403 });
  const users = await getDb().select({ email: appUsers.email, username: appUsers.username, recoveryEmail: appUsers.recoveryEmail, recoveryEmailVerifiedAt: appUsers.recoveryEmailVerifiedAt, employeeNo: appUsers.employeeNo, name: appUsers.name, role: appUsers.role, status: appUsers.status, createdAt: appUsers.createdAt }).from(appUsers).orderBy(desc(appUsers.createdAt));
  return Response.json({ users });
}

export async function PATCH(request: Request) {
  const session = await requireAdmin(request);
  if (!session) return Response.json({ error: "登录已过期或无管理权限，请重新登录。" }, { status: 403 });
  const { email, action, role, username, password, name, employeeNo } = await request.json() as {
    email?: string;
    action?: "approve" | "suspend" | "activate" | "set_role" | "credentials";
    username?: string;
    name?: string;
    employeeNo?: string;
    password?: string;
    role?: "employee" | "management" | "ceo" | "cost_accountant";
  };
  if (!email || !action) return Response.json({ error: "请求无效" }, { status: 400 });
  if (email === ADMIN_EMAIL && (action === "suspend" || action === "set_role")) return Response.json({ error: "唯一管理员账号不能修改" }, { status: 400 });
  const db = getDb();
  const target = await db.select().from(appUsers).where(eq(appUsers.email, email)).get();
  if (!target) return Response.json({ error: "账号不存在。" }, { status: 404 });
  if (action === "credentials") {
    const login = typeof username === "string" ? normalizeEmail(username) : "";
    if (!login || login.length > 80 || /\s/.test(login)) return Response.json({ error: "用户名为 1–80 位，不能包含空格。" }, { status: 400 });
    if (password !== undefined && (typeof password !== "string" || passwordError(password))) return Response.json({ error: "密码至少需要 6 位。" }, { status: 400 });
    const existing = await db.select().from(appUsers).where(eq(appUsers.username, login)).get();
    if (existing && existing.email !== email) return Response.json({ error: "用户名已存在。" }, { status: 409 });
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 80)) return Response.json({ error: "姓名为 1–80 位。" }, { status: 400 });
    if (employeeNo !== undefined && (typeof employeeNo !== "string" || employeeNo.trim().length > 40)) return Response.json({ error: "工号最多 40 位。" }, { status: 400 });
    const profile = { ...(password ? { mustChangePassword: true } : {}), ...(name !== undefined ? { name: name.trim() } : {}), ...(employeeNo !== undefined ? { employeeNo: employeeNo.trim() } : {}) };
    const record = password ? await createPasswordRecord(password) : {};
    const credentialsChanged = login !== target.username || password !== undefined;
    const update = db.update(appUsers).set({ username: login, ...profile, ...record, updatedAt: new Date().toISOString() }).where(eq(appUsers.email, email));
    if (credentialsChanged) {
      await db.batch([update, db.delete(loginSessions).where(eq(loginSessions.username, email))]);
    } else {
      await update;
    }
    return Response.json({ ok: true, credentialsChanged, reauthenticate: credentialsChanged && session.email === email });
  }
  if (!["approve", "suspend", "activate", "set_role"].includes(action)) return Response.json({ error: "操作无效。" }, { status: 400 });
  if (action === "set_role") {
    if (role !== "employee" && role !== "management" && role !== "ceo" && role !== "cost_accountant") return Response.json({ error: "角色无效" }, { status: 400 });
    await getDb().update(appUsers).set({ role, updatedAt: new Date().toISOString() }).where(eq(appUsers.email, email));
    return Response.json({ ok: true });
  }
  const status = action === "suspend" ? "suspended" : "active";
  await getDb().update(appUsers).set({ status, updatedAt: new Date().toISOString() }).where(eq(appUsers.email, email));
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request))) return Response.json({ error: "无权限" }, { status: 403 });
  const body = await request.json();
  if (!Array.isArray(body.users) || !body.users.length || body.users.length > 100) return Response.json({ error: "每次可添加 1–100 个账号。" }, { status: 400 });
  const db = getDb();
  const seen = new Set<string>();
  const prepared = [];
  for (let i = 0; i < body.users.length; i++) {
    const row = body.users[i];
    const username = typeof row?.username === "string" ? normalizeEmail(row.username) : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const role = row?.role || "employee";
    const employeeNo = row?.employeeNo === undefined ? "" : typeof row.employeeNo === "string" ? row.employeeNo.trim() : null;
    if (employeeNo === null || employeeNo.length > 40) return Response.json({ error: `第 ${i + 1} 行工号最多 40 位。` }, { status: 400 });
    if (!username || username.length > 80 || /\s/.test(username) || !name || name.length > 80 || typeof row.password !== "string" || passwordError(row.password) || !["employee", "management", "ceo", "cost_accountant"].includes(role)) return Response.json({ error: `第 ${i + 1} 行无效：请检查用户名、姓名、至少 6 位密码及角色。` }, { status: 400 });
    if (seen.has(username) || await db.select().from(appUsers).where(eq(appUsers.username, username)).get()) return Response.json({ error: `第 ${i + 1} 行用户名重复，未添加任何账号。` }, { status: 409 });
    seen.add(username);
    const now = new Date().toISOString();
    prepared.push({ email: `account:${crypto.randomUUID()}`, username, name, employeeNo, role, mustChangePassword: true, status: "active", ...(await createPasswordRecord(row.password)), createdAt: now, updatedAt: now });
  }
  try {
    const [first, ...rest] = prepared.map(user => db.insert(appUsers).values(user));
    await db.batch([first, ...rest]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "用户名重复，未添加任何账号。" }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true, count: prepared.length });
}

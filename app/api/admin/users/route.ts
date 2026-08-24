import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";
import { ADMIN_EMAIL, getLoginSession } from "../../../../lib/auth";

async function requireAdmin(request: Request) {
  const session = await getLoginSession(request);
  return session?.role === "admin" ? session : null;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(request))) return Response.json({ error: "无权限" }, { status: 403 });
  const users = await getDb().select({ email: appUsers.email, name: appUsers.name, role: appUsers.role, status: appUsers.status, createdAt: appUsers.createdAt }).from(appUsers).orderBy(desc(appUsers.createdAt));
  return Response.json({ users });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(request))) return Response.json({ error: "无权限" }, { status: 403 });
  const { email, action, role } = await request.json() as {
    email?: string;
    action?: "approve" | "suspend" | "activate" | "set_role";
    role?: "employee" | "management";
  };
  if (!email || !action) return Response.json({ error: "请求无效" }, { status: 400 });
  if (email === ADMIN_EMAIL && (action === "suspend" || action === "set_role")) return Response.json({ error: "唯一管理员账号不能修改" }, { status: 400 });
  if (action === "set_role") {
    if (role !== "employee" && role !== "management") return Response.json({ error: "角色无效" }, { status: 400 });
    await getDb().update(appUsers).set({ role, updatedAt: new Date().toISOString() }).where(eq(appUsers.email, email));
    return Response.json({ ok: true });
  }
  const status = action === "suspend" ? "suspended" : "active";
  await getDb().update(appUsers).set({ status, updatedAt: new Date().toISOString() }).where(eq(appUsers.email, email));
  return Response.json({ ok: true });
}

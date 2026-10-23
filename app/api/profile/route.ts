import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appUsers, loginSessions, passwordResetTokens } from "../../../db/schema";
import { getLoginSession, createPasswordRecord, passwordMatches, passwordError } from "../../../lib/auth";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401 });
  const user = await getDb().select({ name: appUsers.name, username: appUsers.username, employeeNo: appUsers.employeeNo, role: appUsers.role, mustChangePassword: appUsers.mustChangePassword, recoveryEmail: appUsers.recoveryEmail, recoveryEmailVerifiedAt: appUsers.recoveryEmailVerifiedAt }).from(appUsers).where(eq(appUsers.email, session.email)).get();
  return Response.json({ user });
}

export async function PATCH(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401 });
  const { currentPassword, password, confirmPassword } = await request.json();
  if (typeof currentPassword !== "string" || !currentPassword || typeof password !== "string") return Response.json({ error: "请填写原密码和新密码。" }, { status: 400 });
  const invalid = passwordError(password);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  if (password === currentPassword) return Response.json({ error: "新密码不能与当前密码相同。" }, { status: 400 });
  if (password !== confirmPassword) return Response.json({ error: "两次新密码输入不一致。" }, { status: 400 });
  const db = getDb();
  const user = await db.select().from(appUsers).where(eq(appUsers.email, session.email)).get();
  if (!user || !(await passwordMatches(currentPassword, user.passwordHash, user.passwordSalt))) return Response.json({ error: "原密码不正确。" }, { status: 400 });
  await db.batch([
    db.update(appUsers).set({ mustChangePassword: false, ...(await createPasswordRecord(password)), updatedAt: new Date().toISOString() }).where(eq(appUsers.email, session.email)),
    db.delete(loginSessions).where(eq(loginSessions.username, session.email)),
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, session.email)),
  ]);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": "yifun_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" } });
}

import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";
import {
  SESSION_SECONDS,
  createLoginSession,
  ensureAdminUser,
  normalizeEmail,
  passwordMatches,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  const { email, username, password } = await request.json() as { email?: string; username?: string; password?: string };
  try {
    await ensureAdminUser();
  } catch {
    return Response.json({ error: "登录配置未加载，请联系管理员" }, { status: 503 });
  }
  const user = await getDb().select().from(appUsers).where(eq(appUsers.email, normalizeEmail(email || username || ""))).get();
  if (!user || !password || !(await passwordMatches(password, user.passwordHash, user.passwordSalt)))
    return Response.json({ error: "账户或密码不正确" }, { status: 401 });
  if (user.status === "pending")
    return Response.json({ error: "账号已注册，等待管理员批准后使用。" }, { status: 403 });
  if (user.status !== "active")
    return Response.json({ error: "账号已停用，请联系管理员。" }, { status: 403 });
  const { token, expiresAt } = await createLoginSession(user.email);
  return Response.json(
    { ok: true, email: user.email, name: user.name, role: user.role, expiresAt },
    { headers: { "Set-Cookie": `yifun_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}` } },
  );
}

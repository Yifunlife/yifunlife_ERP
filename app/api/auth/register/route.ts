import { env } from "cloudflare:workers";
import { ADMIN_EMAIL, createPasswordRecord, normalizeEmail, passwordError } from "../../../../lib/auth";

export async function POST(request: Request) {
  const { name, email, password } = await request.json() as { name?: string; email?: string; password?: string };
  const normalizedEmail = normalizeEmail(email || "");
  const normalizedName = name?.trim() || "";
  if (!normalizedName || normalizedName.length > 80 || !/^\S+@\S+\.\S+$/.test(normalizedEmail))
    return Response.json({ error: "请填写有效的姓名和邮箱。" }, { status: 400 });
  const invalidPassword = passwordError(password || "");
  if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
  if (normalizedEmail === ADMIN_EMAIL)
    return Response.json({ error: "管理员账号已预设，请使用找回密码。" }, { status: 409 });
  if (!env.DB) return Response.json({ error: "账户数据库连接未配置，请联系管理员。" }, { status: 503 });
  if (await env.DB.prepare("SELECT email FROM app_users WHERE email = ?").bind(normalizedEmail).first())
    return Response.json({ error: "该邮箱已经注册，请登录或找回密码。" }, { status: 409 });
  const now = new Date().toISOString();
  const record = await createPasswordRecord(password || "");
  await env.DB.prepare("INSERT INTO app_users (email, name, password_hash, password_salt, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'employee', 'pending', ?, ?)")
    .bind(normalizedEmail, normalizedName, record.passwordHash, record.passwordSalt, now, now)
    .run();
  return Response.json({ ok: true, message: "注册成功，等待管理员批准后即可使用。" });
}

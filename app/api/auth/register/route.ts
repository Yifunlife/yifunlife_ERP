import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";
import { ADMIN_EMAIL, createPasswordRecord, ensureAuthSchema, normalizeEmail, passwordError } from "../../../../lib/auth";

export async function POST(request: Request) {
  await ensureAuthSchema();
  const { name, email, password } = await request.json() as { name?: string; email?: string; password?: string };
  const normalizedEmail = normalizeEmail(email || "");
  const normalizedName = name?.trim() || "";
  if (!normalizedName || normalizedName.length > 80 || !/^\S+@\S+\.\S+$/.test(normalizedEmail))
    return Response.json({ error: "请填写有效的姓名和邮箱。" }, { status: 400 });
  const invalidPassword = passwordError(password || "");
  if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
  if (normalizedEmail === ADMIN_EMAIL)
    return Response.json({ error: "管理员账号已预设，请使用找回密码。" }, { status: 409 });
  const db = getDb();
  if (await db.select({ email: appUsers.email }).from(appUsers).where(eq(appUsers.email, normalizedEmail)).get())
    return Response.json({ error: "该邮箱已经注册，请登录或找回密码。" }, { status: 409 });
  const now = new Date().toISOString();
  await db.insert(appUsers).values({
    email: normalizedEmail,
    name: normalizedName,
    ...(await createPasswordRecord(password || "")),
    role: "employee",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ ok: true, message: "注册成功，等待管理员批准后即可使用。" });
}

import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers, emailVerificationTokens, passwordResetTokens } from "../../../../db/schema";
import { getLoginSession, hash, normalizeEmail, passwordMatches, sendAccountEmail } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401 });
  const { email, currentPassword } = await request.json();
  const address = typeof email === "string" ? normalizeEmail(email) : "";
  if (!/^\S+@\S+\.\S+$/.test(address) || address.length > 254) return Response.json({ error: "请填写有效邮箱。" }, { status: 400 });
  const db = getDb();
  const user = await db.select().from(appUsers).where(eq(appUsers.email, session.email)).get();
  if (!user || typeof currentPassword !== "string" || !(await passwordMatches(currentPassword, user.passwordHash, user.passwordSalt))) return Response.json({ error: "原密码不正确。" }, { status: 400 });
  const existing = await db.select().from(appUsers).where(eq(appUsers.recoveryEmail, address)).get();
  if (existing && existing.email !== session.email) return Response.json({ error: "该邮箱已关联其他账号。" }, { status: 409 });
  const pending = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.owner, session.email)).get();
  if (pending && Date.now() - Date.parse(pending.createdAt) < 60000) return Response.json({ error: "请间隔 60 秒后重新发送。" }, { status: 429 });
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(random % 1000000).padStart(6, "0");
  const now = new Date().toISOString();
  await db.insert(emailVerificationTokens).values({ owner: session.email, email: address, codeHash: await hash(`${session.email}:${code}`), createdAt: now, expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), attempts: 0 }).onConflictDoUpdate({ target: emailVerificationTokens.owner, set: { email: address, codeHash: await hash(`${session.email}:${code}`), createdAt: now, expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), attempts: 0 } });
  try {
    await sendAccountEmail(address, "验证 Yifun Life 找回密码邮箱", `您的邮箱验证码为：${code}，10 分钟内有效。如非本人操作，请忽略此邮件。`);
  } catch {
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.owner, session.email));
    return Response.json({ error: "验证邮件发送失败，请稍后重试。" }, { status: 503 });
  }
  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "登录已过期，请重新登录。" }, { status: 401 });
  const { code } = await request.json();
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return Response.json({ error: "请输入邮件中的 6 位验证码。" }, { status: 400 });
  const db = getDb();
  const pending = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.owner, session.email)).get();
  if (!pending || Date.parse(pending.expiresAt) <= Date.now() || pending.attempts >= 5) return Response.json({ error: "验证码已失效，请重新发送。" }, { status: 400 });
  const attempted = await db.update(emailVerificationTokens).set({ attempts: sql`${emailVerificationTokens.attempts} + 1` }).where(and(eq(emailVerificationTokens.owner, session.email), eq(emailVerificationTokens.codeHash, pending.codeHash), lt(emailVerificationTokens.attempts, 5))).returning({ owner: emailVerificationTokens.owner });
  if (!attempted.length || await hash(`${session.email}:${code}`) !== pending.codeHash) return Response.json({ error: "验证码不正确，请重试。" }, { status: 400 });
  try {
    await db.batch([
      db.update(appUsers).set({ recoveryEmail: pending.email, recoveryEmailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(appUsers.email, session.email)),
      db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.owner, session.email)),
      db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, session.email)),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "该邮箱已关联其他账号。" }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true, recoveryEmail: pending.email });
}

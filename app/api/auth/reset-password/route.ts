import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers, loginSessions, passwordResetTokens } from "../../../../db/schema";
import { createPasswordRecord, hash, passwordError } from "../../../../lib/auth";

export async function POST(request: Request) {
  const { token, password } = await request.json() as { token?: string; password?: string };
  const invalidPassword = passwordError(password || "");
  if (invalidPassword) return Response.json({ error: invalidPassword }, { status: 400 });
  if (!token) return Response.json({ error: "重设链接无效或已过期。" }, { status: 400 });
  const db = getDb();
  const tokenHash = await hash(token);
  const reset = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).get();
  if (!reset || new Date(reset.expiresAt).getTime() <= Date.now()) {
    if (reset) await db.delete(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
    return Response.json({ error: "重设链接无效或已过期。" }, { status: 400 });
  }
  const record = await createPasswordRecord(password || "");
  const consumed = await db.delete(passwordResetTokens).where(and(eq(passwordResetTokens.tokenHash, tokenHash), gt(passwordResetTokens.expiresAt, new Date().toISOString()))).returning({ email: passwordResetTokens.email });
  if (!consumed.length) return Response.json({ error: "重设链接无效或已过期。" }, { status: 400 });
  const updated = await db.update(appUsers).set({ mustChangePassword: false, ...record, updatedAt: new Date().toISOString() }).where(and(
    eq(appUsers.email, reset.email), eq(appUsers.status, "active"),
  )).returning({ email: appUsers.email });
  if (!updated.length) return Response.json({ error: "重设链接无效或已过期。" }, { status: 400 });
  await db.batch([
    db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, reset.email)),
    db.delete(loginSessions).where(eq(loginSessions.username, reset.email)),
  ]);
  return Response.json({ ok: true, message: "密码已更新，请使用新密码登录。" });
}

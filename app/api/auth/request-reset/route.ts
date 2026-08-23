import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appUsers } from "../../../../db/schema";
import { createPasswordReset, ensureAdminUser, normalizeEmail, sendPasswordResetEmail } from "../../../../lib/auth";

const generic = { ok: true, message: "如该邮箱已获批准，重设密码链接将发送至邮箱。" };

export async function POST(request: Request) {
  const { email } = await request.json() as { email?: string };
  const normalizedEmail = normalizeEmail(email || "");
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return Response.json(generic);
  try {
    await ensureAdminUser();
    const user = await getDb().select().from(appUsers).where(eq(appUsers.email, normalizedEmail)).get();
    if (user?.status === "active") {
      const token = await createPasswordReset(user.email);
      await sendPasswordResetEmail(user.email, token, new URL(request.url).origin);
    }
  } catch (error) {
    console.error("Password reset email failed", error);
    return Response.json({ error: "邮件发送服务尚未启用，请联系管理员。" }, { status: 503 });
  }
  return Response.json(generic);
}

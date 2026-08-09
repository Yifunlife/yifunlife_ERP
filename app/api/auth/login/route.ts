import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { loginSessions } from "../../../../db/schema";

const SESSION_SECONDS = 30 * 60;
const bytesToHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export async function POST(request: Request) {
  const { username, password } = await request.json() as { username?: string; password?: string };
  const credentials = env as unknown as { APP_LOGIN_USERNAME?: string; APP_LOGIN_PASSWORD?: string };
  if (username !== credentials.APP_LOGIN_USERNAME || password !== credentials.APP_LOGIN_PASSWORD) return Response.json({ error: "账户或密码不正确" }, { status: 401 });
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await getDb().insert(loginSessions).values({ tokenHash: await hash(token), username, expiresAt });
  return Response.json({ ok: true, expiresAt }, { headers: { "Set-Cookie": `yifun_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}` } });
}

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { loginSessions } from "../db/schema";

const readCookie = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("yifun_session="))?.slice("yifun_session=".length) || "";
const bytesToHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export async function getLoginSession(request: Request) {
  const token = readCookie(request); if (!token) return null;
  const tokenHash = await hash(token); const db = getDb();
  const session = await db.select().from(loginSessions).where(eq(loginSessions.tokenHash, tokenHash)).get();
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) { if (session) await db.delete(loginSessions).where(eq(loginSessions.tokenHash, tokenHash)); return null; }
  return session;
}

export async function removeLoginSession(request: Request) {
  const token = readCookie(request); if (token) await getDb().delete(loginSessions).where(eq(loginSessions.tokenHash, await hash(token)));
}

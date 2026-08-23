import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appUsers, loginSessions, passwordResetTokens } from "../db/schema";

export const AUTHENTICATION_ENABLED = true;
export const ADMIN_EMAIL = "yifunlife@hotmail.com";
export const SESSION_SECONDS = 30 * 60;
export const RESET_SECONDS = 30 * 60;

type AuthBindings = {
  INITIAL_ADMIN_PASSWORD?: string;
  BREVO_API_KEY?: string;
};

const encoder = new TextEncoder();
const readCookie = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("yifun_session="))
    ?.slice("yifun_session=".length) || "";
const bytesToHex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const hexToBytes = (value: string) => {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const hash = async (value: string) =>
  bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const sameHash = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};
const randomToken = () =>
  crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");

export const passwordError = (password: string) =>
  password.length < 10 ? "密码至少需要 10 位。" : "";

async function derivePasswordHash(password: string, salt: Uint8Array) {
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]),
    256,
  );
}

export async function createPasswordRecord(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derivePasswordHash(password, salt);
  return { passwordHash: bytesToHex(bits), passwordSalt: bytesToHex(salt.buffer) };
}

export async function passwordMatches(password: string, passwordHash: string, passwordSalt: string) {
  const bits = await derivePasswordHash(password, hexToBytes(passwordSalt));
  return sameHash(bytesToHex(bits), passwordHash);
}

export async function ensureAdminUser() {
  const db = getDb();
  const existing = await db.select().from(appUsers).where(eq(appUsers.email, ADMIN_EMAIL)).get();
  if (existing) return existing;
  const password = (env as unknown as AuthBindings).INITIAL_ADMIN_PASSWORD;
  if (!password) throw new Error("INITIAL_ADMIN_PASSWORD_MISSING");
  const record = await createPasswordRecord(password);
  const now = new Date().toISOString();
  await db.insert(appUsers).values({
    email: ADMIN_EMAIL,
    name: "Yifun Life Administrator",
    ...record,
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return db.select().from(appUsers).where(eq(appUsers.email, ADMIN_EMAIL)).get();
}

export async function getLoginSession(request: Request) {
  const token = readCookie(request);
  if (!token) return null;
  const tokenHash = await hash(token);
  const db = getDb();
  const session = await db.select().from(loginSessions).where(eq(loginSessions.tokenHash, tokenHash)).get();
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    if (session) await db.delete(loginSessions).where(eq(loginSessions.tokenHash, tokenHash));
    return null;
  }
  const user = await db.select().from(appUsers).where(eq(appUsers.email, session.username)).get();
  if (!user || user.status !== "active") {
    await db.delete(loginSessions).where(eq(loginSessions.tokenHash, tokenHash));
    return null;
  }
  return { ...session, email: user.email, name: user.name, role: user.role };
}

export async function createLoginSession(email: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await getDb().insert(loginSessions).values({ tokenHash: await hash(token), username: email, expiresAt });
  return { token, expiresAt };
}

export async function removeLoginSession(request: Request) {
  const token = readCookie(request);
  if (token) await getDb().delete(loginSessions).where(eq(loginSessions.tokenHash, await hash(token)));
}

export async function createPasswordReset(email: string) {
  const db = getDb();
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, email));
  const token = randomToken();
  const now = new Date().toISOString();
  await db.insert(passwordResetTokens).values({
    tokenHash: await hash(token), email, createdAt: now,
    expiresAt: new Date(Date.now() + RESET_SECONDS * 1000).toISOString(),
  });
  return token;
}

export async function sendPasswordResetEmail(email: string, token: string, origin: string) {
  const apiKey = (env as unknown as AuthBindings).BREVO_API_KEY;
  if (!apiKey) throw new Error("邮件发送服务尚未配置");
  const link = `${origin.replace(/\/$/, "")}/?reset=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Yifun Life", email: "yifunlife@hotmail.com" },
      to: [{ email }],
      subject: "重设 Yifun Life 产品报价系统密码",
      textContent: `请在 30 分钟内打开此链接重设密码：${link}`,
      htmlContent: `<p>请在 30 分钟内打开下面链接重设 Yifun Life 产品报价系统密码：</p><p><a href="${link}">重设密码 / Reset password</a></p>`,
    }),
  });
  if (!response.ok) throw new Error(`Brevo email request failed: ${response.status}`);
}

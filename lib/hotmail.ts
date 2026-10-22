import { env } from "cloudflare:workers";

type MailBindings = {
  MICROSOFT_CLIENT_ID?: string;
  MAIL_TOKEN_KEY?: string;
};
const bindings = () => env as typeof env & MailBindings;
export const mailScope = "offline_access User.Read Mail.Send";
const authority = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const encoder = new TextEncoder();

export const mailConfigured = () => {
  const b = bindings();
  return Boolean(b.MICROSOFT_CLIENT_ID && b.MAIL_TOKEN_KEY);
};
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export function base64(bytes: Uint8Array) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 8192)
    value += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(value);
}
export function unbase64(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
export async function sha256(value: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer)), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function tokenKey() {
  const raw = unbase64(bindings().MAIL_TOKEN_KEY || "");
  if (raw.length !== 32) throw new Error("邮箱加密配置无效，请联系管理员");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptToken(value: string, owner: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(owner) }, await tokenKey(), encoder.encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}
async function decryptToken(value: string, owner: string) {
  const [iv, cipher] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv), additionalData: encoder.encode(owner) }, await tokenKey(), unbase64(cipher)));
}
async function exchange(params: Record<string, string>) {
  const b = bindings();
  const response = await fetch(`${authority}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: b.MICROSOFT_CLIENT_ID!, scope: mailScope, ...params }),
  });
  if (!response.ok) throw new Error("微软邮箱授权已失效或被拒绝，请重新连接 Hotmail");
  const data = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!data.access_token) throw new Error("微软未返回有效的邮箱授权，请重新连接");
  return data as { access_token: string; refresh_token?: string; scope?: string };
}
async function saveConnection(owner: string, token: { access_token: string; refresh_token?: string; scope?: string }) {
  if (!token.refresh_token || !token.scope?.toLowerCase().split(" ").some(scope => scope === "mail.send" || scope.endsWith("/mail.send")))
    throw new Error("请允许系统发送邮件后重新连接");
  const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error("无法读取授权邮箱，请重新连接");
  const profile = await profileResponse.json() as { id: string; mail?: string; userPrincipalName?: string };
  const address = (profile.mail || profile.userPrincipalName || "").toLowerCase();
  if (!/^[^\s@]+@(hotmail|outlook|live|msn)\.[a-z.]+$/i.test(address)) throw new Error("请使用业务员本人的 Hotmail 或 Outlook 个人邮箱");
  const existing = await env.DB.prepare("SELECT owner FROM mail_connections WHERE provider_user_id = ? AND owner <> ?").bind(profile.id, owner).first();
  if (existing) throw new Error("此邮箱已连接另一位员工，请使用自己的邮箱");
  await env.DB.prepare("INSERT INTO mail_connections (owner, provider_user_id, address, refresh_token, connected_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner) DO UPDATE SET provider_user_id=excluded.provider_user_id, address=excluded.address, refresh_token=excluded.refresh_token, connected_at=excluded.connected_at")
    .bind(owner, profile.id, address, await encryptToken(token.refresh_token, owner), new Date().toISOString()).run();
}
export async function beginDeviceAuthorization(owner: string) {
  if (!mailConfigured()) throw new Error("管理员尚未配置微软邮箱授权");
  const response = await fetch(`${authority}/devicecode`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: bindings().MICROSOFT_CLIENT_ID!, scope: mailScope }) });
  if (!response.ok) throw new Error("无法发起微软授权，请稍后重试或联系管理员核对应用配置");
  const device = await response.json() as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval?: number };
  // Never return the private device_code to the browser. It is bound to this
  // employee and encrypted with the same authenticated encryption as tokens.
  if (!device.device_code || !device.user_code || !/^https:\/\/(www\.)?microsoft\.com\//.test(device.verification_uri)) throw new Error("微软未返回有效授权入口");
  const state = crypto.randomUUID();
  const interval = Math.max(5, device.interval || 5);
  const expiresAt = Date.now() + Math.min(900, device.expires_in) * 1000;
  await env.DB.prepare("DELETE FROM mail_oauth_states WHERE owner = ? OR expires_at < ?").bind(owner, Date.now()).run();
  await env.DB.prepare("INSERT INTO mail_oauth_states (state, owner, verifier, expires_at, next_poll_at, poll_interval) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(state, owner, await encryptToken(device.device_code, owner), expiresAt, Date.now() + interval * 1000, interval).run();
  return { state, userCode: device.user_code, verificationUri: device.verification_uri, expiresAt, interval };
}
export async function pollDeviceAuthorization(owner: string, state: string) {
  const now = Date.now();
  const row = await env.DB.prepare("UPDATE mail_oauth_states SET next_poll_at = ? + poll_interval * 1000 WHERE state = ? AND owner = ? AND expires_at > ? AND next_poll_at <= ? RETURNING verifier, poll_interval")
    .bind(now, state, owner, now, now).first<{ verifier: string; poll_interval: number }>();
  if (!row) {
    const pending = await env.DB.prepare("SELECT expires_at FROM mail_oauth_states WHERE state = ? AND owner = ? AND expires_at > ?").bind(state, owner, now).first();
    if (pending) return { status: "pending" };
    throw new Error("授权链接已过期，请重新连接 Hotmail");
  }
  const b = bindings();
  const response = await fetch(`${authority}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: b.MICROSOFT_CLIENT_ID!, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: await decryptToken(row.verifier, owner) }) });
  const token = await response.json() as { error?: string; access_token?: string; refresh_token?: string; scope?: string };
  if (token.error === "authorization_pending") return { status: "pending" };
  if (token.error === "slow_down") {
    await env.DB.prepare("UPDATE mail_oauth_states SET poll_interval = poll_interval + 5, next_poll_at = ? WHERE state = ? AND owner = ?").bind(now + (row.poll_interval + 5) * 1000, state, owner).run();
    return { status: "pending" };
  }
  if (!response.ok || !token.access_token) {
    await env.DB.prepare("DELETE FROM mail_oauth_states WHERE state = ? AND owner = ?").bind(state, owner).run();
    throw new Error("授权已取消或失败，请重新连接 Hotmail");
  }
  await saveConnection(owner, { ...token, access_token: token.access_token });
  await env.DB.prepare("DELETE FROM mail_oauth_states WHERE state = ? AND owner = ?").bind(state, owner).run();
  return { status: "connected", connection: await mailbox(owner) };
}
export async function mailbox(owner: string) {
  return env.DB.prepare("SELECT address, connected_at FROM mail_connections WHERE owner = ?").bind(owner).first<{ address: string; connected_at: string }>();
}
export async function mailboxAccess(owner: string) {
  const connection = await env.DB.prepare("SELECT address, refresh_token FROM mail_connections WHERE owner = ?").bind(owner).first<{ address: string; refresh_token: string }>();
  if (!connection) throw new Error("请先连接自己的 Hotmail 邮箱");
  const token = await exchange({ grant_type: "refresh_token", refresh_token: await decryptToken(connection.refresh_token, owner) });
  if (token.refresh_token) await env.DB.prepare("UPDATE mail_connections SET refresh_token = ? WHERE owner = ? AND refresh_token = ?")
    .bind(await encryptToken(token.refresh_token, owner), owner, connection.refresh_token).run();
  return { address: connection.address, accessToken: token.access_token };
}

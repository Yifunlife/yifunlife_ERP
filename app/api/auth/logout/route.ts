import { removeLoginSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  await removeLoginSession(request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": "yifun_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" } });
}

import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../lib/auth";
import { beginDeviceAuthorization, mailbox, mailConfigured, sameOrigin } from "../../../lib/hotmail";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  return Response.json({ configured: mailConfigured(), connection: await mailbox(session.email) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "请从报价系统发起授权" }, { status: 403 });
  try { return Response.json(await beginDeviceAuthorization(session.email)); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 503 }); }
}
export async function DELETE(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "来源无效" }, { status: 403 });
  await env.DB.prepare("DELETE FROM mail_connections WHERE owner = ?").bind(session.email).run();
  await env.DB.prepare("DELETE FROM mail_oauth_states WHERE owner = ?").bind(session.email).run();
  return Response.json({ disconnected: true });
}

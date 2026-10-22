import { getLoginSession } from "../../../../lib/auth";
import { pollDeviceAuthorization, sameOrigin } from "../../../../lib/hotmail";

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "来源无效" }, { status: 403 });
  try {
    const body = await request.json() as { state?: string };
    if (typeof body.state !== "string" || body.state.length > 100) return Response.json({ error: "授权编号无效" }, { status: 400 });
    return Response.json(await pollDeviceAuthorization(session.email, body.state));
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
}

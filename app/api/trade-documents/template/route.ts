import { getLoginSession } from "../../../../lib/auth";
import { tradeTemplatesAvailable, tradeTemplatesUnavailableMessage } from "../../../../lib/trade-document";
import templates from "../../../../lib/trade-templates/templates.json";

export async function GET(request: Request) {
  if (!await getLoginSession(request)) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!tradeTemplatesAvailable) return Response.json({ error: tradeTemplatesUnavailableMessage }, { status: 409 });
  const kind = new URL(request.url).searchParams.get("kind") || "";
  if (!Object.hasOwn(templates, kind)) return Response.json({ error: "模板不存在" }, { status: 404 });
  return Response.json(templates[kind as keyof typeof templates], { headers: { "Cache-Control": "private, no-store" } });
}

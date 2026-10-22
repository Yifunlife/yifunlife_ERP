import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../lib/auth";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const object = await env.PRODUCT_IMAGES.get(`quote-templates/${id}`);
  if (!object || (object.customMetadata?.owner !== session.email && !["admin", "management", "ceo"].includes(session.role)))
    return new Response("Not found", { status: 404 });
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  if (Number(request.headers.get("content-length")) > 9 * 1024 * 1024)
    return Response.json({ error: "大文件请使用分块上传" }, { status: 413 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\.xlsx$/i.test(file.name))
    return Response.json({ error: "请使用 XLSX 格式保留原始报价模板" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024)
    return Response.json({ error: "大文件请使用分块上传（文件最大 200MB）" }, { status: 413 });
  const id = crypto.randomUUID();
  await env.PRODUCT_IMAGES.put(`quote-templates/${id}`, await file.arrayBuffer(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { owner: session.email },
  });
  return Response.json({ id }, { status: 201 });
}

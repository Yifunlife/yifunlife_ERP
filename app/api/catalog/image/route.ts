import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getLoginSession(request)) return new Response("Unauthorized", { status: 401 });
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Missing image key", { status: 400 });
  const object = await env.PRODUCT_IMAGES.get(key);
  if (!object) return new Response("Image not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/webp", "Cache-Control": "public, max-age=31536000, immutable" } });
}

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (session?.role !== "admin")
    return Response.json({ error: "仅管理员可更换产品图片" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file"); const productId = String(form.get("productId") || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!(file instanceof File) || !productId || !file.type.startsWith("image/")) return Response.json({ error: "请选择图片文件" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return Response.json({ error: "图片不能超过 8MB" }, { status: 400 });
  const key = `products/${productId}-${Date.now()}`;
  await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return Response.json({ imageUrl: `/api/catalog/image?key=${encodeURIComponent(key)}` });
}

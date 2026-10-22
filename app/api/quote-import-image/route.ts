import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await getLoginSession(request)))
    return Response.json({ error: "请先登录后再导入报价清单" }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type))
    return Response.json({ error: "导入图片格式无效" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024)
    return Response.json({ error: "单张导入图片不能超过 8MB" }, { status: 400 });
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const key = `quote-imports/${crypto.randomUUID()}.${extension}`;
  await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return Response.json({ imageUrl: `/api/catalog/image?key=${encodeURIComponent(key)}` });
}

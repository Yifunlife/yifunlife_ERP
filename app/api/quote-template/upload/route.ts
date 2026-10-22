import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../../lib/auth";

const LIMIT = 200 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;
type Upload = { owner: string; size: number; uploadId: string; createdAt: number };
const stateKey = (id: string) => `quote-template-uploads/${id}`;

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  const { name, size } = await request.json() as { name?: string; size?: number };
  if (!name || !/\.xlsx$/i.test(name)) return Response.json({ error: "报价模板需为 XLSX 格式" }, { status: 400 });
  if (!Number.isSafeInteger(size) || !size || size < 1 || size > LIMIT) return Response.json({ error: "导入文件不能超过 200MB" }, { status: 413 });
  const id = crypto.randomUUID();
  const upload = await env.PRODUCT_IMAGES.createMultipartUpload(`quote-templates/${id}`, {
    httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { owner: session.email },
  });
  await env.PRODUCT_IMAGES.put(stateKey(id), JSON.stringify({ owner: session.email, size, uploadId: upload.uploadId, createdAt: Date.now() }));
  return Response.json({ id, partSize: PART_SIZE }, { status: 201 });
}

async function handle(request: Request, action: "part" | "complete" | "abort") {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!/^[a-f0-9-]{36}$/.test(id)) return Response.json({ error: "上传不存在" }, { status: 404 });
  const record = await env.PRODUCT_IMAGES.get(stateKey(id));
  const state = record ? await record.json<Upload>() : null;
  if (!state || state.owner !== session.email) return Response.json({ error: "上传不存在" }, { status: 404 });
  const upload = env.PRODUCT_IMAGES.resumeMultipartUpload(`quote-templates/${id}`, state.uploadId);
  if (action === "abort" || Date.now() - state.createdAt > 60 * 60 * 1000) {
    await upload.abort();
    await env.PRODUCT_IMAGES.delete(stateKey(id));
    return action === "abort" ? Response.json({ ok: true }) : Response.json({ error: "上传已过期，请重新导入" }, { status: 410 });
  }
  const count = Math.ceil(state.size / PART_SIZE);
  if (action === "part") {
    const part = Number(url.searchParams.get("part"));
    if (!Number.isInteger(part) || part < 1 || part > count) return Response.json({ error: "上传分块无效" }, { status: 400 });
    const expected = Math.min(PART_SIZE, state.size - (part - 1) * PART_SIZE);
    if (Number(request.headers.get("content-length")) !== expected || !request.body) return Response.json({ error: "上传分块大小不正确" }, { status: 400 });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== expected) return Response.json({ error: "上传分块大小不正确" }, { status: 400 });
    const result = await upload.uploadPart(part, bytes);
    return Response.json(result);
  }
  const { parts } = await request.json() as { parts?: Array<{ partNumber: number; etag: string }> };
  if (!Array.isArray(parts) || parts.length !== count || parts.some((part, index) => part.partNumber !== index + 1 || typeof part.etag !== "string")) return Response.json({ error: "文件尚未上传完整" }, { status: 400 });
  await upload.complete(parts);
  await env.PRODUCT_IMAGES.delete(stateKey(id));
  return Response.json({ id }, { status: 201 });
}
export const PUT = (request: Request) => handle(request, "part");
export const PATCH = (request: Request) => handle(request, "complete");
export const DELETE = (request: Request) => handle(request, "abort");

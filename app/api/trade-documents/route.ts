import { env } from "cloudflare:workers";
import { PDFDocument } from "pdf-lib";
import { getLoginSession } from "../../../lib/auth";
import { sameOrigin, sha256, unbase64 } from "../../../lib/hotmail";
import { tradeTemplatesAvailable, tradeTemplatesUnavailableMessage, safePdfName, tradeError, validEmail, type TradeData } from "../../../lib/trade-document";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (new URL(request.url).searchParams.get("details") === "1") {
      const saved = await env.DB.prepare("SELECT id, data_json, recipient, subject, message, pdf_hash, filename, status FROM trade_documents WHERE id = ? AND owner = ?").bind(id, session.email).first<{ id: string; data_json: string; recipient: string; subject: string; message: string; pdf_hash: string; filename: string; status: string }>();
      if (!saved) return Response.json({ error: "单据不存在" }, { status: 404 });
      return Response.json({ ...saved, data: JSON.parse(saved.data_json), data_json: undefined }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const doc = await env.DB.prepare("SELECT pdf_key, filename FROM trade_documents WHERE id = ? AND owner = ?").bind(id, session.email).first<{ pdf_key: string; filename: string }>();
    if (!doc) return Response.json({ error: "单据不存在" }, { status: 404 });
    const file = await env.PRODUCT_IMAGES.get(doc.pdf_key);
    if (!file) return Response.json({ error: "PDF 读取失败，请重试" }, { status: 404 });
    return new Response(file.body as unknown as ReadableStream<Uint8Array>, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const docs = await env.DB.prepare("SELECT id, kind, number, recipient, subject, status, sender, filename, created_at, sent_at, error FROM trade_documents WHERE owner = ? ORDER BY created_at DESC LIMIT 50").bind(session.email).all();
  return Response.json({ documents: docs.results }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!tradeTemplatesAvailable) return Response.json({ error: tradeTemplatesUnavailableMessage }, { status: 409 });
  if (!sameOrigin(request)) return Response.json({ error: "来源无效" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024) return Response.json({ error: "PDF 太大，请减少明细后重试" }, { status: 413 });
  let body: { data: TradeData; recipient: string; subject: string; message: string; pdf: string };
  try {
    const raw = await request.text();
    if (raw.length > 4 * 1024 * 1024) return Response.json({ error: "PDF 太大，请减少明细后重试" }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "请求格式无效" }, { status: 400 }); }
  const error = tradeError(body.data);
  if (error) return Response.json({ error }, { status: 400 });
  if (typeof body.recipient !== "string" || !validEmail(body.recipient) || typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 200 || /[\r\n]/.test(body.subject) || typeof body.message !== "string" || !body.message.trim() || body.message.length > 10000)
    return Response.json({ error: "请填写有效收件邮箱、邮件主题和正文" }, { status: 400 });
  let bytes: Uint8Array;
  try {
    if (typeof body.pdf !== "string" || body.pdf.length > 3500000) throw new Error();
    bytes = unbase64(body.pdf);
    if (bytes.length > 2500000 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error();
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 50) throw new Error();
  } catch { return Response.json({ error: "请生成有效 PDF（不超过 2.5MB / 50 页）" }, { status: 400 }); }
  const id = crypto.randomUUID();
  const key = `trade-documents/${id}.pdf`;
  const hash = await sha256(bytes);
  const filename = safePdfName(body.data.kind, body.data.number);
  await env.PRODUCT_IMAGES.put(key, new Uint8Array(bytes).buffer, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { owner: session.email } });
  await env.DB.prepare("INSERT INTO trade_documents (id, owner, kind, number, recipient, subject, message, data_json, pdf_key, pdf_hash, filename, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, session.email, body.data.kind, body.data.number, body.recipient, body.subject.trim(), body.message, JSON.stringify(body.data), key, hash, filename, new Date().toISOString()).run();
  return Response.json({ id, hash, filename, url: `/api/trade-documents?id=${id}` }, { status: 201 });
}

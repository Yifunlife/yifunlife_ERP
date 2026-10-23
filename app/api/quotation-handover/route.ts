import { env } from "cloudflare:workers";
import { zipSync, strToU8 } from "fflate";
import { getLoginSession } from "../../../lib/auth";
import { sameOrigin, sha256 } from "../../../lib/hotmail";
import { accessibleQuotation } from "../../../lib/quotation-source";
import { quoteAmount, readSnapshot } from "../../../lib/quote-amount";
import { handoverHtml, handoverItems, safeHandoverFilename, type HandoverData } from "../../../lib/quotation-handover";

type Saved = { id: string; data_json: string; created_at: string; created_by: string };
type FileRow = { id: string; filename: string; size: number; sha256: string; object_key: string };
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const active = (quote: NonNullable<Awaited<ReturnType<typeof accessibleQuotation>>>) => Boolean(quote.isFinalized && quote.finalAmount !== null && quote.snapshotJson && !quote.voidedAt && !quote.archivedAt && quote.projectStatus !== "lost");

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const quote = await accessibleQuotation(params.get("quotation") || "", session);
  if (!quote) return Response.json({ error: "报价不存在或无权查看" }, { status: 404 });
  const fileId = params.get("file");
  if (fileId) {
    const file = await env.DB.prepare("SELECT * FROM quotation_handover_files WHERE id = ? AND quotation_id = ?").bind(fileId, quote.id).first<FileRow>();
    if (!file) return Response.json({ error: "附件不存在" }, { status: 404 });
    const object = await env.PRODUCT_IMAGES.get(file.object_key);
    if (!object) return Response.json({ error: "附件文件缺失，请联系管理员" }, { status: 404 });
    return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } });
  }
  const savedId = params.get("id");
  if (savedId) {
    const saved = await env.DB.prepare("SELECT * FROM quotation_handovers WHERE id = ? AND quotation_id = ?").bind(savedId, quote.id).first<Saved>();
    if (!saved) return Response.json({ error: "资料包不存在" }, { status: 404 });
    const data: HandoverData = JSON.parse(saved.data_json);
    const latest = await env.DB.prepare("SELECT id FROM quotation_handovers WHERE quotation_id = ? ORDER BY rowid DESC LIMIT 1").bind(quote.id).first<{ id: string }>();
    const current = latest?.id === saved.id && active(quote) && data.confirmedAt === (quote.confirmedAt || "") && data.finalAmount === quote.finalAmount;
    const html = handoverHtml(data, saved.created_at, current);
    if (params.get("download") !== "1") return new Response(html, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'" } });
    const files: Record<string, Uint8Array> = { "成交交接单.html": strToU8(html), "成交资料.json": strToU8(JSON.stringify({ ...data, savedAt: saved.created_at, current }, null, 2)) };
    for (const file of data.files) {
      const stored = await env.DB.prepare("SELECT object_key FROM quotation_handover_files WHERE id = ? AND quotation_id = ?").bind(file.id, quote.id).first<{ object_key: string }>();
      const object = stored && await env.PRODUCT_IMAGES.get(stored.object_key);
      if (!object) return Response.json({ error: `附件缺失：${file.filename}，资料包未下载` }, { status: 409 });
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (await sha256(bytes) !== file.sha256) return Response.json({ error: "附件校验失败，资料包未下载" }, { status: 409 });
      files[`客户确认附件/${file.id}-${safeHandoverFilename(file.filename)}`] = bytes;
    }
    return new Response(new Uint8Array(zipSync(files, { level: 0 })).buffer, { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeHandoverFilename(data.contractNo) + '-成交交接.zip')}` } });
  }
  const records = await env.DB.prepare("SELECT id, data_json, created_by, created_at FROM quotation_handovers WHERE quotation_id = ? ORDER BY rowid DESC").bind(quote.id).all<Saved>();
  return Response.json({ quotation: { id: quote.id, contractNo: quote.contractNo, projectName: quote.projectName, customerName: quote.customerName, finalAmount: quote.finalAmount, currency: quote.finalCurrency, canCreate: active(quote), items: quote.snapshotJson ? handoverItems(quote.snapshotJson) : [] }, records: records.results.map(({ data_json, ...record }) => ({ ...record, data: JSON.parse(data_json) })) }, { headers });
}

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "来源无效" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const quote = await accessibleQuotation(params.get("quotation") || "", session);
  if (!quote) return Response.json({ error: "报价不存在或无权查看" }, { status: 404 });
  if (!active(quote)) return Response.json({ error: "请先确认有效报价及成交价格；历史资料包仍可查看" }, { status: 409 });
  if (params.get("upload") === "1") {
    if (Number(request.headers.get("content-length")) > 5 * 1024 * 1024) return Response.json({ error: "附件不得超过 5MB" }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return Response.json({ error: "附件为空或超过 5MB" }, { status: 413 });
    const isPdf = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
    const isPng = [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v);
    const isJpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const name = params.get("name") || "";
    if (!(isPdf && /\.pdf$/i.test(name) || isPng && /\.png$/i.test(name) || isJpg && /\.jpe?g$/i.test(name))) return Response.json({ error: "请上传 PDF、PNG 或 JPG 客户确认文件" }, { status: 400 });
    const id = crypto.randomUUID(), filename = safeHandoverFilename(name), key = `quotation-handovers/${quote.id}/${id}`;
    const hash = await sha256(bytes);
    await env.PRODUCT_IMAGES.put(key, bytes.buffer, { httpMetadata: { contentType: "application/octet-stream" } });
    await env.DB.prepare("INSERT INTO quotation_handover_files (id, quotation_id, filename, object_key, size, sha256, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, quote.id, filename, key, bytes.length, hash, session.email, new Date().toISOString()).run();
    return Response.json({ file: { id, filename, size: bytes.length, sha256: hash } }, { status: 201 });
  }
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 30000) throw new Error(); body = JSON.parse(raw); if (!body || typeof body !== "object") throw new Error(); }
  catch { return Response.json({ error: "交接内容无效或过长" }, { status: 400 }); }
  for (const key of ["responsiblePerson", "paymentTerms", "customerConfirmation"])
    if (typeof body[key] !== "string" || !(body[key] as string).trim() || (body[key] as string).length > (key === "responsiblePerson" ? 120 : 5000)) return Response.json({ error: "请填写交接负责人、付款条件和客户确认说明（姓名限 120 字，说明限 5000 字）" }, { status: 400 });
  if (typeof body.deliveryNotes !== "string" || body.deliveryNotes.length > 5000 || typeof body.previousId !== "string" || !Array.isArray(body.fileIds) || body.fileIds.length > 5 || body.fileIds.some(id => typeof id !== "string") || new Set(body.fileIds).size !== body.fileIds.length) return Response.json({ error: "交付备注或附件无效，每份资料包最多 5 个附件" }, { status: 400 });
  const files: FileRow[] = [];
  for (const id of body.fileIds) {
    const file = await env.DB.prepare("SELECT id, filename, size, sha256, object_key FROM quotation_handover_files WHERE id = ? AND quotation_id = ?").bind(id, quote.id).first<FileRow>();
    if (!file) return Response.json({ error: "客户确认附件不存在或不属于本报价" }, { status: 400 });
    files.push(file);
  }
  const latest = await env.DB.prepare("SELECT id FROM quotation_handovers WHERE quotation_id = ? ORDER BY rowid DESC LIMIT 1").bind(quote.id).first<{ id: string }>();
  if ((latest?.id || "") !== body.previousId) return Response.json({ error: "交接资料已更新，请刷新后再保存" }, { status: 409 });
  const summary = quoteAmount(readSnapshot(quote.snapshotJson));
  const snapshot = readSnapshot(quote.snapshotJson);
  const data: HandoverData = { quoteTerms: { fees: snapshot?.fees || {}, includeTax: summary.currency === "CNY" && snapshot?.includeTax !== false, showDesignDeduction: Boolean(snapshot?.showDesignDeduction) }, quotationId: quote.id, contractNo: quote.contractNo, projectName: quote.projectName, customerName: quote.customerName, quotationCreatedAt: quote.generatedAt, confirmedAt: quote.confirmedAt || "", confirmedBy: quote.confirmedBy, finalAmount: quote.finalAmount!, currency: quote.finalCurrency || summary.currency, quotedAmount: summary.amount, responsiblePerson: (body.responsiblePerson as string).trim(), paymentTerms: (body.paymentTerms as string).trim(), customerConfirmation: (body.customerConfirmation as string).trim(), deliveryNotes: body.deliveryNotes, items: handoverItems(quote.snapshotJson!), files: files.map(({ object_key, ...file }) => file) };
  const id = crypto.randomUUID();
  try {
    const inserted = await env.DB.prepare(`INSERT INTO quotation_handovers (id, quotation_id, previous_id, data_json, created_by, created_at)
      SELECT ?, id, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM quotation_history
      WHERE id = ? AND is_finalized = 1 AND voided_at IS NULL AND archived_at IS NULL AND project_status != 'lost' AND confirmed_at IS ? AND final_amount = ?`)
      .bind(id, body.previousId, JSON.stringify(data), session.email, quote.id, quote.confirmedAt, quote.finalAmount).run();
    if (!inserted.meta.changes) return Response.json({ error: "成交状态已改变，请刷新后重试" }, { status: 409 });
  } catch (error) {
    if (!String(error).includes("UNIQUE constraint")) throw error;
    return Response.json({ error: "交接资料已保存或已更新，请刷新后查看" }, { status: 409 });
  }
  return Response.json({ id }, { status: 201 });
}

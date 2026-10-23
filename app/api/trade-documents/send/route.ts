import { quotationSourceError } from "../../../../lib/quotation-source";
import { env } from "cloudflare:workers";
import { getLoginSession } from "../../../../lib/auth";
import { base64, mailboxAccess, sameOrigin, sha256 } from "../../../../lib/hotmail";

type StoredDocument = { data_json: string; id: string; owner: string; recipient: string; subject: string; message: string; pdf_key: string; pdf_hash: string; filename: string; status: string };
export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "请先登录报价系统" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "来源无效" }, { status: 403 });
  let body: { id?: string; hash?: string; confirmed?: boolean; sender?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式无效" }, { status: 400 }); }
  const doc = await env.DB.prepare("SELECT * FROM trade_documents WHERE id = ? AND owner = ?").bind(body.id || "", session.email).first<StoredDocument>();
  if (!doc) return Response.json({ error: "单据不存在" }, { status: 404 });
  if (body.confirmed !== true || body.hash !== doc.pdf_hash) return Response.json({ error: "请重新预览 PDF 并确认收件人" }, { status: 409 });
  if (doc.status !== "ready") return Response.json({ error: "此单据已经提交过发送，请查看发送记录，勿重复发送" }, { status: 409 });
  const sourceError = await quotationSourceError(JSON.parse(doc.data_json).sourceQuotationId, session);
  if (sourceError) return Response.json({ error: sourceError }, { status: 409 });
  // Refresh and load the exact reviewed attachment before taking the send lock.
  let account: { address: string; accessToken: string };
  try { account = await mailboxAccess(session.email); }
  catch (error) { return Response.json({ error: (error as Error).message }, { status: 409 }); }
  if (account.address !== body.sender) return Response.json({ error: "发件邮箱已变更，请核对邮箱后重新确认" }, { status: 409 });
  const pdf = await env.PRODUCT_IMAGES.get(doc.pdf_key);
  if (!pdf) return Response.json({ error: "PDF 不存在，请重新生成" }, { status: 409 });
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (await sha256(bytes) !== doc.pdf_hash) return Response.json({ error: "PDF 校验失败，请重新生成" }, { status: 409 });
  const lock = await env.DB.prepare("UPDATE trade_documents SET status = 'sending', sender = ?, error = '' WHERE id = ? AND owner = ? AND status = 'ready'").bind(account.address, doc.id, session.email).run();
  if (lock.meta.changes !== 1) return Response.json({ error: "发送已在处理中，请勿重复点击" }, { status: 409 });
  let response: Response;
  try {
    response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST", headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json", "client-request-id": doc.id },
      body: JSON.stringify({ message: { subject: doc.subject, body: { contentType: "Text", content: doc.message }, toRecipients: [{ emailAddress: { address: doc.recipient } }], attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: doc.filename, contentType: "application/pdf", contentBytes: base64(bytes) }] }, saveToSentItems: true }),
    });
  } catch {
    await env.DB.prepare("UPDATE trade_documents SET status = 'uncertain', error = ? WHERE id = ?").bind("网络中断，发送结果待核实；请检查 Hotmail 已发送文件夹，系统不会自动重发。", doc.id).run();
    return Response.json({ error: "发送结果待核实，请检查 Hotmail 已发送文件夹，勿重复发送", status: "uncertain" }, { status: 502 });
  }
  const accepted = response.status === 202;
  const uncertain = response.status >= 500 || (response.ok && !accepted);
  const status = accepted ? "accepted" : uncertain ? "uncertain" : "failed";
  const error = accepted ? "" : uncertain ? "微软服务响应异常，发送结果待核实，请检查已发送文件夹。" : `微软拒绝发送（${response.status}），请检查邮箱授权或发送限制。`;
  await env.DB.prepare("UPDATE trade_documents SET status = ?, sent_at = ?, provider_request_id = ?, error = ? WHERE id = ?")
    .bind(status, accepted ? new Date().toISOString() : null, response.headers.get("request-id"), error, doc.id).run();
  return Response.json(accepted ? { status, message: "微软已接受发送请求；请在 Hotmail 已发送文件夹核对，尚不代表客户已送达。" } : { status, error }, { status: accepted ? 202 : 502 });
}

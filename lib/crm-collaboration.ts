export async function sharedQuotation(db: D1Database, id: string, email: string) {
  return db.prepare('SELECT quotation_id FROM quotation_crm_links WHERE quotation_id=? AND sales_email=? AND sales_email<>\'\' AND active=1').bind(id,email).first();
}
export function bridgeMessage(body: any) {
  if (!body || !['核算报价完成','核算回复'].includes(body.kind) || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 5000 || typeof body.requestId !== 'string' || !/^[a-z0-9-]{10,100}$/i.test(body.requestId)) throw new Error('请填写完成说明或回复（最多5000字）');
  return {content:body.content.trim()};
}

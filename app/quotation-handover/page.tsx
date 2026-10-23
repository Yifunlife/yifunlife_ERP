"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { HandoverData, HandoverFile } from "../../lib/quotation-handover";
import styles from "../trade-documents/trade-documents.module.css";

type RecordRow = { id: string; created_at: string; created_by: string; data: HandoverData };
type State = { quotation: { id: string; contractNo: string; projectName: string; customerName: string; finalAmount: number | null; currency: string; canCreate: boolean; items: HandoverData["items"] }; records: RecordRow[] };
async function json(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败，请重试");
  return data;
}
export default function QuotationHandoverPage() {
  const [state, setState] = useState<State | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const [previousId, setPreviousId] = useState("");
  const [responsiblePerson, setResponsiblePerson] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [customerConfirmation, setCustomerConfirmation] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [files, setFiles] = useState<HandoverFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = `/api/quotation-handover?quotation=${encodeURIComponent(quoteId)}`;
  const load = async (id: string) => {
    const result: State = await json(`/api/quotation-handover?quotation=${encodeURIComponent(id)}`);
    setState(result);
    const latest = result.records[0];
    setPreviousId(latest?.id || "");
    setResponsiblePerson(latest?.data.responsiblePerson || ""); setPaymentTerms(latest?.data.paymentTerms || "");
    setCustomerConfirmation(latest?.data.customerConfirmation || ""); setDeliveryNotes(latest?.data.deliveryNotes || ""); setFiles(latest?.data.files || []);
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("quotation") || "";
    setQuoteId(id);
    if (!id) { setError("请从报价历史选择要交接的报价版本。"); return; }
    load(id).catch(error => setError(error.message));
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await json(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previousId, responsiblePerson, paymentTerms, customerConfirmation, deliveryNotes, fileIds: files.map(file => file.id) }) });
      await load(quoteId); setNotice("已保存新的成交交接资料包，旧记录保留。可在下方预览或下载。");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file || busy) return;
    if (file.size > 5 * 1024 * 1024 || files.length >= 5) { setError("每份资料包最多 5 个附件，每个附件不超过 5MB。"); return; }
    setBusy(true); setError("");
    try {
      const result = await json(`${endpoint}&upload=1&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      setFiles(current => [...current, result.file]); setNotice("附件已上传，请保存资料包以固定本次交接内容。");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}>
    <header className={styles.header}><div><h1>成交交接资料包</h1><p>按确认报价留存，每次保存保留独立记录。</p></div><a className="outline" href="/quotation-history">返回报价历史</a></header>
    {error && <p role="alert">{error} {quoteId && <button className="outline" disabled={busy} onClick={() => { setError(""); load(quoteId).catch(error => setError(error.message)); }}>重新读取已保存资料</button>}</p>}
    {notice && <p role="status">{notice}</p>}
    {!state && !error && <p role="status">正在读取报价与交接记录…</p>}
    {state && <>
      <section className={styles.history}><h2>{state.quotation.projectName} · {state.quotation.contractNo}</h2><p>客户：{state.quotation.customerName || "报价未填写"}　成交金额：{state.quotation.finalAmount === null ? "未确认" : `${state.quotation.currency} ${state.quotation.finalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`}</p>
        {!state.quotation.canCreate && <p role="status">当前版本未确认成交价，或已失效。不能创建新交接；已有资料包仍保留供查阅。</p>}
        <div className={styles.tableWrap}><table><thead><tr><th>SKU</th><th>产品名称</th><th>规格</th><th>数量</th><th>单位</th><th>区域／分类</th><th>备注</th></tr></thead><tbody>{state.quotation.items.map((item, index) => <tr key={index}><td>{item.sku}</td><td>{item.name}</td><td>{item.specification || "—"}</td><td>{item.quantity}</td><td>{item.unit}</td><td>{item.area || "—"}</td><td>{item.note || "—"}</td></tr>)}</tbody></table></div>
      </section>
      {state.quotation.canCreate && <form onSubmit={save}><fieldset className={styles.form} disabled={busy}><legend>本次交接内容</legend>
        <label>交接负责人<input required maxLength={120} value={responsiblePerson} onChange={event => setResponsiblePerson(event.target.value)} /></label>
        <label className={styles.address}>付款条件<textarea required maxLength={5000} rows={3} value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)} /></label>
        <p className={styles.hint}>填写约定的付款节点与金额；实际到账以收款系统记录为准。</p>
        <label>客户确认说明<textarea required maxLength={5000} rows={3} value={customerConfirmation} onChange={event => setCustomerConfirmation(event.target.value)} /></label>
        <label className={styles.address}>客户确认附件（PDF / PNG / JPG，最多 5 个，每个不超过 5MB）<input type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={files.length >= 5} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
        {!files.length && <p className={styles.hint}>尚未上传客户确认附件；保存后会明确标为待补充。</p>}
        <ul>{files.map(file => <li key={file.id}><a href={`${endpoint}&file=${encodeURIComponent(file.id)}`}>{file.filename}</a> <button type="button" className="outline" onClick={() => setFiles(current => current.filter(item => item.id !== file.id))}>从本次交接移除</button></li>)}</ul>
        <label>交付要求及范围<textarea maxLength={5000} rows={4} value={deliveryNotes} onChange={event => setDeliveryNotes(event.target.value)} /></label>
        <div className={styles.actions}><span>以本页报价版本固定清单和成交金额，保存后不覆盖旧资料包。</span><button className="primary" type="submit">{busy ? "处理中…" : "保存交接资料包"}</button></div>
      </fieldset></form>}
      <section className={styles.history}><h2>已保存的交接资料</h2>{!state.records.length ? <p>暂无交接资料包。确认成交价格后可填写并保存。</p> : <div className={styles.tableWrap}><table><thead><tr><th>保存时间</th><th>负责人</th><th>客户附件</th><th>资料包</th></tr></thead><tbody>{state.records.map((record, index) => <tr key={record.id}><td>{new Date(record.created_at).toLocaleString("zh-CN")}<br />{index === 0 && state.quotation.canCreate ? "最新交接" : "历史留存"}</td><td>{record.data.responsiblePerson}</td><td>{record.data.files.length ? `${record.data.files.length} 个` : "待补充"}</td><td><a className="outline" target="_blank" rel="noreferrer" href={`${endpoint}&id=${record.id}`}>预览交接单</a> <a className="outline" href={`${endpoint}&id=${record.id}&download=1`}>下载资料包</a></td></tr>)}</tbody></table></div>}</section>
    </>}
  </main>;
}

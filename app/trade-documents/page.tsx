"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { tradeTemplatesAvailable, tradeTemplatesUnavailableMessage, tradeEmailMessage, defaultPayments, paymentAmounts, lineCents, safePdfName, tradeError, tradeKinds, tradeTotal, type TradeData, type TradeKind } from "../../lib/trade-document";
import styles from "./trade-documents.module.css";
import PdfPreview from "./pdf-preview";
import { excludedFromQuote, type QuoteRevision } from "../../lib/quote-revisions";

type MailStatus = { configured: boolean; connection: { address: string } | null };
type DeviceAuthorization = { state: string; userCode: string; verificationUri: string; expiresAt: number; interval: number };
type RecordRow = { source_quotation_id?: string; source_contract_no?: string; id: string; kind: TradeKind; number: string; recipient: string; subject: string; status: string; sender: string; created_at: string; error: string };
type Preview = { id: string; hash: string; filename: string; url: string; recipient: string; subject: string; message: string; fingerprint: string };
const dateToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const initialData = (): TradeData => ({ kind: "equipment-pi", number: "", date: dateToday(), validUntil: "", buyer: "", buyerAddress: "", buyerContact: "", buyerPhone: "", buyerEmail: "", sellerContact: "", sellerEmail: "", sellerPhone: "", origin: "", destination: "", projectName: "", projectAddress: "", description: "Indoor Playground Equipment", items: [{ description: "", quantity: 1, price: 0, hsCode: "" }], deliveryDays: "", appendix: "", installationOption: "", guidanceDays: "", guidanceFee: "", installationDays: "", installationFee: "", includedCosts: ["Equipment Cost"], payments: defaultPayments(), tradeTerm: "FOB", tradePlace: "", signatureRequired: true });
const statusText: Record<string, string> = { ready: "已生成 · 未发送", sending: "发送处理中 · 请核对已发送邮箱", accepted: "微软已接受发送", uncertain: "发送结果待核实", failed: "发送失败" };
let fontPromise: Promise<Uint8Array> | undefined;
const getFont = () => fontPromise ||= fetch("/fonts/NotoSansSC-Trade.ttf").then(async response => { if (!response.ok) throw new Error("PDF 字体加载失败，请重试"); return new Uint8Array(await response.arrayBuffer()); }).catch(error => { fontPromise = undefined; throw error; });
async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "操作失败，请重试");
  return body;
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function encodePdf(bytes: Uint8Array) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 8192) value += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(value);
}

export default function TradeDocumentsPage() {
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking");
  const [data, setData] = useState<TradeData>(initialData);
  const [mail, setMail] = useState<MailStatus>({ configured: false, connection: null });
  const [device, setDevice] = useState<DeviceAuthorization | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [renderedUrl, setRenderedUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sourceOptions, setSourceOptions] = useState<{ id: string; contractNo: string; projectName: string; currency: string }[]>([]);
  const [draftKey, setDraftKey] = useState("");
  const guard = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
  const fingerprint = JSON.stringify({ data, recipient, subject, message });
  const currentPreview = preview?.fingerprint === fingerprint ? preview : null;
  const refreshRecords = () => jsonRequest("/api/trade-documents").then(body => setRecords(body.documents || []));
  useEffect(() => {
    let active = true;
    jsonRequest("/api/auth/session").then(async account => {
      if (!active) return;
      if (!account.authenticated) { setAuth("out"); return; }
      setAuth("in");
      setData(value => ({ ...value, sellerContact: account.name || "" }));
      const key = `yifun-trade-draft:${account.email}`;
      try {
        const saved = sessionStorage.getItem(key);
        if (saved) {
          const draft = JSON.parse(saved);
          if (draft.data && Object.hasOwn(tradeKinds, draft.data.kind)) {
            setData({ ...initialData(), ...draft.data }); setRecipient(draft.recipient || ""); setSubject(draft.subject || ""); setMessage(draft.message || "");
          }
        }
      } catch { /* A browser may disable session storage. The form still works. */ }
      setDraftKey(key);
      const results = await Promise.allSettled([
        jsonRequest("/api/hotmail"), jsonRequest("/api/trade-documents"), jsonRequest("/api/quotation-history?pageSize=50"),
      ]);
      if (!active) return;
      if (results[0].status === "fulfilled") {
        setMail(results[0].value);
        setData(value => ({ ...value, sellerEmail: value.sellerEmail || (results[0].status === "fulfilled" ? results[0].value.connection?.address || "" : "") }));
      }
      if (results[1].status === "fulfilled") setRecords(results[1].value.documents || []);
      if (results[2].status === "fulfilled") setSourceOptions((results[2].value.quotations || []).filter((record: { voidedAt: string | null; archivedAt: string | null }) => !record.voidedAt && !record.archivedAt));
      const failures = results.filter(result => result.status === "rejected");
      if (failures.length) setError("部分资料未能读取，请刷新页面重试；新功能尚未初始化时请联系管理员。");
      const params = new URLSearchParams(window.location.search);
      if (params.get("quotation")) setSourceId(params.get("quotation")!);
    }).catch(() => { if (active) setError("无法确认登录状态，请刷新重试"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!device) return;
    let active = true, polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      if (Date.now() > device.expiresAt) { setDevice(null); setError("授权代码已过期，请重新连接 Hotmail"); return; }
      polling = true;
      try {
        const result = await jsonRequest("/api/hotmail/poll", post({ state: device.state }));
        if (active && result.status === "connected") {
          setMail({ configured: true, connection: result.connection }); setDevice(null);
          setData(value => ({ ...value, sellerEmail: result.connection.address }));
          setNotice("Hotmail 已连接，请核对发件人后预览并发送 PDF。");
        }
      } catch (error) { if (active) { setDevice(null); setError((error as Error).message); } }
      finally { polling = false; }
    }, device.interval * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [device]);
  useEffect(() => {
    if (!draftKey) return;
    try { sessionStorage.setItem(draftKey, fingerprint); } catch { /* Storage is optional. */ }
  }, [draftKey, fingerprint]);
  useEffect(() => { setConfirmed(false); }, [fingerprint, mail.connection?.address]);
  const uploadSignature = async (file?: File) => {
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("请上传不超过 5MB 的 PNG 或 JPG 签名图片");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 180;
      const context = canvas.getContext("2d")!;
      const scale = Math.min(600 / bitmap.width, 180 / bitmap.height);
      context.drawImage(bitmap, (600 - bitmap.width * scale) / 2, (180 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
      bitmap.close();
      const signature = canvas.toDataURL("image/png");
      if (signature.length > 80000) throw new Error("签名图片过于复杂，请裁剪为清晰的签名后重新上传");
      setData(current => ({ ...current, sellerSignature: signature, signatureRequired: true })); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "签名图片读取失败"); }
  };
  const update = <K extends keyof TradeData>(key: K, value: TradeData[K]) => setData(current => ({ ...current, [key]: value }));
  const changeKind = (kind: TradeKind) => {
    setData(current => ({ ...current, kind, description: kind === "design-pi" ? "Design Fee" : "Indoor Playground Equipment" }));
    setSubject(""); setMessage(""); setPreview(null); setConfirmed(false);
  };
  const connect = async () => {
    setError(""); setBusy("连接邮箱");
    try { setDevice(await jsonRequest("/api/hotmail", post({}))); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  };
  const disconnect = async () => {
    setError(""); setBusy("断开邮箱");
    try { await jsonRequest("/api/hotmail", { method: "DELETE" }); setMail(current => ({ ...current, connection: null })); setDevice(null); setConfirmed(false); setNotice("邮箱已断开。需要时可重新授权连接。"); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  };
  const importQuote = async () => {
    if (!sourceId) return;
    setBusy("读取报价"); setError("");
    try {
      const { quotation } = await jsonRequest(`/api/quotation-history?id=${encodeURIComponent(sourceId)}`);
      const snapshot = quotation.snapshot;
      if (!snapshot || snapshot.priceMode !== "usd") throw new Error("这些模板使用 USD，请选择美元报价；系统不会自动换算人民币报价。");
      if (quotation.voidedAt || quotation.archivedAt) throw new Error("此报价已作废或归档，请选择有效报价");
      const products = new Map<string, { id: string; en?: string; name: string; usd: number | null; revision?: QuoteRevision }>();
      for (const product of [...(snapshot.importedProducts || []), ...(snapshot.products || [])]) products.set(product.id, product);
      const items: TradeData["items"] = [];
      for (const [id, quantity] of Object.entries(snapshot.cart || {})) {
        if (Number(quantity) <= 0) continue;
        const product = products.get(id);
        if (product && excludedFromQuote(product)) continue;
        if (!product || product.usd == null) throw new Error("报价中有产品缺少美元售价，请先补齐报价或手动填写");
        items.push({ description: product.en || product.name, quantity: Number(quantity), price: product.usd, hsCode: "" });
      }
      for (const [key, label] of [["packaging", "Packaging"], ["formaldehyde", "Formaldehyde treatment"], ["shipping", "Freight"], ["installation", "Installation"]] as const)
        if (Number(snapshot.fees?.[key]) > 0) items.push({ description: label, quantity: 1, price: Number(snapshot.fees[key]), hsCode: "" });
      if (snapshot.showDesignDeduction && Number(snapshot.fees?.designDeduction) > 0) throw new Error("此报价有设计费抵扣，请手动核对单据明细及总额后填写");
      if (!items.length) throw new Error("此报价没有产品明细");
      setData(current => ({ ...current, sourceQuotationId: quotation.id, number: quotation.contractNo || "", projectName: quotation.projectName || "", items }));
      setNotice("已带入报价产品和费用；请核对实际出货数量、成交金额、客户资料及海关编码。");
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true; setBusy("正在生成 PDF"); setError(""); setNotice(""); setPreview(null); setConfirmed(false);
    try {
      const validation = tradeError(data);
      if (validation) throw new Error(validation);
      const target = recipient || data.buyerEmail;
      const title = subject || `${tradeKinds[data.kind]} / ${data.number}`;
      const text = message || tradeEmailMessage(data);
      const [{ makeTradePdf }, template, font] = await Promise.all([import("../../lib/trade-pdf"), jsonRequest(`/api/trade-documents/template?kind=${data.kind}`), getFont()]);
      const bytes = await makeTradePdf(data, template, font);
      const saved = await jsonRequest("/api/trade-documents", post({ data, recipient: target, subject: title, message: text, pdf: encodePdf(bytes) }));
      setRecipient(target); setSubject(title); setMessage(text);
      setPreview({ ...saved, recipient: target, subject: title, message: text, fingerprint: JSON.stringify({ data, recipient: target, subject: title, message: text }) });
      await refreshRecords();
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) { setError((error as Error).message); }
    finally { guard.current = false; setBusy(""); }
  };
  const send = async () => {
    if (!currentPreview || currentPreview.url !== renderedUrl || !confirmed || !mail.connection || guard.current) return;
    guard.current = true; setBusy("正在提交发送"); setError("");
    try {
      const response = await jsonRequest("/api/trade-documents/send", post({ id: currentPreview.id, hash: currentPreview.hash, confirmed: true, sender: mail.connection.address }));
      setNotice(response.message); setPreview(null); setConfirmed(false);
    } catch (error) { setError((error as Error).message); setConfirmed(false); }
    finally { await refreshRecords().catch(() => setError("发送后记录读取失败，请刷新页面并检查 Hotmail 已发送文件夹，勿重复发送。")); guard.current = false; setBusy(""); }
  };
  const reopen = async (id: string) => {
    setBusy("读取单据"); setError(""); setConfirmed(false);
    try {
      const saved = await jsonRequest(`/api/trade-documents?id=${id}&details=1`);
      setSourceId(saved.data.sourceQuotationId || "");
      setData({ ...initialData(), ...saved.data }); setRecipient(saved.recipient); setSubject(saved.subject); setMessage(saved.message);
      const fingerprint = JSON.stringify({ data: saved.data, recipient: saved.recipient, subject: saved.subject, message: saved.message });
      setPreview(saved.status === "ready" ? { id, hash: saved.pdf_hash, filename: saved.filename, url: `/api/trade-documents?id=${id}`, recipient: saved.recipient, subject: saved.subject, message: saved.message, fingerprint } : null);
      if (saved.status !== "ready") setNotice("已带入历史单据资料。此记录已有发送结果，原 PDF 不会再次发送；如需修改，请重新生成并核对。");
      if (saved.sourceWarning) { setPreview(null); setNotice(saved.sourceWarning + "；原单据保留供查阅。"); }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  };
  const input = (key: keyof TradeData, label: string, required = false, type = "text") => <label>{label}<input value={String(data[key])} type={type} required={required} maxLength={key === "number" ? 80 : 240} onChange={event => update(key, event.target.value)} /></label>;
  if (auth === "checking") return <main className={styles.page}><p role="status">正在读取账户和模板…</p>{error && <p role="alert">{error}</p>}</main>;
  if (auth === "out") return <main className={styles.page}><h1>请先登录报价系统</h1><a className="primary" href="/">返回登录</a></main>;
  return <main className={styles.page}>
    <p className={styles.hint}>{data.sourceQuotationId ? `已绑定报价版本：${sourceOptions.find(option => option.id === data.sourceQuotationId)?.contractNo || data.sourceQuotationId}（切换下拉框后需点击带入，才会改变绑定）` : "未绑定报价版本：手工单据或旧记录，系统不会推测来源。"}</p>
    <header className={styles.header}><a className="outline" href="/">返回报价系统</a><div><h1>贸易单据与合同</h1><p>沿用公司模板生成 PDF，预览确认后通过本人的 Hotmail 发送。</p></div><a className="outline" href="/quotation-history">报价历史</a></header>
    <section className={styles.mailbox} aria-label="发件邮箱"><div><strong>{mail.connection ? `发件邮箱：${mail.connection.address}` : "尚未连接发件邮箱"}</strong><p>{mail.configured ? "各业务员独立授权，仅本人可以使用自己的邮箱发送。" : "微软应用授权尚未配置。可以先填写并预览 PDF，配置完成后连接 Hotmail 发送。"}</p></div>{mail.connection ? <button type="button" className="outline" disabled={Boolean(busy)} onClick={() => void disconnect()}>断开邮箱</button> : <button type="button" className="primary" disabled={!mail.configured || Boolean(busy)} onClick={() => void connect()}>连接我的 Hotmail</button>}</section>
    {device && <section className={styles.authorization} aria-label="微软邮箱授权"><h2>连接本人的 Hotmail</h2><p>在微软授权页面输入此代码，然后登录自己的 Hotmail。授权完成后本页会自动更新。</p><strong>{device.userCode}</strong><a className="primary" href={device.verificationUri} target="_blank" rel="noopener noreferrer">打开微软授权页面</a><button className="outline" type="button" onClick={() => void disconnect()}>取消授权</button><p>只输入本页刚生成的代码。系统使用 Yifun Sales Workbench Outlook 应用申请发送邮件权限，不读取收件箱。</p></section>}
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {!tradeTemplatesAvailable && <p className={styles.notice} role="status">{tradeTemplatesUnavailableMessage} 已有单据和发送记录保留。</p>}
    {tradeTemplatesAvailable && <><form onSubmit={event => void generate(event)}>
      <fieldset disabled={Boolean(busy)} className={styles.form}>
        <legend>填写单据</legend>
        <div className={`${styles.grid} ${styles.documentGrid}`}>{<label>单据类型<select value={data.kind} onChange={event => changeKind(event.target.value as TradeKind)}>{Object.entries(tradeKinds).map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label>}{input("number", "单据 / 合同编号", true)}{input("date", "日期", true, "date")}{data.kind === "design-pi" && input("validUntil", "有效期至", true, "date")}</div>
        <p className={styles.hint}>{data.kind === "design-pi" ? "开票主体：YIFUN LIFE AU PTY LTD · USD · FOB · 开工前支付 100% · 原模板 WESTPAC 账户" : "开票主体：HONG KONG YIFUN LIFE LIMITED · USD · 原模板 HSBC 账户"}{data.kind === "equipment-contract" ? " · 付款比例与付款条件可按订单修改" : ""}</p>
        {data.kind !== "design-pi" && <div className={styles.source}><label>从美元报价带入明细<select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">选择报价（也可以直接手动填写）</option>{sourceOptions.map(row => <option key={row.id} value={row.id}>{row.contractNo} · {row.projectName} · {row.currency}</option>)}</select></label><button className="outline" type="button" disabled={!sourceId} onClick={() => void importQuote()}>带入报价</button></div>}
        {data.kind !== "design-pi" && <div className={`${styles.grid} ${styles.tradeGrid}`}><label>贸易条款<select value={data.tradeTerm || "EXW"} onChange={event => update("tradeTerm", event.target.value as "FOB" | "EXW")}><option value="FOB">FOB 船上交货</option><option value="EXW">EXW 工厂交货</option></select></label><label>{data.tradeTerm === "FOB" ? "指定装运港（FOB）" : "指定交货地点（EXW）"}<input required maxLength={100} value={data.tradePlace || ""} onChange={event => update("tradePlace", event.target.value)} placeholder={data.tradeTerm === "FOB" ? "例如 Shenzhen, China（按订单填写）" : "填写工厂交货地点"} /></label>{input("origin", "起运地")}{input("destination", "目的地")}<p className={styles.hint}>设备单据将注明所选条款、港口／地点及 Incoterms® 2020；FOB 港口是装运港。</p></div>}
        <h2>客户资料</h2><div className={`${styles.grid} ${styles.customerGrid}`}>{input("buyer", "客户 / 公司名称", true)}{input("buyerContact", "客户联系人", true)}{input("buyerEmail", "客户邮箱", true, "email")}{input("buyerPhone", "客户电话")}</div><label className={styles.address}>客户地址<textarea required maxLength={500} rows={2} value={data.buyerAddress} onChange={event => update("buyerAddress", event.target.value)} /></label>
        <h2>业务联系人</h2><div className={`${styles.grid} ${styles.contactGrid}`}>{input("sellerContact", "业务员姓名", true)}{input("sellerEmail", "业务联系邮箱", true, "email")}{input("sellerPhone", "业务联系电话")}</div><p className={styles.hint}>文档联系资料可填写；实际发件人始终为上方已授权邮箱。设计 PI 保留模板中的澳洲公司联系邮箱。</p>
        <h2>金额与明细</h2><label>模板主表中的货物 / 服务概述<input required maxLength={150} value={data.description} onChange={event => update("description", event.target.value)} /></label><p className={styles.hint}>主表按 1 个项目包汇总，总额与附后的产品明细一致。所有金额均为 USD；不自动换汇、不猜测 HS 编码。</p>
        <div className={styles.tableWrap}><table className={styles.items}><thead><tr><th>产品 / 服务名称</th><th>HS 编码</th><th>数量</th><th>单价 USD</th><th>金额 USD</th><th>操作</th></tr></thead><tbody>{data.items.map((item, index) => <tr key={index}><td><input aria-label={`第 ${index + 1} 条名称`} required maxLength={1000} value={item.description} onChange={event => update("items", data.items.map((row, i) => i === index ? { ...row, description: event.target.value } : row))} /></td><td><input aria-label={`第 ${index + 1} 条 HS 编码`} maxLength={30} value={item.hsCode} onChange={event => update("items", data.items.map((row, i) => i === index ? { ...row, hsCode: event.target.value } : row))} /></td><td><input aria-label={`第 ${index + 1} 条数量`} type="number" required min="0.001" step="0.001" max="1000000" value={item.quantity} onChange={event => update("items", data.items.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} /></td><td><input aria-label={`第 ${index + 1} 条单价`} type="number" required min="0" step="0.000001" max="100000000" value={item.price} onChange={event => update("items", data.items.map((row, i) => i === index ? { ...row, price: Number(event.target.value) } : row))} /></td><td>{(lineCents(item) / 100).toFixed(2)}</td><td><button className="outline" type="button" disabled={data.items.length === 1} aria-label={`删除第 ${index + 1} 条`} onClick={() => update("items", data.items.filter((_, i) => i !== index))}>删除</button></td></tr>)}</tbody></table></div>
        <div className={styles.total}><button className="outline" type="button" disabled={data.items.length >= 200} onClick={() => update("items", [...data.items, { description: "", quantity: 1, price: 0, hsCode: "" }])}>添加明细</button><strong>合计 USD {tradeTotal(data).toFixed(2)}</strong></div>
        {data.kind === "equipment-contract" && <><h2>合同填写项</h2><div className={`${styles.grid} ${styles.contractGrid}`}>{input("projectName", "项目名称", true)}{input("projectAddress", "项目地址", true)}{input("deliveryDays", "交货周期（自然日）", true, "number")}{input("appendix", "确认设计图附件编号", true)}<label>选定的安装方案<select required value={data.installationOption} onChange={event => update("installationOption", event.target.value)}><option value="">请选择</option><option value="1">方案 1：现场安装指导</option><option value="2">方案 2：乙方团队安装</option></select></label>{input("guidanceDays", "方案 1 安装天数", true, "number")}{input("guidanceFee", "方案 1 服务费 USD", true, "number")}{input("installationDays", "方案 2 安装天数", true, "number")}{input("installationFee", "方案 2 服务费 USD", true, "number")}</div><div className={styles.costs}><span>合同报价包含：</span>{["Equipment Cost", "Freight", "Installation", "Unloading", "Special Invoice"].map(cost => <label key={cost}><input type="checkbox" checked={data.includedCosts.includes(cost)} onChange={event => update("includedCosts", event.target.checked ? [...data.includedCosts, cost] : data.includedCosts.filter(value => value !== cost))} />{cost}</label>)}</div><h2>合同付款计划</h2><p className={styles.hint}>默认 50% / 50%；可修改比例、添加付款期数并填写每期付款条件。条件会原文写入英文合同，请填写双方确认的英文。合计必须为 100%，末期金额自动调整分币差额。</p><div className={styles.tableWrap}><table className={styles.payments}><thead><tr><th>期次</th><th>比例 %</th><th>付款条件</th><th>金额 USD</th><th>操作</th></tr></thead><tbody>{(data.payments || defaultPayments()).map((stage, index, stages) => <tr key={index}><td>第 {index + 1} 期</td><td><input aria-label={`第 ${index + 1} 期付款比例`} type="number" min="0.01" max="100" step="0.01" required value={stage.percent || ""} onChange={event => update("payments", stages.map((value, i) => i === index ? { ...value, percent: Number(event.target.value) } : value))} /></td><td><textarea aria-label={`第 ${index + 1} 期付款条件`} rows={3} maxLength={500} required value={stage.condition} onChange={event => update("payments", stages.map((value, i) => i === index ? { ...value, condition: event.target.value } : value))} /></td><td>{paymentAmounts(tradeTotal(data), stages)[index].toFixed(2)}</td><td><button type="button" className="outline" disabled={stages.length <= 2} onClick={() => update("payments", stages.filter((_, i) => i !== index))}>删除第 {index + 1} 期</button></td></tr>)}</tbody></table></div><button type="button" className="outline" disabled={(data.payments || defaultPayments()).length >= 6} onClick={() => update("payments", [...(data.payments || defaultPayments()), { percent: 0, condition: "" }])}>添加付款期数</button><p>付款比例合计：{(data.payments || defaultPayments()).reduce((sum, stage) => sum + stage.percent, 0).toFixed(2)}%</p><p className={styles.hint}>合同第 4 条引用付款计划，PDF 附上每期比例、金额和条件。银行资料保留，双方签名由实际签署人完成。</p></>}
        <h2>业务员授权签名</h2><p className={styles.hint}>请上传本人的签名或本人有权使用的卖方签名图片（PNG / JPG，5MB 以内），建议裁剪掉多余空白。签名将写入当前 PDF 的卖方签字位置；客户签字位置保持空白。每份文件都需要确认签名后再发送。</p><label>录入卖方签名<input type="file" accept="image/png,image/jpeg" onChange={event => { void uploadSignature(event.target.files?.[0]); event.target.value = ""; }} /></label>{data.sellerSignature && <div><img src={data.sellerSignature} alt="当前单据的卖方签名预览" width={240} height={72} style={{ objectFit: "contain", border: "1px solid #ccd5df", background: "white" }} /><button type="button" className="outline" onClick={() => update("sellerSignature", undefined)}>移除签名</button></div>}
        <h2>邮件内容</h2><div className={`${styles.grid} ${styles.mailGrid}`}><label>收件邮箱<input type="email" value={recipient} placeholder={data.buyerEmail || "默认使用客户邮箱"} onChange={event => setRecipient(event.target.value)} /></label><label>主题<input maxLength={200} value={subject} placeholder={`${tradeKinds[data.kind]} / ${data.number || "单据编号"}`} onChange={event => setSubject(event.target.value)} /></label></div><label>邮件正文<textarea rows={10} maxLength={10000} value={message || tradeEmailMessage(data)} onChange={event => setMessage(event.target.value)} /></label><p className={styles.hint}>按当前单据生成英文正文，可直接修改；修改后保留你的文字。更新单据后可重新生成。</p><button className="outline" type="button" onClick={() => setMessage(tradeEmailMessage(data))}>按当前单据重新生成正文</button>
        <div className={styles.actions}><span>客户附件：{safePdfName(data.kind, data.number || "单据编号")}</span><button className="primary" type="submit">{busy || "生成 PDF 并预览"}</button></div>
      </fieldset>
    </form>
    <section className={styles.preview} ref={previewRef} aria-label="PDF 预览与发送"><h2>PDF 预览与发送</h2>{currentPreview ? <><div className={styles.review}><p><b>发件人：</b>{mail.connection?.address || "尚未连接 Hotmail"}</p><p><b>收件人：</b>{currentPreview.recipient}</p><p><b>主题：</b>{currentPreview.subject}</p><p className={styles.message}>{currentPreview.message}</p><a className="outline" href={currentPreview.url} target="_blank" rel="noopener">在新窗口查看 PDF</a></div><PdfPreview url={currentPreview.url} onReady={setRenderedUrl} onError={setError} /><div className={styles.send}><label><input type="checkbox" checked={confirmed} disabled={Boolean(busy) || renderedUrl !== currentPreview.url} onChange={event => setConfirmed(event.target.checked)} />我已查看 PDF 全部页面，确认发件人、收件人、金额和邮件内容正确。</label><button className="primary" type="button" disabled={!confirmed || !mail.connection || Boolean(busy) || renderedUrl !== currentPreview.url} onClick={() => void send()}>{busy || "确认并发送 PDF"}</button></div></> : <p className={styles.hint}>{preview ? "资料或邮件内容已修改，请重新生成 PDF 后确认发送。" : "填写完成后生成 PDF。生成文件不会自动向客户发送。"}</p>}</section>
    </>}
    <section className={styles.history}><h2>我的单据与发送记录</h2><p className={styles.hint}>仅显示本人最近 50 份单据。“微软已接受发送”不等于客户已送达；结果待核实时请先检查 Hotmail 已发送文件夹。</p>{records.length ? <div className={styles.tableWrap}><table><thead><tr><th>单据</th><th>客户邮箱</th><th>状态</th><th>生成时间</th><th>PDF</th></tr></thead><tbody>{records.map(row => <tr key={row.id}><td><b>{row.number}</b><small>{tradeKinds[row.kind]}</small><small>来源：{row.source_contract_no || (row.source_quotation_id ? "来源记录不可用" : "未绑定（手工／旧记录）")}</small></td><td>{row.recipient}<small>{row.sender && `发件：${row.sender}`}</small></td><td>{statusText[row.status] || row.status}{row.error && <small>{row.error}</small>}</td><td>{new Date(row.created_at).toLocaleString("zh-CN")}</td><td><a href={`/api/trade-documents?id=${row.id}`} target="_blank" rel="noopener">查看 PDF</a>{tradeTemplatesAvailable && <button className="outline" type="button" disabled={Boolean(busy)} onClick={() => void reopen(row.id)}>{row.status === "ready" ? "继续确认发送" : "复制资料"}</button>}</td></tr>)}</tbody></table></div> : <p>尚未生成单据。</p>}</section>
  </main>;
}

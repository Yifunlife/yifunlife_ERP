"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

type QuotationHistoryRecord = {
  id: string;
  contractNo: string;
  projectName: string;
  createdBy: string;
  createdByName: string;
  salesName: string;
  estimatedCost: number | null;
  missingCostCount: number;
  canViewCost: boolean;
  generatedAt: string;
  hasSnapshot: boolean;
  isFinalized: boolean;
  isLatest: boolean;
  projectStatus: "quoted" | "confirmed" | "won" | "lost";
  lossReason: string;
  lossNote: string;
  nextFollowUpAt: string;
  archivedAt: string | null;
  voidedAt: string | null;
  voidReason: string;
  finalAmount: number | null;
  finalCurrency: string | null;
  currency: string;
  quotedAmount: number | null;
};

type HistoryResponse = {
  quotations: QuotationHistoryRecord[];
  page: number;
  pageSize: number;
  total: number;
};

type ContractsResponse = { contracts: string[] };

const formatAmount = (amount: number, currency: string) => `${currency} ${currency === "USD" ? "$" : "¥"}${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lossReasons = ["价格", "预算", "竞品", "项目取消", "暂缓", "其他"] as const;
const projectStatusLabel = {
  quoted: "已报价",
  confirmed: "已确定",
  won: "已成交",
  lost: "未成交 / 丢单",
} as const;

export default function QuotationHistoryPage() {
  const [auth, setAuth] = useState<"checking" | "signedOut" | "signedIn">("checking");
  const [records, setRecords] = useState<QuotationHistoryRecord[]>([]);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [contracts, setContracts] = useState<string[]>([]);
  const [contractNoDraft, setContractNoDraft] = useState("");
  const [contractNo, setContractNo] = useState("");
  const [fromDraft, setFromDraft] = useState("");
  const [from, setFrom] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [to, setTo] = useState("");
  const [listView, setListView] = useState<"active" | "archived" | "voided">("active");
  const showArchived = listView === "archived";
  const showVoided = listView === "voided";
  const viewLabel = showVoided ? "已作废" : showArchived ? "已归档" : "主列表";
  const [actionDialog, setActionDialog] = useState<{ kind: "confirm" | "void"; record: QuotationHistoryRecord } | null>(null);
  const [finalAmount, setFinalAmount] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [lossDialogRecord, setLossDialogRecord] = useState<QuotationHistoryRecord | null>(null);
  const [lossReason, setLossReason] = useState<(typeof lossReasons)[number]>("价格");
  const [lossNote, setLossNote] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [lossSaving, setLossSaving] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionMenu, setActionMenu] = useState<{ record: QuotationHistoryRecord; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);
  const [batchVoidRecords, setBatchVoidRecords] = useState<QuotationHistoryRecord[]>([]);
  const canSelect = listView === "active" && !loading;
  const allSelected = records.length > 0 && records.every(record => selectedIds.has(record.id));
  useEffect(() => { setSelectedIds(new Set()); }, [page, query, contractNo, from, to, listView, refreshToken]);
  const archiveSelected = async () => {
    if (!selectedIds.size || archiving) return;
    setArchiving(true);
    setLoadError("");
    try {
      const response = await fetch("/api/quotation-history", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "archive", ids: [...selectedIds]})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "批量归档失败，请重试。");
      setNotice(`已归档 ${data.archivedCount} 份报价单，可在“已归档”中查看。`);
      setSelectedIds(new Set());
      setPage(1);
      setRefreshToken(current => current + 1);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "批量归档失败，请重试。"); }
    finally { setArchiving(false); }
  };
  const voidSelected = async (event: FormEvent) => {
    event.preventDefault();
    if (!batchVoidRecords.length || actionSaving) return;
    setActionSaving(true); setActionError("");
    try {
      const response = await fetch("/api/quotation-history", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", ids: batchVoidRecords.map(record => record.id), voidReason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "批量作废失败，请重试。");
      setNotice(`已作废 ${data.voidedCount} 份报价单，可在“已作废”中查看。`);
      setBatchVoidRecords([]); setSelectedIds(new Set()); setPage(1);
      setRefreshToken(current => current + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : "批量作废失败，请重试。"); }
    finally { setActionSaving(false); }
  };
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((data) => setAuth(data.authenticated ? "signedIn" : "signedOut"))
      .catch(() => setAuth("signedOut"));
  }, []);

  useEffect(() => {
    if (auth !== "signedIn") return;
    fetch(`/api/quotation-history?contracts=1&archived=${showArchived ? "1" : "0"}&voided=${showVoided ? "1" : "0"}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ContractsResponse | null) => setContracts(data?.contracts || []))
      .catch(() => setContracts([]));
  }, [auth, showArchived, showVoided, refreshToken]);

  useEffect(() => {
    if (auth !== "signedIn") return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set("query", query);
    if (contractNo) params.set("contractNo", contractNo);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (showArchived) params.set("archived", "1");
    if (showVoided) params.set("voided", "1");
    fetch(`/api/quotation-history?${params}`)
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data: HistoryResponse | null) => {
        if (cancelled || !data) return;
        setLoadError("");
        setRecords(data.quotations || []);
        setTotal(data.total || 0);
      })
      .catch(() => { if (!cancelled) setLoadError("报价列表读取失败，请点击搜索重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [auth, page, query, contractNo, from, to, showArchived, showVoided, refreshToken]);

  useEffect(() => {
    if (!actionMenu) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const closeMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-history-actions]")) return;
      setActionMenu(null);
    };
    const closeOnMove = () => setActionMenu(null);
    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("resize", closeOnMove);
    window.addEventListener("scroll", closeOnMove, true);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("resize", closeOnMove);
      window.removeEventListener("scroll", closeOnMove, true);
    };
  }, [actionMenu]);

  const openAction = (kind: "confirm" | "void", record: QuotationHistoryRecord) => {
    setActionMenu(null);
    setFinalAmount("");
    setVoidReason("");
    setActionError("");
    setActionDialog({ kind, record });
  };
  const saveAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!actionDialog || actionSaving) return;
    if (actionDialog.kind === "confirm" && (!/^\d+(\.\d{1,2})?$/.test(finalAmount) || Number(finalAmount) <= 0)) {
      setActionError("请输入大于 0 的最终成交价格，最多两位小数。");
      return;
    }
    setActionSaving(true);
    setActionError("");
    try {
      const response = await fetch("/api/quotation-history", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionDialog.record.id, action: actionDialog.kind,
          ...(actionDialog.kind === "confirm" ? { finalAmount: Number(finalAmount), finalCurrency: actionDialog.record.currency } : { voidReason }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败，请重试。");
      setNotice(actionDialog.kind === "confirm" ? `已最终确认，成交价格 ${formatAmount(Number(finalAmount), actionDialog.record.currency)}` : `${actionDialog.record.contractNo} 已作废，可在“已作废”中查看。`);
      setActionDialog(null);
      setRefreshToken((current) => current + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "保存失败，请检查网络后重试。");
    } finally { setActionSaving(false); }
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setRefreshToken((current) => current + 1);
    setQuery(queryDraft.trim());
    setContractNo(contractNoDraft);
    setFrom(fromDraft ? new Date(fromDraft).toISOString() : "");
    setTo(toDraft ? new Date(toDraft).toISOString() : "");
  };

  const switchArchiveView = (view: "active" | "archived" | "voided") => {
    setListView(view);
    setActionMenu(null);
    setPage(1);
    setContractNoDraft("");
    setContractNo("");
  };

  const markLost = async () => {
    if (!lossDialogRecord) return;
    setLossSaving(true);
    try {
      const response = await fetch("/api/quotation-history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lossDialogRecord.id,
          action: "lost",
          lossReason,
          lossNote,
          nextFollowUpAt,
        }),
      });
      if (!response.ok) throw new Error();
      setLossDialogRecord(null);
      setRefreshToken((current) => current + 1);
    } catch {
      window.alert("标记未成交失败，请稍后重试。");
    } finally {
      setLossSaving(false);
    }
  };

  const reactivateQuotation = async (record: QuotationHistoryRecord) => {
    if (!window.confirm(`确认重新激活“${record.projectName}”？项目将恢复为已报价，并可从最新版本继续报价。`)) return;
    try {
      const response = await fetch("/api/quotation-history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, action: "reactivate" }),
      });
      if (!response.ok) throw new Error();
      setRefreshToken((current) => current + 1);
    } catch {
      window.alert("重新激活失败，请稍后重试。");
    }
  };

  const openLossDialog = (record: QuotationHistoryRecord) => {
    setActionMenu(null);
    setLossDialogRecord(record);
    setLossReason(lossReasons.includes(record.lossReason as (typeof lossReasons)[number]) ? record.lossReason as (typeof lossReasons)[number] : "价格");
    setLossNote(record.lossNote || "");
    setNextFollowUpAt(record.nextFollowUpAt || "");
  };

  if (auth === "checking")
    return <main className="quoteHistoryPage"><p>正在读取报价历史…</p></main>;
  if (auth === "signedOut") {
    if (typeof window !== "undefined") window.location.replace("/");
    return null;
  }

  return (
    <main className="quoteHistoryPage">
      <header className="quoteHistoryPageHeader">
        <a className="outline" href="/">返回选品 / Back</a>
        <div>
          <h1>报价历史</h1>
          <p>同一项目会自动生成 -R01、-R02 等后序编号；所有历史版本永久保留。最终确认时填写议价后的成交总额；作废仅影响当前版本，历史记录继续保留。</p>
        </div>
      </header>

      <section className="quoteHistoryArchive" aria-label="报价历史列表">
        <div className="quoteHistoryViewSwitch" role="group" aria-label="报价单列表范围">
          <button className={listView === "active" ? "primary" : "outline"} onClick={() => switchArchiveView("active")}>主列表</button>
          <button className={showArchived ? "primary" : "outline"} onClick={() => switchArchiveView("archived")}>已归档</button>
          <button className={showVoided ? "primary" : "outline"} onClick={() => switchArchiveView("voided")}>已作废</button>
        </div>
        <form className="quoteHistorySearch" onSubmit={search}>
          <div className="quoteHistorySearchField quoteHistoryContractFilter">
            <label htmlFor="quotation-history-contract">项目合同</label>
            <select
              id="quotation-history-contract"
              value={contractNoDraft}
              onChange={(event) => setContractNoDraft(event.target.value)}
            >
              <option value="">全部项目合同</option>
              {contracts.map((contract) => <option key={contract} value={contract}>{contract}</option>)}
            </select>
          </div>
          <div className="quoteHistorySearchField quoteHistoryKeywordFilter">
            <label htmlFor="quotation-history-search">搜索合同号</label>
            <input
              id="quotation-history-search"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="输入合同号或项目名称"
            />
          </div>
          <div className="quoteHistorySearchField quoteHistoryDateFilter">
            <label htmlFor="quotation-history-from">开始时间</label>
            <input
              id="quotation-history-from"
              type="datetime-local"
              value={fromDraft}
              max={toDraft || undefined}
              onChange={(event) => setFromDraft(event.target.value)}
            />
          </div>
          <div className="quoteHistorySearchField quoteHistoryDateFilter">
            <label htmlFor="quotation-history-to">结束时间</label>
            <input
              id="quotation-history-to"
              type="datetime-local"
              value={toDraft}
              min={fromDraft || undefined}
              onChange={(event) => setToDraft(event.target.value)}
            />
          </div>
          <button className="primary" type="submit">搜索</button>
        </form>
        <div className="quoteHistorySummary">
          <div className="quoteHistoryBatch">
            <b>{viewLabel}共 {total} 份报价单</b>
            {listView === "active" && <>
              <label><input type="checkbox" aria-label="全选当前页报价单" disabled={!canSelect || archiving || !records.length} checked={allSelected} onChange={event => setSelectedIds(event.target.checked ? new Set(records.map(record => record.id)) : new Set())} />全选当前页</label>
              <span>已选 {selectedIds.size} 份</span>
              <button className="outline" disabled={!selectedIds.size || archiving || loading} onClick={() => void archiveSelected()}>{archiving ? "归档中…" : "批量归档"}</button>
              <button className="outline quoteHistoryDanger" disabled={!selectedIds.size || archiving || loading || actionSaving} onClick={() => { setBatchVoidRecords(records.filter(record => selectedIds.has(record.id))); setVoidReason(""); setActionError(""); }}>批量作废</button>
            </>}
          </div>
          <span>每页 {pageSize} 份</span>
        </div>
        {notice && <p className="quoteHistoryNotice" role="status">{notice}</p>}
        {loadError && <p className="quoteHistoryNotice quoteHistoryError" role="alert">{loadError}</p>}
        <div className="quoteHistoryTableWrap">
          <table className="quoteHistoryTable">
            <thead>
              <tr><th>项目合同号</th><th>项目名称</th><th>报价人</th><th>生成时间</th><th>商务</th><th>保存时成本</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const isLatest = !showArchived && !showVoided && record.isLatest;
                return <tr key={record.id}>
                  <td data-label="项目合同号">
                    <div className="quoteHistoryRecordSelect">
                      {listView === "active" && <input type="checkbox" aria-label={`选择 ${record.contractNo} ${record.projectName}`} checked={selectedIds.has(record.id)} disabled={loading || archiving} onChange={event => setSelectedIds(current => { const next = new Set(current); if (event.target.checked) next.add(record.id); else next.delete(record.id); return next; })} />}
                      <b>{record.contractNo}</b>
                    </div>
                    {record.contractNo.match(/-R\d+$/i) && <small className="quoteHistoryRevision">{record.contractNo.match(/-R\d+$/i)?.[0]?.slice(1)}</small>}
                  </td>
                  <td data-label="项目名称">{record.projectName}</td>
                  <td data-label="报价人">{record.createdByName || (record.createdBy ? "姓名未设置" : "历史未归属")}</td>
                  <td data-label="生成时间">{new Date(record.generatedAt).toLocaleString("zh-CN")}</td>
                  <td data-label="商务">{record.salesName || "待补充"}</td>
                  <td data-label="保存时成本">{!record.canViewCost ? "—" : record.estimatedCost === null ? "历史成本未记录" : <>{formatAmount(record.estimatedCost, "CNY")}{record.missingCostCount > 0 && <small className="quoteHistoryDetail">已知成本小计 · {record.missingCostCount}项成本未记录</small>}</>}</td>
                  <td data-label="状态">
                    <span className={record.voidedAt || record.projectStatus === "lost" ? "quoteHistoryLost" : ""}>{record.voidedAt ? "已作废" : projectStatusLabel[record.projectStatus] || (record.hasSnapshot ? "已报价" : "仅项目资料")}</span>
                    {record.voidedAt && <small className="quoteHistoryDetail">{record.voidReason || "未填写作废原因"}</small>}
                    {isLatest && <small className="quoteHistoryLatest">最新版本</small>}
                    {record.isFinalized && <small className="quoteHistoryFinal">最终确认版本</small>}
                    {record.isFinalized && <small className="quoteHistoryDealAmount">{record.finalAmount === null ? "成交价待补录" : `成交价 ${formatAmount(record.finalAmount, record.finalCurrency || record.currency)}`}</small>}
                  </td>
                  <td data-label="操作">
                    <div className="quoteHistoryActions" data-history-actions>
                      <a className="outline quoteHistoryOpen" href={`/quotation-handover?quotation=${encodeURIComponent(record.id)}`}>成交交接</a>
                      <a className="outline quoteHistoryOpen" href={`/?quotationHistory=${encodeURIComponent(record.id)}&mode=view`}>查看</a>
                      {!record.voidedAt && !record.archivedAt && <a className="outline quoteHistoryOpen" href={`/trade-documents?quotation=${encodeURIComponent(record.id)}`}>PI / CI / 合同</a>}
                      {!record.voidedAt && !record.archivedAt && record.projectStatus !== "lost" && <a className="primary quoteHistoryOpen" href={`/?quotationHistory=${encodeURIComponent(record.id)}&mode=edit`}>编辑</a>}
                      {!record.voidedAt && !record.archivedAt && <button
                        aria-expanded={actionMenu?.record.id === record.id} aria-haspopup="menu"
                        className="outline quoteHistoryOpen" aria-label={`${record.contractNo} 更多操作`}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          menuTriggerRef.current = event.currentTarget;
                          setActionMenu(actionMenu?.record.id === record.id ? null : {
                            record, left: Math.max(12, Math.min(rect.right - 192, window.innerWidth - 204)),
                            top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 260)),
                          });
                        }} type="button">更多<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>}
                    </div>
                  </td>
                </tr>;
              })}
              {!loading && !records.length && <tr><td colSpan={8} className="quoteHistoryEmpty">没有匹配的报价单。</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="quoteHistoryPagination">
          <button className="outline" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button className="outline" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>下一页</button>
        </footer>
      </section>
      {actionMenu && createPortal(<div className="quoteHistoryMoreMenu" role="menu" aria-label="报价操作" ref={menuRef} data-history-actions style={{ left: actionMenu.left, top: actionMenu.top }} onKeyDown={(event) => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
        if (event.key === "Escape" || event.key === "Tab") { setActionMenu(null); menuTriggerRef.current?.focus(); }
      }}>
        {actionMenu.record.hasSnapshot && <>
          <a role="menuitem" href={`/?quotationHistory=${encodeURIComponent(actionMenu.record.id)}&mode=export&format=pdf`}>导出 PDF</a>
          <a role="menuitem" href={`/?quotationHistory=${encodeURIComponent(actionMenu.record.id)}&mode=export&format=excel`}>导出 Excel</a>
        </>}
        {actionMenu.record.hasSnapshot && actionMenu.record.projectStatus !== "lost" && (!actionMenu.record.isFinalized || actionMenu.record.finalAmount === null) && <button role="menuitem" type="button" onClick={() => openAction("confirm", actionMenu.record)}>{actionMenu.record.isFinalized ? "补录成交价格" : "最终确认"}</button>}
        {actionMenu.record.isLatest && actionMenu.record.projectStatus !== "lost" && <button role="menuitem" type="button" onClick={() => openLossDialog(actionMenu.record)}>标记未成交</button>}
        {actionMenu.record.isLatest && actionMenu.record.projectStatus === "lost" && <button role="menuitem" type="button" onClick={() => { const record = actionMenu.record; setActionMenu(null); void reactivateQuotation(record); }}>重新激活</button>}
        <div role="separator" />
        <button className="quoteHistoryDanger" role="menuitem" type="button" onClick={() => openAction("void", actionMenu.record)}>作废</button>
      </div>, document.body)}
      {batchVoidRecords.length > 0 && <HistoryActionDialog title={`批量作废 ${batchVoidRecords.length} 份报价单`} busy={actionSaving} onClose={() => setBatchVoidRecords([])}>
        <form onSubmit={event => void voidSelected(event)}>
          <p>仅作废以下选中的版本。记录继续保留，作废后不能编辑、导出或最终确认，也不再计入有效报价统计。</p>
          <ul>{batchVoidRecords.map(record => <li key={record.id}>{record.contractNo} · {record.projectName}</li>)}</ul>
          {batchVoidRecords.some(record => record.isFinalized) && <p className="quoteHistoryError">包含 {batchVoidRecords.filter(record => record.isFinalized).length} 份已最终确认的报价，作废后将取消其有效确认状态。</p>}
          <label htmlFor="batch-void-reason">作废原因（可选，应用于本批全部报价）</label>
          <textarea autoFocus id="batch-void-reason" maxLength={600} value={voidReason} onChange={event => setVoidReason(event.target.value)} />
          {actionError && <p className="quoteHistoryError" role="alert">{actionError}</p>}
          <footer><button type="button" className="outline" disabled={actionSaving} onClick={() => setBatchVoidRecords([])}>取消</button><button className="quoteHistoryVoidButton" type="submit" disabled={actionSaving}>{actionSaving ? "作废中…" : `确认作废 ${batchVoidRecords.length} 份`}</button></footer>
        </form>
      </HistoryActionDialog>}
      {actionDialog && <HistoryActionDialog title={actionDialog.kind === "confirm" ? "最终确认" : "作废报价"} busy={actionSaving} onClose={() => setActionDialog(null)}>
        <form onSubmit={saveAction}>
          <p className="quoteHistoryDialogProject">{actionDialog.record.projectName}<br />{actionDialog.record.contractNo}</p>
          {actionDialog.kind === "confirm" ? <>
            <div className="quoteHistoryOriginalAmount"><span>原报价总额</span><strong>{actionDialog.record.quotedAmount === null ? "金额待补充" : formatAmount(actionDialog.record.quotedAmount, actionDialog.record.currency)}</strong></div>
            <label htmlFor="quotation-final-amount">最终成交价格（{actionDialog.record.currency}）</label>
            <input autoFocus id="quotation-final-amount" inputMode="decimal" required autoComplete="off" value={finalAmount} onChange={(event) => setFinalAmount(event.target.value)} placeholder="填写与客户谈妥的最终总额" aria-describedby="quotation-final-help" />
            <p id="quotation-final-help">含谈妥的税费、运输及安装等费用。确认后用于项目金额统计，原报价内容保留。</p>
            {finalAmount && Number.isFinite(Number(finalAmount)) && Number(finalAmount) > 0 && actionDialog.record.quotedAmount !== null && <p className="quoteHistoryPriceDifference">较原报价{Number(finalAmount) > actionDialog.record.quotedAmount ? "增加" : "减少"} {formatAmount(Math.abs(Number(finalAmount) - actionDialog.record.quotedAmount), actionDialog.record.currency)}</p>}
          </> : <>
            <p>仅作废当前版本。作废后保留记录供查看，不能编辑、导出或最终确认，也不再计入有效报价统计。</p>
            {actionDialog.record.isFinalized && <p className="quoteHistoryError">该版本已经最终确认，作废后将取消其有效确认状态。</p>}
            <label htmlFor="quotation-void-reason">作废原因（可选）</label>
            <textarea autoFocus id="quotation-void-reason" maxLength={600} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="例如：重复生成、方案已取消" />
          </>}
          {actionError && <p className="quoteHistoryError" role="alert">{actionError}</p>}
          <footer><button className="outline" disabled={actionSaving} type="button" onClick={() => setActionDialog(null)}>取消</button><button className={actionDialog.kind === "void" ? "quoteHistoryVoidButton" : "primary"} disabled={actionSaving} type="submit">{actionSaving ? "保存中…" : actionDialog.kind === "confirm" ? "确认成交价格" : "确认作废"}</button></footer>
        </form>
      </HistoryActionDialog>}
      {lossDialogRecord && <div className="quoteHistoryLossOverlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLossDialogRecord(null); }}>
        <section className="quoteHistoryLossDialog" aria-modal="true" aria-label="标记未成交" role="dialog">
          <div><span>PROJECT OUTCOME</span><h2>标记未成交</h2><p>{lossDialogRecord.projectName} · {lossDialogRecord.contractNo}</p></div>
          <button aria-label="关闭标记未成交" className="quoteHistoryLossClose" onClick={() => setLossDialogRecord(null)} type="button">×</button>
          <label>未成交原因<select value={lossReason} onChange={(event) => setLossReason(event.target.value as (typeof lossReasons)[number])}>{lossReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
          <label>备注<textarea maxLength={600} onChange={(event) => setLossNote(event.target.value)} placeholder="可填写客户反馈或后续处理说明" value={lossNote} /></label>
          <label>下次跟进日期（可选）<input onChange={(event) => setNextFollowUpAt(event.target.value)} type="date" value={nextFollowUpAt} /></label>
          <div className="quoteHistoryLossActions"><button className="outline" onClick={() => setLossDialogRecord(null)} type="button">取消</button><button className="primary" disabled={lossSaving} onClick={() => void markLost()} type="button">{lossSaving ? "保存中" : "确认标记未成交"}</button></div>
        </section>
      </div>}
    </main>
  );
}

function HistoryActionDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={ref} className="quoteHistoryActionDialog" aria-labelledby="quotation-action-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <h2 id="quotation-action-title">{title}</h2>
    <button className="quoteHistoryDialogClose" aria-label="关闭弹窗" disabled={busy} type="button" onClick={onClose}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="m4 4 10 10M14 4 4 14" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    {children}
  </dialog>;
}

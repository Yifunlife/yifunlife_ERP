"use client";

import { useEffect, useMemo, useState } from "react";

type Currency = "CNY" | "USD";
type ProjectStatus = "quoted" | "confirmed" | "won" | "lost";

type QuoteVersion = {
  id: string;
  contractNo: string;
  generatedAt: string;
  isFinalized: boolean;
  currency: Currency;
  amount: number;
  hasAmount: boolean;
  skuCount: number;
};

type Project = {
  key: string;
  id: string;
  contractNo: string;
  projectName: string;
  createdBy: string;
  generatedAt: string;
  isFinalized: boolean;
  projectStatus: ProjectStatus;
  statusUpdatedAt: string;
  customerName: string;
  lastFollowUpAt: string;
  quoteValidUntil: string;
  lossReason: string;
  lossNote: string;
  nextFollowUpAt: string;
  currency: Currency;
  amount: number;
  hasAmount: boolean;
  quotedAmount: number | null;
  finalAmount: number | null;
  costAmount: number | null;
  costCurrency: "CNY";
  hasCost: boolean;
  skuCount: number;
  salesName: string;
  items: Array<{ sku: string; name: string; quantity: number }>;
  versions: QuoteVersion[];
};

type DashboardResponse = {
  generatedAt: string;
  canViewCosts: boolean;
  quotationCount: number;
  projects: Project[];
};

type MoneyTotals = Record<Currency, number>;
const emptyMoney = (): MoneyTotals => ({ CNY: 0, USD: 0 });
const addMoney = (totals: MoneyTotals, item: Pick<Project, "currency" | "amount">) => {
  totals[item.currency] += item.amount;
  return totals;
};
const formatMoney = (amount: number, currency: Currency) =>
  currency === "USD"
    ? `USD $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `CNY ¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel: Record<ProjectStatus, string> = {
  quoted: "已报价",
  confirmed: "已确定",
  won: "已成交",
  lost: "未成交 / 丢单",
};
const dateValue = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
};
const daysUntil = (value: string, now: number) => {
  const date = dateValue(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now) / 86_400_000);
};
const monthKey = (value: string) => {
  const date = dateValue(value);
  return date ? `${date.getFullYear()}-${date.getMonth()}` : "";
};

export default function CEODashboardPage() {
  const [auth, setAuth] = useState<"checking" | "signedOut" | "signedIn">("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [canViewCosts, setCanViewCosts] = useState(false);
  const [quotationCount, setQuotationCount] = useState(0);
  const [asOf, setAsOf] = useState(0);
  const [rankCurrency, setRankCurrency] = useState<Currency>("CNY");
  const [range, setRange] = useState<"all" | "month" | "quarter" | "year">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedTeamName, setSelectedTeamName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("quoted");
  const [customerName, setCustomerName] = useState("");
  const [lastFollowUpAt, setLastFollowUpAt] = useState("");
  const [quoteValidUntil, setQuoteValidUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState("financials");

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ceo-dashboard");
      if (!response.ok) throw new Error();
      const data = (await response.json()) as DashboardResponse;
      setAsOf(Date.parse(data.generatedAt) || Date.now());
      setCanViewCosts(Boolean(data.canViewCosts));
      setProjects(data.projects || []);
      setQuotationCount(data.quotationCount || 0);
    } catch {
      setError("看板数据暂时无法读取，请刷新后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((data) => { setAuth(data.authenticated ? "signedIn" : "signedOut"); if (data.authenticated) void loadDashboard(); })
      .catch(() => setAuth("signedOut"));
  }, []);

  useEffect(() => {
    if (auth !== "signedIn") return;
    const sectionIds = ["financials", "top-projects", "lost-projects", "team", "attention"];
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-18% 0px -62%", threshold: [0, 0.15, 0.45] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [auth]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  useEffect(() => {
    if (!selectedProject) return;
    setProjectStatus(selectedProject.projectStatus);
    setCustomerName(selectedProject.customerName);
    setLastFollowUpAt(selectedProject.lastFollowUpAt);
    setQuoteValidUntil(selectedProject.quoteValidUntil);
  }, [selectedProject]);

  const visibleProjects = useMemo(() => {
    if (range === "all") return projects;
    const now = new Date(asOf);
    return projects.filter((project) => {
      const generatedAt = dateValue(project.generatedAt);
      if (!generatedAt) return false;
      if (range === "month")
        return generatedAt.getFullYear() === now.getFullYear() && generatedAt.getMonth() === now.getMonth();
      if (range === "quarter")
        return generatedAt.getFullYear() === now.getFullYear() && Math.floor(generatedAt.getMonth() / 3) === Math.floor(now.getMonth() / 3);
      return generatedAt.getFullYear() === now.getFullYear();
    });
  }, [projects, range, asOf]);
  const activeProjects = visibleProjects.filter((project) => project.projectStatus !== "lost");
  const lostProjects = visibleProjects.filter((project) => project.projectStatus === "lost");
  const confirmedProjects = activeProjects.filter((project) => project.projectStatus === "confirmed" || project.projectStatus === "won");
  const wonProjects = activeProjects.filter((project) => project.projectStatus === "won");
  const finalProjects = activeProjects;
  const visibleQuoteCount = activeProjects.reduce((total, project) => total + project.versions.length, 0);
  const finalTopProjects = finalProjects
    .filter((project) => project.hasAmount && project.currency === rankCurrency)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 10);
  const finalTopMaximums = amountMaximums(finalTopProjects);
  const lostProjectMaximums = amountMaximums(lostProjects);
  const lostMoney = lostProjects.reduce((totals, project) => addMoney(totals, project), emptyMoney());
  const lossReasonStats = (() => {
    const reasons = ["价格", "预算", "竞品", "项目取消", "暂缓", "其他"];
    return reasons.map((reason) => {
      const reasonProjects = lostProjects.filter((project) => (project.lossReason || "其他") === reason);
      return {
        reason,
        count: reasonProjects.length,
        money: reasonProjects.reduce((totals, project) => addMoney(totals, project), emptyMoney()),
      };
    });
  })();
  const confirmedRate = activeProjects.length ? (confirmedProjects.length / activeProjects.length) * 100 : 0;
  const wonRate = confirmedProjects.length ? (wonProjects.length / confirmedProjects.length) * 100 : 0;

  const trends = useMemo(() => {
    const now = new Date(asOf);
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`;
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousKey = `${previous.getFullYear()}-${previous.getMonth()}`;
    const summarize = (key: string) => {
      const quoted = projects.filter((project) => project.projectStatus !== "lost" && monthKey(project.generatedAt) === key);
      const confirmed = projects.filter((project) => (project.projectStatus === "confirmed" || project.projectStatus === "won") && monthKey(project.statusUpdatedAt) === key);
      const won = projects.filter((project) => project.projectStatus === "won" && monthKey(project.statusUpdatedAt) === key);
      return {
        quoted: quoted.length,
        confirmed: confirmed.length,
        won: won.length,
        money: quoted.reduce((totals, project) => addMoney(totals, project), emptyMoney()),
      };
    };
    return { current: summarize(currentKey), previous: summarize(previousKey) };
  }, [projects, asOf]);
  const team = (() => {
    const records = new Map<string, { quoted: number; confirmed: number; won: number; money: MoneyTotals }>();
    activeProjects.forEach((project) => {
      const key = project.salesName || "待补充";
      const row = records.get(key) || { quoted: 0, confirmed: 0, won: 0, money: emptyMoney() };
      row.quoted += 1;
      if (project.projectStatus !== "quoted") row.confirmed += 1;
      if (project.projectStatus === "won") row.won += 1;
      addMoney(row.money, project);
      records.set(key, row);
    });
    return [...records.entries()].sort((left, right) => right[1].quoted - left[1].quoted);
  })();
  const expiringProjects = activeProjects.filter((project) => {
    const days = daysUntil(project.quoteValidUntil, asOf);
    return project.projectStatus === "quoted" && days !== null && days >= 0 && days <= 7;
  });
  const overdueFollowUps = activeProjects.filter((project) => {
    const date = dateValue(project.lastFollowUpAt);
    return project.projectStatus !== "won" && date && asOf - date.getTime() > 14 * 86_400_000;
  });
  const highUnconfirmed = activeProjects
    .filter((project) => project.projectStatus === "quoted" && project.hasAmount)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5);
  const confirmedNotWon = activeProjects.filter((project) => project.projectStatus === "confirmed");
  const selectedTeamProjects = selectedTeamName
    ? activeProjects.filter((project) => (project.salesName || "待补充") === selectedTeamName)
    : [];
  const selectedTeamMaximums = amountMaximums(selectedTeamProjects);

  const openProject = (project: Project) => setSelectedProjectId(project.id);
  const navigateToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const saveProject = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      const response = await fetch("/api/quotation-history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedProject.id,
          action: "project",
          projectStatus,
          customerName,
          lastFollowUpAt,
          quoteValidUntil,
        }),
      });
      if (!response.ok) throw new Error();
      setSelectedProjectId("");
      await loadDashboard();
    } catch {
      window.alert("项目状态保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  if (auth === "checking") return <main className="ceoDashboard"><p>正在读取 CEO 看板…</p></main>;
  if (auth === "signedOut") {
    if (typeof window !== "undefined") window.location.replace("/");
    return null;
  }

  return (
    <main className="ceoDashboard">
      <aside className="ceoDashboardRail">
        <a className="ceoDashboardBrand" href="/" aria-label="返回亦玩集团选品系统">
          <img src="/brand/yifun-life-logo.png" alt="亦玩集团 Yifun Life" />
        </a>
        <a className="ceoDashboardBack" href="/?catalog=1">进入主界面</a>
        {canViewCosts && <a className="ceoDashboardBack" href="/costing">核算管理</a>}
        <div className="ceoDashboardRailTitle">
          <h1>CEO 看板</h1>
          <p>亦玩集团 · 经营管理</p>
        </div>
        <nav className="ceoDashboardNav" aria-label="看板重点导航">
          {[
            ["financials", "金额与利润"],
            ["top-projects", "项目 Top 10"],
            ["lost-projects", "未成交项目"],
            ["attention", "待关注"],
            ["team", "团队"],
          ].map(([sectionId, label]) => (
            <a
              className={activeSection === sectionId ? "on" : ""}
              aria-current={activeSection === sectionId ? "location" : undefined}
              href={`#${sectionId}`}
              key={sectionId}
              onClick={(event) => {
                event.preventDefault();
                navigateToSection(sectionId);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <a className="ceoRailHistory" href="/quotation-history">报价历史与确认<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></a>
      </aside>
      <section className="ceoDashboardWorkspace">
      <header className="ceoDashboardHeader">
        <div className="ceoHeaderTitle">
          <h2>经营概览</h2>
          <p>从报价到成交，关注项目金额与推进情况。</p>
          <small className="ceoUpdatedAt">{asOf ? `数据更新于 ${new Date(asOf).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "正在读取最新数据"}</small>
        </div>
        <div className="ceoDashboardActions">
          <div className="ceoRange" role="group" aria-label="时间范围">
            {(["all", "month", "quarter", "year"] as const).map((option) => (
              <button aria-pressed={range === option} className={range === option ? "on" : ""} key={option} onClick={() => setRange(option)} type="button">
                {{ all: "全部", month: "本月", quarter: "本季度", year: "本年" }[option]}
              </button>
            ))}
          </div>
          <button className="outline" disabled={loading} onClick={() => void loadDashboard()} type="button">{loading ? "更新中…" : "刷新数据"}</button>
        </div>
      </header>

      {error && <p className="ceoDashboardError" role="alert">{error}</p>}
      <section className="ceoStageTrack" aria-label="订单总览">
        <article><span>已报价单数</span><strong>{loading && !asOf ? "—" : visibleQuoteCount}<em>份</em></strong><small>有效项目的报价版本</small></article>
        <article><span>已确定订单数</span><strong>{loading && !asOf ? "—" : confirmedProjects.length}<em>个</em></strong><small>客户已确认的项目</small></article>
        <article><span>已成交订单数</span><strong>{loading && !asOf ? "—" : wonProjects.length}<em>个</em></strong><small>合同与首款均已确认</small></article>
      </section>

      <section className="ceoFinancialSection" id="financials" aria-label="金额、成本与毛利">
        <div className="ceoFinancialTitle">
          <div><h2>金额与利润</h2><p>已确认项目优先取成交价；未录入成交价的旧记录保留报价金额。</p></div>
          {canViewCosts && <small>成本统一以人民币记录；不做跨币种利润换算</small>}
        </div>
        <div className="ceoCurrencyLedgers" aria-label="按币种统计的项目金额" aria-busy={loading}>
          {(["CNY", "USD"] as const).map((currency) => <CurrencyLedger key={currency} currency={currency} canViewCosts={canViewCosts} groups={[
            { label: "项目总金额", projects: activeProjects },
            { label: "已确定金额", projects: confirmedProjects },
            { label: "已成交金额", projects: wonProjects },
          ]} />)}
        </div>
      </section>

      <section className="ceoSplitGrid">
        <article className="ceoPanel">
          <div className="ceoPanelTitle"><h2>转化</h2><span>当前范围</span></div>
          <div className="ceoConversionRows">
            <div><span>报价 → 确定</span><strong>{confirmedRate.toFixed(1)}%</strong><small>{activeProjects.length} 个项目中 {confirmedProjects.length} 个已确定</small></div>
            <div><span>确定 → 成交</span><strong>{wonRate.toFixed(1)}%</strong><small>{confirmedProjects.length} 个已确定项目中 {wonProjects.length} 个已成交</small></div>
          </div>
        </article>
        <article className="ceoPanel">
          <div className="ceoPanelTitle"><h2>趋势</h2><span>本月 / 上月</span></div>
          <div className="ceoTableWrap"><table className="ceoTrendTable"><thead><tr><th></th><th>报价</th><th>确定</th><th>成交</th><th>CNY</th><th>USD</th></tr></thead><tbody>
            <tr><td>本月</td><td>{trends.current.quoted}</td><td>{trends.current.confirmed}</td><td>{trends.current.won}</td><td>{formatMoney(trends.current.money.CNY, "CNY")}</td><td>{formatMoney(trends.current.money.USD, "USD")}</td></tr>
            <tr><td>上月</td><td>{trends.previous.quoted}</td><td>{trends.previous.confirmed}</td><td>{trends.previous.won}</td><td>{formatMoney(trends.previous.money.CNY, "CNY")}</td><td>{formatMoney(trends.previous.money.USD, "USD")}</td></tr>
          </tbody></table></div>
        </article>
      </section>

      <section className="ceoPanel ceoTopProjects" id="top-projects">
        <div className="ceoPanelTitle"><div><h2>项目金额 Top 10</h2><p>按同一币种排序；点击项目查看报价与成交详情。</p></div><div className="ceoCurrencySwitch" role="group" aria-label="排名币种">{(["CNY", "USD"] as const).map((currency) => <button key={currency} type="button" aria-pressed={rankCurrency === currency} className={rankCurrency === currency ? "on" : ""} onClick={() => setRankCurrency(currency)}>{currency}</button>)}</div></div>
        <div className="ceoTableWrap"><table className="ceoTable"><thead><tr><th>项目</th><th>项目合同号</th><th>客户</th><th>负责人</th><th>状态</th><th>项目金额</th></tr></thead><tbody>
          {finalTopProjects.map((project) => <tr key={project.id}><td><button className="ceoProjectName" type="button" onClick={() => openProject(project)}>{project.projectName}</button></td><td>{project.contractNo}</td><td>{project.customerName || "待补充"}</td><td>{project.salesName}</td><td><StatusBadge status={project.projectStatus} /></td><td><AmountBar project={project} maximums={finalTopMaximums} /></td></tr>)}
          {!loading && !finalTopProjects.length && <tr><td className="ceoEmpty" colSpan={6}>当前币种暂无有效项目，可切换币种查看。</td></tr>}
        </tbody></table></div>
      </section>

      <section className="ceoPanel ceoLostProjects" id="lost-projects">
        <div className="ceoPanelTitle"><div><h2>未成交项目</h2><p>已丢单项目不计入待推进、已确定及已成交统计；点击可查看原因与历史版本。</p></div><span>{lostProjects.length} 个项目</span></div>
        <div className="ceoLostOverview"><div><span>未成交金额</span><strong>{formatMoney(lostMoney.CNY, "CNY")}</strong><strong>{formatMoney(lostMoney.USD, "USD")}</strong></div><div><span>主要原因统计</span><small>按当前项目的未成交原因汇总</small></div></div>
        <div className="ceoLossReasonGrid">{lossReasonStats.map((stat) => <div key={stat.reason}><b>{stat.reason}</b><span>{stat.count} 个项目</span><small>{formatMoney(stat.money.CNY, "CNY")} · {formatMoney(stat.money.USD, "USD")}</small></div>)}</div>
        <div className="ceoTeamQuoteList ceoLostProjectList">{lostProjects.map((project) => <button key={project.id} onClick={() => openProject(project)} type="button"><div><b>{project.projectName}</b><small>{project.contractNo} · {project.lossReason || "其他"}{project.nextFollowUpAt ? ` · 下次跟进 ${project.nextFollowUpAt}` : ""}</small></div><StatusBadge status={project.projectStatus} /><AmountBar maximums={lostProjectMaximums} project={project} /></button>)}{!loading && !lostProjects.length && <p>当前范围没有未成交项目。</p>}</div>
      </section>

      <section className="ceoPanel" id="attention">
        <div className="ceoPanelTitle"><div><h2>CEO 待关注</h2><p>只显示仍需推进的当前项目；点击可进入项目资料维护。</p></div></div>
        <div className="ceoRiskGrid">
          <RiskList label="即将到期报价" projects={expiringProjects} render={(project) => `${daysUntil(project.quoteValidUntil, asOf)} 天后到期`} onOpen={openProject} />
          <RiskList label="长期未跟进项目" projects={overdueFollowUps} render={(project) => `上次跟进 ${project.lastFollowUpAt}`} onOpen={openProject} />
          <RiskList label="金额高但未确定项目" projects={highUnconfirmed} render={(project) => formatMoney(project.amount, project.currency)} showAmountBar onOpen={openProject} />
          <RiskList label="已确定但未成交项目" projects={confirmedNotWon} render={(project) => project.statusUpdatedAt ? `确定于 ${project.statusUpdatedAt.slice(0, 10)}` : "待补充确定日期"} onOpen={openProject} />
        </div>
      </section>

      <section className="ceoPanel" id="team">
        <div className="ceoPanelTitle"><h2>团队</h2><span>当前范围</span></div>
        <div className="ceoTableWrap"><table className="ceoTable"><thead><tr><th>负责人</th><th>报价项目</th><th>已确定</th><th>已成交</th><th>CNY 项目金额</th><th>USD 项目金额</th></tr></thead><tbody>
          {team.map(([name, data]) => <tr className="ceoTeamRow" key={name}><td><button className="ceoTeamMemberButton" onClick={() => setSelectedTeamName(name)} type="button">{name}<span>查看报价单</span></button></td><td>{data.quoted}</td><td>{data.confirmed}</td><td>{data.won}</td><td>{formatMoney(data.money.CNY, "CNY")}</td><td>{formatMoney(data.money.USD, "USD")}</td></tr>)}
          {!loading && !team.length && <tr><td className="ceoEmpty" colSpan={6}>暂无项目数据。</td></tr>}
        </tbody></table></div>
      </section>

      <p className="ceoDashboardFootnote">共读取 {quotationCount} 份未归档、未作废的报价记录；缺少价格、客户、有效期或跟进日期的旧记录不会被自动补写。</p>

      {selectedTeamName && <div className="ceoProjectOverlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTeamName(""); }}>
        <aside className="ceoProjectDrawer" aria-label={`${selectedTeamName} 的报价单`}>
          <div className="ceoProjectHead"><div><h2>{selectedTeamName}</h2><span>当前范围内的报价单 · {selectedTeamProjects.length} 个项目</span></div><button aria-label="关闭负责人报价单" onClick={() => setSelectedTeamName("")} type="button">×</button></div>
          <div className="ceoProjectContent">
            <section><h3>报价单</h3><div className="ceoTeamQuoteList">{selectedTeamProjects.map((project) => <button key={project.id} onClick={() => { setSelectedTeamName(""); openProject(project); }} type="button"><div><b>{project.projectName}</b><small>{project.contractNo} · {project.customerName || "客户待补充"}</small></div><StatusBadge status={project.projectStatus} /><AmountBar maximums={selectedTeamMaximums} project={project} /></button>)}{!selectedTeamProjects.length && <p>当前范围没有该负责人的报价单。</p>}</div></section>
          </div>
        </aside>
      </div>}
      {selectedProject && <div className="ceoProjectOverlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProjectId(""); }}>
        <aside className="ceoProjectDrawer" aria-label="项目详情">
          <div className="ceoProjectHead"><div><h2>{selectedProject.projectName}</h2><span>{selectedProject.contractNo}</span></div><button aria-label="关闭项目详情" onClick={() => setSelectedProjectId("")} type="button">×</button></div>
          <div className="ceoProjectContent">
            <section className="ceoProjectFacts"><span>客户：{selectedProject.customerName || "待补充"}</span><span>负责人：{selectedProject.salesName}</span><span>SKU：{selectedProject.skuCount} 款</span><strong>{selectedProject.isFinalized && selectedProject.finalAmount !== null ? "最终成交价格：" : "报价金额："}{formatMoney(selectedProject.amount, selectedProject.currency)}</strong>{selectedProject.isFinalized && selectedProject.finalAmount !== null && selectedProject.quotedAmount !== null && <small>原报价：{formatMoney(selectedProject.quotedAmount, selectedProject.currency)}</small>}{canViewCosts && <small>{selectedProject.hasCost && selectedProject.costAmount !== null ? <>成本价 {formatMoney(selectedProject.costAmount, "CNY")} · {selectedProject.currency === "CNY" ? `毛利 ${formatMoney(selectedProject.amount - selectedProject.costAmount, "CNY")}` : "美元毛利待确认汇率"}</> : "成本待补充，暂不计算毛利"}</small>}</section>
            {selectedProject.projectStatus === "lost" ? <section><h3>未成交信息</h3><div className="ceoLostDetail"><span>原因：{selectedProject.lossReason || "其他"}</span><span>下次跟进：{selectedProject.nextFollowUpAt || "未设置"}</span><p>{selectedProject.lossNote || "未填写备注"}</p><a className="outline" href="/quotation-history">前往报价历史重新激活</a></div></section> : <section><h3>项目状态</h3><div className="ceoProjectForm">
              <label>当前状态<select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value as ProjectStatus)}><option value="quoted">已报价</option><option value="confirmed">已确定</option><option value="won">已成交</option></select></label>
              <label>客户名称<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="待补充" /></label>
              <label>最后跟进日期<input type="date" value={lastFollowUpAt} onChange={(event) => setLastFollowUpAt(event.target.value)} /></label>
              <label>报价有效期<input type="date" value={quoteValidUntil} onChange={(event) => setQuoteValidUntil(event.target.value)} /></label>
            </div><button className="primary ceoProjectSave" disabled={saving} onClick={() => void saveProject()} type="button">{saving ? "保存中" : "保存项目状态"}</button></section>}
            <section><h3>报价版本</h3><div className="ceoVersionList">{selectedProject.versions.map((version) => <div key={version.id}><span>{version.contractNo}</span><small>{new Date(version.generatedAt).toLocaleString("zh-CN")}</small><strong>{version.hasAmount ? formatMoney(version.amount, version.currency) : "金额待补充"}</strong></div>)}</div></section>
            <section><h3>SKU 清单</h3><div className="ceoSkuList">{selectedProject.items.map((item) => <div key={`${item.sku}-${item.name}`}><span>{item.sku || "无 SKU"}</span><b>{item.name}</b><small>× {item.quantity}</small></div>)}{!selectedProject.items.length && <p>该历史报价没有可读取的 SKU 快照。</p>}</div></section>
          </div>
        </aside>
      </div>}
      </section>
    </main>
  );
}

function CurrencyLedger({ currency, groups, canViewCosts }: { currency: Currency; groups: Array<{ label: string; projects: Project[] }>; canViewCosts: boolean }) {
  return <section className={`ceoCurrencyLedger ceoCurrency${currency}`} aria-label={`${currency} ${canViewCosts ? "金额与成本" : "项目金额"}`}>
    <header><h3>{currency}</h3><span>{currency === "CNY" ? "人民币业务" : "美元业务"}</span></header>
    <div className="ceoLedgerRows">{groups.map((group) => {
      const projects = group.projects.filter((project) => project.currency === currency);
      const amount = projects.reduce((total, project) => total + project.amount, 0);
      const cost = projects.reduce((total, project) => total + (project.costAmount || 0), 0);
      const complete = projects.length > 0 && projects.every((project) => project.hasCost && project.costAmount !== null);
      return <div className="ceoLedgerRow" key={group.label}>
        <div><span>{group.label}</span><strong>{formatMoney(amount, currency)}</strong></div>
        {canViewCosts && <p><span>成本 {complete ? formatMoney(cost, "CNY") : projects.length ? "待补充" : "—"}</span><span>{currency === "USD" ? "美元毛利待确认汇率" : complete ? `毛利 ${formatMoney(amount - cost, "CNY")}` : "毛利 —"}</span></p>}
      </div>;
    })}</div>
  </section>;
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`ceoStatus ceoStatus${status}`}>{statusLabel[status]}</span>;
}

function amountMaximums(projects: Project[]): MoneyTotals {
  return projects.reduce((maximums, project) => ({
    ...maximums,
    [project.currency]: Math.max(maximums[project.currency], project.amount),
  }), { CNY: 1, USD: 1 } as MoneyTotals);
}

function AmountBar({ project, maximums }: { project: Project; maximums: MoneyTotals }) {
  const width = Math.max(8, Math.round((project.amount / maximums[project.currency]) * 100));
  return <div className="ceoAmountBar"><span><i style={{ width: `${width}%` }} /></span><b>{formatMoney(project.amount, project.currency)}</b></div>;
}

function RiskList({ label, projects, render, showAmountBar = false, onOpen }: { label: string; projects: Project[]; render: (project: Project) => string; showAmountBar?: boolean; onOpen: (project: Project) => void }) {
  const maximums = amountMaximums(projects);
  return <section className="ceoRiskList"><h3>{label}<small>{projects.length}</small></h3>{projects.slice(0, 5).map((project) => <button key={project.id} onClick={() => onOpen(project)} type="button"><b>{project.projectName}</b>{showAmountBar ? <AmountBar maximums={maximums} project={project} /> : <span>{render(project)}</span>}</button>)}{!projects.length && <p>暂无需要关注的项目。</p>}</section>;
}

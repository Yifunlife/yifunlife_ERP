import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appUsers, catalogProducts, costingRecords, productOverrides, quotationHistory } from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { baseContractNo, quotationProjectKey } from "../../../lib/quotation";
import { quoteAmount, readSnapshot } from "../../../lib/quote-amount";
import { visibleQuoteSnapshot } from "../../../lib/quote-snapshot";
import { workplaceProject } from "../../../lib/workplace";

export const dynamic = "force-dynamic";

const projectStatuses = new Set(["quoted", "confirmed", "won"]);
const lossReasons = new Set(["价格", "预算", "竞品", "项目取消", "暂缓", "其他"]);
const quotationMoney = (snapshotJson: string | null) => {
  const summary = quoteAmount(readSnapshot(snapshotJson));
  return { currency: summary.currency, quotedAmount: summary.hasAmount ? summary.amount : null };
};
const dateOnly = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : "";
const nextRevisionContractNo = (base: string, contracts: string[]) => {
  const pattern = new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-R(\\d+)$`,
    "i",
  );
  const highestRevision = contracts.reduce((highest, contractNo) => {
    const match = contractNo.match(pattern);
    return match ? Math.max(highest, Number(match[1]) || 0) : highest;
  }, 0);
  const unsuffixedCount = contracts.filter((contractNo) => contractNo === base).length;
  return `${base}-R${String(Math.max(highestRevision, unsuffixedCount) + 1).padStart(2, "0")}`;
};

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const nextRevisionOf = url.searchParams.get("nextRevisionOf")?.trim();
  const contractsOnly = url.searchParams.get("contracts") === "1";
  const archived = url.searchParams.get("archived") === "1";
  const voided = url.searchParams.get("voided") === "1";
  const isPrivileged = session.role === "admin" || session.role === "management" || session.role === "ceo";
  const ownershipFilter = isPrivileged
    ? undefined
    : eq(quotationHistory.createdBy, session.email);
  const archiveFilter = voided ? isNotNull(quotationHistory.voidedAt) : and(
    isNull(quotationHistory.voidedAt),
    archived ? isNotNull(quotationHistory.archivedAt) : isNull(quotationHistory.archivedAt),
  );

  if (contractsOnly) {
    const contracts = await getDb()
      .selectDistinct({ contractNo: quotationHistory.contractNo })
      .from(quotationHistory)
      .where(and(ownershipFilter, archiveFilter))
      .orderBy(quotationHistory.contractNo);
    return Response.json({ contracts: contracts.map(({ contractNo }) => contractNo) });
  }

  if (nextRevisionOf) {
    const source = await getDb()
      .select()
      .from(quotationHistory)
      .where(and(eq(quotationHistory.id, nextRevisionOf), ownershipFilter))
      .get();
    if (!source)
      return Response.json({ error: "报价单不存在或无权编辑" }, { status: 404 });
    if (source.voidedAt || source.archivedAt) return Response.json({ error: "作废或归档报价只能查看，不能编辑" }, { status: 409 });
    const contractBase = baseContractNo(source.contractNo);
    const historyContracts = await getDb().select().from(quotationHistory).where(ownershipFilter);
    const relatedContracts = historyContracts
      .filter((quotation) => quotationProjectKey(quotation) === quotationProjectKey(source))
      .map((quotation) => quotation.contractNo);
    return Response.json({
      contractNo: nextRevisionContractNo(contractBase, relatedContracts),
    });
  }

  if (id) {
    const quotation = await getDb()
      .select()
      .from(quotationHistory)
      .where(and(eq(quotationHistory.id, id), ownershipFilter))
      .get();
    if (!quotation)
      return Response.json({ error: "报价单不存在或无权查看" }, { status: 404 });
    let snapshot: unknown = null;
    if (quotation.snapshotJson) {
      try {
        snapshot = visibleQuoteSnapshot({ ...JSON.parse(quotation.snapshotJson), contractNo: quotation.contractNo, projectName: quotation.projectName }, session.role);
      } catch {
        snapshot = null;
      }
    }
    return Response.json({ quotation: { ...quotation, ...quotationMoney(quotation.snapshotJson), snapshot, snapshotJson: undefined } });
  }

  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("pageSize")) || 20));
  const query = url.searchParams.get("query")?.trim() || "";
  const contractNo = url.searchParams.get("contractNo")?.trim() || "";
  const from = url.searchParams.get("from")?.trim() || "";
  const to = url.searchParams.get("to")?.trim() || "";
  const searchFilter = query
    ? or(
        like(quotationHistory.contractNo, `%${query}%`),
        like(quotationHistory.projectName, `%${query}%`),
      )
    : undefined;
  const filters = and(
    ownershipFilter,
    archiveFilter,
    contractNo ? eq(quotationHistory.contractNo, contractNo) : undefined,
    from ? gte(quotationHistory.generatedAt, from) : undefined,
    to ? lte(quotationHistory.generatedAt, to) : undefined,
    searchFilter,
  );
  const db = getDb();
  const totalRow = await db
    .select({ total: count() })
    .from(quotationHistory)
    .where(filters)
    .get();
  const quotations = await db
    .select()
    .from(quotationHistory)
    .where(filters)
    .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const allVersions = await db.select({ id: quotationHistory.id, lineageId: quotationHistory.lineageId, createdBy: quotationHistory.createdBy, contractNo: quotationHistory.contractNo, projectName: quotationHistory.projectName })
    .from(quotationHistory).where(and(ownershipFilter, isNull(quotationHistory.archivedAt), isNull(quotationHistory.voidedAt)))
    .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id));
  const canViewCost = ["admin", "ceo", "cost_accountant"].includes(session.role);
  const catalogCosts = canViewCost ? await db.select({id: productOverrides.productId, cost: productOverrides.cost}).from(productOverrides) : [];
  const costsById = new Map(catalogCosts.filter(product => product.cost !== null).map(product => [product.id, product.cost]));
  const catalogSkus = canViewCost ? await db.select({id: catalogProducts.id, sku: catalogProducts.sku}).from(catalogProducts) : [];
  const costsBySku = new Map(catalogSkus.filter(product => costsById.has(product.id)).map(product => [product.sku.trim().toUpperCase(), costsById.get(product.id)]));
  const creatorEmails = [...new Set(quotations.map(quotation => quotation.createdBy).filter(Boolean))];
  const creators = creatorEmails.length
    ? await db.select({email: appUsers.email, name: appUsers.name}).from(appUsers).where(inArray(appUsers.email, creatorEmails))
    : [];
  const creatorNames = new Map(creators.map(creator => [creator.email, creator.name.trim()]));
  const latestIds = new Map<string, string>();
  allVersions.forEach((record) => { const key = quotationProjectKey(record); if (!latestIds.has(key)) latestIds.set(key, record.id); });
  return Response.json({
    quotations: quotations.map(({ snapshotJson, ...quotation }) => {
      const snapshot = readSnapshot(snapshotJson);
      const summary = quoteAmount(snapshot && canViewCost ? {...snapshot, products: snapshot.products?.map(product => ({
        ...product,
        cost: product.quoteCosting ? product.cost : costsById.get(product.catalogProductId || product.id || "") ?? costsBySku.get(product.sku?.trim().toUpperCase() || "") ?? product.cost,
      }))} : snapshot);
      return {
        ...quotation,
        createdByName: creatorNames.get(quotation.createdBy) || "",
        ...quotationMoney(snapshotJson),
        salesName: summary.salesName,
        estimatedCost: canViewCost && summary.costRows > 0 ? summary.costAmount : null,
        missingCostCount: canViewCost ? summary.missingCostCount : 0,
        canViewCost,
        hasSnapshot: Boolean(snapshotJson),
        isLatest: latestIds.get(quotationProjectKey(quotation)) === quotation.id,
      };
    }),
    page,
    pageSize,
    total: totalRow?.total || 0,
  });
}

export async function PATCH(request: Request) {
  const session = await getLoginSession(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = (await request.json()) as {
    id?: string;
    ids?: unknown;
    action?: string;
    finalAmount?: number;
    finalCurrency?: string;
    voidReason?: string;
    projectStatus?: string;
    customerName?: string;
    lastFollowUpAt?: string;
    quoteValidUntil?: string;
    lossReason?: string;
    lossNote?: string;
    nextFollowUpAt?: string;
  };
  const isPrivileged = session.role === "admin" || session.role === "management" || session.role === "ceo";
  const ownershipFilter = isPrivileged ? undefined : eq(quotationHistory.createdBy, session.email);
  const db = getDb();
  if (payload.action === "archive" || (payload.action === "void" && payload.ids !== undefined)) {
    if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 50 || payload.ids.some(id => typeof id !== "string" || !id.trim()))
      return Response.json({error: "请选择1至50份报价单"}, {status: 400});
    const ids = [...new Set(payload.ids as string[])];
    const filters = and(inArray(quotationHistory.id, ids), ownershipFilter, isNull(quotationHistory.archivedAt), isNull(quotationHistory.voidedAt));
    const selected = await db.select({id: quotationHistory.id}).from(quotationHistory).where(filters);
    if (selected.length !== ids.length) return Response.json({error: "部分报价已归档、已作废或无权操作，请刷新后重新选择"}, {status: 409});
    const now = new Date().toISOString();
    if (payload.action === "void") {
      await db.update(quotationHistory).set({
        voidedAt: now, voidedBy: session.email,
        voidReason: typeof payload.voidReason === "string" ? payload.voidReason.trim().slice(0, 600) : "",
        isFinalized: false,
      }).where(filters);
      return Response.json({ voidedCount: ids.length, updatedAt: now });
    }
    await db.update(quotationHistory).set({archivedAt: now}).where(filters);
    return Response.json({archivedCount: ids.length});
  }
  if (!payload.id?.trim()) return Response.json({error: "无效操作"}, {status: 400});
  const quotation = await db
    .select()
    .from(quotationHistory)
    .where(and(eq(quotationHistory.id, payload.id.trim()), ownershipFilter))
    .get();
  if (!quotation)
    return Response.json({ error: "报价单不存在或无权确认" }, { status: 404 });

  if (quotation.voidedAt || quotation.archivedAt)
    return Response.json({ error: "作废或归档报价只能查看，不能修改状态" }, { status: 409 });

  if (payload.action === "void") {
    const now = new Date().toISOString();
    await db.update(quotationHistory).set({
      voidedAt: now, voidedBy: session.email,
      voidReason: typeof payload.voidReason === "string" ? payload.voidReason.trim().slice(0, 600) : "",
      isFinalized: false,
    }).where(and(eq(quotationHistory.id, quotation.id), isNull(quotationHistory.voidedAt)));
    return Response.json({ updatedAt: now, status: "voided" });
  }

  if (payload.action === "project") {
    if (session.role !== "admin" && session.role !== "ceo")
      return Response.json({ error: "仅 CEO 或管理员可维护项目状态" }, { status: 403 });
    const projectStatus = payload.projectStatus || "quoted";
    if (!projectStatuses.has(projectStatus))
      return Response.json({ error: "项目状态无效" }, { status: 400 });
    const customerName = (payload.customerName || "").trim().slice(0, 120);
    const lastFollowUpAt = dateOnly(payload.lastFollowUpAt);
    const quoteValidUntil = dateOnly(payload.quoteValidUntil);
    const now = new Date().toISOString();
    await db
      .update(quotationHistory)
      .set({
        projectStatus,
        customerName,
        lastFollowUpAt,
        quoteValidUntil,
        statusUpdatedAt: now,
      })
      .where(eq(quotationHistory.id, quotation.id));
    return Response.json({ updatedAt: now });
  }

  if (
    payload.action !== "confirm"
    && payload.action !== "lost"
    && payload.action !== "reactivate"
  )
    return Response.json({ error: "无效操作" }, { status: 400 });

  const candidates = await db.select().from(quotationHistory).where(ownershipFilter)
    .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id));
  const projectVersions = candidates.filter((item) => !item.voidedAt && !item.archivedAt && quotationProjectKey(item) === quotationProjectKey(quotation));
  const now = new Date().toISOString();
  if (payload.action === "confirm") {
    if (quotation.projectStatus === "lost")
      return Response.json({ error: "请先重新激活项目，再确认报价版本" }, { status: 409 });
    if (!quotation.snapshotJson)
      return Response.json({ error: "缺少报价明细，请先生成完整报价再确认" }, { status: 409 });
    if (quotation.isFinalized && quotation.finalAmount !== null)
      return Response.json({ error: "该版本已确认成交价格，如需调整请编辑生成新版本" }, { status: 409 });
    const amount = payload.finalAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
        !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)
      return Response.json({ error: "请输入大于 0 的最终成交价格，最多两位小数" }, { status: 400 });
    const currency = quotationMoney(quotation.snapshotJson).currency;
    if (payload.finalCurrency !== currency)
      return Response.json({ error: "成交价格币种必须与报价一致，请刷新后重试" }, { status: 400 });
    // Set the selected version and retire other confirmations in one statement.
    const result = await db.update(quotationHistory).set({
      isFinalized: sql`CASE WHEN id = ${quotation.id} THEN 1 ELSE 0 END`,
      projectStatus: sql`CASE WHEN id = ${quotation.id} THEN 'confirmed' ELSE 'quoted' END`,
      finalAmount: sql`CASE WHEN id = ${quotation.id} THEN ${Math.round(amount * 100) / 100} ELSE final_amount END`,
      finalCurrency: sql`CASE WHEN id = ${quotation.id} THEN ${currency} ELSE final_currency END`,
      confirmedAt: sql`CASE WHEN id = ${quotation.id} THEN ${now} ELSE confirmed_at END`,
      confirmedBy: sql`CASE WHEN id = ${quotation.id} THEN ${session.email} ELSE confirmed_by END`,
      statusUpdatedAt: now,
    }).where(and(
      inArray(quotationHistory.id, projectVersions.map((version) => version.id)),
      isNull(quotationHistory.voidedAt), isNull(quotationHistory.archivedAt),
      sql`EXISTS (SELECT 1 FROM quotation_history AS target WHERE target.id = ${quotation.id}
        AND target.voided_at IS NULL AND target.archived_at IS NULL AND target.project_status != 'lost'
        AND (target.is_finalized = 0 OR target.final_amount IS NULL))`,
    )).run();
    if (!result.meta.changes) return Response.json({ error: "报价状态已变更，请刷新后重试" }, { status: 409 });
    return Response.json({ updatedAt: now, status: "confirmed" });
  }

  if (projectVersions[0]?.id !== quotation.id)
    return Response.json({ error: "只能在项目最新报价版本上更新项目状态" }, { status: 409 });

  if (payload.action === "lost") {
    const lossReason = payload.lossReason?.trim() || "";
    if (!lossReasons.has(lossReason))
      return Response.json({ error: "请选择未成交原因" }, { status: 400 });
    const lossNote = (payload.lossNote || "").trim().slice(0, 600);
    const nextFollowUpAt = dateOnly(payload.nextFollowUpAt);
    for (const version of projectVersions) {
      await db
        .update(quotationHistory)
        .set({
          projectStatus: "lost",
          lossReason,
          lossNote,
          nextFollowUpAt,
          statusUpdatedAt: now,
        })
        .where(eq(quotationHistory.id, version.id));
    }
    return Response.json({ updatedAt: now, status: "lost" });
  }

  for (const version of projectVersions) {
    await db
      .update(quotationHistory)
      .set({ projectStatus: "quoted", isFinalized: false, statusUpdatedAt: now })
      .where(eq(quotationHistory.id, version.id));
  }
  return Response.json({ updatedAt: now, status: "quoted" });
}

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = (await request.json()) as {
    id?: string;
    contractNo?: string;
    projectName?: string;
    lineageId?: string;
    snapshot?: unknown;
  };
  const id = payload.id?.trim() || "";
  const contractNo = payload.contractNo?.trim() || "";
  const projectName = payload.projectName?.trim() || "";
  if (!contractNo || !projectName)
    return Response.json(
      { error: "请填写项目名称和项目合同号" },
      { status: 400 },
    );
  let snapshotJson: string | null = null;
  if (payload.snapshot) {
    snapshotJson = JSON.stringify(payload.snapshot);
    if (snapshotJson.length > 2_000_000)
      return Response.json({ error: "报价内容过大，无法保存历史记录" }, { status: 413 });
    const projectId = (payload.snapshot as { workspaceProjectId?: unknown }).workspaceProjectId;
    if (projectId && (typeof projectId !== "string" || !await workplaceProject(request, projectId)))
      return Response.json({ error: "无权使用该 Workplace 项目，请核对项目成员。" }, { status: 403 });
  }
  const isPrivileged = session.role === "admin" || session.role === "management" || session.role === "ceo";
  const ownershipFilter = isPrivileged
    ? undefined
    : eq(quotationHistory.createdBy, session.email);
  const generatedAt = new Date().toISOString();

  const db = getDb();
  let source: typeof quotationHistory.$inferSelect | undefined;
  const normalizedSnapshot = (value: string | null, number: string, name: string) => {
    if (!value) return null;
    return JSON.stringify(visibleQuoteSnapshot({ ...JSON.parse(value), contractNo: number, projectName: name }, session.role));
  };
  snapshotJson = normalizedSnapshot(snapshotJson, contractNo, projectName);
  if (id) {
    source = await db.select().from(quotationHistory)
      .where(and(eq(quotationHistory.id, id), ownershipFilter)).get();
    if (!source) return Response.json({ error: "报价单不存在或无权修改" }, { status: 404 });
    if (source.voidedAt) return Response.json({ error: "已作废报价只能查看" }, { status: 409 });
    if (source.contractNo === contractNo && source.projectName === projectName &&
        normalizedSnapshot(source.snapshotJson, source.contractNo, source.projectName) === snapshotJson)
      return Response.json({ quotation: { ...source, snapshotJson: undefined, hasSnapshot: Boolean(source.snapshotJson) } });
    if (source.isFinalized || source.archivedAt)
      return Response.json({ error: "已确认或归档的报价不可覆盖，请从历史记录编辑生成新版本" }, { status: 409 });
  }
  const suppliedLineageId = payload.lineageId?.trim() || "";
  if (!source && suppliedLineageId) {
    source = await db.select().from(quotationHistory)
      .where(and(or(eq(quotationHistory.lineageId, suppliedLineageId), eq(quotationHistory.id, suppliedLineageId)), ownershipFilter, isNull(quotationHistory.voidedAt), isNull(quotationHistory.archivedAt)))
      .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id)).get();
    if (!source) return Response.json({ error: "报价项目不存在或无权编辑" }, { status: 404 });
  }
  const contractBase = baseContractNo(source?.contractNo || contractNo);
  if (!source) {
    const related = await db.select().from(quotationHistory)
      .where(and(eq(quotationHistory.projectName, projectName), eq(quotationHistory.createdBy, session.email)))
      .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id));
    source = related.find((record) => !record.voidedAt && !record.archivedAt && baseContractNo(record.contractNo) === contractBase)
      || related.find((record) => baseContractNo(record.contractNo) === contractBase);
  }
  if (source?.voidedAt) return Response.json({ error: "已作废报价不能继续编辑，请使用有效版本或新建项目合同号" }, { status: 409 });
  if (source?.projectStatus === "lost")
    return Response.json({ error: "请先重新激活项目，再创建新报价版本" }, { status: 409 });
  const quotationId = crypto.randomUUID();
  const lineageId = source?.lineageId || source?.id || quotationId;
  if (snapshotJson) {
    const snapshot = JSON.parse(snapshotJson);
    const costs = new Map((await db.select({ id: productOverrides.productId, cost: productOverrides.cost }).from(productOverrides)).map((product) => [product.id, product.cost]));
    const sourceProducts = source?.snapshotJson ? JSON.parse(source.snapshotJson).products || [] : [];
    const allowedRecordIds = new Set(sourceProducts.map((p: { quoteCosting?: { recordId?: string } }) => p.quoteCosting?.recordId).filter(Boolean));
    for (const key of ["products", "importedProducts"]) {
      if (!Array.isArray(snapshot[key])) continue;
      for (const product of snapshot[key]) {
        if (product.revision?.status === "deleted" || product.revision?.status === "customer") continue;
        if (product.quoteCosting || /^FB000[13](?:-|$)/i.test(String(product.sku || ""))) {
          if (!(Number(snapshot.cart?.[product.id]) > 0)) { product.cost = null; continue; }
          const recordId = product.quoteCosting?.recordId;
          const record = typeof recordId === "string" ? await db.select().from(costingRecords).where(eq(costingRecords.id, recordId)).get() : null;
          if (!record || (record.createdBy !== session.email && !["admin", "ceo", "cost_accountant"].includes(session.role) && !allowedRecordIds.has(record.id)))
            return Response.json({ error: `${product.sku} 尚未完成核算，请从原报价入口重新导入` }, { status: 400 });
          const calculation = JSON.parse(record.snapshotJson);
          if (record.sku.trim().toUpperCase() !== String(product.sku).trim().toUpperCase() || calculation.source !== "quotation-import" || !(calculation.quoteQuantity > 0))
            return Response.json({ error: "核算记录与报价产品不一致，请重新导入" }, { status: 400 });
          const catalogSale = calculation.sale?.source === "catalog" ? calculation.sale : null;
          const saleUnit = catalogSale ? catalogSale.unitPrices.price : calculation.sale?.total === null || calculation.sale?.total === undefined ? null : calculation.sale.total / calculation.quoteQuantity;
          const usdSaleUnit = catalogSale ? catalogSale.unitPrices.usd : calculation.sale?.usd == null ? null : calculation.sale.usd / calculation.quoteQuantity;
          const factorySaleUnit = catalogSale ? catalogSale.unitPrices.factory : saleUnit;
          const selectedSale = snapshot.priceMode === "usd" ? usdSaleUnit : snapshot.priceMode === "factory" ? factorySaleUnit : saleUnit;
          if (Number(snapshot.cart?.[product.id]) > 0 && selectedSale == null)
            return Response.json({ error: `${product.sku} ${catalogSale ? "产品库未填写当前报价模式的售价，请维护后重新导入" : snapshot.priceMode === "usd" ? "尚未配置美元售价，请使用人民币报价" : "售价待核算，请补齐原清单资料或后台售价规则后重新导入"}` }, { status: 400 });
          product.cost = calculation.result.total === null ? null : calculation.result.total / calculation.quoteQuantity;
          product.price = saleUnit; product.factory = factorySaleUnit; product.usd = usdSaleUnit;
          product.quoteCosting = { ...(catalogSale ? { saleSource: "catalog", factorySaleUnit } : {}), recordId, version: record.ruleVersion, saleUnit, usdSaleUnit, status: catalogSale ? (catalogSale.issues.length ? "pending" : "ready") : saleUnit === null ? "pending" : "ready", issues: calculation.sale?.issues || [] };
        } else {
          product.cost = costs.get(String(product.catalogProductId || product.id)) ?? (session.role === "ceo" ? product.cost ?? null : null);
        }
      }
    }
    snapshotJson = JSON.stringify(snapshot);
  }
  if (source && !source.lineageId) {
    // Link legacy versions by their existing owner, name and contract; preserve their contents.
    const legacy = await db.select().from(quotationHistory)
      .where(and(isNull(quotationHistory.lineageId), eq(quotationHistory.createdBy, source.createdBy), eq(quotationHistory.projectName, source.projectName)));
    const related = legacy.filter((record) => baseContractNo(record.contractNo) === contractBase);
    if (related.length) {
      const queries = related.map((record) => db.update(quotationHistory).set({ lineageId }).where(and(eq(quotationHistory.id, record.id), isNull(quotationHistory.lineageId))));
      await db.batch([queries[0], ...queries.slice(1)]);
    }
  }
  // Allocate and insert in one SQLite statement so concurrent saves cannot reuse a revision.
  await db.run(sql`
    WITH revision AS (
      SELECT ${contractBase} || '-R' || printf('%02d', coalesce(max(CASE
        WHEN contract_no = ${contractBase} THEN 1
        WHEN substr(contract_no, 1, length(${contractBase}) + 2) = ${contractBase} || '-R'
          THEN cast(substr(contract_no, length(${contractBase}) + 3) AS integer)
        ELSE 0 END), 0) + 1) AS number,
        CASE WHEN max(generated_at) >= ${generatedAt}
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', max(generated_at), '+0.001 seconds')
          ELSE ${generatedAt} END AS saved_at
      FROM quotation_history WHERE lineage_id = ${lineageId}
    )
    INSERT INTO quotation_history (id, contract_no, project_name, created_by, lineage_id, snapshot_json, generated_at,
      project_status, status_updated_at, customer_name, last_follow_up_at, quote_valid_until, loss_reason, loss_note, next_follow_up_at)
    SELECT ${quotationId}, number, ${projectName}, ${session.email}, ${lineageId},
      CASE WHEN ${snapshotJson} IS NULL THEN NULL ELSE json_set(${snapshotJson}, '$.contractNo', number, '$.projectName', ${projectName}) END,
      saved_at, ${"quoted"}, '',
      ${source?.customerName || ""}, ${source?.lastFollowUpAt || ""}, ${source?.quoteValidUntil || ""},
      ${source?.lossReason || ""}, ${source?.lossNote || ""}, ${source?.nextFollowUpAt || ""}
    FROM revision
  `);
  const quotation = await db.select().from(quotationHistory).where(eq(quotationHistory.id, quotationId)).get();
  return Response.json({ quotation: { ...quotation, snapshotJson: undefined, hasSnapshot: Boolean(snapshotJson) } }, { status: 201 });
}

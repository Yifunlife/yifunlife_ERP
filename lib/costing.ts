import { evaluateCostingExpression } from "./costing-expression";
import { resolvedRecipe, resolvedRules, pieceLineUsage, squareMeterPrice, type RecipeLine, type CostResource, type CostRecipe } from "./costing-library";
export const canManageCosting = (role: string) => role === "admin" || role === "ceo" || role === "cost_accountant";
export const parts = { wall: "墙体", mezzanine: "夹层平台", roof: "屋顶", glass: "玻璃" } as const;
export type Part = keyof typeof parts;
export type Family = "house" | "lowwall" | "piece";
export type Rule = { id: string; family: Family; part: Part; kind: "material" | "labor"; name: string; spec: string; unit: string; usage: number | null; price: number | null; factors: (number | null)[]; enabled: boolean };
export type Mapping = { sku: string; family: Family; grade: number; label: string };
export type SaleRule = { family: Family; part: Part; prices: (number | null)[] };
export type Settings = { exchangeRate?: number; saleMultiplier?: number; houseStandard?: { usageDecimals?: 3; lines: RecipeLine[]; factors: number[]; managementRate: number }; codeCounters?: { material: number; labor: number; GC?: number; MB?: number; RB?: number; SGB?: number; BL?: number }; resources?: CostResource[]; recipes?: CostRecipe[]; rules: Rule[]; mappings: Mapping[]; saleRules?: SaleRule[] };
export const initialSaleRules = (): SaleRule[] => (["house", "lowwall"] as Family[]).flatMap(family => (Object.keys(parts) as Part[]).filter(part => family === "house" || part === "wall").map(part => ({ family, part, prices: [null, null, null, null] })));
export type Extra = { status: "none" | "present" | "pending"; area: number | null };
export type CostInput = { project: string; name: string; sku: string; quantity: number; area: number | null; perimeter: number | null; height: number | null; mezzanine: Extra; roof: Extra; glass: Extra; glassReplacesWall: boolean; drawing: string; note: string; adjustments: { id: string; quantity: number | null; price: number | null }[] };
export const blankInput = (): CostInput => ({ project: "", name: "", sku: "FB0001-A", quantity: 1, area: null, perimeter: null, height: null, mezzanine: { status: "pending", area: null }, roof: { status: "pending", area: null }, glass: { status: "pending", area: null }, glassReplacesWall: false, drawing: "", note: "", adjustments: [] });
export function initialSettings(): Settings {
  const rules: Rule[] = [];
  for (const family of ["house", "lowwall"] as Family[]) for (const part of Object.keys(parts) as Part[]) {
    if (family === "lowwall" && part !== "wall") continue;
    const materials = part === "glass" ? ["玻璃"] : ["钢材", "木板", "石膏板", "软包材料"];
    for (const kind of ["material", "labor"] as const) {
      const names = kind === "material" ? materials : ["电焊", "木工", "软包", "拆卸", "打包", "编号"];
      names.forEach((name, i) => rules.push({ id: `${family}-${part}-${kind}-${i}`, family, part, kind, name, spec: "", unit: kind === "labor" ? "人时" : name === "钢材" ? "kg" : ["木板", "石膏板"].includes(name) ? "张" : "㎡", usage: null, price: null, factors: [1, null, null, null], enabled: true }));
    }
  }
  return { rules, saleRules: initialSaleRules(), mappings: [
    ...["常规", "二级", "三级", "最难"].map((label, grade) => ({ sku: `FB0001-${"ABCD"[grade]}`, family: "house" as const, grade, label })),
    ...["常规", "立体", "复杂"].map((label, grade) => ({ sku: `FB0003-${grade + 1}`, family: "lowwall" as const, grade, label })),
  ] };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 200) => typeof v === "string" && v.length <= max;
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
const optionalNumber = (v: unknown) => v === null || number(v);
export function validSettings(v: unknown): v is Settings {
  if (!object(v) || !Array.isArray(v.rules) || !Array.isArray(v.mappings) || (!v.resources && !v.rules.length) || v.rules.length > 500 || v.mappings.length > 500) return false;
  if (v.codeCounters !== undefined && (!object(v.codeCounters) || !Number.isSafeInteger(v.codeCounters.material) || !Number.isSafeInteger(v.codeCounters.labor) || !number(v.codeCounters.material) || !number(v.codeCounters.labor))) return false;
  if (v.resources !== undefined || v.recipes !== undefined) {
    if (!Array.isArray(v.resources) || !Array.isArray(v.recipes) || v.resources.length > 1000 || v.recipes.length > 500) return false;
    if (v.codeCounters && ["GC", "MB", "RB", "SGB", "BL"].some(k => { const n = (v.codeCounters as Record<string, unknown>)[k]; return n !== undefined && (!Number.isSafeInteger(n) || !number(n)); })) return false;
    if (v.saleMultiplier !== undefined && (!number(v.saleMultiplier) || v.saleMultiplier <= 0)) return false;
    if (v.exchangeRate !== undefined && (!number(v.exchangeRate) || v.exchangeRate <= 0)) return false;
    if (object(v.houseStandard) && v.houseStandard.usageDecimals !== undefined && v.houseStandard.usageDecimals !== 3) return false;
    if (v.houseStandard !== undefined && (!object(v.houseStandard) || !number(v.houseStandard.managementRate) || v.houseStandard.managementRate > 1 || !Array.isArray(v.houseStandard.lines) || v.houseStandard.lines.length > 500 || !Array.isArray(v.houseStandard.factors) || v.houseStandard.factors.length !== 3 || !v.houseStandard.factors.every(n => number(n) && n > 0 && n <= 100))) return false;
    const ids = new Set(), codes = new Set(), recipes = new Set();
    for (const r of v.resources) {
      if (object(r) && r.areaPerUnit !== undefined && r.areaPerUnit !== null && (!number(r.areaPerUnit) || r.areaPerUnit <= 0)) return false;
      if (object(r) && r.dailyOutput !== undefined && r.dailyOutput !== null && (!number(r.dailyOutput) || r.dailyOutput <= 0)) return false;
      if (!object(r) || !text(r.id) || !r.id || ids.has(r.id) || !text(r.code, 80) || !(r.code as string).trim() || r.code !== (r.code as string).trim().toUpperCase() || codes.has(r.code) || !["material", "labor"].includes(r.kind as string) || !text(r.name) || !(r.name as string).trim() || !text(r.spec) || !text(r.unit, 20) || !(r.unit as string).trim() || (r.kind === "labor" && !["人时", "人天"].includes(r.unit as string)) || !optionalNumber(r.price)) return false;
      if (r.category !== undefined && (r.kind !== "material" || !["GC", "MB", "RB", "SGB", "BL"].includes(r.category as string))) return false;
      ids.add(r.id); codes.add(r.code);
    }
    for (const recipe of v.recipes) {
      if (!object(recipe) || !text(recipe.sku, 80) || recipes.has(recipe.sku) || !text(recipe.name) || !(recipe.name as string).trim() || !Array.isArray(recipe.lines) || recipe.lines.length > 500 || !object(recipe.salePrices) || !Object.keys(parts).every(p => optionalNumber((recipe.salePrices as Record<string, unknown>)[p]))) return false;
      if (recipe.difficultyFactor !== undefined && !(recipe.difficultyFactor === null || (number(recipe.difficultyFactor) && recipe.difficultyFactor > 0 && recipe.difficultyFactor <= 100))) return false;
      const mapping = v.mappings.find(m => object(m) && m.sku === recipe.sku);
      if (!mapping) return false;
      if (recipe.specification !== undefined && !text(recipe.specification, 1000)) return false;
      if (recipe.pendingIssues !== undefined && (!Array.isArray(recipe.pendingIssues) || recipe.pendingIssues.length > 50 || !recipe.pendingIssues.every(x => text(x, 1000)))) return false;
      if (recipe.maxUsageLaborResourceIds !== undefined && (recipe.basis !== "piece" || !Array.isArray(recipe.maxUsageLaborResourceIds) || recipe.maxUsageLaborResourceIds.length > 2 || new Set(recipe.maxUsageLaborResourceIds).size !== recipe.maxUsageLaborResourceIds.length || !recipe.maxUsageLaborResourceIds.every(id => (v.resources as CostResource[]).some(r => r.id === id && r.kind === "labor")))) return false;
      if (recipe.saleSource !== undefined && (recipe.saleSource !== "catalog" || recipe.basis !== "piece")) return false;
      if (recipe.basis !== undefined && recipe.basis !== "piece") return false;
      if ((recipe.basis === "piece") !== (mapping.family === "piece") || (recipe.basis && recipe.houseClass)) return false;
      if (recipe.houseClass !== undefined && (!["A", "B", "C"].includes(recipe.houseClass as string) || !v.houseStandard || mapping.family !== "house" || Number(mapping.grade) > 2)) return false;
      const recipeLines = recipe.houseClass ? (v.houseStandard as { lines: unknown[] }).lines : recipe.lines;
      const lineIds = new Set(), combinations = new Set();
      for (const line of recipeLines) {
        if (!object(line) || !text(line.id) || !line.id || lineIds.has(line.id) || !ids.has(line.resourceId) || !Object.hasOwn(parts, line.part as string) || (mapping.family === "lowwall" && line.part !== "wall") || !optionalNumber(line.usage) || !(line.factor === null || (number(line.factor) && line.factor > 0 && line.factor <= 100)) || typeof line.enabled !== "boolean") return false;
        if (line.expression !== undefined && (!text(line.expression, 256) || evaluateCostingExpression(line.expression as string) === null || Math.abs(evaluateCostingExpression(line.expression as string)! - Number(line.usage)) > 1e-12)) return false;
        if (recipe.basis === "piece" && (line.part !== "wall" || line.factor !== 1 || !(v.resources as CostResource[]).some(r => r.id === line.resourceId && r.kind === "material") || !(v.resources as CostResource[]).some(r => r.id === line.laborResourceId && r.kind === "labor"))) return false;
        if (line.materialEnabled !== undefined && (recipe.basis !== "piece" || typeof line.materialEnabled !== "boolean")) return false;
        if (line.usageFromLineId !== undefined && (recipe.basis !== "piece" || !text(line.usageFromLineId) || !recipeLines.some(target => object(target) && target.id === line.usageFromLineId && target.id !== line.id && !target.usageFromLineId))) return false;
        if (line.source !== undefined && !text(line.source, 1000)) return false;
        const key = `${line.part}:${line.resourceId}${recipe.basis === "piece" ? `:${line.laborResourceId}` : ""}`; if (combinations.has(key)) return false;
        combinations.add(key); lineIds.add(line.id);
      }
      if (recipe.houseClass && recipeLines.some(line => (line as Record<string, unknown>).part !== "wall")) return false;
      recipes.add(recipe.sku);
    }
    if (v.mappings.some(m => !object(m) || !recipes.has(m.sku))) return false;
  }
  if (v.saleRules !== undefined) {
    if (!Array.isArray(v.saleRules) || v.saleRules.length > 8) return false;
    const keys = new Set();
    for (const r of v.saleRules) {
      if (!object(r) || !["house", "lowwall"].includes(r.family as string) || !Object.hasOwn(parts, r.part as string) || (r.family === "lowwall" && r.part !== "wall") || !Array.isArray(r.prices) || r.prices.length !== 4 || !r.prices.every(optionalNumber)) return false;
      const key = `${r.family}:${r.part}`; if (keys.has(key)) return false; keys.add(key);
    }
  }
  const ids = new Set<string>(), skus = new Set<string>();
  for (const r of v.rules) {
    if (!object(r) || !text(r.id) || !r.id || ids.has(r.id as string) || !["house", "lowwall"].includes(r.family as string) || !Object.hasOwn(parts, r.part as string) || (r.family === "lowwall" && r.part !== "wall") || !["material", "labor"].includes(r.kind as string) || !text(r.name) || !(r.name as string).trim() || !text(r.spec) || !text(r.unit, 20) || !(r.unit as string).trim() || !optionalNumber(r.usage) || !optionalNumber(r.price) || typeof r.enabled !== "boolean" || !Array.isArray(r.factors) || r.factors.length !== 4 || !r.factors.every(x => x === null || (number(x) && x > 0 && x <= 100))) return false;
    ids.add(r.id as string);
  }
  for (const m of v.mappings) {
    if (!object(m) || !text(m.sku, 80) || !(m.sku as string).trim() || m.sku !== (m.sku as string).trim().toUpperCase() || skus.has(m.sku as string) || !["house", "lowwall", "piece"].includes(m.family as string) || !Number.isInteger(m.grade) || (m.grade as number) < 0 || (m.grade as number) > 3 || !text(m.label) || !m.label) return false;
    skus.add(m.sku as string);
  }
  return true;
}
export function validInput(v: unknown): v is CostInput {
  if (!object(v) || !text(v.project) || !text(v.name) || !text(v.sku, 80) || !number(v.quantity) || v.quantity <= 0 || !optionalNumber(v.area) || !optionalNumber(v.perimeter) || !optionalNumber(v.height) || typeof v.glassReplacesWall !== "boolean" || !text(v.drawing, 1000) || !text(v.note, 2000) || !Array.isArray(v.adjustments) || v.adjustments.length > 500) return false;
  for (const p of ["mezzanine", "roof", "glass"]) { const e = v[p]; if (!object(e) || !["none", "present", "pending"].includes(e.status as string) || !optionalNumber(e.area)) return false; }
  const ids = new Set();
  for (const a of v.adjustments) { if (!object(a) || !text(a.id) || ids.has(a.id) || !optionalNumber(a.quantity) || !optionalNumber(a.price)) return false; ids.add(a.id); }
  return true;
}
export function measureCostingAreas(input: CostInput, settings: Settings) {
  const issues: string[] = [];
  if (!validInput(input)) issues.push("请检查数值：用量和单价不能为负数，产品数量必须大于零");
  const mapping = settings.mappings.find(m => m.sku === input.sku.trim().toUpperCase());
  if (mapping?.family === "piece") return { mapping, areas: { wall: 1, mezzanine: 0, roof: 0, glass: 0 }, issues };
  let area = input.area;
  const dimensionalArea = input.perimeter !== null && input.height !== null ? input.perimeter * input.height : null;
  if (area === null) area = dimensionalArea;
  else if (dimensionalArea !== null && Math.abs(area - dimensionalArea) > 0.01) issues.push("填写面积与周长 × 高度不一致，请核实");
  if (area === null || area <= 0) issues.push("请填写有效墙体面积，或周长与高度");
  if (!mapping) issues.push("款号尚未匹配核算规则");
  const areas: Record<Part, number> = { wall: area || 0, mezzanine: 0, roof: 0, glass: 0 };
  const houseClass = settings.recipes?.find(r => r.sku === mapping?.sku)?.houseClass;
  if (houseClass) {
    if (houseClass !== "A") {
      if (input.mezzanine.status !== "present" || input.mezzanine.area === null || input.mezzanine.area <= 0) issues.push("请填写夹层面积");
      else areas.wall += input.mezzanine.area;
    } else if (input.mezzanine.status === "present") issues.push("A类无夹层，请选择B类或C类款号");
    if (houseClass === "C") {
      if (input.mezzanine.status === "present" && input.mezzanine.area !== null && input.mezzanine.area > 0) {
        areas.wall += input.mezzanine.area; // C roof uses the same footprint as its mezzanine.
        if (input.roof.status === "present" && (input.roof.area === null || Math.abs(input.roof.area - input.mezzanine.area) > 0.01)) issues.push("C类顶面积应与夹层面积相同，请核实填写的顶尺寸");
      }
    }
    if (input.roof.status === "present" && houseClass !== "C") issues.push("带顶请使用C类款号");
    if (input.glassReplacesWall) issues.push("本标准公式不扣减玻璃面积；玻璃需单独计算");
  }
  if (!houseClass && mapping?.family === "house") for (const p of ["mezzanine", "roof", "glass"] as const) {
    const extra = input[p];
    if (extra.status === "pending") issues.push(`请确认是否有${parts[p]}`);
    if (extra.status === "present") { if (extra.area === null || extra.area <= 0) issues.push(`请填写${parts[p]}实际面积`); else areas[p] = extra.area; }
  }
  if (mapping?.family === "lowwall" && [input.mezzanine, input.roof, input.glass].some(e => e.status === "present")) issues.push("矮墙暂不适用房子附加配置，请使用独立核算规则");
  if (!houseClass && input.glassReplacesWall) {
    if (areas.glass <= 0 || areas.glass > areas.wall) issues.push("替换墙体的玻璃面积需大于零且不超过墙体面积");
    else areas.wall -= areas.glass;
  }
  return { mapping, areas, issues };
}
function calculatePiece(input: CostInput, settings: Settings, recipe: CostRecipe, mapping: Mapping | undefined, issues: string[]) {
  const difficultyFactor = recipe.difficultyFactor ?? null;
  const managementRate = settings.houseStandard?.managementRate ?? 0.1;
  if (difficultyFactor === null) issues.push("请填写款号难度系数");
  issues.push(...(recipe.pendingIssues || []));
  if (input.adjustments.length) issues.push("标准件请在款号组合中调整用量");
  const rows: { id: string; part: Part; kind: Rule["kind"]; name: string; unit: string; area: number; quantity: number | null; price: number | null; factor: number | null; amount: number | null }[] = [];
  for (const line of recipe.lines.filter(l => l.enabled)) {
    const material = settings.resources?.find(r => r.id === line.resourceId);
    const labor = settings.resources?.find(r => r.id === line.laborResourceId);
    const usage = pieceLineUsage(recipe, line);
    const quantity = usage === null ? null : Math.round(usage * 1000) / 1000 * input.quantity;
    for (const [kind, resource] of [["material", material], ["labor", labor]] as const) {
      if (kind === "material" && line.materialEnabled === false) continue;
      const price = resource ? squareMeterPrice(resource) : null;
      const amount = quantity !== null && price !== null ? quantity * price : null;
      const name = kind === "labor" ? `${material?.name || "材料"} · ${resource?.name || "工种未关联"}` : resource?.name || "材料未关联";
      if (amount === null) issues.push(`${name}的用量、价格或单位换算待补齐`);
      if (amount !== null && (!Number.isFinite(amount) || amount > 1e12)) issues.push(`${name}超出核算范围`);
      rows.push({ id: `${line.id}-${kind}`, part: "wall", kind, name, unit: "㎡", area: quantity ?? 0, quantity, price, factor: 1, amount });
    }
  }
  if (recipe.maxUsageLaborResourceIds?.length) {
    const quantities = rows.filter(r => r.kind === "material").map(r => r.quantity);
    const quantity = !quantities.length || quantities.some(q => q === null) ? null : Math.max(...quantities as number[]);
    for (const id of recipe.maxUsageLaborResourceIds) {
      const resource = settings.resources?.find(r => r.id === id && r.kind === "labor");
      const price = resource ? squareMeterPrice(resource) : null;
      const amount = quantity !== null && price !== null ? quantity * price : null;
      const name = `最大材料用量 · ${resource?.name || "工种未关联"}`;
      if (amount === null) issues.push(`${name}的用量、工资或日产量待补齐`);
      if (amount !== null && (!Number.isFinite(amount) || amount > 1e12)) issues.push(`${name}超出核算范围`);
      rows.push({ id: `max-usage-${id}`, part: "wall", kind: "labor", name, unit: "㎡", area: quantity ?? 0, quantity, price, factor: 1, amount });
    }
  }
  if (!rows.length) issues.push("请配置标准件材料与工种");
  const sum = (kind: Rule["kind"]) => rows.filter(r => r.kind === kind).reduce((n,r) => n + (r.amount || 0), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { mapping, areas: { wall: 1, mezzanine: 0, roof: 0, glass: 0 }, rows, issues, difficultyFactor, managementRate, costModel: "piece-labor-difficulty", material: issues.length ? null : round(sum("material")), labor: issues.length ? null : round(sum("labor")), total: issues.length ? null : round((sum("material") + sum("labor") * (difficultyFactor ?? 1)) * (1 + managementRate)) };
}
export function calculate(input: CostInput, settings: Settings) {
  const { mapping, areas, issues } = measureCostingAreas(input, settings);
  const recipe = resolvedRecipe(settings, input.sku);
  if (recipe?.basis === "piece") return calculatePiece(input, settings, recipe, mapping, issues);
  const difficultyFactor = recipe && Object.hasOwn(recipe, "difficultyFactor") ? recipe.difficultyFactor ?? null : 1;
  if (difficultyFactor === null) issues.push("请填写款号统一难度系数");
  if (input.adjustments.length && !input.note.trim()) issues.push("本单调整需要填写原因");
  const rows: { id: string; part: Part; kind: Rule["kind"]; name: string; unit: string; area: number; quantity: number | null; price: number | null; factor: number | null; amount: number | null }[] = [];
  if (mapping) for (const p of Object.keys(parts) as Part[]) {
    if (areas[p] <= 0) continue;
    const rules = resolvedRules(settings, input.sku).filter(r => r.family === mapping.family && r.part === p && r.enabled);
    for (const kind of ["material", "labor"] as const) if (!rules.some(r => r.kind === kind)) issues.push(`${parts[p]}缺少${kind === "material" ? "材料" : "人工"}规则`);
    for (const r of rules) {
      const factor = r.factors[mapping.grade];
      const override = input.adjustments.find(a => a.id === r.id);
      const quantity = override?.quantity ?? (r.usage !== null && factor !== null ? areas[p] * input.quantity * r.usage * factor : null);
      const price = override?.price ?? r.price;
      let amount = quantity !== null && price !== null ? (recipe?.houseClass ? quantity * price : Math.round(quantity * price * 100) / 100) : null;
      if (amount !== null && (!Number.isFinite(amount) || amount > 1e12)) { issues.push(`${parts[p]}·${r.name}超出核算范围`); amount = null; }
      if (quantity === null || price === null) issues.push(`${parts[p]}·${r.name}的用量、单价或难度系数待配置`);
      rows.push({ id: r.id, part: p, kind: r.kind, name: r.name, unit: r.unit, area: areas[p] * input.quantity, quantity, price, factor, amount });
    }
  }
  if (input.adjustments.some(a => !rows.some(r => r.id === a.id))) issues.push("本单调整包含不适用的规则，请清除后重新核算");
  const sum = (kind: Rule["kind"]) => Math.round(rows.filter(r => r.kind === kind).reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;
  const rawSum = (kind: Rule["kind"]) => rows.filter(r => r.kind === kind).reduce((s, r) => s + (r.amount || 0), 0);
  const total = recipe?.houseClass ? (rawSum("material") + rawSum("labor") * (difficultyFactor ?? 1)) * (1 + (settings.houseStandard?.managementRate ?? 0.1)) : (sum("material") + sum("labor")) * (difficultyFactor ?? 1);
  return { mapping, areas, rows, issues, difficultyFactor, managementRate: recipe?.houseClass ? settings.houseStandard?.managementRate ?? 0.1 : 0, costModel: recipe?.houseClass ? "labor-difficulty" : "legacy", material: issues.length ? null : sum("material"), labor: issues.length ? null : sum("labor"), total: issues.length ? null : Math.round(total * 100) / 100 };
}

export function calculateSale(input: CostInput, settings: Settings) {
  if (resolvedRecipe(settings, input.sku)?.saleSource === "catalog") return { total: null, usd: null, exchangeRate: null, saleMultiplier: null, items: [] as { part: Part; area: number; price: number | null; amount: number | null }[], issues: ["售价取产品库，请通过报价入口读取"] };
  // Presence of the versioned exchange rate enables cost-based pricing; old snapshots retain their rules.
  if (settings.exchangeRate !== undefined) {
    const cost = calculate(input, settings);
    const issues = [...cost.issues];
    if (!Number.isFinite(settings.exchangeRate) || settings.exchangeRate <= 0) issues.push("美元汇率必须大于零");
    const saleMultiplier = settings.saleMultiplier ?? 2;
    if (!Number.isFinite(saleMultiplier) || saleMultiplier <= 0) issues.push("人民币售价倍数必须大于零");
    const total = cost.total === null || issues.length ? null : Math.round(Math.round(cost.total * 100) * saleMultiplier) / 100;
    const usd = total === null ? null : Math.round(total / settings.exchangeRate * 100) / 100;
    if ((total !== null && total > 1e12) || (usd !== null && (!Number.isFinite(usd) || usd > 1e12))) issues.push("售价超出核算范围");
    return { total: issues.length ? null : total, usd: issues.length ? null : usd, exchangeRate: settings.exchangeRate, saleMultiplier, items: [] as { part: Part; area: number; price: number | null; amount: number | null }[], issues };
  }
  const { mapping, areas, issues } = measureCostingAreas(input, settings);
  let total = 0;
  const items: { part: Part; area: number; price: number | null; amount: number | null }[] = [];
  if (mapping) for (const part of Object.keys(parts) as Part[]) {
    if (areas[part] <= 0) continue;
    const price = settings.recipes ? settings.recipes.find(r => r.sku === mapping.sku)?.salePrices[part] ?? null : settings.saleRules?.find(r => r.family === mapping.family && r.part === part)?.prices[mapping.grade] ?? null;
    const amount = price === null ? null : Math.round(areas[part] * input.quantity * price * 100) / 100;
    if (amount === null) issues.push(`${parts[part]}的${mapping.label}售价单价待配置`);
    else if (!Number.isFinite(amount) || amount > 1e12) issues.push("售价超出核算范围");
    else total += amount;
    items.push({ part, area: areas[part] * input.quantity, price, amount });
  }
  return { total: issues.length ? null : Math.round(total * 100) / 100, usd: null, exchangeRate: null, saleMultiplier: null, items, issues };
}

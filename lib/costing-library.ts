import { type Settings, type Rule, type Part } from "./costing";

export const materialCategories = { GC: "钢材", MB: "木板", RB: "软包", SGB: "石膏板", BL: "玻璃" } as const;
export type MaterialCategory = keyof typeof materialCategories;
export type CostResource = { areaPerUnit?: number | null; dailyOutput?: number | null; category?: MaterialCategory; id: string; code: string; kind: "material" | "labor"; name: string; spec: string; unit: string; price: number | null };
export function materialTypeLabel(r: CostResource): string {
  if (r.category === "RB") {
    for (const name of ["珍珠棉", "海绵", "皮革"]) if (r.name.includes(name)) return name;
    if (/软包皮|平台皮/.test(r.name)) return "皮革";
  }
  return r.category ? materialCategories[r.category] : "未分类";
}
export const materialSizeLabel = (r: CostResource) => r.spec.trim() || r.name?.match(/\d+(?:\.\d+)?\s*(?:厘|cm|mm|毫米|厘米)/i)?.[0] || "待填写尺寸规格";
export type RecipeLine = { materialEnabled?: boolean; usageFromLineId?: string; laborResourceId?: string; expression?: string; source?: string; id: string; resourceId: string; part: Part; usage: number | null; factor: number | null; enabled: boolean };
export type CostRecipe = { maxUsageLaborResourceIds?: string[]; specification?: string; pendingIssues?: string[]; saleSource?: "catalog"; basis?: "piece"; houseClass?: "A" | "B" | "C"; difficultyFactor?: number | null; sku: string; name: string; lines: RecipeLine[]; salePrices: Record<Part, number | null> };

export function pieceLineUsage(recipe: CostRecipe, line: RecipeLine): number | null {
  if (!line.usageFromLineId) return line.usage;
  const source = recipe.lines.find(l => l.id === line.usageFromLineId);
  return source && !source.usageFromLineId ? source.usage : null;
}

export function squareMeterPrice(resource: CostResource): number | null {
  if (resource.price === null) return null;
  const divisor = resource.kind === "labor" ? (resource.unit === "人天" ? resource.dailyOutput : null) : resource.unit === "㎡" ? 1 : resource.areaPerUnit;
  return divisor && divisor > 0 ? Math.round(resource.price / divisor * 1000) / 1000 : null;
}
export type LibrarySettings = Settings & { resources: CostResource[]; recipes: CostRecipe[] };

// Convert legacy family rules once for editing. Distinct specifications or prices stay distinct.
export function withLibraries(settings: Settings): LibrarySettings {
  if (settings.resources && settings.recipes) {
    const counters = resourceCounters(settings);
    const categories: Record<string, MaterialCategory> = { "钢材": "GC", "木板": "MB", "软包材料": "RB", "石膏板": "SGB", "玻璃": "BL" };
    const resources = settings.resources.map(resource => {
      const category = categories[resource.name];
      if (resource.kind !== "material" || !/^CL-\d+$/.test(resource.code) || !category) return resource;
      counters[category] = (counters[category] || 0) + 1;
      return { ...resource, category, code: `CL-${category}-${String(counters[category]).padStart(3, "0")}` };
    });
    settings = { ...settings, resources, codeCounters: counters };
  }
  if (settings.resources && settings.recipes) return { ...settings, codeCounters: resourceCounters(settings), recipes: settings.recipes.map(recipe => {
    if (Object.hasOwn(recipe, "difficultyFactor")) return recipe;
    const factors = [...new Set(recipe.lines.filter(l => l.enabled).map(l => l.factor))];
    return { ...recipe, difficultyFactor: factors.length === 1 ? factors[0] : null, lines: recipe.lines.map(l => ({ ...l, factor: 1 })) };
  }) } as LibrarySettings;
  const resources: CostResource[] = [];
  const resourceIds = new Map<string, string>();
  const idsByRule = new Map<string, string>();
  for (const rule of settings.rules) {
    const signature = JSON.stringify([rule.kind, rule.name, rule.spec, rule.unit, rule.price]);
    let id = resourceIds.get(signature);
    if (!id) {
      id = `resource-${resources.length + 1}`;
      const code = `${rule.kind === "material" ? "CL" : "RG"}-${String(resources.filter(r => r.kind === rule.kind).length + 1).padStart(3, "0")}`;
      resources.push({ id, code, kind: rule.kind, name: rule.name, spec: rule.spec, unit: rule.unit, price: rule.price });
      resourceIds.set(signature, id);
    }
    idsByRule.set(rule.id, id);
  }
  const recipes = settings.mappings.map(m => ({ sku: m.sku, name: `${m.family === "house" ? "非标房子" : "矮墙"} · ${m.label}`, lines: settings.rules.filter(r => r.family === m.family).map(r => ({ id: r.id, resourceId: idsByRule.get(r.id)!, part: r.part, usage: r.usage, factor: r.factors[m.grade], enabled: r.enabled })), salePrices: Object.fromEntries((["wall", "mezzanine", "roof", "glass"] as Part[]).map(part => [part, settings.saleRules?.find(r => r.family === m.family && r.part === part)?.prices[m.grade] ?? null])) as CostRecipe["salePrices"] }));
  return withLibraries({ ...settings, rules: [], saleRules: [], resources, recipes });
}

export function resolvedRecipe(settings: Settings, sku: string): CostRecipe | undefined {
  const recipe = settings.recipes?.find(r => r.sku === sku.trim().toUpperCase());
  if (!recipe?.houseClass || !settings.houseStandard) return recipe;
  const grade = settings.mappings.find(m => m.sku === recipe.sku)?.grade ?? 0;
  return { ...recipe, lines: settings.houseStandard.lines.map(line => ({ ...line, usage: line.usage === null || settings.houseStandard!.usageDecimals !== 3 ? line.usage : Math.round(line.usage * 1000) / 1000 })), difficultyFactor: settings.houseStandard.factors[grade] };
}

export function resolvedRules(settings: Settings, sku: string): Rule[] {
  if (!settings.resources || !settings.recipes) return settings.rules;
  const mapping = settings.mappings.find(m => m.sku === sku.trim().toUpperCase());
  const recipe = resolvedRecipe(settings, mapping?.sku || "");
  if (!mapping || !recipe) return [];
  return recipe.lines.map(line => {
    const item = settings.resources!.find(r => r.id === line.resourceId);
    return { id: line.id, family: mapping.family, part: line.part, kind: item?.kind || "material", name: item?.name || "库项目已缺失", spec: item?.spec || "", unit: item?.unit || "", price: item?.price ?? null, usage: line.usage, factors: Object.hasOwn(recipe, "difficultyFactor") ? [1, 1, 1, 1] : [line.factor, line.factor, line.factor, line.factor], enabled: line.enabled };
  });
}

export function resourceCounters(settings: Settings): NonNullable<Settings["codeCounters"]> {
  const counters: NonNullable<Settings["codeCounters"]> = { ...settings.codeCounters, material: settings.codeCounters?.material || 0, labor: settings.codeCounters?.labor || 0 };
  for (const resource of settings.resources || []) {
    const categoryMatch = resource.code.match(/^CL-(GC|MB|RB|SGB|BL)-(\d+)$/);
    if (categoryMatch) { const key = categoryMatch[1] as MaterialCategory; counters[key] = Math.max(counters[key] || 0, Number(categoryMatch[2])); }
    const prefix = resource.kind === "material" ? "CL" : "RG";
    const match = resource.code.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) counters[resource.kind] = Math.max(counters[resource.kind], Number(match[1]));
  }
  return counters;
}
export function nextResourceCode(settings: Settings, kind: CostResource["kind"], category?: MaterialCategory) {
  const counters = resourceCounters(settings);
  if (kind === "material" && category) { counters[category] = (counters[category] || 0) + 1; return { counters, code: `CL-${category}-${String(counters[category]).padStart(3, "0")}` }; }
  counters[kind] += 1;
  return { counters, code: `${kind === "material" ? "CL" : "RG"}-${String(counters[kind]).padStart(3, "0")}` };
}

// Assign new codes on save, guarded by the rule-version compare-and-swap.
export function assignResourceCodes(settings: Settings, previous: Settings): Settings {
  if (!settings.resources) return settings;
  const counters = resourceCounters(previous);
  const existing = new Map(previous.resources?.map(r => [r.id, r]) || []);
  const resources = settings.resources.map(resource => {
    const old = existing.get(resource.id);
    if (old) return { ...resource, category: old.category, code: old.code };
    if (resource.kind === "material" && resource.category) { const category = resource.category; counters[category] = (counters[category] || 0) + 1; return { ...resource, code: `CL-${category}-${String(counters[category]).padStart(3, "0")}` }; }
    counters[resource.kind] += 1;
    return { ...resource, code: `${resource.kind === "material" ? "CL" : "RG"}-${String(counters[resource.kind]).padStart(3, "0")}` };
  });
  return { ...settings, resources, codeCounters: counters };
}

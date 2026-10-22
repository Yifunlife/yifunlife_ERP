import { blankInput, type CostInput } from "./costing";

// Dimensions default to metres; add only the written edges and keep height/mezzanine separate.
export function costingDimensionsFromSpec(value: string) {
  let text = value.replace(/。\s*$/, "").replace(/\s/g, "").replace(/＋/g, "+").replace(/[×xX]/g, "*").replace(/[，,；;]/g, "|");
  const number = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
  const unit = "(?:米|m)?";
  const mezzPattern = new RegExp(`夹层(?:面积)?[:：]?(${number})${unit}\\*(${number})${unit}`, "i");
  const mezzMatch = text.match(mezzPattern);
  const mezzanine = mezzMatch ? Number(mezzMatch[1]) * Number(mezzMatch[2]) : null;
  if (mezzMatch) text = text.replace(mezzMatch[0], "");
  const roofPattern = new RegExp(`(?:二层吊顶|吊顶|屋顶|顶)(?:面积)?[:：]?(${number})${unit}\\*(${number})${unit}`, "i");
  const roofMatch = text.match(roofPattern);
  const hasRoof = text.includes("有顶");
  text = text.replace(/有顶/g, "");
  const roof = roofMatch ? Number(roofMatch[1]) * Number(roofMatch[2]) : hasRoof ? mezzanine : null;
  if (roofMatch) text = text.replace(roofMatch[0], "");
  text = text.replace(/无夹层/g, "");
  const heightPattern = new RegExp(`高(?:度)?[:：]?(${number})${unit}`, "i");
  const heightMatch = text.match(heightPattern);
  if (!heightMatch) return null;
  text = text.replace(heightMatch[0], "").replace(/^[|+]+|[|+]+$/g, "");
  const edge = `(?:长(?:度)?|宽(?:度)?)?[:：]?(${number})${unit}`;
  if (!new RegExp(`^${edge}(?:\\+${edge})*$`, "i").test(text)) return null;
  const lengths = [...text.matchAll(new RegExp(edge, "gi"))].map(m => Number(m[1]));
  if (hasRoof && mezzanine === null && roofMatch === null) return null;
  if (lengths.some(n => n <= 0) || Number(heightMatch[1]) <= 0 || (mezzanine !== null && mezzanine <= 0) || (roof !== null && roof <= 0)) return null;
  return { perimeter: lengths.reduce((sum, n) => sum + n, 0), height: Number(heightMatch[1]), mezzanine, roof };
}
export function costingInputFromRow(header: string[], row: unknown[], product: { sku: string; name: string; unit: string }, quantity: number, project: string): CostInput {
  const clean = (v: unknown) => String(v ?? "").replace(/\s/g, "").toLowerCase();
  const cell = (names: string[]) => { const i = header.findIndex(h => names.includes(clean(h))); return i < 0 ? "" : String(row[i] ?? "").trim(); };
  const numeric = (value: string) => value === "" ? null : (Number.isFinite(Number(value.replace(/,/g, ""))) ? Number(value.replace(/,/g, "")) : -1);
  const specIndex = header.findIndex(h => /规格|尺寸|specification|dimension|^size(?:\s*\/|$)/i.test(h));
  const specText = specIndex < 0 ? "" : String(row[specIndex] ?? "");
  const spec = costingDimensionsFromSpec(specText);
  const extra = (names: string[]) => { const value = cell(names); return value === "无" ? { status: "none" as const, area: null } : value === "" || value === "待确认" ? { status: "pending" as const, area: null } : { status: "present" as const, area: numeric(value) }; };
  const dimension = (names: string[]) => numeric(cell(names.flatMap(name => [name, `${name}(m)`, `${name}（m）`, `${name}(米)`, `${name}（米）`])));
  const length = dimension(["长", "长度"]), width = dimension(["宽", "宽度"]);
  // User-defined production length is length + width, never the rectangle perimeter 2*(L+W).
  const suppliedPerimeter = dimension(["周长", "制作总长度"]);
  const perimeter = suppliedPerimeter ?? (length === null || width === null ? (length === null && width === null ? spec?.perimeter ?? null : null) : length < 0 || width < 0 ? -1 : length + width);
  const height = dimension(["高", "高度"]) ?? spec?.height ?? null;
  const hasDimensions = !!specText.trim() || suppliedPerimeter !== null || length !== null || width !== null || height !== null;
  const areaUnit = /^(㎡|m²|m2|平方|平方米|sqm)$/i.test(product.unit.trim());
  return {
    ...blankInput(), project, name: product.name, sku: product.sku,
    quantity: areaUnit ? 1 : quantity,
    area: numeric(cell(["墙体面积", "墙体面积(㎡)", "墙体面积（㎡）", "核算面积", "周长面积"])) ?? (areaUnit && !hasDimensions ? quantity : null),
    perimeter, height,
    mezzanine: cell(["夹层面积", "夹层平台面积"]) ? extra(["夹层面积", "夹层平台面积"]) : spec?.mezzanine != null ? { status: "present", area: spec.mezzanine } : extra(["夹层面积", "夹层平台面积"]), roof: cell(["屋顶面积", "顶面积", "吊顶面积", "二层吊顶面积"]) ? extra(["屋顶面积", "顶面积", "吊顶面积", "二层吊顶面积"]) : spec?.roof != null ? { status: "present", area: spec.roof } : extra(["屋顶面积", "顶面积", "吊顶面积", "二层吊顶面积"]), glass: extra(["玻璃面积"]),
    glassReplacesWall: cell(["玻璃替换墙体"]) === "是",
    drawing: cell(["图纸", "图纸编号", "图纸版本"]),
  };
}
export type QuoteCosting = { saleSource?: "catalog"; factorySaleUnit?: number | null; recordId: string | null; version: number; saleUnit: number | null; usdSaleUnit?: number | null; status: "ready" | "pending"; issues: string[] };

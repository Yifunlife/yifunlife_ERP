"use client";
import { blankInput, calculate, calculateSale } from "../../lib/costing";
import { pieceLineUsage, squareMeterPrice, type LibrarySettings } from "../../lib/costing-library";
import { evaluateCostingExpression } from "../../lib/costing-expression";

function Formula({ value, save }: { value: string; save: (value: string, usage: number | null) => void }) {
  const usage = evaluateCostingExpression(value);
  return <><input aria-label="单件用量公式" value={value} aria-invalid={usage === null} onChange={e => save(e.target.value, evaluateCostingExpression(e.target.value))} />{usage === null && <small role="alert">请填写有效的加减乘除公式后保存</small>}</>;
}
export function PieceRecipes({ settings, edit }: { settings: LibrarySettings; edit: (settings: LibrarySettings) => void }) {
  const price = (v: number | null) => v === null ? "待补齐" : `¥${v.toFixed(2)}`;
  const patch = (sku: string, change: Partial<LibrarySettings["recipes"][number]>) => edit({ ...settings, recipes: settings.recipes.map(r => r.sku === sku ? { ...r, ...change } : r) });
  return <section className="costingPanel"><h2>标准件款号与单件成本</h2><p>各行列明材料用量与对应工种；仅人工的行不重复计材料费。平方米单价由材料库、工种库实时换算；用量及平方米单价四舍五入至三位后参与核算。</p><p>单件成本＝（材料合计＋人工合计×款号难度系数）×（1＋管理费率）。管理费沿用上方设置。</p>
    {settings.recipes.filter(r => r.basis === "piece").map(recipe => {
      const input = { ...blankInput(), sku: recipe.sku };
      const result = calculate(input, settings), sale = calculateSale(input, settings);
      return <details key={recipe.sku} open={settings.recipes.filter(r => r.basis === "piece").length <= 2}><summary>{recipe.sku} · {recipe.name} · 单件成本 {price(result.total)}</summary>
        {recipe.specification && <p>尺寸：{recipe.specification}</p>}
        <label>人工难度系数<input aria-label={`${recipe.sku}难度系数`} type="number" min="0.001" step="0.001" value={recipe.difficultyFactor ?? ""} onChange={e => patch(recipe.sku, { difficultyFactor: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        <p>材料 {price(result.material)}　人工 {price(result.labor)}　管理费率 {Math.round(result.managementRate * 100)}%　{recipe.saleSource === "catalog" ? "人民币售价取产品库；美元售价＝出厂价÷共用汇率" : `人民币售价 ${price(sale.total)} / 件`}</p>
        <div className="costingTableWrap"><table><thead><tr><th>材料 / 编号</th><th>计费内容</th><th>单件用量公式（㎡）</th><th>核算用量（㎡）</th><th>材料单价（元/㎡）</th><th>对应工种 / 编号</th><th>人工单价（元/㎡）</th></tr></thead><tbody>{recipe.lines.map(line => {
          const usage = pieceLineUsage(recipe, line);
          const material = settings.resources.find(r => r.id === line.resourceId), labor = settings.resources.find(r => r.id === line.laborResourceId);
          const update = (change: Partial<typeof line>) => patch(recipe.sku, { lines: recipe.lines.map(l => l.id === line.id ? { ...l, ...change } : l) });
          return <tr key={line.id}><td><select aria-label={`${recipe.sku}材料${line.id}`} value={line.resourceId} onChange={e => update({ resourceId: e.target.value })}>{settings.resources.filter(r => r.kind === "material").map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></td><td>{line.materialEnabled === false ? "仅人工" : "材料＋人工"}</td><td>{line.usageFromLineId ? <span>跟随关联材料行用量</span> : <Formula value={line.expression ?? String(line.usage ?? "")} save={(expression, usage) => update({ expression, usage })} />}<small>{line.source}</small></td><td>{usage === null ? "待补齐" : (Math.round(usage * 1000) / 1000).toFixed(3)}</td><td>{material ? squareMeterPrice(material)?.toFixed(3) ?? "待补齐" : "未关联"}</td><td><select aria-label={`${recipe.sku}工种${line.id}`} value={line.laborResourceId || ""} onChange={e => update({ laborResourceId: e.target.value })}><option value="">请选择工种</option>{settings.resources.filter(r => r.kind === "labor").map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select></td><td>{labor ? squareMeterPrice(labor)?.toFixed(3) ?? "待补齐" : "未关联"}</td></tr>;
        })}</tbody></table></div>
        {recipe.maxUsageLaborResourceIds?.length ? <div><p>包装、编号用量随本款号最大材料用量自动更新，并计入人工合计后统一乘难度系数。</p>{result.rows.filter(row => row.id.startsWith("max-usage-")).map(row => <p key={row.id}>{row.name}：{row.quantity?.toFixed(3) ?? "待补齐"} ㎡ × {row.price?.toFixed(3) ?? "待补齐"} 元/㎡ ＝ {price(row.amount)}（乘难度前）</p>)}</div> : null}
        {result.issues.length > 0 && <p role="alert">{result.issues.join("；")}</p>}
      </details>;
    })}
  </section>;
}

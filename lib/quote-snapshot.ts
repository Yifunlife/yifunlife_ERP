export function visibleQuoteSnapshot(snapshot: Record<string, unknown>, role: string) {
  const result = { ...snapshot };
  for (const key of ["products", "importedProducts"]) {
    if (!Array.isArray(result[key])) continue;
    result[key] = result[key].map((product: Record<string, unknown>) => {
      const visible = { ...product };
      if (!["admin", "ceo", "cost_accountant"].includes(role)) delete visible.cost;
      if (!["admin", "management", "ceo"].includes(role)) delete visible.branchPrice;
      return visible;
    });
  }
  return result;
}

// The shared rate is CNY per USD. Missing RMB prices must remain missing.
export function usdFromCny(price: number | null, exchangeRate: number): number | null {
  if (price === null || !Number.isFinite(price) || price < 0 || !Number.isFinite(exchangeRate) || exchangeRate <= 0) return null;
  const converted = price / exchangeRate;
  return Number.isFinite(converted) && converted <= 1e12 ? Math.round(converted * 100) / 100 : null;
}

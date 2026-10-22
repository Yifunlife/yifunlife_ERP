import { excludedFromQuote, type QuoteRevision } from "./quote-revisions";
import { quotationTotals } from "./quotation";

type SnapshotProduct = {
  revision?: QuoteRevision;
  id?: string;
  catalogProductId?: string;
  quoteCosting?: { recordId?: string | null };
  sku?: string;
  name?: string;
  price?: number | null;
  factory?: number | null;
  usd?: number | null;
  cost?: number | null;
  tags?: string[];
  category3?: string;
};

type QuoteSnapshot = {
  products?: SnapshotProduct[];
  cart?: Record<string, number>;
  priceMode?: "factory" | "vip" | "usd";
  salesName?: string;
  fees?: Partial<Record<"packaging" | "formaldehyde" | "shipping" | "installation" | "designDeduction", number>>;
  includeTax?: boolean;
  showDesignDeduction?: boolean;
};

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const readSnapshot = (value: string | null): QuoteSnapshot | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as QuoteSnapshot;
  } catch {
    return null;
  }
};

export const quoteAmount = (snapshot: QuoteSnapshot | null) => {
  const currency = snapshot?.priceMode === "usd" ? "USD" : "CNY";
  // A row can appear in restored snapshots more than once; its latest state wins.
  // Different rows with the same SKU remain separate business items.
  const products = [...new Map((snapshot?.products || []).map((product, index) => [product.id || `row:${index}`, product])).values()];
  const cart = snapshot?.cart || {};
  let pricedRows = 0;
  let costRows = 0;
  const subtotal = products.reduce((total, product) => {
    const quantity = Math.max(0, product.quoteCosting ? finiteNumber(cart[product.id || ""]) : Math.floor(finiteNumber(cart[product.id || ""])));
    if (!quantity || excludedFromQuote(product)) return total;
    const isToy = Boolean(
      product.tags?.includes("配套玩具") || product.category3 === "配套玩具",
    );
    const unitPrice = currency === "USD"
      ? product.usd
      : snapshot?.priceMode === "factory" && !isToy
        ? product.factory
        : product.price;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice)) return total;
    pricedRows += 1;
    return total + unitPrice * quantity;
  }, 0);
  const costAmount = products.reduce((total, product) => {
    const quantity = Math.max(0, product.quoteCosting ? finiteNumber(cart[product.id || ""]) : Math.floor(finiteNumber(cart[product.id || ""])));
    if (!quantity || excludedFromQuote(product) || typeof product.cost !== "number" || !Number.isFinite(product.cost))
      return total;
    costRows += 1;
    return total + product.cost * quantity;
  }, 0);
  const fees = snapshot?.fees || {};
  const totals = quotationTotals(subtotal, currency, fees, snapshot?.includeTax !== false, Boolean(snapshot?.showDesignDeduction));
  const skuCount = products.filter((product) => !excludedFromQuote(product) && finiteNumber(cart[product.id || ""]) > 0).length;
  return {
    currency,
    amount: totals.totalWithTax,
    hasAmount: pricedRows > 0,
    costAmount,
    hasCost: skuCount > 0 && costRows === skuCount,
    costRows,
    missingCostCount: skuCount - costRows,
    costCurrency: "CNY",
    skuCount: products.filter((product) => !excludedFromQuote(product) && finiteNumber(cart[product.id || ""]) > 0).length,
    salesName: snapshot?.salesName?.trim() || "",
    items: products
      .filter(product => !excludedFromQuote(product))
      .map((product) => ({
        sku: product.sku || "",
        name: product.name || "未命名产品",
        quantity: Math.max(0, product.quoteCosting ? finiteNumber(cart[product.id || ""]) : Math.floor(finiteNumber(cart[product.id || ""]))),
      }))
      .filter((item) => item.quantity > 0),
  };
};


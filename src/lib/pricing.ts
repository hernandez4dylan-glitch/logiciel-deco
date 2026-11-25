/** Taux de TVA appliqué aux prix TTC du magasin. */
export const VAT_RATE = 0.2;

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const ttcToHt = (ttc: number) => round2(ttc / (1 + VAT_RATE));

export type QuoteLine = {
  productId: string;
  quantity: number;
  salePriceTtc: number;
  proPriceTtc: number;
};

/** Prix unitaire TTC d'une ligne : tarif Pro si le client est Pro, sinon prix public. */
export function unitPrice(line: QuoteLine, isPro: boolean) {
  return isPro ? line.proPriceTtc : line.salePriceTtc;
}

export function computeQuote(lines: QuoteLine[], isPro: boolean, extraDiscountPercent = 0) {
  const discount = Math.min(Math.max(extraDiscountPercent || 0, 0), 100);
  const publicSubtotal = round2(lines.reduce((sum, l) => sum + l.salePriceTtc * l.quantity, 0));
  const subtotal = round2(lines.reduce((sum, l) => sum + unitPrice(l, isPro) * l.quantity, 0));
  const discountAmount = round2((subtotal * discount) / 100);
  const total = round2(subtotal - discountAmount);
  const totalHt = ttcToHt(total);
  return {
    publicSubtotal,
    proSavings: round2(publicSubtotal - subtotal),
    subtotal,
    discountAmount,
    total,
    totalHt,
    vat: round2(total - totalHt),
  };
}

/** Marge nette = CA HT − coût d'achat HT des articles vendus − frais & dépenses. */
export function computeNetMargin(input: {
  salesTotalTtc: number;
  costOfGoodsHt: number;
  expensesTotal: number;
}) {
  const revenueHt = ttcToHt(input.salesTotalTtc);
  const grossMargin = round2(revenueHt - input.costOfGoodsHt);
  const netMargin = round2(grossMargin - input.expensesTotal);
  return { revenueHt, grossMargin, netMargin };
}

export function isLowStock(stock: number, threshold: number) {
  return stock <= threshold;
}

import type { ProductRow } from "./data";
type Brief = {
  style: string;
  needs: string;
  budget: number;
  discountPercent: number;
};
function words(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
}
export async function recommendSelection(products: ProductRow[], brief: Brief) {
  const terms = new Set(words(brief.style + " " + brief.needs));
  const sorted = products
    .filter((p) => p.stock > 0)
    .map((p) => ({
      p,
      score: words(p.name + " " + p.category).filter((w) => terms.has(w))
        .length,
    }))
    .sort((a, b) => b.score - a.score || a.p.pro_price_ttc - b.p.pro_price_ttc);
  let remaining = Math.round(brief.budget * 100);
  const items = [];
  for (const { p, score } of sorted) {
    const cost = Math.round(p.pro_price_ttc * (100 - brief.discountPercent));
    if (cost > remaining) continue;
    remaining -= cost;
    items.push({
      productId: p.id,
      quantity: 1,
      reason: score
        ? "Correspondance avec les mots du projet."
        : "Disponible dans le budget restant.",
    });
  }
  return {
    items,
    summary: items.length
      ? "Sélection locale selon les mots du projet, les disponibilités et le budget."
      : "Aucun article en stock dans ce budget.",
    error: undefined,
  };
}

import { describe, expect, it } from "vitest";
import { computeNetMargin, computeQuote, isLowStock } from "./pricing";

const lamp = { productId: "a", quantity: 2, salePriceTtc: 129, proPriceTtc: 109 };
const vase = { productId: "b", quantity: 1, salePriceTtc: 59, proPriceTtc: 49 };

describe("devis", () => {
  it("utilise le prix public TTC pour un client particulier", () => {
    expect(computeQuote([lamp, vase], false).total).toBe(317);
  });

  it("applique le prix Pro quand la remise Pro est activée", () => {
    const q = computeQuote([lamp, vase], true);
    expect(q.total).toBe(267);
    expect(q.proSavings).toBe(50);
  });

  it("applique une remise supplémentaire en pourcentage", () => {
    expect(computeQuote([lamp, vase], false, 10).total).toBe(285.3);
  });
});

describe("marge nette", () => {
  it("déduit le coût d'achat et les frais du CA HT", () => {
    const m = computeNetMargin({ salesTotalTtc: 1200, costOfGoodsHt: 400, expensesTotal: 150 });
    expect(m.revenueHt).toBe(1000);
    expect(m.grossMargin).toBe(600);
    expect(m.netMargin).toBe(450);
  });
});

describe("alerte stock bas", () => {
  it("se déclenche quand le stock atteint le seuil", () => {
    expect(isLowStock(2, 2)).toBe(true);
    expect(isLowStock(3, 2)).toBe(false);
  });
});

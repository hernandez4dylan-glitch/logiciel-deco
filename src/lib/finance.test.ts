import { describe, expect, it } from "vitest";
import { monthlyFinance, startOfWeek, weeklySales } from "./finance";

describe("ventes de la semaine (cap de la boutique)", () => {
  it("compte du lundi à maintenant et compare à la semaine précédente", () => {
    const now = new Date(2026, 10, 25, 15, 0); // mercredi 25 novembre 2026
    expect(startOfWeek(now)).toEqual(new Date(2026, 10, 23));
    expect(startOfWeek(new Date(2026, 10, 29, 23))).toEqual(new Date(2026, 10, 23)); // dimanche
    const iso = (d: Date) => d.toISOString();
    const res = weeklySales(
      [
        { created_at: iso(new Date(2026, 10, 23, 9)), total_ttc: 129 },
        { created_at: iso(new Date(2026, 10, 25, 11)), total_ttc: "59.50" },
        { created_at: iso(new Date(2026, 10, 22, 18)), total_ttc: 549 }, // dimanche précédent
        { created_at: iso(new Date(2026, 10, 16, 10)), total_ttc: 79 },
        { created_at: iso(new Date(2026, 10, 2, 10)), total_ttc: 10 },
      ],
      now,
    );
    expect(res).toEqual({ count: 2, total: 188.5, lastCount: 2 });
  });
});

describe("monthlyFinance", () => {
  const now = new Date(2026, 10, 15);
  it("sorties = somme des frais et dépenses du mois, marge nette déduite", () => {
    const res = monthlyFinance(
      [{ created_at: "2026-11-10T10:00:00Z", total_ttc: 120, total_cost_ht: 40 }],
      [
        { expense_date: "2026-11-01", amount: 30 },
        { expense_date: "2026-11-05", amount: 10 },
        { expense_date: "2026-10-05", amount: 999 },
      ],
      2,
      now,
    );
    const nov = res[1]!;
    expect(nov.entrees).toBe(120);
    expect(nov.sorties).toBe(40);
    // 120 TTC → 100 HT − 40 coût − 40 frais = 20
    expect(nov.margeNette).toBe(20);
    expect(res[0]!.sorties).toBe(999);
  });
});

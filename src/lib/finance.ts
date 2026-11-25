import { computeNetMargin, round2 } from "./pricing";

type Sale = { created_at: string; total_ttc: number | string; total_cost_ht: number | string };
type Expense = { expense_date: string; amount: number | string };

export type MonthFinance = {
  key: string;
  label: string;
  entrees: number;
  sorties: number;
  margeNette: number;
};

const monthKey = (iso: string) => iso.slice(0, 7);

/** Lundi 0 h (heure locale) de la semaine qui contient `d`. */
export function startOfWeek(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

/**
 * Indicateur du cap de la boutique : ventes enregistrées cette semaine (du lundi à
 * maintenant), comparées à la semaine précédente.
 */
export function weeklySales(sales: { created_at: string; total_ttc: number | string }[], now = new Date()) {
  const start = startOfWeek(now).getTime();
  const prev = start - 7 * 24 * 3600 * 1000;
  let count = 0, total = 0, lastCount = 0;
  for (const s of sales) {
    const t = new Date(s.created_at).getTime();
    if (t >= start && t <= now.getTime()) {
      count++;
      total += Number(s.total_ttc);
    } else if (t >= prev && t < start) lastCount++;
  }
  return { count, total: round2(total), lastCount };
}

/**
 * Bilan mensuel : entrées = ventes encaissées TTC, sorties = frais & dépenses,
 * marge nette = CA HT − coût d'achat HT − sorties.
 */
export function monthlyFinance(sales: Sale[], expenses: Expense[], months = 6, now = new Date()): MonthFinance[] {
  const out: MonthFinance[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ms = sales.filter((s) => monthKey(new Date(s.created_at).toISOString()) === key);
    const me = expenses.filter((e) => monthKey(e.expense_date) === key);
    const entrees = round2(ms.reduce((t, s) => t + Number(s.total_ttc), 0));
    const sorties = round2(me.reduce((t, e) => t + Number(e.amount), 0));
    const cost = round2(ms.reduce((t, s) => t + Number(s.total_cost_ht), 0));
    const { netMargin } = computeNetMargin({ salesTotalTtc: entrees, costOfGoodsHt: cost, expensesTotal: sorties });
    out.push({
      key,
      label: new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d),
      entrees,
      sorties,
      margeNette: netMargin,
    });
  }
  return out;
}

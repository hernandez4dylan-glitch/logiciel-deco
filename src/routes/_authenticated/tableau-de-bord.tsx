import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowDownToLine, ArrowUpFromLine, ArrowUpRight, Euro, Package, ShoppingBag, TrendingUp } from "lucide-react";
import { Bar, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthlyFinance, weeklySales } from "@/lib/finance";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { ProductImage } from "@/components/app/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  allSalesQuery,
  expensesQuery,
  monthSalesQuery,
  movementsQuery,
  productsQuery,
  startOfMonthDate,
} from "@/lib/data";
import { dateTime, eur, monthLabel } from "@/lib/format";
import { computeNetMargin, isLowStock, round2 } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — Un Instant Chez Moi" },
      { name: "description", content: "Chiffre d'affaires, valeur du stock, alertes et marge nette du mois." },
      { property: "og:title", content: "Tableau de bord — Un Instant Chez Moi" },
      { property: "og:description", content: "Chiffre d'affaires, valeur du stock, alertes et marge nette du mois." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(productsQuery());
    context.queryClient.ensureQueryData(monthSalesQuery());
    context.queryClient.ensureQueryData(movementsQuery(8));
    context.queryClient.ensureQueryData(expensesQuery());
    context.queryClient.ensureQueryData(allSalesQuery());
  },
  component: Dashboard,
});

function Dashboard() {
  const { data: products } = useSuspenseQuery(productsQuery());
  const { data: sales } = useSuspenseQuery(monthSalesQuery());
  const { data: movements } = useSuspenseQuery(movementsQuery(8));
  const { data: expenses } = useSuspenseQuery(expensesQuery());
  const { data: allSales } = useSuspenseQuery(allSalesQuery());
  const history = monthlyFinance(allSales, expenses, 6);
  const week = weeklySales(allSales);

  const monthStart = startOfMonthDate();
  const monthExpenses = expenses.filter((e) => e.expense_date >= monthStart);
  const expensesTotal = round2(monthExpenses.reduce((s, e) => s + Number(e.amount), 0));
  const revenueTtc = round2(sales.reduce((s, x) => s + Number(x.total_ttc), 0));
  const costHt = round2(sales.reduce((s, x) => s + Number(x.total_cost_ht), 0));
  const margin = computeNetMargin({ salesTotalTtc: revenueTtc, costOfGoodsHt: costHt, expensesTotal });
  const stockValue = round2(products.reduce((s, p) => s + p.stock * Number(p.purchase_price_ht), 0));
  const stockUnits = products.reduce((s, p) => s + p.stock, 0);
  const lowStock = products.filter((p) => isLowStock(p.stock, p.low_stock_threshold));

  return (
    <>
      <PageHeader
        eyebrow={monthLabel()}
        title="Tableau de bord"
        description="L'essentiel de la boutique en un coup d'œil."
        actions={
          <Button asChild variant="hero">
            <Link to="/ventes">Nouveau devis</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Chiffre d'affaires du mois" value={eur(margin.revenueHt)} hint={`${sales.length} vente(s) · HT`} icon={Euro} />
        <StatCard label="Total des entrées" value={eur(revenueTtc)} hint="Ventes encaissées TTC" icon={ArrowDownToLine} tone="success" />
        <StatCard label="Total des sorties" value={eur(expensesTotal)} hint="Frais généraux + dépenses" icon={ArrowUpFromLine} tone="warning" />
        <StatCard
          label="Marge nette du mois"
          value={eur(margin.netMargin)}
          hint="Après coût d'achat et frais"
          icon={TrendingUp}
          tone={margin.netMargin >= 0 ? "success" : "destructive"}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Ventes enregistrées cette semaine"
          value={String(week.count)}
          hint={`${eur(week.total)} TTC · semaine dernière : ${week.lastCount} vente(s)`}
          icon={ShoppingBag}
          tone={week.count >= week.lastCount && week.count > 0 ? "success" : "primary"}
        />
        <StatCard label="Valeur totale du stock" value={eur(stockValue)} hint={`${stockUnits} pièces · prix d'achat HT`} icon={Package} />
        <StatCard
          label="Articles en alerte"
          value={String(lowStock.length)}
          hint="Stock au niveau du seuil ou en dessous"
          icon={AlertTriangle}
          tone={lowStock.length ? "warning" : "success"}
        />
      </div>

      <section className="surface mt-6 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Entrées, sorties et marge nette — 6 derniers mois</h2>
          <ExportCsvButton
            filename="bilan-mensuel"
            rows={history.map((h) => ({ Mois: h.key, "Entrées TTC": h.entrees, "Sorties (frais)": h.sorties, "Marge nette": h.margeNette }))}
          />
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `${v} €`} />
              <Tooltip formatter={(v: number) => eur(v)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="entrees" name="Entrées" fill="var(--success)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sorties" name="Sorties" fill="var(--warning)" radius={[4, 4, 0, 0]} />
              <Line dataKey="margeNette" name="Marge nette" stroke="var(--primary)" strokeWidth={2.5} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="surface p-6 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-medium">Dernières entrées / sorties</h2>
            <Link to="/catalogue" className="text-sm text-primary hover:underline">
              Gérer le stock
            </Link>
          </div>
          {movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun mouvement pour l'instant.</p>
          ) : (
            <ul className="divide-y">
              {movements.map((m) => {
                const isIn = m.quantity > 0;
                return (
                  <li key={m.id} className="flex items-center gap-3 py-3">
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full",
                        isIn ? "bg-success-soft text-success" : "bg-primary-soft text-primary",
                      )}
                    >
                      {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.product?.name ?? "Article supprimé"}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.reason} · {dateTime(m.created_at)}
                      </p>
                    </div>
                    <span className={cn("tabular text-sm font-semibold", isIn ? "text-success" : "text-primary")}>
                      {isIn ? "+" : ""}
                      {m.quantity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="grid gap-6 lg:col-span-2">
          <section className="surface p-6">
            <h2 className="mb-4 text-xl font-medium">Marge du mois</h2>
            <dl className="grid gap-2 text-sm">
              <Row label="CA HT" value={eur(margin.revenueHt)} />
              <Row label="Coût d'achat des ventes" value={`− ${eur(costHt)}`} />
              <Row label="Marge brute" value={eur(margin.grossMargin)} strong />
              <Row label="Frais & dépenses" value={`− ${eur(expensesTotal)}`} />
              <div className="my-1 h-px bg-border" />
              <Row label="Marge nette" value={eur(margin.netMargin)} strong accent />
            </dl>
          </section>

          <section className="surface p-6">
            <h2 className="mb-4 text-xl font-medium">À réapprovisionner</h2>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tout est en stock, rien à signaler.</p>
            ) : (
              <ul className="grid gap-3">
                {lowStock.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <ProductImage src={p.image_url} alt={p.name} className="h-10 w-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.supplier?.name ?? "Sans fournisseur"}</p>
                    </div>
                    <Badge variant={p.stock === 0 ? "danger" : "warning"}>{p.stock} en stock</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn("text-muted-foreground", strong && "font-medium text-foreground")}>{label}</dt>
      <dd className={cn("tabular", strong && "font-semibold", accent && "text-lg text-primary")}>{value}</dd>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";

import { Printer, Sparkles } from "lucide-react";
import { ProductImage } from "@/components/app/product-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ProductRow } from "@/lib/data";
import { eur } from "@/lib/format";
import { round2 } from "@/lib/pricing";
import { recommendSelection } from "@/lib/recommend.functions";

export function Advisor({ products, discount }: { products: ProductRow[]; discount: number }) {

  const [style, setStyle] = useState("");
  const [needs, setNeeds] = useState("");
  const [budget, setBudget] = useState("1500");
  const run = useMutation({
    mutationFn: () => recommendSelection(products, { style, needs, budget: Number(budget) || 0, discountPercent: discount }),
  });

  const factor = 1 - discount / 100;
  const lines = (run.data?.items ?? [])
    .map((i) => ({ ...i, p: products.find((x) => x.id === i.productId) }))
    .filter((l): l is typeof l & { p: ProductRow } => !!l.p);
  const total = round2(lines.reduce((s, l) => s + Number(l.p.pro_price_ttc) * factor * l.quantity, 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run.mutate();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={submit} className="surface grid content-start gap-3 p-5 print:hidden">
        <h3 className="text-lg font-medium">Le projet du client</h3>
        <div className="grid gap-1.5">
          <Label htmlFor="style">Style recherché</Label>
          <Input id="style" required minLength={2} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Ex. japandi chaleureux, tons naturels" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="needs">Besoins</Label>
          <Textarea id="needs" rows={4} value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder="Ex. salon de 25 m², besoin d'éclairage d'appoint et d'un fauteuil de lecture" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="budget">Budget maximum (€ TTC)</Label>
          <Input id="budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <Button type="submit" variant="hero" disabled={run.isPending}>
          <Sparkles className="h-4 w-4" /> {run.isPending ? "Sélection en cours…" : "Recommander une sélection"}
        </Button>
        <p className="text-xs text-muted-foreground">Sélection locale à partir du catalogue en stock, aux tarifs Pro.</p>
      </form>

      <section className="surface p-5">
        {run.isError && <p className="text-sm text-destructive">La recommandation a échoué, réessayez.</p>}
        {run.data?.error && <p className="text-sm text-destructive">{run.data.error}</p>}
        {!run.data && !run.isPending && !run.isError && (
          <p className="py-10 text-center text-sm text-muted-foreground">Décrivez le projet pour recevoir une sélection d'articles.</p>
        )}
        {run.isPending && <p className="py-10 text-center text-sm text-muted-foreground">Le logiciel compose la sélection…</p>}
        {run.data && !run.data.error && (
          <>
            <h3 className="mb-2 text-lg font-medium">Sélection proposée</h3>
            <p className="mb-4 text-sm text-muted-foreground">{run.data.summary}</p>
            <ul className="divide-y">
              {lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-3 py-3">
                  <ProductImage src={l.p.image_url} alt={l.p.name} className="h-14 w-14 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{l.quantity} × {l.p.name}</p>
                    <p className="text-xs text-muted-foreground">{l.reason}</p>
                  </div>
                  <span className="tabular text-sm">{eur(Number(l.p.pro_price_ttc) * factor * l.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className={Number(budget) && total > Number(budget) ? "text-destructive" : "text-muted-foreground"}>
                Budget : {eur(Number(budget) || 0)}
              </span>
              <span className="text-lg font-semibold text-primary">Total : {eur(total)}</span>
            </div>
            <Button className="mt-4 print:hidden" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer la sélection
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

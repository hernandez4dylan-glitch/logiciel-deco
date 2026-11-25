import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Minus, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { ConfirmButton } from "@/components/app/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/app/page-header";
import { ProductImage } from "@/components/app/product-image";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { allSalesQuery, productsQuery, STOCK_KEYS } from "@/lib/data";
import { dateTime, eur } from "@/lib/format";
import { computeQuote, type QuoteLine } from "@/lib/pricing";

const TITLE = "Devis & Ventes — Un Instant Chez Moi";
const DESC = "Préparez un devis, appliquez le tarif Pro et enregistrez la vente.";

export const Route = createFileRoute("/_authenticated/ventes")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(productsQuery());
    context.queryClient.ensureQueryData(allSalesQuery());
  },
  component: Page,
});

function Page() {
  const { data: products } = useSuspenseQuery(productsQuery());
  const { data: sales } = useSuspenseQuery(allSalesQuery());
  const qc = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [isPro, setIsPro] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [customer, setCustomer] = useState("");

  const lines: (QuoteLine & { name: string; sku: string; stock: number })[] = Object.entries(cart)
    .map(([id, quantity]) => {
      const p = products.find((x) => x.id === id);
      if (!p) return null;
      return {
        productId: id,
        quantity,
        salePriceTtc: Number(p.sale_price_ttc),
        proPriceTtc: Number(p.pro_price_ttc),
        name: p.name,
        sku: p.sku,
        stock: p.stock,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const quote = computeQuote(lines, isPro, discount);

  const filtered = useMemo(
    () => products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase())),
    [products, search],
  );

  const setQty = (id: string, qty: number, max: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(qty, max);
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await localStore.rpc("record_sale", {
        p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
        p_is_pro: isPro,
        p_extra_discount: discount,
        p_customer: customer,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vente enregistrée, stock mis à jour");
      setCart({});
      setCustomer("");
      setDiscount(0);
      STOCK_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await localStore.from("sales").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vente annulée, articles remis en stock");
      STOCK_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Devis & Ventes" description={DESC} />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="surface p-6 lg:col-span-3">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Rechercher un article ou un SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={p.stock === 0}
                  onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1, p.stock)}
                  className="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition hover:border-primary disabled:opacity-50"
                >
                  <ProductImage src={p.image_url} alt={p.name} className="h-12 w-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {eur(isPro ? p.pro_price_ttc : p.sale_price_ttc)} · {p.stock} en stock
                    </p>
                  </div>
                  <Plus className="h-4 w-4 text-primary" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface p-6 lg:col-span-2 print:col-span-5" id="quote">
          <h2 className="mb-4 text-xl font-medium">Devis en cours</h2>
          <div className="mb-4 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="customer">Client</Label>
              <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Nom du client (facultatif)" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="pro">Client professionnel (tarif Pro)</Label>
              <Switch id="pro" checked={isPro} onCheckedChange={setIsPro} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="discount">Remise supplémentaire (%)</Label>
              <Input id="discount" type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cliquez sur un article pour l'ajouter.</p>
          ) : (
            <ul className="mb-4 divide-y">
              {lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">{eur(isPro ? l.proPriceTtc : l.salePriceTtc)} / unité</p>
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Retirer un" onClick={() => setQty(l.productId, l.quantity - 1, l.stock)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="tabular w-6 text-center text-sm">{l.quantity}</span>
                  <Button size="icon" variant="ghost" aria-label="Ajouter un" onClick={() => setQty(l.productId, l.quantity + 1, l.stock)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={() => setQty(l.productId, 0, l.stock)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <dl className="grid gap-1.5 text-sm">
            <Row label="Sous-total" value={eur(quote.subtotal)} />
            {quote.proSavings > 0 && <Row label="Économie tarif Pro" value={`− ${eur(quote.proSavings)}`} />}
            {quote.discountAmount > 0 && <Row label={`Remise ${discount} %`} value={`− ${eur(quote.discountAmount)}`} />}
            <Row label="Total HT" value={eur(quote.totalHt)} />
            <Row label="TVA 20 %" value={eur(quote.vat)} />
            <div className="flex items-center justify-between border-t pt-2 text-lg font-semibold">
              <dt>Total TTC</dt>
              <dd className="tabular text-primary">{eur(quote.total)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex gap-2 print:hidden">
            <Button variant="outline" className="flex-1" disabled={!lines.length} onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer le devis
            </Button>
            <Button variant="hero" className="flex-1" disabled={!lines.length || save.isPending} onClick={() => save.mutate()}>
              Enregistrer la vente
            </Button>
          </div>
        </section>
      </div>

      <section className="surface mt-6 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Historique des ventes</h2>
          <ExportCsvButton
            filename="ventes"
            rows={sales.map((s) => ({
              Date: new Date(s.created_at).toLocaleString("fr-FR"),
              Client: s.customer_name ?? "",
              Pro: s.is_pro ? "Oui" : "Non",
              Articles: s.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", "),
              "Remise %": Number(s.extra_discount_percent),
              "Total TTC": Number(s.total_ttc),
              "Total HT": Number(s.total_ttc) / 1.2,
              "Coût d'achat HT": Number(s.total_cost_ht),
            }))}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Articles</TableHead>
              <TableHead className="text-right">Total TTC</TableHead>
              <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap">{dateTime(s.created_at)}</TableCell>
                <TableCell>
                  {s.customer_name || "Client comptoir"} {s.is_pro ? <Badge variant="secondary">Pro</Badge> : null}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
                </TableCell>
                <TableCell className="tabular text-right font-medium">{eur(s.total_ttc)}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <CustomerDialog saleId={s.id} name={s.customer_name ?? ""} />
                    <ConfirmButton
                      title="Annuler cette vente ?"
                      description="La vente est supprimée de l'historique et les articles sont remis en stock."
                      confirmLabel="Annuler la vente"
                      onConfirm={() => cancel.mutate(s.id)}
                    >
                      <Button size="icon" variant="ghost" aria-label="Annuler la vente" title="Annuler la vente">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sales.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Aucune vente enregistrée.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

function CustomerDialog({ saleId, name }: { saleId: string; name: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await localStore.from("sales").update({ customer_name: value }).eq("id", saleId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vente modifiée");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["sales"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(name);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Modifier le client" title="Modifier le client">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la vente</DialogTitle>
          <DialogDescription>Pour changer les articles, annulez la vente puis enregistrez-la à nouveau.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`client-${saleId}`}>Client</Label>
            <Input id={`client-${saleId}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Client comptoir" />
          </div>
          <DialogFooter>
            <Button type="submit" variant="hero" disabled={save.isPending}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

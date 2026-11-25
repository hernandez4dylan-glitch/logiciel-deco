import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/app/confirm-button";
import { ProductPhotosDialog } from "@/components/app/product-photos-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ProductImage } from "@/components/app/product-image";
import { ProductFormDialog } from "@/components/app/product-form-dialog";
import { StockStepper } from "@/components/app/stock-stepper";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CATEGORIES, productsQuery, STOCK_KEYS, suppliersQuery } from "@/lib/data";
import { eur } from "@/lib/format";
import { isLowStock } from "@/lib/pricing";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { ShowroomDialog } from "@/components/app/showroom-dialog";

type CatalogueSearch = { fournisseur?: string | undefined; categorie?: string | undefined };

export const Route = createFileRoute("/_authenticated/catalogue")({
  validateSearch: (s: Record<string, unknown>): CatalogueSearch => ({
    fournisseur: typeof s["fournisseur"] === "string" ? s["fournisseur"] : undefined,
    categorie: typeof s["categorie"] === "string" ? s["categorie"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Catalogue & Stock — Un Instant Chez Moi" },
      { name: "description", content: "Produits, prix d'achat, prix public et Pro, quantités en stock." },
      { property: "og:title", content: "Catalogue & Stock — Un Instant Chez Moi" },
      { property: "og:description", content: "Produits, prix d'achat, prix public et Pro, quantités en stock." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(productsQuery());
    context.queryClient.ensureQueryData(suppliersQuery());
  },
  component: Catalogue,
});

const ALL = "__all";

function Catalogue() {
  const { fournisseur, categorie } = Route.useSearch();
  const navigate = useNavigate({ from: "/catalogue" });
  const { data: products } = useSuspenseQuery(productsQuery());
  const { data: suppliers } = useSuspenseQuery(suppliersQuery());
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await localStore.from("products").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Article supprimé");
      STOCK_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = products.filter((p) => {
    if (fournisseur && p.supplier_id !== fournisseur) return false;
    if (categorie && p.category !== categorie) return false;
    const term = q.trim().toLowerCase();
    return !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term);
  });

  return (
    <>
      <PageHeader
        eyebrow={`${products.length} articles`}
        title="Catalogue & Stock"
        description="Ajustez le stock d'un clic avec −1 / +1 après un réassort ou une casse."
        actions={
          <>
            <ExportCsvButton
              filename="stock"
              rows={products.map((p) => ({
                SKU: p.sku,
                Nom: p.name,
                Catégorie: p.category,
                Fournisseur: p.supplier?.name ?? "",
                "Prix d'achat HT": Number(p.purchase_price_ht),
                "Prix de vente TTC": Number(p.sale_price_ttc),
                "Prix Pro TTC": Number(p.pro_price_ttc),
                Stock: p.stock,
                "Valeur stock HT": p.stock * Number(p.purchase_price_ht),
              }))}
            />
            <ShowroomDialog products={products} />
            <ProductFormDialog />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Rechercher un nom ou un SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select
          value={categorie ?? ALL}
          onValueChange={(v) => navigate({ search: (s) => ({ ...s, categorie: v === ALL ? undefined : v }) })}
        >
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toutes catégories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={fournisseur ?? ALL}
          onValueChange={(v) => navigate({ search: (s) => ({ ...s, fournisseur: v === ALL ? undefined : v }) })}
        >
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les fournisseurs</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="w-16">Photo</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead className="text-right">Achat HT</TableHead>
              <TableHead className="text-right">Vente TTC</TableHead>
              <TableHead className="text-right">Prix Pro</TableHead>
              <TableHead className="text-center">Stock</TableHead>
              <TableHead className="w-32"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const low = isLowStock(p.stock, p.low_stock_threshold);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <ProductImage src={p.image_url} alt={p.name} className="h-12 w-12" />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                  <TableCell className="font-medium">
                    {p.name}
                    {low && <Badge variant={p.stock === 0 ? "danger" : "warning"} className="ml-2">Stock bas</Badge>}
                  </TableCell>
                  <TableCell><Badge variant="muted">{p.category}</Badge></TableCell>
                  <TableCell className="text-sm">{p.supplier?.name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular">{eur(p.purchase_price_ht)}</TableCell>
                  <TableCell className="text-right tabular font-medium">{eur(p.sale_price_ttc)}</TableCell>
                  <TableCell className="text-right tabular text-primary">{eur(p.pro_price_ttc)}</TableCell>
                  <TableCell className="text-center">
                    <StockStepper productId={p.id} stock={p.stock} low={low} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <ProductPhotosDialog product={p} />
                      <ProductFormDialog product={p} />
                      <ConfirmButton
                        title={`Supprimer « ${p.name} » ?`}
                        description="L'article et ses mouvements de stock seront supprimés. Les ventes passées restent dans l'historique."
                        onConfirm={() => remove.mutate(p.id)}
                      >
                        <Button size="icon" variant="ghost" aria-label={`Supprimer ${p.name}`} title="Supprimer">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </ConfirmButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}className="py-12 text-center text-muted-foreground">
                  Aucun article ne correspond à ces filtres.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

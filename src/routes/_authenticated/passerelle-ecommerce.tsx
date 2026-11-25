import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Code } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { PageHeader } from "@/components/app/page-header";
import { ProductImage } from "@/components/app/product-image";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { productsQuery } from "@/lib/data";
import { downloadFile } from "@/lib/csv";
import { eur } from "@/lib/format";

const TITLE = "Passerelle E-commerce — Un Instant Chez Moi";
const DESC = "Choisissez les articles publiés sur le site et exportez le catalogue.";

export const Route = createFileRoute("/_authenticated/passerelle-ecommerce")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQuery()),
  component: Page,
});

function Page() {
  const { data: products } = useSuspenseQuery(productsQuery());
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await localStore.from("products").update({ published_web: value, web_synced_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const published = products.filter((p) => p.published_web);
  const feed = published.map((p) => ({ sku: p.sku, nom: p.name, categorie: p.category, prix_ttc: Number(p.sale_price_ttc), stock: p.stock, image: p.image_url }));

  return (
    <>
      <PageHeader
        title="Passerelle E-commerce"
        description={`${published.length} article(s) à exporter sur ${products.length}.`}
        actions={
          <>
            <ExportCsvButton filename="catalogue-web" rows={feed} label="Exporter le catalogue (CSV)" />
            <Button variant="outline" onClick={() => downloadFile("catalogue-web.json", JSON.stringify(feed, null, 2), "application/json")}>
              <Code className="h-4 w-4" /> Export API (JSON)
            </Button>
          </>
        }
      />
      <section className="surface p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Article</TableHead><TableHead>Prix TTC</TableHead><TableHead>Stock</TableHead><TableHead>État de l’export</TableHead><TableHead>Inclure dans l’export</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <ProductImage src={p.image_url} alt={p.name} className="h-10 w-10" />
                    <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku}</p></div>
                  </div>
                </TableCell>
                <TableCell className="tabular">{eur(p.sale_price_ttc)}</TableCell>
                <TableCell className="tabular">{p.stock}</TableCell>
                <TableCell>
                  {!p.published_web ? <Badge variant="muted">Brouillon</Badge> : p.stock === 0 ? <Badge variant="danger">Rupture</Badge> : <Badge variant="success">Inclus dans l’export</Badge>}
                </TableCell>
                <TableCell>
                  <Switch aria-label={`Publier ${p.name}`} checked={p.published_web} onCheckedChange={(value) => toggle.mutate({ id: p.id, value })} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { ProductImage } from "@/components/app/product-image";
import { EspaceDecorateur } from "@/components/decor/espace-decorateur";
import { Advisor } from "@/components/pro/advisor";
import { DecoratorForm } from "@/components/pro/decorator-form";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { decoratorsQuery, productsQuery } from "@/lib/data";
import { eur } from "@/lib/format";

const TITLE = "Espace Pro Décorateurs — Un Instant Chez Moi";
const DESC = "Espace décorateur (photo du client, finitions et objets du catalogue, liste d'achat et PDF), catalogue aux tarifs Pro et décorateurs partenaires.";

export const Route = createFileRoute("/_authenticated/espace-pro")({
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
    context.queryClient.ensureQueryData(decoratorsQuery());
  },
  component: Page,
});

function Page() {
  const { data: products } = useSuspenseQuery(productsQuery());
  const { data: decorators } = useSuspenseQuery(decoratorsQuery());
  const [decoId, setDecoId] = useState("none");
  const discount = Number(decorators.find((d) => d.id === decoId)?.discount_percent ?? 0);

  return (
    <>
      <PageHeader
        title="Espace Pro Décorateurs"
        description={DESC}
        actions={
          <Select value={decoId} onValueChange={setDecoId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Décorateur" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sans remise partenaire</SelectItem>
              {decorators.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name} (−{Number(d.discount_percent)} %)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <Tabs defaultValue="studio">
        <TabsList className="mb-4">
          <TabsTrigger value="studio">Espace décorateur</TabsTrigger>
          <TabsTrigger value="conseiller">Conseiller local</TabsTrigger>
          <TabsTrigger value="catalogue">Catalogue Pro</TabsTrigger>
          <TabsTrigger value="partenaires">Décorateurs partenaires</TabsTrigger>
        </TabsList>
        <TabsContent value="studio"><EspaceDecorateur products={products} discount={discount} /></TabsContent>
        <TabsContent value="conseiller"><Advisor products={products} discount={discount} /></TabsContent>
        <TabsContent value="catalogue">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <div key={p.id} className="surface flex gap-3 p-3">
                <ProductImage src={p.image_url} alt={p.name} className="h-20 w-20 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku} · {p.category}</p>
                  <p className="mt-1 text-lg font-semibold text-primary">{eur(Number(p.pro_price_ttc) * (1 - discount / 100))}</p>
                  <Badge variant={p.stock > 0 ? "success" : "danger"}>{p.stock} en stock</Badge>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="partenaires">
          <section className="surface p-6">
            <div className="mb-4 flex justify-end"><DecoratorForm /></div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead><TableHead>Société</TableHead><TableHead>Email</TableHead><TableHead>Téléphone</TableHead><TableHead className="text-right">Remise</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decorators.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.company}</TableCell>
                    <TableCell>{d.email}</TableCell>
                    <TableCell>{d.phone}</TableCell>
                    <TableCell className="text-right">{Number(d.discount_percent)} %</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}

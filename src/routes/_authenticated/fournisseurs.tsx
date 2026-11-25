import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Clock, Mail, Phone, Plus, User } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { PageHeader } from "@/components/app/page-header";
import { ProductImage } from "@/components/app/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { productsQuery, suppliersQuery } from "@/lib/data";
import { eur } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/fournisseurs")({
  head: () => ({
    meta: [
      { title: "Fournisseurs — Un Instant Chez Moi" },
      { name: "description", content: "Contacts, délais de livraison et produits de chaque fournisseur." },
      { property: "og:title", content: "Fournisseurs — Un Instant Chez Moi" },
      { property: "og:description", content: "Contacts, délais de livraison et produits de chaque fournisseur." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(productsQuery());
    context.queryClient.ensureQueryData(suppliersQuery());
  },
  component: Suppliers,
});

function Suppliers() {
  const { data: suppliers } = useSuspenseQuery(suppliersQuery());
  const { data: products } = useSuspenseQuery(productsQuery());
  const [selected, setSelected] = useState<string | null>(suppliers[0]?.id ?? null);
  const current = suppliers.find((s) => s.id === selected);
  const supplierProducts = products.filter((p) => p.supplier_id === selected);

  return (
    <>
      <PageHeader
        eyebrow={`${suppliers.length} partenaires`}
        title="Fournisseurs"
        description="Sélectionnez un fournisseur pour afficher ses produits."
        actions={<SupplierDialog />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {suppliers.map((s) => {
          const count = products.filter((p) => p.supplier_id === s.id).length;
          const active = s.id === selected;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s.id)}
              className={cn(
                "surface p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]",
                active && "ring-2 ring-primary",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-medium">{s.name}</h2>
                <Badge variant={active ? "default" : "muted"}>{count} produit{count > 1 ? "s" : ""}</Badge>
              </div>
              <dl className="mt-4 grid gap-2 text-sm text-muted-foreground">
                <Info icon={User}>{s.contact_name ?? "—"}</Info>
                <Info icon={Mail}>{s.email ?? "—"}</Info>
                <Info icon={Phone}>{s.phone ?? "—"}</Info>
                <Info icon={Clock}>Livraison sous {s.lead_time_days} jours</Info>
              </dl>
            </button>
          );
        })}
      </div>

      {current && (
        <section className="surface mt-8 p-6 animate-rise">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-medium">Produits de {current.name}</h2>
            <Button asChild variant="soft" size="sm">
              <Link to="/catalogue" search={{ fournisseur: current.id }}>Voir dans le catalogue</Link>
            </Button>
          </div>
          {supplierProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun produit associé pour l'instant.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {supplierProducts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border bg-background p-3">
                  <ProductImage src={p.image_url} alt={p.name} className="h-14 w-14 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku} · achat {eur(p.purchase_price_ht)} HT
                    </p>
                    <p className="text-xs text-muted-foreground">{p.stock} en stock</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function Info({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="truncate">{children}</span>
    </div>
  );
}

const emptySupplier = { name: "", contact_name: "", email: "", phone: "", lead_time_days: "7" };

function SupplierDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptySupplier);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await localStore.from("suppliers").insert({
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        lead_time_days: Math.max(0, parseInt(form.lead_time_days || "0", 10)),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Fournisseur ajouté");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setForm(emptySupplier);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const field = (key: keyof typeof emptySupplier, label: string, type = "text", required = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`sup-${key}`}>{label}</Label>
      <Input
        id={`sup-${key}`}
        type={type}
        required={required}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="hero"><Plus /> Nouveau fournisseur</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">Nouveau fournisseur</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {field("name", "Nom", "text", true)}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("contact_name", "Contact")}
            {field("phone", "Téléphone", "tel")}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">{field("email", "Email", "email")}</div>
            {field("lead_time_days", "Délai (jours)", "number")}
          </div>
          <DialogFooter>
            <Button type="submit" variant="hero" disabled={mutation.isPending}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

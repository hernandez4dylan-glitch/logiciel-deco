import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { CATEGORIES, PRODUCT_IMAGES_BUCKET, suppliersQuery, type Category, type ProductRow } from "@/lib/data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const empty = {
  sku: "",
  name: "",
  category: "Objet déco" as Category,
  supplier_id: "",
  purchase_price_ht: "",
  sale_price_ttc: "",
  pro_price_ttc: "",
  stock: "0",
  low_stock_threshold: "3",
};

const fromProduct = (p: ProductRow): typeof empty => ({
  sku: p.sku,
  name: p.name,
  category: p.category as Category,
  supplier_id: p.supplier_id ?? "",
  purchase_price_ht: String(p.purchase_price_ht),
  sale_price_ttc: String(p.sale_price_ttc),
  pro_price_ttc: String(p.pro_price_ttc),
  stock: String(p.stock),
  low_stock_threshold: String(p.low_stock_threshold),
});

/** Création d'un article, ou modification si `product` est fourni (le stock se règle avec −1 / +1). */
export function ProductFormDialog({ product }: { product?: ProductRow } = {}) {
  const editing = !!product;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const { data: suppliers = [] } = useQuery(suppliersQuery());

  const set = (key: keyof typeof empty) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const onOpenChange = (next: boolean) => {
    if (next) {
      setForm(product ? fromProduct(product) : empty);
      setFile(null);
    }
    setOpen(next);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      let image_url: string | null = product?.image_url ?? null;
      if (file) {
        const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error } = await localStore.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, file);
        if (error) throw new Error("Photo non envoyée : " + error.message);
        image_url = path;
      }
      const values = {
        sku: form.sku.trim().toUpperCase(),
        name: form.name.trim(),
        category: form.category,
        supplier_id: form.supplier_id || null,
        purchase_price_ht: Number(form.purchase_price_ht || 0),
        sale_price_ttc: Number(form.sale_price_ttc || 0),
        pro_price_ttc: Number(form.pro_price_ttc || form.sale_price_ttc || 0),
        low_stock_threshold: Math.max(0, parseInt(form.low_stock_threshold || "0", 10)),
        image_url,
      };
      const { error } = product
        ? await localStore
            .from("products")
            .update(file ? { ...values, cutout_url: null } : values)
            .eq("id", product.id)
        : await localStore
            .from("products")
            .insert({ ...values, stock: Math.max(0, parseInt(form.stock || "0", 10)) });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(editing ? "Article modifié" : "Article ajouté au catalogue");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["stock_movements"] });
      setForm(empty);
      setFile(null);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button size="icon" variant="ghost" aria-label={`Modifier ${product.name}`} title="Modifier">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="hero">
            <Plus /> Nouvel article
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-medium">
            {editing ? "Modifier l'article" : "Nouvel article"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Le stock se corrige avec les boutons −1 / +1 du catalogue."
              : "Ajoutez une pièce au catalogue de la boutique."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Référence SKU" id="sku">
              <Input id="sku" required placeholder="LUM-XXX-007" value={form.sku} onChange={(e) => set("sku")(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Nom" id="name">
                <Input id="name" required value={form.name} onChange={(e) => set("name")(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Catégorie" id="category">
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger id="category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fournisseur" id="supplier">
              <Select value={form.supplier_id} onValueChange={set("supplier_id")}>
                <SelectTrigger id="supplier"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Prix d'achat HT (€)" id="pa">
              <Input id="pa" type="number" step="0.01" min="0" required value={form.purchase_price_ht} onChange={(e) => set("purchase_price_ht")(e.target.value)} />
            </Field>
            <Field label="Prix de vente TTC (€)" id="pv">
              <Input id="pv" type="number" step="0.01" min="0" required value={form.sale_price_ttc} onChange={(e) => set("sale_price_ttc")(e.target.value)} />
            </Field>
            <Field label="Prix Pro TTC (€)" id="pp">
              <Input id="pp" type="number" step="0.01" min="0" placeholder="= prix public" value={form.pro_price_ttc} onChange={(e) => set("pro_price_ttc")(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={editing ? "Stock actuel" : "Stock initial"} id="stock">
              <Input id="stock" type="number" min="0" disabled={editing} value={form.stock} onChange={(e) => set("stock")(e.target.value)} />
            </Field>
            <Field label="Seuil d'alerte" id="threshold">
              <Input id="threshold" type="number" min="0" value={form.low_stock_threshold} onChange={(e) => set("low_stock_threshold")(e.target.value)} />
            </Field>
            <Field label={editing ? "Nouvelle photo" : "Photo"} id="photo">
              <Input id="photo" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="submit" variant="hero" disabled={mutation.isPending}>
              {mutation.isPending ? "Enregistrement…" : editing ? "Enregistrer" : "Ajouter l'article"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Scissors, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CutoutEditor } from "@/components/app/cutout-editor";
import { localStore } from "@/lib/local-client";
import { productPhotosQuery, type ProductRow } from "@/lib/data";
import { photoUrl, uploadBlob } from "@/lib/studio-api";
import { cn } from "@/lib/utils";

export type PhotoChoice = { id: string | null; image: string; cutout: string | null; label: string };

/** Photos d'un article : la photo principale de la fiche puis les photos complémentaires. */
export function productPhotoChoices(product: ProductRow, extra: { id: string; product_id: string; image_path: string; cutout_path: string | null; label: string | null }[]): PhotoChoice[] {
  const list: PhotoChoice[] = [];
  if (product.image_url) list.push({ id: null, image: product.image_url, cutout: product.cutout_url, label: "Photo principale" });
  extra
    .filter((p) => p.product_id === product.id)
    .forEach((p, i) => list.push({ id: p.id, image: p.image_path, cutout: p.cutout_path, label: p.label || `Vue ${i + 2}` }));
  return list;
}

/** Enregistre un détourage sur la fiche article : réutilisable dans tous les projets. */
export async function saveCutout(product: ProductRow, choice: PhotoChoice, png: Blob) {
  const path = await uploadBlob("cutout", png, "png");
  const res = choice.id
    ? await localStore.from("product_photos").update({ cutout_path: path }).eq("id", choice.id)
    : await localStore.from("products").update({ cutout_url: path }).eq("id", product.id);
  if (res.error) throw new Error(res.error.message);
  return path;
}

export function ProductPhotosDialog({ product, trigger }: { product: ProductRow; trigger?: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PhotoChoice | null>(null);
  const [label, setLabel] = useState("");
  const { data: extra = [] } = useQuery({ ...productPhotosQuery(), enabled: open });
  const choices = productPhotoChoices(product, extra);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_photos"] });
  };

  const add = useMutation({
    mutationFn: async (file: File) => {
      const ext = /png$/i.test(file.type) ? "png" : "jpg";
      const path = await uploadBlob("photo", file, ext);
      const { error } = product.image_url
        ? await localStore.from("product_photos").insert({ product_id: product.id, image_path: path, label: label.trim() || null })
        : await localStore.from("products").update({ image_url: path }).eq("id", product.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setLabel("");
      refresh();
      toast.success("Photo ajoutée");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await localStore.from("product_photos").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const makeMain = useMutation({
    mutationFn: async (c: PhotoChoice) => {
      if (!c.id || !product.image_url) return;
      // Échange : l'ancienne principale devient une photo complémentaire.
      const a = await localStore.from("product_photos").insert({ product_id: product.id, image_path: product.image_url, cutout_path: product.cutout_url, label: "Ancienne principale" });
      if (a.error) throw new Error(a.error.message);
      const b = await localStore.from("products").update({ image_url: c.image, cutout_url: c.cutout }).eq("id", product.id);
      if (b.error) throw new Error(b.error.message);
      const d = await localStore.from("product_photos").delete().eq("id", c.id);
      if (d.error) throw new Error(d.error.message);
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEditing(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="icon" variant="ghost" aria-label={`Photos et détourage de ${product.name}`} title="Photos & détourage">
            <Camera className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Photos & détourage — {product.name}</DialogTitle>
          <DialogDescription>
            {product.sku} · Le détourage enregistré ici est réutilisé dans tous les projets du studio. Plusieurs angles de vue peuvent être ajoutés.
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <CutoutEditor
            source={photoUrl(editing.image)}
            cutout={editing.cutout ? photoUrl(editing.cutout) : null}
            onCancel={() => setEditing(null)}
            onSave={async (png) => {
              await saveCutout(product, editing, png);
              refresh();
              toast.success("Détourage enregistré sur la fiche article");
              setEditing(null);
            }}
          />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {choices.map((c) => (
                <li key={c.id ?? "main"} className="rounded-lg border p-2">
                  <div className="grid grid-cols-2 gap-1">
                    <img src={photoUrl(c.image)} alt={c.label} className="aspect-square w-full rounded object-contain bg-muted" />
                    <div className={cn("aspect-square w-full rounded", "bg-[conic-gradient(#e7e3dc_25%,#f6f3ee_0_50%,#e7e3dc_0_75%,#f6f3ee_0)] bg-[length:16px_16px]")}>
                      {c.cutout ? (
                        <img src={photoUrl(c.cutout)} alt={`${c.label} détourée`} className="h-full w-full object-contain" />
                      ) : (
                        <p className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">Pas encore détourée</p>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{c.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button size="sm" variant={c.cutout ? "outline" : "hero"} onClick={() => setEditing(c)}>
                      <Scissors className="h-4 w-4" /> {c.cutout ? "Retoucher" : "Détourer"}
                    </Button>
                    {c.id && (
                      <>
                        <Button size="icon" variant="ghost" title="Utiliser comme photo principale" aria-label="Utiliser comme photo principale" onClick={() => makeMain.mutate(c)}>
                          <Star className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Retirer cette photo" aria-label="Retirer cette photo" onClick={() => remove.mutate(c.id!)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
              <div className="grid gap-1">
                <label htmlFor={`label-${product.id}`} className="text-xs text-muted-foreground">Nom de la vue (facultatif)</label>
                <Input id={`label-${product.id}`} className="h-9 w-56" placeholder="Ex. vue de trois-quarts" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:border-primary">
                <ImagePlus className="h-4 w-4" /> {add.isPending ? "Envoi…" : "Ajouter une photo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) add.mutate(f);
                  }}
                />
              </label>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

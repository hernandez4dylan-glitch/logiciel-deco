import { CutoutEditor } from "./cutout-editor";
import { blobToDataUrl, loadImage } from "@/lib/studio-api";
import { composeShowroom } from "@/lib/showroom";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, ImagePlus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_IMAGES_BUCKET, type ProductRow } from "@/lib/data";
import { streamImage } from "@/lib/stream-image";
import { cn } from "@/lib/utils";

type Photo = {
  cutout?: string;
  editing?: boolean;
  id: string;
  file: File;
  original: string;
  result?: string | undefined;
  final?: boolean;
  error?: string | undefined;
  busy?: boolean;
};

export function ShowroomDialog({ products }: { products: ProductRow[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState("#ebe7df");
  const [fond, setFond] = useState<"uni" | "decor">("uni");
  const [lumiere, setLumiere] = useState(true);
  const [target, setTarget] = useState<Record<string, string>>({});

  const patch = (id: string, p: Partial<Photo>) =>
    setPhotos((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function retouch(photo: Photo) {
    patch(photo.id, {
      busy: true,
      error: undefined,
      result: undefined,
      final: false,
    });
    try {
      const form = new FormData();
      form.append("image", photo.file);
      form.append("mode", "cutout");
      let cutout = "";
      await streamImage("/api/photo", form, (src) => {
        cutout = src;
      });
      const image = await loadImage(cutout);
      patch(photo.id, {
        cutout,
        result: composeShowroom(image, { fond, couleur: note, lumiere }),
        final: true,
        editing: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Échec";
      patch(photo.id, {
        error: msg,
      });
    } finally {
      patch(photo.id, { busy: false });
    }
  }

  async function useAsProductPhoto(photo: Photo) {
    const productId = target[photo.id];
    if (!photo.result || !productId) return;
    const blob = await (await fetch(photo.result)).blob();
    const path = `showroom-${crypto.randomUUID()}.png`;
    const up = await localStore.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, blob, { contentType: "image/png" });
    if (up.error) {
      toast.error("Photo non envoyée : " + up.error.message);
      return;
    }
    const updates: Record<string, string> = { image_url: path };
    if (photo.cutout) {
      const cutpath = "cutout-" + crypto.randomUUID() + ".png";
      const saved = await localStore.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(cutpath, await (await fetch(photo.cutout)).blob());
      if (saved.error) {
        toast.error(saved.error.message);
        return;
      }
      updates["cutout_url"] = cutpath;
    }
    const { error } = await localStore
      .from("products")
      .update(updates)
      .eq("id", productId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Photo de l'article mise à jour");
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles className="h-4 w-4" /> Retouche showroom
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Retouche showroom</DialogTitle>
          <DialogDescription>
            Détourez le produit, corrigez sa lumière et choisissez le fond de la
            photo d'annonce. Le traitement se fait sur cet ordinateur.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label>Fond</Label>
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Fond de la photo">
              {([["uni", "Couleur unie"], ["decor", "Décor clair"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={fond === id}
                  onClick={() => setFond(id)}
                  className={cn("rounded px-2 py-1 text-xs", fond === id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {fond === "uni" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="note">Couleur du fond</Label>
              <Input type="color" id="note" className="w-20" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Mur crème, sol bois clair et ombre au sol, format carré.</p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={lumiere} onCheckedChange={setLumiere} aria-label="Corriger la lumière" /> Corriger la lumière (balance des blancs, exposition)
          </label>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm hover:border-primary">
            <ImagePlus className="h-4 w-4" /> Importer des photos
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setPhotos((s) => [
                  ...s,
                  ...files.map((file) => ({
                    id: crypto.randomUUID(),
                    file,
                    original: URL.createObjectURL(file),
                  })),
                ]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {photos.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucune photo importée.
          </p>
        )}
        <ul className="grid gap-4">
          {photos.map((p) => (
            <li key={p.id} className="rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <figure>
                  <img
                    src={p.original}
                    alt="Photo d'origine"
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <figcaption className="mt-1 text-xs text-muted-foreground">
                    Avant
                  </figcaption>
                </figure>
                <figure>
                  <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
                    {p.result ? (
                      <img
                        src={p.result}
                        alt="Photo retouchée"
                        className={cn(
                          "h-full w-full object-cover transition-[filter] duration-500",
                          p.final ? "blur-0" : "blur-2xl",
                        )}
                      />
                    ) : (
                      <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
                        {p.busy
                          ? "Retouche en cours… cela peut prendre une minute."
                          : (p.error ?? "Pas encore retouchée")}
                      </p>
                    )}
                  </div>
                  <figcaption className="mt-1 text-xs text-muted-foreground">
                    Après
                  </figcaption>
                </figure>
              </div>
              {p.editing && p.cutout && (
                <CutoutEditor
                  source={p.original}
                  cutout={p.cutout}
                  saveLabel="Appliquer les contours"
                  onCancel={() => patch(p.id, { editing: false })}
                  onSave={async (png) => {
                    const cutout = await blobToDataUrl(png);
                    const image = await loadImage(cutout);
                    patch(p.id, { cutout, result: composeShowroom(image, { fond, couleur: note, lumiere }), editing: false });
                  }}
                />
              )}
              {p.error && p.result && (
                <p className="mt-2 text-sm text-destructive">{p.error}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="hero"
                  size="sm"
                  disabled={p.busy}
                  onClick={() => retouch(p)}
                >
                  <Sparkles className="h-4 w-4" />{" "}
                  {p.result ? "Refaire" : "Retoucher"}
                </Button>
                {p.result && p.final && (
                  <>
                    <Button size="sm" variant="outline" asChild>
                      <a href={p.result} download="photo-showroom.png">
                        <Download className="h-4 w-4" /> Télécharger
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => patch(p.id, { editing: true })}
                    >
                      Affiner les contours
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={p.cutout} download="produit-detoure.png">
                        PNG transparent
                      </a>
                    </Button>
                    <Select
                      value={target[p.id] ?? ""}
                      onValueChange={(v) =>
                        setTarget((t) => ({ ...t, [p.id]: v }))
                      }
                    >
                      <SelectTrigger className="h-9 w-56">
                        <SelectValue placeholder="Choisir l'article" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!target[p.id]}
                      onClick={() => useAsProductPhoto(p)}
                    >
                      Utiliser comme photo
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ProductRow } from "@/lib/data";
import { localStore } from "@/lib/local-client";
import { canvasToBlob, loadImage, photoEngine, uploadBlob } from "@/lib/studio-api";
import { newCanvas } from "@/lib/mask-canvas";

/** Un visuel a-t-il déjà un fond transparent (PNG détouré) ? */
async function transparent(file: File) {
  const img = await loadImage(URL.createObjectURL(file));
  const c = newCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i]! < 250) n++;
  return n > d.length / 16 / 50; // plus de 2 % de pixels transparents
}

/** Importer son propre visuel d'un article : PNG transparent utilisé tel quel, sinon
 *  détourage automatique ; rangé dans les photos de l'article (référence conservée). */
export function ImportVisuel({ products, onAjoute }: { products: ProductRow[]; onAjoute: (productId: string, photoId: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function importer() {
    if (!file || !productId) return;
    try {
      setBusy("Lecture du visuel…");
      const png = /png$/i.test(file.type);
      const image_path = await uploadBlob("photo", file, png ? "png" : "jpg");
      let cutout_path: string;
      if (png && (await transparent(file))) {
        cutout_path = image_path;
      } else {
        setBusy("Détourage automatique…");
        const fr = new FileReader();
        const dataUrl: string = await new Promise((res, rej) => { fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
        const blob = await photoEngine({ image: dataUrl, mode: "cutout" });
        const img = await loadImage(URL.createObjectURL(blob));
        const c = newCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext("2d")!.drawImage(img, 0, 0);
        cutout_path = await uploadBlob("cutout", await canvasToBlob(c), "png");
      }
      const { data, error } = await localStore.from("product_photos").insert({ product_id: productId, image_path, cutout_path, label: "Visuel importé" });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["product_photos"] });
      onAjoute(productId, (data as unknown as { id: string }).id);
      toast.success("Visuel ajouté : cliquez sur la photo pour le poser. « Retoucher le détourage » affine les bords.");
      setOpen(false);
      setFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-full"><ImagePlus className="h-4 w-4" /> Importer mon visuel (PNG, JPG)</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importer un visuel d'article</DialogTitle>
          <DialogDescription>Un PNG transparent est utilisé tel quel ; une photo avec fond est détourée automatiquement. Le visuel reste lié à la référence choisie.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="iv-produit">Article du catalogue</Label>
            <select id="iv-produit" value={productId} onChange={(e) => setProductId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Choisir la référence…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 text-sm hover:border-primary">
            {file ? <img src={URL.createObjectURL(file)} alt="" className="h-16 w-16 rounded object-contain" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" />}
            <span>{file ? file.name : "Choisir le fichier (PNG transparent ou photo)"}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="hero" disabled={!file || !productId || !!busy} onClick={() => void importer()}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy}</> : "Ajouter à la pièce"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

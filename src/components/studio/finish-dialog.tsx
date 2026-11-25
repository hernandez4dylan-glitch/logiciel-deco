import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localStore } from "@/lib/local-client";
import type { StudioRows } from "@/lib/records";
import { ASPECTS, SURFACES, isAspect } from "@/lib/scene";
import { photoUrl, uploadBlob } from "@/lib/studio-api";

type Finish = StudioRows["finishes"];
export const KIND_LABEL: Record<Finish["kind"], string> = { peinture: "Peinture", papier: "Papier peint / revêtement", enduit: "Enduit / béton ciré" };
const TOUS = "tous";

/** Création ou modification d'une teinte / matière du magasin, comme un produit :
 *  marque (fournisseur), gamme, référence, couleur ou motif, finition, usage conseillé. */
export function FinishDialog({
  finish,
  defaultKind = "peinture",
  defaultUsage = null,
  initialColor,
  marques = [],
  trigger,
  onSaved,
}: {
  finish?: Finish;
  defaultKind?: Finish["kind"];
  defaultUsage?: Finish["usage"];
  /** Couleur proposée pour une nouvelle teinte (pipette). */
  initialColor?: string;
  /** Marques déjà saisies, proposées à la frappe. */
  marques?: string[];
  trigger: ReactNode;
  onSaved?: (f: Finish) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: defaultKind as Finish["kind"], name: "", reference: "", color: "#D8C7AE", finition: "mat", motif: "", marque: "", gamme: "", usage: TOUS });
  const [file, setFile] = useState<File | null>(null);
  const [texture, setTexture] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let texture_path = texture;
      if (file) texture_path = await uploadBlob("motif", file, /png$/i.test(file.type) ? "png" : "jpg");
      if (f.kind === "papier" && !texture_path) throw new Error("Importez le motif du papier peint ou du revêtement");
      const values = {
        name: f.name.trim(),
        reference: f.reference.trim() || null,
        color: f.kind === "papier" ? null : f.color.toUpperCase(),
        texture_path,
        motif_cm: f.motif ? Number(f.motif.replace(",", ".")) : null,
        finition: f.finition.trim() || null,
        marque: f.marque.trim() || null,
        gamme: f.gamme.trim() || null,
        usage: f.usage === TOUS ? null : f.usage,
      };
      const res = finish
        ? await localStore.from("finishes").update(values).eq("id", finish.id)
        : await localStore.from("finishes").insert({ kind: f.kind, ...values });
      if (res.error) throw new Error(res.error.message);
      return res.data as unknown as Finish;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["finishes"] });
      toast.success(finish ? "Finition modifiée" : "Finition enregistrée dans la bibliothèque");
      setOpen(false);
      onSaved?.(row);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const peinture = f.kind === "peinture";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          const kind = finish?.kind ?? defaultKind;
          setF({
            kind,
            name: finish?.name ?? "",
            reference: finish?.reference ?? "",
            color: finish?.color ?? initialColor ?? "#D8C7AE",
            finition: finish?.finition ?? (kind === "papier" ? "" : "mat"),
            motif: finish?.motif_cm ? String(finish.motif_cm) : "",
            marque: finish?.marque ?? "",
            gamme: finish?.gamme ?? "",
            usage: finish?.usage ?? defaultUsage ?? TOUS,
          });
          setTexture(finish?.texture_path ?? null);
          setFile(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{finish ? "Modifier la finition" : "Nouvelle teinte ou matière"}</DialogTitle>
          <DialogDescription>Marque, nom et référence figurent sur la fiche remise au client.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select
                value={f.kind}
                disabled={!!finish}
                onValueChange={(kind) =>
                  setF((s) => ({ ...s, kind: kind as Finish["kind"], finition: kind === "papier" ? "" : isAspect(s.finition) ? s.finition : "mat" }))
                }
              >
                <SelectTrigger aria-label="Type de finition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as Finish["kind"][]).map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Pour</Label>
              <Select value={f.usage} onValueChange={(usage) => setF((s) => ({ ...s, usage }))}>
                <SelectTrigger aria-label="Usage conseillé"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TOUS}>Toutes surfaces</SelectItem>
                  {SURFACES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="fin-marque">Marque / fournisseur</Label>
              <Input id="fin-marque" list="fin-marques" value={f.marque} placeholder="Ex. nom du fabricant" onChange={(e) => setF((s) => ({ ...s, marque: e.target.value }))} />
              <datalist id="fin-marques">
                {marques.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fin-gamme">Gamme / collection</Label>
              <Input id="fin-gamme" value={f.gamme} placeholder="Ex. Intérieur" onChange={(e) => setF((s) => ({ ...s, gamme: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="grid gap-1.5">
              <Label htmlFor="fin-name">Nom</Label>
              <Input id="fin-name" required value={f.name} placeholder="Ex. Beige lin" onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fin-ref">Référence</Label>
              <Input id="fin-ref" value={f.reference} placeholder="Ex. 204" onChange={(e) => setF((s) => ({ ...s, reference: e.target.value }))} />
            </div>
          </div>
          {f.kind !== "papier" && (
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <input type="color" aria-label="Couleur" className="h-9 w-14 cursor-pointer rounded border" value={f.color} onChange={(e) => setF((s) => ({ ...s, color: e.target.value }))} />
              <div className="grid gap-1.5">
                <Label htmlFor="fin-hex">Code couleur</Label>
                <Input id="fin-hex" value={f.color} pattern="#[0-9a-fA-F]{6}" onChange={(e) => setF((s) => ({ ...s, color: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Finition</Label>
                {peinture ? (
                  <Select value={isAspect(f.finition) ? f.finition : "mat"} onValueChange={(finition) => setF((s) => ({ ...s, finition }))}>
                    <SelectTrigger aria-label="Finition de la peinture"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASPECTS.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={f.finition} aria-label="Finition" placeholder="Ex. mat, ciré" onChange={(e) => setF((s) => ({ ...s, finition: e.target.value }))} />
                )}
              </div>
            </div>
          )}
          {!peinture && (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px] sm:items-end">
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-2 text-sm hover:border-primary">
                {file || texture ? (
                  <img src={file ? URL.createObjectURL(file) : photoUrl(texture!)} alt="Motif" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                )}
                <span>{f.kind === "papier" ? "Motif (une répétition) : papier peint, parquet, carrelage" : "Photo de l'échantillon (facultatif)"}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor="fin-motif">Largeur du motif (cm)</Label>
                <Input id="fin-motif" inputMode="decimal" value={f.motif} placeholder="Ex. 53" onChange={(e) => setF((s) => ({ ...s, motif: e.target.value }))} />
              </div>
            </div>
          )}
          {f.kind === "papier" && (
            <div className="grid gap-1.5">
              <Label htmlFor="fin-fin-pap">Finition (texte libre)</Label>
              <Input id="fin-fin-pap" value={f.finition} placeholder="Ex. intissé, vinyle, huilé" onChange={(e) => setF((s) => ({ ...s, finition: e.target.value }))} />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" variant="hero" disabled={save.isPending}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

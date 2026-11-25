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
import { photoUrl, uploadBlob } from "@/lib/studio-api";

type Finish = StudioRows["finishes"];
export const KIND_LABEL: Record<Finish["kind"], string> = { peinture: "Peinture", papier: "Papier peint", enduit: "Enduit / béton ciré" };

/** Création ou modification d'une teinte / matière du magasin. */
export function FinishDialog({
  finish,
  defaultKind = "peinture",
  initialColor,
  trigger,
  onSaved,
}: {
  finish?: Finish;
  defaultKind?: Finish["kind"];
  /** Couleur proposée pour une nouvelle teinte (pipette). */
  initialColor?: string;
  trigger: ReactNode;
  onSaved?: (f: Finish) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: defaultKind as Finish["kind"], name: "", reference: "", color: "#D8C7AE", finition: "mat", motif: "" });
  const [file, setFile] = useState<File | null>(null);
  const [texture, setTexture] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      let texture_path = texture;
      if (file) texture_path = await uploadBlob("motif", file, /png$/i.test(file.type) ? "png" : "jpg");
      if (f.kind === "papier" && !texture_path) throw new Error("Importez le motif du papier peint");
      const values = {
        name: f.name.trim(),
        reference: f.reference.trim() || null,
        color: f.kind === "papier" ? null : f.color.toUpperCase(),
        texture_path,
        motif_cm: f.motif ? Number(f.motif.replace(",", ".")) : null,
        finition: f.finition || null,
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

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setF({
            kind: finish?.kind ?? defaultKind,
            name: finish?.name ?? "",
            reference: finish?.reference ?? "",
            color: finish?.color ?? initialColor ?? "#D8C7AE",
            finition: finish?.finition ?? "mat",
            motif: finish?.motif_cm ? String(finish.motif_cm) : "",
          });
          setTexture(finish?.texture_path ?? null);
          setFile(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{finish ? "Modifier la finition" : "Nouvelle teinte ou matière"}</DialogTitle>
          <DialogDescription>Le nom et la référence magasin figurent sur la fiche remise au client.</DialogDescription>
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
              <Select value={f.kind} disabled={!!finish} onValueChange={(kind) => setF((s) => ({ ...s, kind: kind as Finish["kind"] }))}>
                <SelectTrigger aria-label="Type de finition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as Finish["kind"][]).map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fin-ref">Référence magasin</Label>
              <Input id="fin-ref" value={f.reference} placeholder="Ex. PEI-204-MAT" onChange={(e) => setF((s) => ({ ...s, reference: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fin-name">Nom</Label>
            <Input id="fin-name" required value={f.name} placeholder="Ex. Beige lin mat" onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} />
          </div>
          {f.kind !== "papier" && (
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
              <input type="color" aria-label="Couleur" className="h-9 w-14 cursor-pointer rounded border" value={f.color} onChange={(e) => setF((s) => ({ ...s, color: e.target.value }))} />
              <div className="grid gap-1.5">
                <Label htmlFor="fin-hex">Code couleur</Label>
                <Input id="fin-hex" value={f.color} pattern="#[0-9a-fA-F]{6}" onChange={(e) => setF((s) => ({ ...s, color: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fin-fin">Aspect</Label>
                <Input id="fin-fin" value={f.finition} placeholder="mat, velours, satin" onChange={(e) => setF((s) => ({ ...s, finition: e.target.value }))} />
              </div>
            </div>
          )}
          {f.kind !== "peinture" && (
            <div className="grid gap-3 sm:grid-cols-[1fr_140px] sm:items-end">
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-2 text-sm hover:border-primary">
                {file || texture ? (
                  <img src={file ? URL.createObjectURL(file) : photoUrl(texture!)} alt="Motif" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                )}
                <span>{f.kind === "papier" ? "Motif du papier peint (une répétition)" : "Photo de l'échantillon (facultatif)"}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor="fin-motif">Largeur du motif (cm)</Label>
                <Input id="fin-motif" inputMode="decimal" value={f.motif} placeholder="Ex. 53" onChange={(e) => setF((s) => ({ ...s, motif: e.target.value }))} />
              </div>
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

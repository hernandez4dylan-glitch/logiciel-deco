import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { downloadCsv } from "@/lib/csv";
import { localStore } from "@/lib/local-client";
import { MODELE_NUANCIER, planifierImport, type PlanImport } from "@/lib/nuancier";
import type { StudioRows } from "@/lib/records";
import { aspectLabel, isAspect, surfaceLabel } from "@/lib/scene";

type Finish = StudioRows["finishes"];

/** Import d'un nuancier fournisseur (CSV Excel) : aperçu, puis ajout des nouvelles
 *  teintes et mise à jour de celles déjà connues (même marque + référence). */
export function FinishImport({ finishes }: { finishes: Finish[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanImport | null>(null);
  const [fichier, setFichier] = useState("");

  const lire = async (file: File) => {
    setFichier(file.name);
    setPlan(planifierImport(await file.text(), finishes));
  };

  const go = useMutation({
    mutationFn: async (p: PlanImport) => {
      let faits = 0;
      for (const l of p.ajouts) {
        const res = await localStore.from("finishes").insert({ ...l, texture_path: null });
        if (res.error) throw new Error(`« ${l.name} » : ${res.error.message} (${faits} teintes déjà importées)`);
        faits++;
      }
      for (const { id, ligne } of p.majs) {
        const { kind: _kind, ...values } = ligne;
        const res = await localStore.from("finishes").update(values).eq("id", id);
        if (res.error) throw new Error(`« ${ligne.name} » : ${res.error.message} (${faits} teintes déjà importées)`);
        faits++;
      }
      return faits;
    },
    onSuccess: (n) => {
      toast.success(`${n} teinte${n > 1 ? "s" : ""} importée${n > 1 ? "s" : ""} dans la bibliothèque`);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["finishes"] }),
  });

  const apercu = plan ? [...plan.ajouts.map((l) => ({ l, maj: false })), ...plan.majs.map((m) => ({ l: m.ligne, maj: true }))] : [];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setPlan(null);
          setFichier("");
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title="Importer un nuancier fournisseur depuis Excel (CSV)">
          <FileSpreadsheet className="h-4 w-4" /> Importer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer un nuancier</DialogTitle>
          <DialogDescription>
            Remplissez le modèle dans Excel (une ligne par teinte : marque, gamme, nom, référence, couleur, finition, usage), enregistrez-le
            au format CSV, puis choisissez-le ici. Une teinte déjà connue (même marque et même référence) est mise à jour, pas dupliquée.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadCsv("modele-nuancier", MODELE_NUANCIER)}>
            <Download className="h-4 w-4" /> Télécharger le modèle
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm hover:border-primary">
            <FileSpreadsheet className="h-4 w-4" /> {fichier || "Choisir le fichier CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void lire(e.target.files[0])} />
          </label>
        </div>
        {plan && (
          <div className="grid gap-2 text-sm">
            <p>
              <strong>{plan.ajouts.length}</strong> nouvelle{plan.ajouts.length > 1 ? "s" : ""}, <strong>{plan.majs.length}</strong> mise
              {plan.majs.length > 1 ? "s" : ""} à jour, <strong>{plan.erreurs.length}</strong> ligne{plan.erreurs.length > 1 ? "s" : ""} refusée
              {plan.erreurs.length > 1 ? "s" : ""}.
            </p>
            {plan.erreurs.length > 0 && (
              <ul className="max-h-28 overflow-auto rounded border border-destructive/40 bg-destructive/5 p-2 text-xs">
                {plan.erreurs.map((e, i) => (
                  <li key={i}>Ligne {e.ligne} : {e.message}</li>
                ))}
              </ul>
            )}
            {apercu.length > 0 && (
              <ul className="grid max-h-64 gap-1 overflow-auto pr-1">
                {apercu.slice(0, 200).map(({ l, maj }, i) => (
                  <li key={i} className="flex items-center gap-2 rounded border p-1.5 text-xs">
                    <span className="h-5 w-5 shrink-0 rounded-full border" style={{ backgroundColor: l.color ?? "#ddd" }} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{[l.marque, l.name].filter(Boolean).join(" – ")}</span>
                      {" · "}
                      {[l.reference, l.color, isAspect(l.finition) ? aspectLabel(l.finition) : l.finition, l.usage ? surfaceLabel(l.usage) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className={maj ? "text-amber-700" : "text-emerald-700"}>{maj ? "mise à jour" : "nouvelle"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="hero" disabled={!plan || apercu.length === 0 || go.isPending} onClick={() => plan && go.mutate(plan)}>
            Importer {apercu.length || ""} teinte{apercu.length > 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

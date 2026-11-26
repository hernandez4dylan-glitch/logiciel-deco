import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canvasToDataUrl, photoJson } from "@/lib/studio-api";

type Calques = { montage: HTMLCanvasElement; articles: HTMLCanvasElement; ombres: HTMLCanvasElement };
type Reponse = { image: string; zones: string; temps: { total: number; vignettes: number }; consigne: string };

/** Optimisation finale : retouche locale par l'IA générative avec la consigne enregistrée,
 *  puis avant / après et choix du rendu à garder. Aucun texte à saisir. */
export function OptimisationDialog({
  open,
  onOpenChange,
  calques,
  onKeep,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  calques: () => Promise<Calques>;
  onKeep: (dataUrl: string, duree: number) => Promise<void>;
}) {
  const [etat, setEtat] = useState<"attente" | "calcul" | "fini" | "erreur">("attente");
  const [avant, setAvant] = useState<string | null>(null);
  const [res, setRes] = useState<Reponse | null>(null);
  const [ecoule, setEcoule] = useState(0);
  const [rideau, setRideau] = useState(50);
  const [voirZones, setVoirZones] = useState(false);
  const [message, setMessage] = useState("");
  const debut = useRef(0);

  useEffect(() => {
    if (!open) return;
    let vivant = true;
    setEtat("calcul");
    setRes(null);
    setAvant(null);
    setEcoule(0);
    debut.current = performance.now();
    const t = window.setInterval(() => setEcoule((performance.now() - debut.current) / 1000), 250);
    (async () => {
      try {
        const c = await calques();
        const montage = await canvasToDataUrl(c.montage);
        if (!vivant) return;
        setAvant(montage);
        const r = await photoJson<Reponse>({
          mode: "optimiser",
          image: montage,
          articles: await canvasToDataUrl(c.articles),
          ombres: await canvasToDataUrl(c.ombres),
        });
        if (!vivant) return;
        setRes(r);
        setEtat("fini");
      } catch (e) {
        if (!vivant) return;
        setMessage(e instanceof Error ? e.message : "Optimisation impossible");
        setEtat("erreur");
      } finally {
        window.clearInterval(t);
        if (vivant) setEcoule((performance.now() - debut.current) / 1000);
      }
    })();
    return () => {
      vivant = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const s = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
  return (
    <Dialog open={open} onOpenChange={(o) => etat !== "calcul" && onOpenChange(o)}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Optimisation finale</DialogTitle>
          <DialogDescription>
            Retouche par l'IA locale, limitée aux contours et aux ombres des articles ajoutés ; le reste du montage, le cadrage, les
            finitions et les articles sont conservés.
          </DialogDescription>
        </DialogHeader>
        {etat === "calcul" && (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Optimisation en cours… {s(ecoule)}
            </p>
            <p className="text-xs text-muted-foreground">Environ 30 à 60 secondes par groupe d'articles sur ce PC (sans carte graphique).</p>
            {avant && <img src={avant} alt="Montage" className="max-h-[60vh] w-full rounded object-contain opacity-70" />}
          </div>
        )}
        {etat === "erreur" && <p className="text-sm text-destructive">{message}</p>}
        {etat === "fini" && res && avant && (
          <div className="grid gap-2">
            <div className="relative select-none overflow-hidden rounded border">
              <img src={res.image} alt="Rendu optimisé" className="block w-full" />
              <img
                src={avant}
                alt="Montage"
                className="absolute inset-0 block h-full w-full"
                style={{ clipPath: `inset(0 ${100 - rideau}% 0 0)` }}
              />
              {voirZones && <img src={res.zones} alt="Zones retouchées" className="absolute inset-0 h-full w-full opacity-60 mix-blend-screen" />}
              <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Montage</span>
              <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Optimisé</span>
              <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${rideau}%` }} />
            </div>
            <input type="range" min={0} max={100} value={rideau} onChange={(e) => setRideau(Number(e.target.value))} aria-label="Rideau avant / après" />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Durée de l'optimisation : {s(ecoule)} (calcul {s(res.temps.total)}, {res.temps.vignettes} zone{res.temps.vignettes > 1 ? "s" : ""})</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={voirZones} onChange={(e) => setVoirZones(e.target.checked)} /> Montrer les zones retouchées
              </label>
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Consigne enregistrée</summary>
              <p className="mt-1">{res.consigne}</p>
            </details>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={etat === "calcul"} onClick={() => onOpenChange(false)}>
            Revenir au montage
          </Button>
          <Button
            variant="hero"
            disabled={etat !== "fini"}
            onClick={async () => {
              if (!res) return;
              try {
                await onKeep(res.image, Math.round(ecoule * 10) / 10);
                onOpenChange(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
              }
            }}
          >
            Garder le rendu optimisé
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

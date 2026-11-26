import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { finishPayload } from "@/lib/compose";
import { newCanvas } from "@/lib/mask-canvas";
import { lignesReferences, proposer, type Proposition } from "@/lib/propositions";
import type { StudioRows } from "@/lib/records";
import type { AnalyseInfo, Zone } from "@/lib/scene";
import { canvasToDataUrl, loadImage, photoEngine, photoUrl } from "@/lib/studio-api";

type Finish = StudioRows["finishes"];
const APERCU = 900; // grand côté des aperçus (rapide, assez net pour choisir)

const sec = (n: number | undefined) => (n === undefined ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`);

/** Aperçus de la pièce du client avec les finitions du catalogue, proposés dès l'import.
 *  Le premier clic choisit un rendu ; les masques de l'analyse sont réutilisés tels quels. */
export function Propositions({
  zones,
  finishes,
  basePath,
  W,
  H,
  mask,
  zonesPour,
  analyse,
  analysing,
  onChoose,
  onFirstPreview,
  onReanalyse,
  version,
}: {
  zones: Zone[];
  finishes: Finish[];
  basePath: string;
  W: number;
  H: number;
  mask: (id: string) => HTMLCanvasElement | undefined;
  /** Surfaces de la pièce avec les finitions de la proposition (perspective comprise). */
  zonesPour: (p: Proposition) => Zone[];
  analyse: AnalyseInfo | null;
  analysing: boolean;
  onChoose: (p: Proposition) => void;
  onFirstPreview: () => void;
  onReanalyse: () => void;
  /** Change quand les sélections changent (les aperçus sont alors refaits). */
  version: number;
}) {
  const [ouvert, setOuvert] = useState(true);
  const [apercus, setApercus] = useState<Record<string, string>>({});
  const [choisi, setChoisi] = useState<string | null>(null);
  const premier = useRef(false);
  const props = useMemo(() => proposer(zones, finishes), [zones, finishes]);
  const cle = JSON.stringify([basePath, version, props.map((p) => p.affectations.map((a) => [a.zoneId, a.finish.id, a.finish.updated_at]))]);

  useEffect(() => {
    if (!props.length || analysing || !ouvert) return;
    let vivant = true;
    (async () => {
      const s = Math.min(1, APERCU / Math.max(W, H));
      const w = Math.round(W * s), h = Math.round(H * s);
      const base = newCanvas(w, h);
      base.getContext("2d")!.drawImage(await loadImage(photoUrl(basePath)), 0, 0, w, h);
      const image = await canvasToDataUrl(base, "image/jpeg", 0.92);
      const petits = new Map<string, HTMLCanvasElement>();
      for (const z of zones) {
        const m = mask(z.id);
        if (!m) continue;
        const c = newCanvas(w, h);
        c.getContext("2d")!.drawImage(m, 0, 0, w, h);
        petits.set(z.id, c);
      }
      for (const p of props) {
        if (!vivant) return;
        try {
          const payload = await finishPayload(zonesPour(p), (z) => petits.get(z.id) ?? null, w, h);
          const blob = await photoEngine({ image, mode: "finish", zones: payload });
          if (!vivant) return;
          const url = URL.createObjectURL(blob);
          setApercus((a) => ({ ...a, [p.id]: url }));
          if (!premier.current) {
            premier.current = true;
            onFirstPreview();
          }
        } catch {
          /* un aperçu raté n'empêche pas les autres */
        }
      }
    })();
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, analysing, ouvert]);

  if (!analysing && !props.length && !analyse) return null;
  return (
    <section className="mb-3 rounded-lg border bg-card p-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Propositions pour cette pièce</h3>
        {analysing ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reconnaissance des murs, du plafond, du sol et des meubles…
          </span>
        ) : (
          analyse && (
            <span className="text-xs text-muted-foreground" title="Mesuré sur ce PC">
              Analyse {sec(analyse.temps["total"])} · premier aperçu {analyse.apercu === null ? "…" : sec(analyse.apercu)}
            </span>
          )
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={analysing} onClick={onReanalyse} title="Relancer la reconnaissance de la pièce">
            <RefreshCw className="h-3.5 w-3.5" /> Réanalyser
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={ouvert ? "Replier les propositions" : "Afficher les propositions"} onClick={() => setOuvert((o) => !o)}>
            {ouvert ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {ouvert && !analysing && !props.length && (
        <p className="mt-1 text-xs text-muted-foreground">
          Aucun mur reconnu ou aucune peinture dans la bibliothèque : ajoutez des teintes, ou sélectionnez les surfaces à la baguette (onglet Murs).
        </p>
      )}
      {ouvert && props.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {props.map((p) => (
            <li key={p.id} className="min-w-0">
              <button
                type="button"
                onClick={() => {
                  setChoisi(p.id);
                  onChoose(p);
                }}
                className={cn("group grid w-full min-w-0 gap-1 overflow-hidden rounded-md border p-1 text-left hover:border-primary", choisi === p.id && "border-primary ring-1 ring-primary")}
              >
                <span className="relative block overflow-hidden rounded bg-muted" style={{ aspectRatio: `${W} / ${H}` }}>
                  {apercus[p.id] ? (
                    <img src={apercus[p.id]} alt={p.titre} className="h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Aperçu…
                    </span>
                  )}
                  {choisi === p.id && (
                    <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span>
                  )}
                </span>
                <span className="text-xs font-medium">{p.titre}</span>
                {lignesReferences(p, zones).map((l, i) => (
                  <span key={i} className="flex items-center gap-1 text-[11px] leading-tight text-muted-foreground">
                    {l.texture ? (
                      <img src={photoUrl(l.texture)} alt="" className="h-3 w-3 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: l.color ?? "#ddd" }} />
                    )}
                    <span className="truncate">
                      {l.zones} : {l.nom}
                      {l.reference ? ` · réf. ${l.reference}` : ""}
                    </span>
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import { ArrowLeft, Brush, Eraser, Grid2x2, Pipette, Plus, RefreshCw, RotateCw, Search, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/studio-api";
import { ASPECTS, SURFACES, aspectLabel, isAspect, surfaceLabel, zoneAspect, type Surface, type Zone } from "@/lib/scene";
import { FinishDialog } from "@/components/studio/finish-dialog";
import { FinishImport } from "@/components/studio/finish-import";
import type { WorkspaceApi } from "@/components/studio/workspace";
import type { StudioRows } from "@/lib/records";

type Finish = StudioRows["finishes"];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Finitions du catalogue compatibles avec une surface. */
export function compatibles(surface: Surface, finishes: Finish[]) {
  const pour = (f: Finish) => !f.usage || f.usage === surface || (surface === "mur" && f.usage === "autre");
  return finishes.filter((f) => {
    if (surface === "sol") return (f.kind === "papier" && f.usage === "sol") || (f.kind === "enduit" && (!f.usage || f.usage === "sol"));
    if (f.kind === "papier" && f.usage === "sol") return false;
    if (surface === "mur") return pour(f);
    if (surface === "plafond") return (f.kind === "peinture" || f.kind === "enduit") && pour(f);
    return f.kind === "peinture" && pour(f); // portes, cadres, plinthes, fenêtres, autres
  });
}

export function Vignette({ f, actif, onClick }: { f: Finish; actif: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={[f.marque, f.name, f.reference ? `réf. ${f.reference}` : null].filter(Boolean).join(" · ")}
      className={cn("group grid gap-1 rounded-md border p-1 text-left transition hover:border-primary hover:shadow", actif && "border-primary ring-2 ring-primary")}
    >
      {f.texture_path ? (
        <img src={photoUrl(f.texture_path)} alt="" className="aspect-square w-full rounded object-cover" />
      ) : (
        <span className="block aspect-square w-full rounded border" style={{ backgroundColor: f.color ?? "#ddd" }} />
      )}
      <span className="truncate text-[11px] font-medium leading-tight">{f.name}</span>
      <span className="truncate text-[10px] leading-tight text-muted-foreground">{[f.marque, f.reference].filter(Boolean).join(" · ") || " "}</span>
    </button>
  );
}

/** Liste des surfaces reconnues : survoler les montre sur la photo, cliquer les ouvre. */
export function ListeSurfaces({ api }: { api: WorkspaceApi }) {
  const ordre: Surface[] = ["mur", "plafond", "sol", "porte", "cadre", "plinthe", "fenetre", "autre"];
  const zones = [...api.scene.zones].sort((a, b) => ordre.indexOf(a.surface) - ordre.indexOf(b.surface));
  return (
    <div className="grid gap-3 text-sm">
      <div>
        <h3 className="font-medium">Surfaces de la pièce</h3>
        <p className="text-xs text-muted-foreground">
          Survolez la photo pour voir chaque surface, cliquez pour l'habiller. Glissez un objet depuis l'onglet « Objets ».
        </p>
      </div>
      {api.analysing && <p className="text-xs text-muted-foreground">Reconnaissance des murs, du sol, du plafond, des portes et fenêtres…</p>}
      <ul className="grid gap-1">
        {zones.map((z) => (
          <li key={z.id}>
            <button
              type="button"
              onMouseEnter={() => api.setSurvol(z.id)}
              onMouseLeave={() => api.setSurvol(null)}
              onClick={() => api.choisirSurface(z.id)}
              className="flex w-full items-center gap-2 rounded-md border p-1.5 text-left hover:border-primary"
            >
              {z.finish?.texture ? (
                <img src={photoUrl(z.finish.texture)} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
              ) : (
                <span className="h-7 w-7 shrink-0 rounded border" style={{ backgroundColor: z.finish?.color ?? "transparent" }} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{z.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {surfaceLabel(z.surface)} · {z.finish ? z.finish.name : z.surface === "fenetre" ? "conservée" : "d'origine"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="grid gap-1">
        <Button size="sm" variant="outline" onClick={() => api.nouvelleSurface()}>
          <Wand2 className="h-4 w-4" /> Ajouter une surface : cliquer dessus
        </Button>
        <Button size="sm" variant="ghost" disabled={api.analysing} onClick={api.reanalyse}>
          <RefreshCw className="h-4 w-4" /> Relancer la reconnaissance
        </Button>
      </div>
    </div>
  );
}

/** Panneau d'une surface : finitions compatibles en vignettes (un clic = essai), réglages
 *  du produit posé, surface réelle pour les quantités, correction du contour. */
export function PanneauSurface({ api, z }: { api: WorkspaceApi; z: Zone }) {
  const [recherche, setRecherche] = useState("");
  const [onglet, setOnglet] = useState<"peinture" | "matiere">(z.surface === "sol" ? "matiere" : "peinture");
  const liste = useMemo(() => compatibles(z.surface, api.finishes), [z.surface, api.finishes]);
  const peintures = liste.filter((f) => f.kind === "peinture");
  const matieres = liste.filter((f) => f.kind !== "peinture");
  const q = norm(recherche.trim());
  const visibles = (onglet === "peinture" ? peintures : matieres).filter(
    (f) => !q || norm([f.name, f.reference, f.marque, f.gamme, f.color].filter(Boolean).join(" ")).includes(q),
  );
  const marques = [...new Set(api.finishes.map((f) => f.marque?.trim()).filter((m): m is string => !!m))];
  const corrige = api.tool === "mur-plus" || api.tool === "mur-moins";
  const aspect = zoneAspect(z);
  const motif = z.finish && z.finish.kind !== "peinture";

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Toutes les surfaces" onClick={() => api.choisirSurface(null)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <Input value={z.name} aria-label="Nom de la surface" onChange={(e) => api.updateZone(z.id, { name: e.target.value })} className="h-8 font-medium" />
        </div>
        <select
          value={z.surface}
          aria-label="Type de surface"
          onChange={(e) => api.updateZone(z.id, { surface: e.target.value as Surface })}
          className="h-8 rounded-md border bg-background px-1 text-xs"
        >
          {SURFACES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {z.surface === "fenetre" && !z.finish && (
        <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
          Fenêtre reconnue : elle reste telle quelle quand vous peignez les murs. Choisissez une peinture seulement pour repeindre la menuiserie.
        </p>
      )}

      <section className="grid gap-2">
        <div className="flex rounded-md border p-0.5 text-xs" role="tablist">
          {(["peinture", "matiere"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={onglet === k}
              onClick={() => setOnglet(k)}
              className={cn("flex-1 rounded px-2 py-1", onglet === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {k === "peinture" ? `Peintures (${peintures.length})` : z.surface === "sol" ? `Sols (${matieres.length})` : `Matières (${matieres.length})`}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
          <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Nom, référence, marque" className="h-8 pl-7" aria-label="Rechercher une finition" />
        </div>
        {visibles.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune finition compatible dans le catalogue. Ajoutez-en une ci-dessous.</p>
        ) : (
          <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-auto pr-1">
            {visibles.map((f) => (
              <Vignette key={f.id} f={f} actif={z.finish?.id === f.id} onClick={() => api.applyFinishTo(f, [z.id])} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={api.tool === "pipette" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => api.setTool(api.tool === "pipette" ? "deplacer" : "pipette")}>
            <Pipette className="h-3.5 w-3.5" /> Couleur de la photo
          </Button>
          <FinishDialog
            defaultKind={onglet === "peinture" ? "peinture" : z.surface === "sol" ? "papier" : "enduit"}
            defaultUsage={z.surface === "sol" ? "sol" : null}
            marques={marques}
            onSaved={(f) => api.applyFinishTo(f, [z.id])}
            trigger={<Button size="sm" variant="outline" className="h-7 px-2 text-xs"><Plus className="h-3.5 w-3.5" /> Nouvelle finition</Button>}
          />
          <FinishImport finishes={api.finishes} />
        </div>
      </section>

      {z.finish && (
        <section className="grid gap-2 rounded-lg border p-2">
          <p className="text-xs font-medium">
            {[z.finish.marque, z.finish.name].filter(Boolean).join(" – ")}
            {z.finish.reference ? <span className="text-muted-foreground"> · réf. {z.finish.reference}</span> : null}
          </p>
          {z.finish.kind === "peinture" && (
            <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Finition">
              {ASPECTS.map((a) => (
                <Button key={a.id} size="sm" role="radio" aria-checked={aspect === a.id} variant={aspect === a.id ? "default" : "outline"} className="h-7 px-1 text-xs" onClick={() => api.updateZone(z.id, { aspect: a.id })}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
          {motif && (
            <>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Échelle : {z.repetitions.toFixed(1)} motifs sur la largeur
                <Slider min={0.5} max={30} step={0.5} value={[z.repetitions]} onValueChange={([v]) => api.updateZone(z.id, { repetitions: v ?? 4 })} aria-label="Échelle du motif" />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                <span className="flex items-center justify-between">
                  Sens {z.surface === "sol" ? "des lames" : "du motif"} : {Math.round(z.rotation)}°
                  <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => api.updateZone(z.id, { rotation: (z.rotation + 90) % 360 })}>
                    <RotateCw className="h-3.5 w-3.5" /> 90°
                  </Button>
                </span>
                <Slider min={-90} max={90} step={1} value={[((z.rotation + 90) % 180) - 90]} onValueChange={([v]) => api.updateZone(z.id, { rotation: v ?? 0 })} aria-label="Rotation du motif" />
              </label>
              <Button size="sm" variant={api.tool === "coins" ? "default" : "outline"} className="h-7 text-xs" onClick={() => api.setTool(api.tool === "coins" ? "deplacer" : "coins")}>
                <Grid2x2 className="h-3.5 w-3.5" /> {api.tool === "coins" ? "Terminer la perspective" : "Ajuster la perspective (4 coins)"}
              </Button>
            </>
          )}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Lumière de la pièce : {Math.round(z.lumiere * 100)} %
            <Slider min={0.5} max={1.5} step={0.05} value={[z.lumiere]} onValueChange={([v]) => api.updateZone(z.id, { lumiere: v ?? 1 })} aria-label="Lumière" />
          </label>
          {z.finish.kind === "peinture" && z.finish.color && !z.finish.id && (
            <FinishDialog initialColor={z.finish.color} defaultUsage={z.surface} marques={marques} onSaved={(f) => api.applyFinishTo(f, [z.id])}
              trigger={<Button size="sm" variant="outline" className="h-7 text-xs"><Plus className="h-3.5 w-3.5" /> Enregistrer cette couleur</Button>} />
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => api.updateZone(z.id, { finish: null })}>
            <Trash2 className="h-3.5 w-3.5" /> Revenir à l'aspect d'origine
          </Button>
        </section>
      )}

      <section className="grid gap-1">
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Surface réelle (pour la liste d'achat)</span>
          <span className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              step={0.1}
              inputMode="decimal"
              className="h-7 w-20 text-right"
              aria-label="Surface en m²"
              value={z.m2 ?? ""}
              placeholder="m²"
              onChange={(e) => {
                const v = Number(e.target.value.replace(",", "."));
                api.updateZone(z.id, { m2: e.target.value === "" || !(v > 0) ? null : Math.round(v * 100) / 100 });
              }}
            />
            m²
          </span>
        </label>
      </section>

      <section className="grid gap-2 rounded-lg border border-dashed p-2">
        <p className="text-xs font-medium">Contour {z.auto ? "trouvé automatiquement" : ""}</p>
        <p className="text-xs text-muted-foreground">
          S'il déborde (canapé, tableau, prise) ou s'il manque un morceau, corrigez au pinceau ; zoomez à la molette. La correction est gardée pour tous les essais.
        </p>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant={api.tool === "mur-plus" ? "default" : "outline"} onClick={() => api.setTool(api.tool === "mur-plus" ? "deplacer" : "mur-plus")}>
            <Brush className="h-4 w-4" /> Ajouter
          </Button>
          <Button size="sm" variant={api.tool === "mur-moins" ? "default" : "outline"} onClick={() => api.setTool(api.tool === "mur-moins" ? "deplacer" : "mur-moins")}>
            <Eraser className="h-4 w-4" /> Retirer
          </Button>
        </div>
        {corrige && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Taille du pinceau
            <Slider min={3} max={80} value={[api.brush]} onValueChange={([v]) => api.setBrush(v ?? 20)} aria-label="Taille du pinceau" />
          </label>
        )}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!api.busy} onClick={() => void api.refineZone()}>
            <Sparkles className="h-3.5 w-3.5" /> Coller aux bords
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={api.undoMask}>
            <Undo2 className="h-3.5 w-3.5" /> Annuler le trait
          </Button>
          {corrige && (
            <Button size="sm" variant="hero" className="h-7 text-xs" onClick={() => api.setTool("deplacer")}>Terminé</Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">Type : {surfaceLabel(z.surface)}{isAspect(z.finish?.finition) ? ` · fiche ${aspectLabel(z.finish!.finition as never).toLowerCase()}` : ""}</p>
      </section>
    </div>
  );
}

import { useState } from "react";
import { Eye, EyeOff, Grid2x2, Pencil, Pipette, Plus, ScanLine, ShieldMinus, Sparkles, Trash2, Undo2, Wand2, Paintbrush } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/studio-api";
import { FinishDialog, KIND_LABEL } from "@/components/studio/finish-dialog";
import type { WorkspaceApi } from "@/components/studio/workspace";
import type { StageTool } from "@/components/studio/stage";

const KINDS = ["peinture", "papier", "enduit"] as const;

function Swatch({ color, texture, className }: { color: string | null; texture: string | null; className?: string }) {
  return texture ? (
    <img src={photoUrl(texture)} alt="" className={cn("rounded-full border object-cover", className)} />
  ) : (
    <span className={cn("block rounded-full border", className)} style={{ backgroundColor: color ?? "#ddd" }} />
  );
}

export function PanelMurs({ api }: { api: WorkspaceApi }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("peinture");
  const z = api.activeZone;
  const tools: { id: StageTool; label: string; icon: typeof Wand2; hint: string }[] = [
    { id: "mur-clic", label: "Baguette", icon: Wand2, hint: "Cliquez sur le mur : sélection automatique jusqu'aux arêtes et menuiseries" },
    { id: "mur-plus", label: "Ajouter", icon: Paintbrush, hint: "Pinceau : ajoute au mur" },
    { id: "mur-moins", label: "Protéger", icon: ShieldMinus, hint: "Pinceau : retire et protège (fenêtre, plinthe, meuble devant le mur)" },
  ];
  const list = api.finishes.filter((f) => f.kind === kind);

  return (
    <div className="grid gap-4 text-sm">
      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Surfaces</h3>
          <Button size="sm" variant="outline" onClick={api.addZone}>
            <Plus className="h-4 w-4" /> Nouveau mur
          </Button>
        </div>
        {api.scene.zones.length === 0 && (
          <p className="text-xs text-muted-foreground">Créez un mur, cliquez dessus avec la baguette, puis choisissez une teinte dans la bibliothèque.</p>
        )}
        <ul className="grid gap-1">
          {api.scene.zones.map((zone) => (
            <li
              key={zone.id}
              className={cn("flex items-center gap-2 rounded-md border p-1.5", zone.id === z?.id && "border-primary bg-primary/5")}
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => api.setActiveZone(zone.id)}>
                <Swatch color={zone.finish?.color ?? null} texture={zone.finish?.texture ?? null} className="h-6 w-6 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{zone.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {zone.finish ? `${zone.finish.name}${zone.finish.reference ? ` · ${zone.finish.reference}` : ""}` : "Sans finition"}
                  </span>
                </span>
              </button>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={zone.visible ? `Masquer ${zone.name}` : `Afficher ${zone.name}`} onClick={() => api.updateZone(zone.id, { visible: !zone.visible })}>
                {zone.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Supprimer ${zone.name}`} onClick={() => api.removeZone(zone.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {z && (
        <section className="grid gap-2 rounded-lg border p-2">
          <Input aria-label="Nom de la surface" value={z.name} onChange={(e) => api.updateZone(z.id, { name: e.target.value })} className="h-8" />
          <p className="text-xs font-medium text-muted-foreground">Sélection du mur</p>
          <div className="grid grid-cols-3 gap-1">
            {tools.map((t) => (
              <Button key={t.id} size="sm" variant={api.tool === t.id ? "default" : "outline"} title={t.hint} aria-pressed={api.tool === t.id} onClick={() => api.setTool(t.id)} className="px-1">
                <t.icon className="h-4 w-4" /> {t.label}
              </Button>
            ))}
          </div>
          {api.tool === "mur-clic" && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              Tolérance de la baguette ({api.tolerance.toFixed(1)})
              <Slider min={0.4} max={2} step={0.1} value={[api.tolerance]} onValueChange={([v]) => api.setTolerance(v ?? 1)} aria-label="Tolérance de la baguette" />
            </label>
          )}
          {(api.tool === "mur-plus" || api.tool === "mur-moins") && (
            <label className="grid gap-1 text-xs text-muted-foreground">
              Taille du pinceau
              <Slider min={3} max={80} value={[api.brush]} onValueChange={([v]) => api.setBrush(v ?? 20)} aria-label="Taille du pinceau" />
            </label>
          )}
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={api.tool === "pipette" ? "default" : "outline"}
              aria-pressed={api.tool === "pipette"}
              title="Prélever une teinte sur la photo (coussin, tissu, échantillon) et l'appliquer à ce mur"
              onClick={() => api.setTool(api.tool === "pipette" ? "deplacer" : "pipette")}
            >
              <Pipette className="h-4 w-4" /> Pipette
            </Button>
            <Button size="sm" variant="outline" disabled={!!api.busy} onClick={() => void api.refineZone()} title="Recale le contour sur les bords réels de la photo">
              <Sparkles className="h-4 w-4" /> Affiner les bords
            </Button>
            <Button size="sm" variant="ghost" onClick={api.undoMask}>
              <Undo2 className="h-4 w-4" /> Annuler
            </Button>
            <Button size="sm" variant="ghost" onClick={() => api.clearMask(z.id)}>
              Tout désélectionner
            </Button>
          </div>
          {z.finish && !z.finish.id && z.finish.color && (
            <FinishDialog
              initialColor={z.finish.color}
              onSaved={(f) => api.applyFinish(f)}
              trigger={
                <Button size="sm" variant="hero">
                  <Plus className="h-4 w-4" /> Enregistrer cette teinte dans la bibliothèque
                </Button>
              }
            />
          )}
          {z.finish && (
            <>
              <p className="mt-1 text-xs font-medium text-muted-foreground">Rendu</p>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Lumière de la pièce conservée : {Math.round(z.lumiere * 100)} %
                <Slider min={0.5} max={1.5} step={0.05} value={[z.lumiere]} onValueChange={([v]) => api.updateZone(z.id, { lumiere: v ?? 1 })} aria-label="Lumière conservée" />
              </label>
              {z.finish.kind !== "peinture" && (
                <>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Taille du motif : {z.repetitions.toFixed(1)} répétitions sur la largeur
                    <Slider min={0.5} max={24} step={0.5} value={[z.repetitions]} onValueChange={([v]) => api.updateZone(z.id, { repetitions: v ?? 4 })} aria-label="Taille du motif" />
                  </label>
                  <Button size="sm" variant={api.tool === "coins" ? "default" : "outline"} onClick={() => api.setTool(api.tool === "coins" ? "deplacer" : "coins")}>
                    <Grid2x2 className="h-4 w-4" /> {api.tool === "coins" ? "Terminer la perspective" : "Aligner sur la perspective (4 coins)"}
                  </Button>
                </>
              )}
            </>
          )}
        </section>
      )}

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Bibliothèque du magasin</h3>
          <FinishDialog
            defaultKind={kind}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" /> Ajouter
              </Button>
            }
            onSaved={(f) => api.activeZone && !api.activeZone.finish && api.applyFinish(f)}
          />
        </div>
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Type de finition">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn("flex-1 rounded px-1 py-1 text-xs", kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {k === "peinture" ? "Peintures" : k === "papier" ? "Papiers peints" : "Enduits"}
            </button>
          ))}
        </div>
        {list.length === 0 && <p className="text-xs text-muted-foreground">Aucun {KIND_LABEL[kind].toLowerCase()} enregistré.</p>}
        <ul className="grid max-h-72 gap-1 overflow-auto pr-1">
          {list.map((f) => {
            const active = z?.finish?.id === f.id;
            return (
              <li key={f.id} className={cn("group flex items-center gap-2 rounded-md border p-1.5", active && "border-primary ring-1 ring-primary")}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={z ? `Appliquer sur « ${z.name} »` : "Sélectionnez d'abord un mur"}
                  onClick={() => api.applyFinish(f)}
                >
                  <Swatch color={f.color} texture={f.texture_path} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[f.reference, f.color, f.finition].filter(Boolean).join(" · ") || KIND_LABEL[f.kind]}
                    </span>
                  </span>
                </button>
                <FinishDialog
                  finish={f}
                  trigger={
                    <Button size="icon" variant="ghost" className="h-7 w-7 opacity-60 group-hover:opacity-100" aria-label={`Modifier ${f.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
              </li>
            );
          })}
        </ul>
        {z && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ScanLine className="h-3 w-3" /> Un clic sur une finition l'applique à « {z.name} » ; les articles restent à leur place.
          </p>
        )}
      </section>
    </div>
  );
}

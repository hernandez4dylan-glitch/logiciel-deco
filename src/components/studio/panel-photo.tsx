import { useState } from "react";
import { Eraser, ImagePlus, RotateCcw, Sofa, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { normalizeBase, canvasToDataUrl } from "@/lib/studio-api";
import type { WorkspaceApi } from "@/components/studio/workspace";

const SOLS = [
  { id: "parquet", label: "Parquet chêne" },
  { id: "beton", label: "Béton ciré" },
  { id: "uni", label: "Sol uni" },
] as const;

export function PanelPhoto({ api }: { api: WorkspaceApi }) {
  const [sol, setSol] = useState<(typeof SOLS)[number]["id"] | "photo">("parquet");
  const [mur, setMur] = useState("#E3D5C0");
  const [horizon, setHorizon] = useState(62);
  const [decorPhoto, setDecorPhoto] = useState<string | null>(null);
  const painting = api.tool === "retouche";

  return (
    <div className="grid gap-4 text-sm">
      <section className="grid gap-2 rounded-lg border p-2">
        <p className="font-medium">Retouches de la photo</p>
        <p className="text-xs text-muted-foreground">
          Peignez d'abord la zone au pinceau. Les murs, articles et finitions de la composition sont conservés.
        </p>
        <Button size="sm" variant={painting ? "default" : "outline"} onClick={() => api.setTool(painting ? "deplacer" : "retouche")}>
          {painting ? "Pinceau actif" : "Peindre la zone à retoucher"}
        </Button>
        {painting && (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Taille du pinceau
            <Slider min={4} max={90} value={[api.brush]} onValueChange={([v]) => api.setBrush(v ?? 20)} aria-label="Taille du pinceau" />
          </label>
        )}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={api.undoMask}><Undo2 className="h-4 w-4" /> Annuler</Button>
          <Button size="sm" variant="ghost" onClick={() => api.clearMask("retouche")}>Effacer le tracé</Button>
        </div>
        <Button size="sm" variant="hero" disabled={!!api.busy} onClick={() => void api.retouch("erase")}>
          <Eraser className="h-4 w-4" /> Gomme : effacer la zone
        </Button>
        <p className="text-xs text-muted-foreground">Effacez un meuble à la fois : le sol et le mur autour sont prolongés.</p>
      </section>

      <section className="grid gap-2 rounded-lg border p-2">
        <p className="flex items-center gap-1 font-medium"><Sofa className="h-4 w-4" /> Remplacer le décor</p>
        <p className="text-xs text-muted-foreground">Peignez chaque meuble à garder d'un trait, puis choisissez le nouveau décor.</p>
        <div className="flex flex-wrap gap-1">
          {SOLS.map((s) => (
            <Button key={s.id} size="sm" variant={sol === s.id ? "default" : "outline"} aria-pressed={sol === s.id} onClick={() => setSol(s.id)}>
              {s.label}
            </Button>
          ))}
          <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs", sol === "photo" ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary")}>
            <ImagePlus className="h-3.5 w-3.5" /> Photo de décor
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const { canvas } = await normalizeBase(URL.createObjectURL(f), 2400);
                  setDecorPhoto(await canvasToDataUrl(canvas, "image/jpeg", 0.9));
                  setSol("photo");
                } catch {
                  toast.error("Photo de décor illisible");
                }
              }}
            />
          </label>
        </div>
        {sol !== "photo" && (
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Mur <input type="color" value={mur} onChange={(e) => setMur(e.target.value)} className="h-7 w-10 cursor-pointer rounded border" aria-label="Couleur du mur" />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Hauteur du sol : {horizon} %
              <Slider min={40} max={85} value={[horizon]} onValueChange={([v]) => setHorizon(v ?? 62)} aria-label="Hauteur du sol" />
            </label>
          </div>
        )}
        <Button
          size="sm"
          variant="hero"
          disabled={!!api.busy || (sol === "photo" && !decorPhoto)}
          onClick={() =>
            void api.retouch(
              "decor",
              sol === "photo" ? { decor: decorPhoto } : { style: sol, color: mur.toUpperCase(), horizon: (horizon / 100).toFixed(2) },
            )
          }
        >
          Changer le décor
        </Button>
      </section>

      <section className="grid gap-2 rounded-lg border p-2">
        <p className="font-medium">Image de départ</p>
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2 text-xs hover:border-primary">
          <ImagePlus className="h-4 w-4" /> Remplacer par une autre version du rendu (même format)
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void api.replaceBase(f);
            }}
          />
        </label>
        {api.scene.baseHistory.length > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={!!api.busy} onClick={api.undoRetouch}>
              <Undo2 className="h-4 w-4" /> Annuler la dernière retouche ({api.scene.baseHistory.length})
            </Button>
            <Button size="sm" variant="ghost" disabled={!!api.busy} onClick={api.restoreOriginal}>
              <RotateCcw className="h-4 w-4" /> Revenir à l'image importée
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Copy, FolderOpen, ImagePlus, Loader2, Maximize, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Workspace, type SaveState } from "@/components/studio/workspace";
import { localStorageGet, localStorageSet } from "@/components/studio/panel-references";
import { localStore } from "@/lib/local-client";
import { finishesQuery, productPhotosQuery, projectsQuery, variantsQuery, type ProductRow } from "@/lib/data";
import type { StudioRows } from "@/lib/records";
import { duplicateScene, newScene, nextVariantName, parseScene, serializeScene } from "@/lib/scene";
import { canvasToBlob, normalizeBase, photoUrl, uploadBlob } from "@/lib/studio-api";
import { cn } from "@/lib/utils";

type Variant = StudioRows["variants"];
type Project = StudioRows["projects"];

const SAVE_LABEL: Record<SaveState, string> = { ok: "Enregistré", pending: "Modifications en attente", saving: "Enregistrement…", error: "Non enregistré" };
const tousLesVariants = () => ({
  queryKey: ["variants", "tous"],
  queryFn: async () => {
    const { data, error } = await localStore.from("variants").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Variant[];
  },
});

/** Espace décorateur : accueil (importer une photo / reprendre un projet), puis l'atelier
 *  en plein écran autour de la photo du client. */
export function EspaceDecorateur({ products, discount }: { products: ProductRow[]; discount: number }) {
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery(projectsQuery());
  const { data: tous = [] } = useQuery(tousLesVariants());
  const { data: finishes = [] } = useQuery(finishesQuery());
  const { data: photos = [] } = useQuery(productPhotosQuery());
  const [projectId, setProjectIdState] = useState<string | null>(() => localStorageGet("studio-projet-ouvert"));
  const project = projects.find((p) => p.id === projectId) ?? null;
  const { data: variants = [] } = useQuery({ ...variantsQuery(projectId ?? "-"), enabled: !!project });
  const [variantId, setVariantId] = useState<string | null>(null);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0] ?? null;
  const [saveState, setSaveState] = useState<SaveState>("ok");
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const atelier = useRef<HTMLDivElement>(null);
  const [import_, setImport] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  const ouvrir = async (id: string | null) => {
    await flushRef.current?.();
    setProjectIdState(id);
    setVariantId(null);
    localStorageSet("studio-projet-ouvert", id ?? "");
    if (!id) qc.invalidateQueries({ queryKey: ["variants", "tous"] });
  };
  useEffect(() => {
    if (!isLoading && projectId && !project) setProjectIdState(null);
  }, [isLoading, projectId, project]);
  // Échap ne ferme pas l'atelier (réservé aux fenêtres) ; le bouton « Mes projets » le fait.

  async function importerPhoto(file: File) {
    setImport("Préparation de la photo…");
    try {
      const n = await normalizeBase(URL.createObjectURL(file));
      const base_path = await uploadBlob("base", await canvasToBlob(n.canvas, "image/jpeg", 0.93), "jpg");
      const nom = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
      const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date());
      const p = await localStore.from("projects").insert({ name: nom && !/^(img|dsc|photo)\s?\d/i.test(nom) ? nom : `Projet du ${date}`, client: null });
      if (p.error) throw new Error(p.error.message);
      const proj = p.data as unknown as Project;
      const v = await localStore.from("variants").insert({ project_id: proj.id, name: "Proposition A", base_path, width: n.width, height: n.height, data: serializeScene(newScene()) });
      if (v.error) throw new Error(v.error.message);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["variants", "tous"] });
      await ouvrir(proj.id);
      toast.success("Photo importée : reconnaissance des murs, du sol, du plafond, des portes et fenêtres en cours");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setImport(null);
    }
  }

  async function renommer(champ: "name" | "client", valeur: string) {
    if (!project) return;
    const v = valeur.trim();
    if (champ === "name" && !v) return;
    const { error } = await localStore.from("projects").update({ [champ]: v || null }).eq("id", project.id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["projects"] });
  }
  async function dupliquer() {
    if (!variant || !project) return;
    await flushRef.current?.();
    const rows = await qc.fetchQuery({ ...variantsQuery(project.id), staleTime: 0 });
    const cur = rows.find((v) => v.id === variant.id) ?? variant;
    const { data, error } = await localStore.from("variants").insert({
      project_id: project.id,
      name: nextVariantName(rows.map((v) => v.name)).replace("Variante", "Proposition"),
      base_path: cur.base_path,
      width: cur.width,
      height: cur.height,
      data: serializeScene(duplicateScene(parseScene(cur.data))),
    });
    if (error) return void toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ["variants", project.id] });
    setVariantId((data as unknown as Variant).id);
    toast.success("Proposition dupliquée : essayez autre chose sans perdre la première");
  }
  async function supprimer(p: Project) {
    const { error } = await localStore.from("projects").delete().eq("id", p.id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["variants", "tous"] });
  }

  const entree = (
    <input ref={fichier} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) void importerPhoto(f);
    }} />
  );

  if (project && variant) {
    return (
      <div ref={atelier} className="fixed inset-0 z-40 flex flex-col gap-2 bg-background p-3">
        {entree}
        <header className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void ouvrir(null)}><ArrowLeft className="h-4 w-4" /> Mes projets</Button>
          <Input key={`n${project.id}${project.name}`} defaultValue={project.name} aria-label="Nom du projet" className="h-8 w-56 font-display text-base" onBlur={(e) => void renommer("name", e.target.value)} />
          <Input key={`c${project.id}${project.client}`} defaultValue={project.client ?? ""} placeholder="Client" aria-label="Client" className="h-8 w-40" onBlur={(e) => void renommer("client", e.target.value)} />
          <select
            value={variant.id}
            aria-label="Proposition"
            onChange={async (e) => { await flushRef.current?.(); setVariantId(e.target.value); }}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <Button size="sm" variant="ghost" onClick={() => void dupliquer()} title="Dupliquer pour essayer une autre ambiance"><Copy className="h-4 w-4" /> Dupliquer</Button>
          <span className={cn("ml-auto flex items-center gap-1 text-xs", saveState === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {saveState === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : saveState === "error" ? <TriangleAlert className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {SAVE_LABEL[saveState]}
          </span>
          <Button size="icon" variant="ghost" aria-label="Plein écran" title="Plein écran" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : atelier.current?.requestFullscreen())}>
            <Maximize className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <Workspace
            key={variant.id}
            variant={variant}
            products={products}
            photos={photos}
            finishes={finishes}
            discount={discount}
            onSaveState={setSaveState}
            flushRef={flushRef}
            projet={{ nom: project.name, client: project.client }}
          />
        </div>
      </div>
    );
  }

  const apercu = (p: Project) => tous.find((v) => v.project_id === p.id);
  return (
    <div className="grid gap-6">
      {entree}
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          disabled={!!import_}
          onClick={() => fichier.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void importerPhoto(f);
          }}
          className="surface grid min-h-[220px] place-items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition hover:border-primary hover:bg-primary/5"
        >
          {import_ ? <Loader2 className="h-10 w-10 animate-spin text-primary" /> : <ImagePlus className="h-10 w-10 text-primary" />}
          <span className="font-display text-2xl">{import_ ?? "Importer une photo"}</span>
          <span className="max-w-sm text-sm text-muted-foreground">
            La photo du salon de votre client (ou le rendu de l'architecte) : murs, sol, plafond, portes, fenêtres et plinthes sont reconnus automatiquement.
          </span>
        </button>
        <div className="surface grid min-h-[220px] content-start gap-3 rounded-xl p-5">
          <p className="flex items-center gap-2 font-display text-2xl"><FolderOpen className="h-6 w-6 text-primary" /> Reprendre un projet</p>
          {projects.length === 0 && <p className="text-sm text-muted-foreground">Aucun projet pour l'instant.</p>}
          <ul className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {projects.map((p) => {
              const v = apercu(p);
              return (
                <li key={p.id} className="group relative">
                  <button type="button" onClick={() => void ouvrir(p.id)} className="grid w-full gap-1 overflow-hidden rounded-lg border text-left hover:border-primary hover:shadow">
                    {v ? <img src={photoUrl(v.base_path)} alt="" className="aspect-[4/3] w-full object-cover" /> : <span className="aspect-[4/3] w-full bg-muted" />}
                    <span className="px-2 pb-2">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p.client, new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(p.updated_at))].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <ConfirmButton title={`Supprimer le projet « ${p.name} » ?`} description="Ses propositions seront supprimées. Le catalogue n'est pas touché." onConfirm={() => void supprimer(p)}>
                    <Button size="icon" variant="secondary" className="absolute right-1 top-1 h-7 w-7 opacity-0 group-hover:opacity-100" aria-label={`Supprimer ${p.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

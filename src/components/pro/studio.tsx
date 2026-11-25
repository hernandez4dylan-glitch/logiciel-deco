import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Columns2, Copy, Download, FileText, FolderOpen, ImagePlus, Loader2, Maximize, Pencil, Plus, Printer, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Workspace, type SaveState } from "@/components/studio/workspace";
import { CompareDialog } from "@/components/studio/compare-dialog";
import { localStorageGet, localStorageSet } from "@/components/studio/panel-references";
import { localStore } from "@/lib/local-client";
import { finishesQuery, productPhotosQuery, projectsQuery, variantsQuery, type ProductRow } from "@/lib/data";
import { composeVariant } from "@/lib/compose";
import { downloadCsv } from "@/lib/csv";
import { ficheHtml, printFiche } from "@/lib/fiche";
import type { StudioRows } from "@/lib/records";
import { duplicateScene, newScene, nextVariantName, parseScene, referenceList, referenceRows, serializeScene } from "@/lib/scene";
import { canvasToBlob, canvasToDataUrl, loadImage, normalizeBase, photoEngine, uploadBlob } from "@/lib/studio-api";
import { cn } from "@/lib/utils";

type Variant = StudioRows["variants"];
type Project = StudioRows["projects"];

const SAVE_LABEL: Record<SaveState, string> = { ok: "Enregistré", pending: "Modifications en attente", saving: "Enregistrement…", error: "Non enregistré" };
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "projet";

/** Studio Plan & 3D : projets clients, variantes, comparaison et remise du visuel. */
export function Studio({ products, discount }: { products: ProductRow[]; discount: number }) {
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const { data: projects = [], isLoading } = useQuery(projectsQuery());
  const { data: finishes = [] } = useQuery(finishesQuery());
  const { data: photos = [] } = useQuery(productPhotosQuery());
  const [projectId, setProjectIdState] = useState<string | null>(() => localStorageGet("studio-projet"));
  const project = projects.find((p) => p.id === projectId) ?? null;
  const { data: variants = [] } = useQuery({ ...variantsQuery(projectId ?? "-"), enabled: !!project });
  const [variantId, setVariantId] = useState<string | null>(null);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0] ?? null;
  const [saveState, setSaveState] = useState<SaveState>("ok");
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const setProjectId = async (id: string | null) => {
    await flushRef.current?.();
    setProjectIdState(id);
    setVariantId(null);
    if (id) localStorageSet("studio-projet", id);
  };
  const switchVariant = async (id: string) => {
    await flushRef.current?.();
    setVariantId(id);
  };

  async function freshVariants() {
    await flushRef.current?.();
    return qc.fetchQuery({ ...variantsQuery(projectId!), staleTime: 0 });
  }

  async function duplicate() {
    if (!variant || !project) return;
    const rows = await freshVariants();
    const cur = rows.find((v) => v.id === variant.id) ?? variant;
    const { data, error } = await localStore.from("variants").insert({
      project_id: project.id,
      name: nextVariantName(rows.map((v) => v.name)),
      base_path: cur.base_path,
      width: cur.width,
      height: cur.height,
      data: serializeScene(duplicateScene(parseScene(cur.data))),
    });
    if (error) { toast.error(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["variants", project.id] });
    setVariantId((data as unknown as Variant).id);
    toast.success("Variante dupliquée : modifiez-la sans toucher à l'autre");
  }

  async function exportPng() {
    if (!variant || !project) return;
    setExporting("Rendu du visuel…");
    try {
      const rows = await freshVariants();
      const row = rows.find((v) => v.id === variant.id)!;
      const c = await composeVariant(row, parseScene(row.data), products, photos);
      const url = URL.createObjectURL(await canvasToBlob(c, "image/png"));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(project.name)}-${slug(row.name)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export impossible");
    } finally {
      setExporting(null);
    }
  }
  function listFor(row: Variant) {
    const pro = localStorageGet("studio-tarif") === "pro";
    return { list: referenceList(parseScene(row.data), products, { pro, discount: pro ? discount : 0 }), pro };
  }
  async function exportFiche() {
    if (!variant || !project) return;
    setExporting("Préparation de la fiche…");
    try {
      const rows = await freshVariants();
      const row = rows.find((v) => v.id === variant.id)!;
      const c = await composeVariant(row, parseScene(row.data), products, photos, 2200);
      const { list, pro } = listFor(row);
      printFiche(
        ficheHtml({ projet: project.name, client: project.client, variante: row.name, image: await canvasToDataUrl(c, "image/jpeg", 0.9), list, tarif: pro ? "pro" : "public", remise: pro ? discount : 0 }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fiche impossible");
    } finally {
      setExporting(null);
    }
  }
  async function exportCsv() {
    if (!variant || !project) return;
    const rows = await freshVariants();
    const row = rows.find((v) => v.id === variant.id)!;
    downloadCsv(`${slug(project.name)}-${slug(row.name)}-references`, referenceRows(listFor(row).list));
  }

  async function renameVariant() {
    if (!variant) return;
    const name = window.prompt("Nom de la variante", variant.name)?.trim();
    if (!name) return;
    const { error } = await localStore.from("variants").update({ name }).eq("id", variant.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["variants", variant.project_id] });
  }
  async function deleteVariant() {
    if (!variant || variants.length < 2) return;
    const { error } = await localStore.from("variants").delete().eq("id", variant.id);
    if (error) { toast.error(error.message); return; }
    setVariantId(null);
    qc.invalidateQueries({ queryKey: ["variants", variant.project_id] });
  }
  async function deleteProject() {
    if (!project) return;
    const { error } = await localStore.from("projects").delete().eq("id", project.id);
    if (error) { toast.error(error.message); return; }
    setProjectIdState(null);
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  useEffect(() => {
    if (!isLoading && projectId && !project && projects.length) setProjectIdState(null);
  }, [isLoading, projectId, project, projects.length]);

  return (
    <div ref={root} className="grid gap-3 bg-background">
      <div className="surface flex flex-wrap items-center gap-2 p-3 print:hidden">
        <FolderOpen className="h-4 w-4 text-primary" />
        <Select value={project?.id ?? ""} onValueChange={(v) => void setProjectId(v)}>
          <SelectTrigger className="h-9 w-64" aria-label="Projet client"><SelectValue placeholder={projects.length ? "Ouvrir un projet client…" : "Aucun projet enregistré"} /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="hero" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau projet</Button>
        {project && (
          <>
            <ProjectEdit project={project} />
            <ConfirmButton title={`Supprimer le projet « ${project.name} » ?`} description="Toutes ses variantes seront supprimées. Le catalogue n'est pas touché." onConfirm={() => void deleteProject()}>
              <Button size="icon" variant="ghost" aria-label="Supprimer le projet" title="Supprimer le projet"><Trash2 className="h-4 w-4" /></Button>
            </ConfirmButton>
            <span className={cn("ml-auto flex items-center gap-1 text-xs", saveState === "error" ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {saveState === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : saveState === "error" ? <TriangleAlert className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {SAVE_LABEL[saveState]}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Plein écran"
              title="Plein écran (rendez-vous client)"
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen())}
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {project && variants.length > 0 && variant && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Variantes">
            {variants.map((v) => (
              <Button key={v.id} role="tab" aria-selected={v.id === variant.id} size="sm" variant={v.id === variant.id ? "default" : "outline"} onClick={() => void switchVariant(v.id)}>
                {v.name}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => void duplicate()}><Copy className="h-4 w-4" /> Dupliquer la variante</Button>
          <Button size="icon" variant="ghost" aria-label="Renommer la variante" title="Renommer la variante" onClick={() => void renameVariant()}><Pencil className="h-4 w-4" /></Button>
          {variants.length > 1 && (
            <ConfirmButton title={`Supprimer « ${variant.name} » ?`} description="Les autres variantes du projet sont conservées." onConfirm={() => void deleteVariant()}>
              <Button size="icon" variant="ghost" aria-label="Supprimer la variante" title="Supprimer la variante"><Trash2 className="h-4 w-4" /></Button>
            </ConfirmButton>
          )}
          <span className="mx-1 h-6 w-px bg-border" />
          <Button size="sm" variant="outline" disabled={variants.length < 2} onClick={async () => { await freshVariants(); setComparing(true); }}>
            <Columns2 className="h-4 w-4" /> Comparer
          </Button>
          <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportPng()}><Download className="h-4 w-4" /> Visuel PNG</Button>
          <Button size="sm" variant="outline" disabled={!!exporting} onClick={() => void exportFiche()}><Printer className="h-4 w-4" /> Fiche client (PDF)</Button>
          <Button size="sm" variant="ghost" disabled={!!exporting} onClick={() => void exportCsv()}><FileText className="h-4 w-4" /> Références (CSV)</Button>
          {exporting && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {exporting}</span>}
        </div>
      )}

      {project && variant ? (
        <Workspace
          key={variant.id}
          variant={variant}
          products={products}
          photos={photos}
          finishes={finishes}
          discount={discount}
          onSaveState={setSaveState}
          flushRef={flushRef}
        />
      ) : (
        <div className="surface grid place-items-center gap-3 p-10 text-center">
          <p className="font-display text-2xl">Préparez la proposition de votre client</p>
          <p className="max-w-xl text-sm text-muted-foreground">
            Importez le rendu 3D de l'architecte ou une photo de la pièce (format conservé, même panoramique ou vertical), puis
            changez les murs, placez les articles du magasin et comparez plusieurs variantes. Tout est enregistré sur ce PC.
          </p>
          <Button variant="hero" onClick={() => setCreating(true)}><ImagePlus className="h-4 w-4" /> Nouveau projet client</Button>
        </div>
      )}

      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (id) => {
          await qc.invalidateQueries({ queryKey: ["projects"] });
          await setProjectId(id);
        }}
      />
      {project && variants.length > 1 && variant && (
        <CompareDialog
          open={comparing}
          onOpenChange={setComparing}
          variants={variants}
          initial={[variants[0]!.id === variant.id ? variant.id : variants[0]!.id, variants.find((v) => v.id !== variants[0]!.id)?.id ?? variant.id]}
          products={products}
          photos={photos}
          tarifPro={localStorageGet("studio-tarif") === "pro"}
          discount={discount}
        />
      )}
    </div>
  );
}

function ProjectEdit({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: project.name, client: project.client ?? "", notes: project.notes ?? "" });
  return (
    <>
      <Button size="icon" variant="ghost" aria-label="Modifier le projet" title="Nom du projet, client, notes" onClick={() => { setF({ name: project.name, client: project.client ?? "", notes: project.notes ?? "" }); setOpen(true); }}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Projet client</DialogTitle></DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const { error } = await localStore.from("projects").update({ name: f.name.trim(), client: f.client.trim() || null, notes: f.notes.trim() || null }).eq("id", project.id);
              if (error) { toast.error(error.message); return; }
              qc.invalidateQueries({ queryKey: ["projects"] });
              setOpen(false);
            }}
          >
            <div className="grid gap-1.5"><Label htmlFor="pe-name">Nom du projet</Label><Input id="pe-name" required value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pe-client">Client</Label><Input id="pe-client" value={f.client} onChange={(e) => setF((s) => ({ ...s, client: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pe-notes">Notes</Label><Input id="pe-notes" value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></div>
            <DialogFooter><Button type="submit" variant="hero">Enregistrer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let blob: Blob, width: number, height: number;
      if (file) {
        const n = await normalizeBase(URL.createObjectURL(file));
        blob = await canvasToBlob(n.canvas, "image/jpeg", 0.93);
        ({ width, height } = n);
      } else {
        blob = await photoEngine({ mode: "vierge", width: 1800, height: 1200, style: "parquet", color: "#EFEAE1" });
        const img = await loadImage(URL.createObjectURL(blob));
        width = img.naturalWidth;
        height = img.naturalHeight;
      }
      const base_path = await uploadBlob("base", blob, "jpg");
      const p = await localStore.from("projects").insert({ name: name.trim() || "Projet client", client: client.trim() || null });
      if (p.error) throw new Error(p.error.message);
      const project = p.data as unknown as Project;
      const v = await localStore.from("variants").insert({ project_id: project.id, name: "Variante A", base_path, width, height, data: serializeScene(newScene()) });
      if (v.error) throw new Error(v.error.message);
      await onCreated(project.id);
      setName("");
      setClient("");
      setFile(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau projet client</DialogTitle>
          <DialogDescription>Le cadrage et la lumière de l'image importée sont conservés.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={create}>
          <div className="grid gap-1.5"><Label htmlFor="np-name">Nom du projet</Label><Input id="np-name" required value={name} placeholder="Ex. Salon Dupont" onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="np-client">Client</Label><Input id="np-client" value={client} placeholder="Facultatif" onChange={(e) => setClient(e.target.value)} /></div>
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 text-sm hover:border-primary">
            {file ? <img src={URL.createObjectURL(file)} alt="" className="h-16 w-24 rounded object-cover" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" />}
            <span>{file ? file.name : "Importer le rendu 3D ou la photo de la pièce"}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-muted-foreground">Sans image, le projet démarre sur une pièce vierge générée.</p>
          <DialogFooter>
            <Button type="submit" variant="hero" disabled={busy}>{busy ? "Création…" : "Créer le projet"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

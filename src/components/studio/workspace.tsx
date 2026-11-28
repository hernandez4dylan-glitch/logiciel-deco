import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Columns2, Image as ImageIcon, Loader2, MoreHorizontal, Package, Paintbrush2, Presentation as IconePresentation, Redo2, ShoppingBag, Sparkles, Undo2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ListeSurfaces, PanneauSurface } from "@/components/decor/panneau-surface";
import { MaSelectionSheet } from "@/components/decor/ma-selection";
import { Presentation } from "@/components/decor/presentation";
import { maSelection } from "@/lib/selection";
import { localStorageGet, localStorageSet } from "@/components/studio/panel-references";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Stage, BRUSH_TOOLS, type StageHandle, type StageTool } from "@/components/studio/stage";
import { PanelMurs } from "@/components/studio/panel-murs";
import { PanelArticles } from "@/components/studio/panel-articles";
import { PanelPhoto } from "@/components/studio/panel-photo";
import { PanelReferences } from "@/components/studio/panel-references";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localStore } from "@/lib/local-client";
import type { ProductRow } from "@/lib/data";
import type { StudioRows } from "@/lib/records";
import { cutByMask, maskBounds, maskFromImage, newCanvas, strokeMask, tinted } from "@/lib/mask-canvas";
import { drawComposition, type ItemAsset } from "@/lib/render-scene";
import { finishPayload, itemImagePath, loadAsset, renderFinished, renderFinishedApercu } from "@/lib/compose";
import { defaultQuad, floorQuad, itemBox, surfaceLabel, parseScene, popHistory, pushHistory, serializeScene, type CastShadow, type Item, type Point, type Quad, type Scene, type Surface, type Zone, type AnalyseInfo, compositionKey, aspectLabel, zoneAspect } from "@/lib/scene";
import { OptimisationDialog } from "@/components/studio/optimisation-dialog";
import { ExportIaDialog } from "@/components/studio/export-ia-dialog";
import { snapshotDe } from "@/lib/propositions";
import { accordLight, stats as lumStats, UndoStack } from "@/lib/lumiere";
import { sampleColor } from "@/lib/couleur";
import { canvasToBlob, canvasToDataUrl, loadImage, pathToDataUrl, photoEngine, photoJson, photoUrl, uploadBlob } from "@/lib/studio-api";

type Variant = StudioRows["variants"];
type Finish = StudioRows["finishes"];
type Photo = StudioRows["product_photos"];

export type SaveState = "ok" | "pending" | "saving" | "error";

/** Ce que les panneaux peuvent lire et faire sur la variante ouverte. */
export type WorkspaceApi = {
  scene: Scene;
  W: number;
  H: number;
  products: ProductRow[];
  photos: Photo[];
  finishes: Finish[];
  tool: StageTool;
  setTool: (t: StageTool) => void;
  brush: number;
  setBrush: (n: number) => void;
  busy: string | null;
  // murs
  activeZone: Zone | null;
  setActiveZone: (id: string | null) => void;
  addZone: (surface?: Surface) => void;
  /** Porte sélectionnée avec son huisserie : sépare le cadre dans une nouvelle surface. */
  splitFrame: (epaisseur: number) => Promise<void>;
  updateZone: (id: string, patch: Partial<Zone>) => void;
  removeZone: (id: string) => void;
  applyFinish: (f: Finish) => void;
  /** Pose une finition sur plusieurs surfaces d'un coup (« Tous les murs »). */
  applyFinishTo: (f: Finish, zoneIds: string[]) => void;
  /** Teinte « au pinceau » : un clic sur la photo la pose sur la surface visée. */
  pinceau: Finish | null;
  choisirPinceau: (f: Finish | null) => void;
  /** Surface survolée (contour sur la photo) et surface ouverte dans le panneau. */
  setSurvol: (id: string | null) => void;
  choisirSurface: (id: string | null) => void;
  nouvelleSurface: () => void;
  /** Article posé depuis une photo précise (visuel importé). */
  addItemPhoto: (productId: string, photoId: string) => void;
  analyse: AnalyseInfo | null;
  analysing: boolean;
  reanalyse: () => void;
  refineZone: () => Promise<void>;
  clearMask: (key: string) => void;
  undoMask: () => void;
  tolerance: number;
  setTolerance: (n: number) => void;
  finishing: boolean;
  // articles
  selected: Item | null;
  setSelected: (uid: string | null) => void;
  addItem: (p: ProductRow) => void;
  updateItem: (uid: string, patch: Partial<Item>) => void;
  removeItem: (uid: string) => void;
  duplicateItem: (uid: string) => void;
  moveItem: (uid: string, dir: -1 | 1) => void;
  assetFor: (item: Item) => ItemAsset | undefined;
  accordItem: (uid: string) => void;
  setCast: (patch: Partial<CastShadow>) => void;
  // photo
  basePath: string;
  retouch: (mode: "erase" | "decor", extra?: Record<string, unknown>) => Promise<void>;
  restoreOriginal: () => void;
  undoRetouch: () => void;
  replaceBase: (file: File) => Promise<void>;
};

const APERCU_MAX = 1400;
const kindHeight: Record<string, number> = { Mobilier: 0.34, Luminaire: 0.22, Textile: 0.14, "Objet déco": 0.1 };

export function Workspace({
  variant,
  products,
  photos,
  finishes,
  discount,
  onSaveState,
  flushRef,
  projet,
}: {
  variant: Variant;
  products: ProductRow[];
  photos: Photo[];
  finishes: Finish[];
  discount: number;
  onSaveState: (s: SaveState) => void;
  flushRef: React.MutableRefObject<(() => Promise<void>) | null>;
  projet?: { nom: string; client: string | null };
}) {
  const qc = useQueryClient();
  const stage = useRef<StageHandle>(null);
  const [scene, setSceneState] = useState<Scene>(() => parseScene(variant.data));
  const sceneRef = useRef(scene);
  const [basePath, setBasePath] = useState(variant.base_path);
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
  const W = baseImg?.naturalWidth ?? variant.width;
  const H = baseImg?.naturalHeight ?? variant.height;
  const masks = useRef(new Map<string, HTMLCanvasElement>());
  const moins = useRef(new Map<string, HTMLCanvasElement>());
  const commits = useRef(new Map<string, number>());
  const dirtyMasks = useRef(new Set<string>());
  const undoStack = useRef<{ key: string; data: ImageData }[]>([]);
  const [tick, setTick] = useState(0);
  const [commitTick, setCommitTick] = useState(0);
  const [finished, setFinished] = useState<CanvasImageSource | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [assetTick, setAssetTick] = useState(0);
  const assets = useRef(new Map<string, ItemAsset | "loading" | "error">());
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [activeZoneId, setActiveZoneId] = useState<string | null>(scene.zones[0]?.id ?? null);
  const [tool, setTool] = useState<StageTool>("deplacer");
  const [brush, setBrush] = useState(22);
  const [tolerance, setTolerance] = useState(1);
  const [busy, setBusy] = useState<string | null>("Chargement de la photo…");
  const [panel, setPanel] = useState("murs");
  const [analysing, setAnalysing] = useState(false);
  /** Ouverture de la photo : point de départ de la mesure « premier aperçu ». */
  const debut = useRef(performance.now());
  const [optimOuvert, setOptimOuvert] = useState(false);
  const [exportOuvert, setExportOuvert] = useState(false);
  const [pinceau, setPinceau] = useState<Finish | null>(null);
  /** Surface sous la souris quand une teinte est choisie (aperçu avant le clic). */
  const [survol, setSurvol] = useState<string | null>(null);
  const [avantPart, setAvantPart] = useState<number | null>(null);
  const [selOuverte, setSelOuverte] = useState(false);
  const [presente, setPresente] = useState<{ avant: string | null; apres: string | null } | null>(null);
  const [tarifPro, setTarifPro] = useState(() => localStorageGet("studio-tarif") === "pro");
  const dirty = useRef(false);
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // ------------------------------------------------------------ enregistrement
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current && dirtyMasks.current.size === 0) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    onSaveState("saving");
    try {
      for (const key of [...dirtyMasks.current]) {
        dirtyMasks.current.delete(key);
        const m = masks.current.get(key);
        if (!m) continue;
        const path = await uploadBlob("masque", await canvasToBlob(m), "png");
        const s = sceneRef.current;
        sceneRef.current = key === "fg" ? { ...s, foreground: path } : { ...s, zones: s.zones.map((z) => (z.id === key ? { ...z, mask: path } : z)) };
      }
      setSceneState(sceneRef.current);
      dirty.current = false;
      const { error } = await localStore
        .from("variants")
        .update({ data: serializeScene(sceneRef.current), base_path: basePathRef.current, width: W, height: H })
        .eq("id", variant.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["variants", variant.project_id] });
      onSaveState(dirty.current || dirtyMasks.current.size ? "pending" : "ok");
    } catch (e) {
      dirty.current = true;
      onSaveState("error");
      toast.error("Enregistrement du projet impossible : " + (e instanceof Error ? e.message : ""));
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, [variant.id, variant.project_id, W, H, onSaveState, qc]);
  const basePathRef = useRef(basePath);
  basePathRef.current = basePath;

  const schedule = useCallback(() => {
    onSaveState("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1500);
  }, [flush, onSaveState]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush, flushRef]);
  useEffect(
    () => () => {
      void flushRef.current?.();
    },
    [flushRef],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || dirtyMasks.current.size) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [flush]);

  const undo = useRef(new UndoStack<string>(80));
  const lastRecord = useRef(0);
  const [, setUndoTick] = useState(0);
  /** Annuler / rétablir les articles, réglages et finitions (les tracés au pinceau ont leur propre « Annuler »). */
  const stepHistory = useCallback(
    (dir: "undo" | "redo") => {
      const cur = serializeScene(sceneRef.current);
      const next = dir === "undo" ? undo.current.undo(cur) : undo.current.redo(cur);
      if (next === null) return;
      lastRecord.current = 0;
      sceneRef.current = parseScene(next);
      setSceneState(sceneRef.current);
      setUndoTick((t) => t + 1);
      dirty.current = true;
      schedule();
    },
    [schedule],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) stepHistory("undo");
      else if (k === "y" || (k === "z" && e.shiftKey)) stepHistory("redo");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepHistory]);

  const setScene = useCallback(
    (fn: (s: Scene) => Scene) => {
      // Une étape d'annulation par geste : les changements rapprochés (glisser, curseur) sont regroupés.
      const now = Date.now();
      if (now - lastRecord.current > 600) undo.current.record(serializeScene(sceneRef.current));
      lastRecord.current = now;
      setUndoTick((t) => t + 1);
      sceneRef.current = fn(sceneRef.current);
      setSceneState(sceneRef.current);
      dirty.current = true;
      schedule();
    },
    [schedule],
  );

  // ------------------------------------------------------------ chargement
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const img = await loadImage(photoUrl(basePath));
        if (!alive) return;
        const w = img.naturalWidth, h = img.naturalHeight;
        for (const z of sceneRef.current.zones) {
          if (masks.current.has(z.id)) continue;
          masks.current.set(z.id, z.mask ? maskFromImage(await loadImage(photoUrl(z.mask)), w, h) : newCanvas(w, h));
        }
        if (!masks.current.has("fg"))
          masks.current.set("fg", sceneRef.current.foreground ? maskFromImage(await loadImage(photoUrl(sceneRef.current.foreground)), w, h) : newCanvas(w, h));
        if (!alive) return;
        setBaseImg(img);
        setCommitTick((t) => t + 1);
        // Première ouverture d'une photo : reconnaissance automatique de la pièce (une seule fois).
        if (!sceneRef.current.analyse && sceneRef.current.zones.length === 0) void runAnalyse(false, img);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Photo introuvable");
      } finally {
        if (alive) setBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [basePath]);

  const getMask = useCallback(
    (key: string) => {
      let m = masks.current.get(key);
      if (!m) {
        m = newCanvas(W, H);
        masks.current.set(key, m);
      }
      return m;
    },
    [W, H],
  );

  // ------------------------------------------------------------ finitions (fond fini)
  const finishKey = useMemo(
    () =>
      JSON.stringify([
        basePath,
        commitTick,
        scene.zones.map((z) => [z.id, z.finish, z.quad, z.repetitions, z.lumiere, z.visible, z.surface, z.aspect, commits.current.get(z.id) ?? 0]),
      ]),
    [scene.zones, basePath, commitTick],
  );
  useEffect(() => {
    if (!baseImg) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const zones = sceneRef.current.zones.filter((z) => z.finish && z.visible && masks.current.get(z.id) && maskBounds(masks.current.get(z.id)!, 16));
      if (!zones.length) {
        setFinished(baseImg);
        return;
      }
      setFinishing(true);
      try {
        // Aperçu réduit (1400 px au plus) : un clic de peinture s'affiche en quelques secondes
        // même sur une photo de 12 Mpx ; la pleine résolution est calculée pour l'export.
        const img = await renderFinishedApercu(baseImg, zones, (z) => masks.current.get(z.id) ?? null, W, H, APERCU_MAX, ctrl.signal);
        if (!ctrl.signal.aborted) setFinished(img);
      } catch (e) {
        if (!ctrl.signal.aborted) toast.error(e instanceof Error ? e.message : "Finition impossible");
      } finally {
        if (!ctrl.signal.aborted) setFinishing(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishKey, baseImg]);

  // ------------------------------------------------------------ articles
  const assetFor = useCallback(
    (item: Item) => {
      const path = itemImagePath(item, products, photos);
      if (!path) return undefined;
      const a = assets.current.get(path);
      if (a === undefined) {
        assets.current.set(path, "loading");
        loadAsset(path)
          .then((x) => assets.current.set(path, x))
          .catch(() => assets.current.set(path, "error"))
          .finally(() => setAssetTick((t) => t + 1));
        return undefined;
      }
      return typeof a === "string" ? undefined : a;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, photos, assetTick],
  );

  const updateItem = useCallback((uid: string, patch: Partial<Item>) => setScene((s) => ({ ...s, items: s.items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)) })), [setScene]);

  // ------------------------------------------------------------ pinceaux et clics
  const maskKeyForTool = (t: StageTool) => (t.startsWith("pp-") ? "fg" : t === "retouche" ? "retouche" : activeZoneId);

  function pushUndo(key: string) {
    const m = getMask(key);
    undoStack.current.push({ key, data: m.getContext("2d")!.getImageData(0, 0, m.width, m.height) });
    if (undoStack.current.length > 12) undoStack.current.shift();
  }
  const strokeStarted = useRef(false);
  function onStroke(from: Point, to: Point, radius: number) {
    const key = maskKeyForTool(tool);
    if (!key) {
      toast.info("Créez d'abord un mur dans l'onglet Murs");
      return;
    }
    if (!strokeStarted.current) {
      pushUndo(key);
      strokeStarted.current = true;
    }
    const erase = tool === "mur-moins" || tool === "pp-moins";
    strokeMask(getMask(key), from, to, radius, erase, 0.9);
    if (tool === "mur-moins") {
      // « Pas le mur » : mémorisé pour que les clics magiques suivants le respectent.
      let n = moins.current.get(key);
      if (!n) moins.current.set(key, (n = newCanvas(W, H)));
      strokeMask(n, from, to, radius, false, 1);
    }
    setTick((t) => t + 1);
  }
  function onStrokeEnd() {
    strokeStarted.current = false;
    const key = maskKeyForTool(tool);
    if (!key || key === "retouche") return;
    commits.current.set(key, (commits.current.get(key) ?? 0) + 1);
    dirtyMasks.current.add(key);
    setCommitTick((t) => t + 1);
    schedule();
  }

  /** Surface de la photo sous le point cliqué : la plus « petite » d'abord (une porte
   *  avant le mur qui l'entoure). */
  function surfaceSous(p: Point): Zone | null {
    const ordre: Surface[] = ["plinthe", "cadre", "porte", "autre", "mur", "plafond", "sol"];
    let meilleure: Zone | null = null;
    for (const z of sceneRef.current.zones) {
      const m = masks.current.get(z.id);
      if (!m || !z.visible) continue;
      const a = m.getContext("2d", { willReadFrequently: true })!.getImageData(Math.round(p[0]), Math.round(p[1]), 1, 1).data[3]!;
      if (a < 128) continue;
      if (!meilleure || ordre.indexOf(z.surface) < ordre.indexOf(meilleure.surface)) meilleure = z;
    }
    return meilleure;
  }

  /** Sélection à la baguette autour d'un point, ajoutée au masque « key ». */
  async function selectionAuPoint(p: Point, key: string) {
    const plus = newCanvas(W, H);
    const pc = plus.getContext("2d")!;
    pc.fillStyle = "#fff";
    pc.beginPath();
    pc.arc(p[0], p[1], Math.max(4, Math.max(W, H) / 250), 0, Math.PI * 2);
    pc.fill();
    const fields: Record<string, unknown> = { image: await pathToDataUrl(basePathRef.current), mode: "select", plus: await canvasToDataUrl(plus), tolerance };
    const n = moins.current.get(key);
    if (n) fields["moins"] = await canvasToDataUrl(n);
    const res = await loadImage(URL.createObjectURL(await photoEngine(fields)));
    pushUndo(key);
    getMask(key).getContext("2d")!.drawImage(maskFromImage(res, W, H, true), 0, 0);
    commits.current.set(key, (commits.current.get(key) ?? 0) + 1);
    dirtyMasks.current.add(key);
    setCommitTick((t) => t + 1);
    schedule();
  }

  async function onClickImage(p: Point) {
    if (tool === "deplacer") {
      // Clic hors des articles : la surface sous le pointeur s'ouvre dans le panneau.
      const z = p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H ? surfaceSous(p) : null;
      setActiveZoneId(z?.id ?? null);
      if (z) setPanel("murs");
      return;
    }
    if (tool === "peindre" && pinceau) {
      const zone = surfaceSous(p);
      if (zone) {
        api.applyFinishTo(pinceau, [zone.id]);
        setActiveZoneId(zone.id);
        setTool("peindre");
        return;
      }
      // Surface non reconnue : sélection à la baguette au point cliqué, puis peinture.
      setBusy("Sélection de la surface…");
      try {
        const id = crypto.randomUUID();
        const surface: Surface = pinceau.usage && pinceau.usage !== "autre" ? pinceau.usage : "mur";
        masks.current.set(id, newCanvas(W, H));
        await selectionAuPoint(p, id);
        const n = sceneRef.current.zones.filter((z) => z.surface === surface).length + 1;
        const zone: Zone = { id, name: `${surfaceLabel(surface).split(" ")[0]} ${n}`, mask: null, finish: null, quad: null, repetitions: 4, lumiere: 1, visible: true, surface, aspect: null, auto: false, m2: null, rotation: 0 };
        setScene((s) => ({ ...s, zones: [...s.zones, { ...zone, ...patchFinition(zone, pinceau) }] }));
        setActiveZoneId(id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sélection impossible");
      } finally {
        setBusy(null);
      }
      return;
    }
    if (tool === "mur-clic" || tool === "pp-clic") {
      const key = tool === "pp-clic" ? "fg" : activeZoneId;
      if (!key) {
        toast.info("Créez d'abord un mur dans l'onglet Murs");
        return;
      }
      setBusy(tool === "pp-clic" ? "Sélection de l'élément…" : "Sélection du mur…");
      try {
        const plus = newCanvas(W, H);
        const pc = plus.getContext("2d")!;
        pc.fillStyle = "#fff";
        pc.beginPath();
        pc.arc(p[0], p[1], Math.max(4, Math.max(W, H) / 250), 0, Math.PI * 2);
        pc.fill();
        const fields: Record<string, unknown> = {
          image: await pathToDataUrl(basePathRef.current),
          mode: "select",
          plus: await canvasToDataUrl(plus),
          tolerance,
        };
        const n = moins.current.get(key);
        if (n) fields["moins"] = await canvasToDataUrl(n);
        const res = await loadImage(URL.createObjectURL(await photoEngine(fields)));
        pushUndo(key);
        const sel = maskFromImage(res, W, H, true);
        getMask(key).getContext("2d")!.drawImage(sel, 0, 0); // ajout à la sélection
        commits.current.set(key, (commits.current.get(key) ?? 0) + 1);
        dirtyMasks.current.add(key);
        setCommitTick((t) => t + 1);
        schedule();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sélection impossible");
      } finally {
        setBusy(null);
      }
    } else if (tool === "pipette") {
      // Teinte prise sur la photo d'origine (coussin, tissu, échantillon tenu devant l'objectif).
      const c = baseCanvas();
      const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H);
      const hex = sampleColor({ data: d.data, width: W, height: H }, p[0], p[1], Math.max(2, Math.round(Math.max(W, H) / 600)));
      setTool("deplacer");
      if (!hex) return;
      const couleur: Finish = {
        id: "", kind: "peinture", name: `Couleur prélevée ${hex}`, reference: null, color: hex, texture_path: null, motif_cm: null,
        finition: null, marque: null, gamme: null, usage: null, created_at: "", updated_at: "",
      };
      const cible = sceneRef.current.zones.find((z) => z.id === activeZoneId);
      if (cible) {
        api.applyFinishTo(couleur, [cible.id]);
        toast.success(`Couleur ${hex} posée sur « ${cible.name} » — « Enregistrer cette couleur » lui donne une référence`);
      } else {
        api.choisirPinceau(couleur);
        toast.success(`Couleur ${hex} prise : cliquez sur la surface à peindre`);
      }
    } else if (tool === "poser" && selectedUid) {
      // La base de l'article (pieds, socle) vient se poser exactement sur le point cliqué.
      updateItem(selectedUid, { x: p[0] / W, y: p[1] / H });
      setTool("deplacer");
    }
  }

  const baseCanvasCache = useRef<{ img: HTMLImageElement; c: HTMLCanvasElement } | null>(null);
  function baseCanvas() {
    if (baseCanvasCache.current?.img !== baseImg) {
      const c = newCanvas(W, H);
      c.getContext("2d")!.drawImage(baseImg!, 0, 0);
      baseCanvasCache.current = { img: baseImg!, c };
    }
    return baseCanvasCache.current!.c;
  }

  // ------------------------------------------------------------ affichage
  const background = finished ?? baseImg;
  const fgMask = masks.current.get("fg");
  const foreground = useMemo(
    () => (background && fgMask && maskBounds(fgMask, 16) ? cutByMask(background, fgMask) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [background, commitTick, tool.startsWith("pp-") ? tick : 0],
  );
  const overlayKey = BRUSH_TOOLS.includes(tool) || tool === "mur-clic" || tool === "pp-clic" || tool === "coins" ? maskKeyForTool(tool) : null;
  const overlayCanvas = useRef<HTMLCanvasElement | null>(null);
  const overlay = useMemo(() => {
    if (!overlayKey) return null;
    const m = masks.current.get(overlayKey);
    if (!m) return null;
    overlayCanvas.current = tinted(m, overlayKey === "fg" ? "#e07a2f" : overlayKey === "retouche" ? "#d23c28" : "#2f8f83", overlayCanvas.current?.width === m.width ? overlayCanvas.current : undefined);
    return overlayCanvas.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, tick, commitTick]);

  const survolCanvas = useRef<HTMLCanvasElement | null>(null);
  const apercuSurvol = useMemo(() => {
    if (tool !== "peindre" || !pinceau || !survol || overlayKey) return null;
    const m = masks.current.get(survol);
    if (!m) return null;
    // Couleur choisie posée en transparence : on voit ce qui va être peint avant de cliquer.
    survolCanvas.current = tinted(m, pinceau.color ?? "#ffffff", survolCanvas.current?.width === m.width ? survolCanvas.current : undefined);
    return survolCanvas.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, pinceau, survol, overlayKey, commitTick]);
  const zoneSurvolee = survol ? scene.zones.find((z) => z.id === survol) ?? null : null;
  const contourCanvas = useRef<HTMLCanvasElement | null>(null);
  const contour = useMemo(() => {
    if (!(tool === "deplacer" || tool === "pipette") || !baseImg) return null;
    // la surface ouverte n'est cernée que dans l'onglet Surfaces (pas par-dessus les objets)
    const ids = [survol, panel === "murs" ? activeZoneId : null].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
    if (!ids.length) return null;
    const c = contourCanvas.current && contourCanvas.current.width === W ? contourCanvas.current : newCanvas(W, H);
    contourCanvas.current = c;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const e = Math.max(2, Math.round(Math.max(W, H) / 450));
    for (const id of ids) {
      const m = masks.current.get(id);
      if (!m) continue;
      const tmp = newCanvas(W, H);
      const t = tmp.getContext("2d")!;
      // anneau = sélection décalée dans 8 directions, moins la sélection elle-même
      for (const [dx, dy] of [[e, 0], [-e, 0], [0, e], [0, -e], [e, e], [-e, -e], [e, -e], [-e, e]]) t.drawImage(m, dx!, dy!);
      t.globalCompositeOperation = "destination-out";
      t.drawImage(m, 0, 0);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = id === activeZoneId ? "#c0694a" : "#ffffff";
      t.fillRect(0, 0, W, H);
      if (id === survol && id !== activeZoneId) {
        // voile léger sur la surface survolée
        ctx.globalAlpha = 0.18;
        ctx.drawImage(tinted(m, "#ffffff"), 0, 0);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(tmp, 0, 0);
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survol, activeZoneId, panel, tool, commitTick, baseImg, W, H]);

  const activeZone = scene.zones.find((z) => z.id === activeZoneId) ?? null;
  const selected = scene.items.find((i) => i.uid === selectedUid) ?? null;

  /** Finition posée sur une surface : instantané de la fiche, perspective de départ
   *  (rectangle du mur, trapèze pour un sol) et taille de motif adaptée à la surface. */
  function patchFinition(z: Zone, f: Finish): Partial<Zone> {
    const m = masks.current.get(z.id);
    const b = m ? maskBounds(m) : null;
    const boite = b ? { x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H } : null;
    const quad = z.quad ?? (f.kind !== "peinture" && boite ? (z.surface === "sol" ? floorQuad(boite) : defaultQuad(boite)) : null);
    const changeKind = z.finish?.kind !== f.kind;
    // Papier peint : environ un lé de 53 cm pour 1/9 de la largeur de l'image, borné.
    const largeur = boite ? boite.x1 - boite.x0 : 0.5;
    const reps = f.kind === "enduit" ? 1.5 : z.surface === "sol" ? 7 : Math.min(12, Math.max(2, Math.round(largeur * 9 * 2) / 2));
    return { finish: snapshotDe(f), aspect: null, quad, ...(changeKind ? { repetitions: reps } : {}) };
  }

  /** Reconnaissance de la pièce par l'IA locale : crée une surface par pan de mur, le
   *  plafond, le sol et les portes. Les masques deviennent des surfaces ordinaires :
   *  changer de finition ensuite ne relance jamais l'analyse. */
  async function runAnalyse(force: boolean, img?: HTMLImageElement) {
    if (analysing) return;
    const w = img?.naturalWidth ?? W, h = img?.naturalHeight ?? H;
    setAnalysing(true);
    if (force) debut.current = performance.now();
    try {
      const r = await photoJson<{ zones: { nom: string; surface: Surface; masque: string }[]; temps: Record<string, number> }>({
        image: await pathToDataUrl(basePathRef.current),
        mode: "analyse",
      });
      const nouvelles: Zone[] = [];
      // Relancer garde l'habillage déjà choisi : une surface du même nom reprend sa finition.
      const avant = new Map(sceneRef.current.zones.filter((z) => z.auto).map((z) => [`${z.surface}|${z.name}`, z]));
      for (const z of r.zones) {
        const id = crypto.randomUUID();
        masks.current.set(id, maskFromImage(await loadImage(z.masque), w, h, true));
        commits.current.set(id, 1);
        dirtyMasks.current.add(id);
        const a = force ? avant.get(`${z.surface}|${z.nom}`) : undefined;
        nouvelles.push({
          id, name: z.nom, mask: null, finish: a?.finish ?? null, quad: a?.quad ?? null, repetitions: a?.repetitions ?? 4, lumiere: a?.lumiere ?? 1,
          visible: true, surface: z.surface, aspect: a?.aspect ?? null, auto: true, m2: a?.m2 ?? null, rotation: a?.rotation ?? 0,
        });
      }
      setScene((s) => ({
        ...s,
        // les surfaces ajoutées à la main sont conservées
        zones: force ? [...nouvelles, ...s.zones.filter((z) => !z.auto)] : [...s.zones, ...nouvelles],
        analyse: { temps: r.temps, apercu: null, date: new Date().toISOString() },
      }));
      setActiveZoneId(nouvelles[0]?.id ?? null);
      setCommitTick((t) => t + 1);
      if (!nouvelles.length) toast.info("Aucun mur reconnu sur cette image : sélectionnez les surfaces à la baguette");
      await flush();
    } catch (e) {
      toast.error("Analyse de la pièce impossible : " + (e instanceof Error ? e.message : ""));
      setScene((s) => ({ ...s, analyse: { temps: {}, apercu: null, date: new Date().toISOString() } }));
    } finally {
      setAnalysing(false);
    }
  }


  // ------------------------------------------------------------ API des panneaux
  const api: WorkspaceApi = {
    scene,
    W,
    H,
    products,
    photos,
    finishes,
    tool,
    setTool,
    brush,
    setBrush,
    busy,
    activeZone,
    setActiveZone: setActiveZoneId,
    addZone: (surface = "mur") => {
      const id = crypto.randomUUID();
      masks.current.set(id, newCanvas(W, H));
      setScene((s) => {
        const n = s.zones.filter((z) => z.surface === surface).length + 1;
        const zone: Zone = { id, name: `${surfaceLabel(surface).split(" ")[0]} ${n}`, mask: null, finish: null, quad: null, repetitions: 4, lumiere: 1, visible: true, surface, aspect: null, auto: false, m2: null, rotation: 0 };
        return { ...s, zones: [...s.zones, zone] };
      });
      setActiveZoneId(id);
      setTool("mur-clic");
    },
    updateZone: (id, patch) => setScene((s) => ({ ...s, zones: s.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) })),
    removeZone: (id) => {
      setScene((s) => ({ ...s, zones: s.zones.filter((z) => z.id !== id) }));
      masks.current.delete(id);
      if (activeZoneId === id) setActiveZoneId(null);
    },
    applyFinish: (f) => {
      if (!activeZone) {
        toast.info("Sélectionnez d'abord un mur");
        return;
      }
      if (!masks.current.get(activeZone.id) || !maskBounds(masks.current.get(activeZone.id)!))
        toast.info("Le mur n'est pas encore sélectionné : cliquez dessus avec la baguette");
      api.applyFinishTo(f, [activeZone.id]);
    },
    applyFinishTo: (f, ids) => {
      setScene((s) => ({ ...s, zones: s.zones.map((z) => (ids.includes(z.id) ? { ...z, ...patchFinition(z, f) } : z)) }));
      // On quitte la sélection pour voir le rendu sans la surbrillance verte.
      if (tool === "mur-clic" || tool === "mur-plus" || tool === "mur-moins") setTool("deplacer");
    },
    setSurvol,
    choisirSurface: (id) => {
      setActiveZoneId(id);
      setSelectedUid(null);
      if (tool !== "deplacer" && tool !== "coins") setTool("deplacer");
    },
    nouvelleSurface: () => {
      api.addZone("mur");
      toast.info("Cliquez sur la surface à ajouter (mur, meuble à repeindre…) ; changez son type dans le panneau");
    },
    addItemPhoto: (productId, photoId) => {
      const p = products.find((x) => x.id === productId);
      if (!p) return;
      api.addItem(p);
      const uid = sceneRef.current.items.at(-1)?.uid;
      if (uid) updateItem(uid, { photoId });
    },
    pinceau,
    choisirPinceau: (f) => {
      setPinceau(f);
      setTool(f ? "peindre" : "deplacer");
    },
    analyse: scene.analyse,
    analysing,
    reanalyse: () => void runAnalyse(true),
    splitFrame: async (epaisseur) => {
      const zone = activeZone;
      if (!zone) return;
      const m = masks.current.get(zone.id);
      if (!m || !maskBounds(m)) {
        toast.info("Sélectionnez d'abord la porte avec son cadre");
        return;
      }
      setBusy("Séparation du cadre…");
      try {
        const image = await pathToDataUrl(basePathRef.current);
        const mask = await canvasToDataUrl(m);
        const part = async (partie: "cadre" | "porte") =>
          maskFromImage(await loadImage(URL.createObjectURL(await photoEngine({ image, mode: "cadre", mask, epaisseur, partie }))), W, H, true);
        const [cadre, feuille] = [await part("cadre"), await part("porte")];
        pushUndo(zone.id);
        const ctx = m.getContext("2d")!;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(feuille, 0, 0);
        const id = crypto.randomUUID();
        const cm = newCanvas(W, H);
        cm.getContext("2d")!.drawImage(cadre, 0, 0);
        masks.current.set(id, cm);
        for (const k of [zone.id, id]) {
          commits.current.set(k, (commits.current.get(k) ?? 0) + 1);
          dirtyMasks.current.add(k);
        }
        setScene((s) => ({
          ...s,
          zones: [
            ...s.zones.map((z) => (z.id === zone.id ? { ...z, surface: "porte" as const } : z)),
            { id, name: `Cadre de ${zone.name}`, mask: null, finish: null, quad: null, repetitions: 4, lumiere: zone.lumiere, visible: true, surface: "cadre", aspect: null, auto: false, m2: null, rotation: 0 },
          ],
        }));
        setActiveZoneId(id);
        setCommitTick((t) => t + 1);
        schedule();
        toast.success("Cadre séparé : choisissez sa teinte (la porte garde la sienne)");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Séparation impossible");
      } finally {
        setBusy(null);
      }
    },
    refineZone: async () => {
      const key = activeZoneId;
      if (!key) return;
      setBusy("Affinage des bords…");
      try {
        const blob = await photoEngine({ image: await pathToDataUrl(basePathRef.current), mode: "affiner", mask: await canvasToDataUrl(getMask(key)) });
        pushUndo(key);
        const res = maskFromImage(await loadImage(URL.createObjectURL(blob)), W, H, true);
        const ctx = getMask(key).getContext("2d")!;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(res, 0, 0);
        commits.current.set(key, (commits.current.get(key) ?? 0) + 1);
        dirtyMasks.current.add(key);
        setCommitTick((t) => t + 1);
        schedule();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Affinage impossible");
      } finally {
        setBusy(null);
      }
    },
    clearMask: (key) => {
      pushUndo(key);
      getMask(key).getContext("2d")!.clearRect(0, 0, W, H);
      moins.current.delete(key);
      commits.current.set(key, (commits.current.get(key) ?? 0) + 1);
      if (key !== "retouche") dirtyMasks.current.add(key);
      setCommitTick((t) => t + 1);
      schedule();
    },
    undoMask: () => {
      const u = undoStack.current.pop();
      if (!u) return;
      getMask(u.key).getContext("2d")!.putImageData(u.data, 0, 0);
      commits.current.set(u.key, (commits.current.get(u.key) ?? 0) + 1);
      if (u.key !== "retouche") dirtyMasks.current.add(u.key);
      setCommitTick((t) => t + 1);
      schedule();
    },
    tolerance,
    setTolerance,
    finishing,
    selected,
    setSelected: setSelectedUid,
    addItem: (p) => {
      const uid = crypto.randomUUID();
      setScene((s) => ({
        ...s,
        items: [
          ...s.items,
          { uid, productId: p.id, photoId: null, x: 0.5, y: 0.86, h: kindHeight[p.category] ?? 0.25, flip: false, rot: 0, shadow: { opacity: 0.45, blur: 0.5, size: 1 }, behind: false, light: { bright: 1, warm: 0 } },
        ],
      }));
      setSelectedUid(uid);
      // Choisir l'article puis cliquer sur la photo : sa base se pose au point cliqué.
      setTool("poser");
    },
    updateItem,
    removeItem: (uid) => {
      setScene((s) => ({ ...s, items: s.items.filter((i) => i.uid !== uid) }));
      setSelectedUid(null);
    },
    duplicateItem: (uid) => {
      const it = sceneRef.current.items.find((i) => i.uid === uid);
      if (!it) return;
      const n = { ...it, uid: crypto.randomUUID(), x: Math.min(1, it.x + 0.06) };
      setScene((s) => ({ ...s, items: [...s.items, n] }));
      setSelectedUid(n.uid);
    },
    moveItem: (uid, dir) =>
      setScene((s) => {
        const i = s.items.findIndex((x) => x.uid === uid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.items.length) return s;
        const items = [...s.items];
        [items[i], items[j]] = [items[j]!, items[i]!];
        return { ...s, items };
      }),
    assetFor,
    accordItem: (uid) => {
      // Lumière de la pièce autour de la base de l'article, comparée à celle de sa photo.
      const it = sceneRef.current.items.find((i) => i.uid === uid);
      const a = it ? assetFor(it) : undefined;
      if (!it || !a || !background) return;
      const b = itemBox(it, a.aspect, W, H);
      const x0 = Math.max(0, b.x - b.w * 0.3), y0 = Math.max(0, b.y - b.h * 0.1);
      const x1 = Math.min(W, b.x + b.w * 1.3), y1 = Math.min(H, b.y + b.h * 1.15);
      const s = Math.min(1, 160 / Math.max(x1 - x0, y1 - y0, 1));
      const rw = Math.max(1, Math.round((x1 - x0) * s)), rh = Math.max(1, Math.round((y1 - y0) * s));
      const room = newCanvas(rw, rh).getContext("2d", { willReadFrequently: true })!;
      room.drawImage(background, x0, y0, x1 - x0, y1 - y0, 0, 0, rw, rh);
      // On exclut l'emprise de l'article lui-même : seule compte la pièce autour.
      const ix0 = (b.x - x0) * s, ix1 = (b.x + b.w - x0) * s, iy0 = (b.y - y0) * s, iy1 = (b.y + b.h - y0) * s;
      const local = lumStats(room.getImageData(0, 0, rw, rh).data, (p) => {
        const px = p % rw, py = (p / rw) | 0;
        return px < ix0 || px > ix1 || py < iy0 || py > iy1;
      });
      const pw = Math.max(1, Math.round(a.sw * Math.min(1, 160 / Math.max(a.sw, a.sh))));
      const ph = Math.max(1, Math.round(a.sh * Math.min(1, 160 / Math.max(a.sw, a.sh))));
      const prod = newCanvas(pw, ph).getContext("2d", { willReadFrequently: true })!;
      prod.drawImage(a.img, a.sx, a.sy, a.sw, a.sh, 0, 0, pw, ph);
      const own = lumStats(prod.getImageData(0, 0, pw, ph).data);
      if (!local || !own) return;
      updateItem(uid, { light: accordLight(local, own) });
      toast.success("Lumière de l'article accordée à la pièce");
    },
    setCast: (patch) => setScene((s) => ({ ...s, cast: { ...s.cast, ...patch } })),
    basePath,
    retouch: async (mode, extra = {}) => {
      const m = masks.current.get("retouche");
      if (!m || !maskBounds(m, 16)) {
        toast.info("Peignez d'abord la zone au pinceau");
        return;
      }
      setBusy(mode === "erase" ? "Effacement en cours…" : "Changement de décor…");
      try {
        // Convention du moteur : masque transparent là où l'on a peint.
        const inv = newCanvas(W, H);
        const ic = inv.getContext("2d")!;
        ic.fillStyle = "#000";
        ic.fillRect(0, 0, W, H);
        ic.globalCompositeOperation = "destination-out";
        ic.drawImage(m, 0, 0);
        const blob = await photoEngine({ image: await pathToDataUrl(basePathRef.current), mode, mask: await canvasToDataUrl(inv), ...extra });
        const out = await loadImage(URL.createObjectURL(blob));
        const c = newCanvas(W, H);
        c.getContext("2d")!.drawImage(out, 0, 0, W, H);
        const path = await uploadBlob("base", await canvasToBlob(c, "image/jpeg", 0.93), "jpg");
        m.getContext("2d")!.clearRect(0, 0, W, H);
        // Le premier plan doit être enregistré avant d'être mémorisé dans l'historique.
        await flush();
        setScene((s) => pushHistory(s, basePathRef.current));
        if (mode === "decor") {
          // Les murs et le premier plan détourés sur l'ancienne photo n'existent plus :
          // on masque les surfaces et on vide le premier plan (« Annuler » les rétablit).
          const hidden = sceneRef.current.zones.some((z) => z.visible && z.finish);
          setScene((s) => ({ ...s, foreground: null, zones: s.zones.map((z) => ({ ...z, visible: false })) }));
          getMask("fg").getContext("2d")!.clearRect(0, 0, W, H);
          commits.current.set("fg", (commits.current.get("fg") ?? 0) + 1);
          setCommitTick((t) => t + 1);
          toast.success(hidden ? "Décor remplacé — les finitions des anciens murs sont masquées (onglet Murs)" : "Décor remplacé");
        } else {
          toast.success("Objet effacé");
        }
        setBasePath(path);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Retouche impossible");
      } finally {
        setBusy(null);
      }
    },
    restoreOriginal: () => {
      // Revenir à l'image importée = annuler toutes les étapes d'un coup.
      let s = sceneRef.current;
      let base: string | null = null;
      for (let u = popHistory(s); u; u = popHistory(s)) {
        s = u.scene;
        base = u.base;
      }
      if (base) void restoreStep(s, base);
    },
    undoRetouch: () => {
      const u = popHistory(sceneRef.current);
      if (u) void restoreStep(u.scene, u.base);
    },
    replaceBase: async (file) => {
      setBusy("Import de la photo…");
      try {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        if (Math.abs(img.naturalWidth / img.naturalHeight - W / H) > 0.01)
          throw new Error("La nouvelle image doit avoir le même format que l'actuelle (sinon créez un nouveau projet)");
        const c = newCanvas(W, H);
        c.getContext("2d")!.drawImage(img, 0, 0, W, H);
        const path = await uploadBlob("base", await canvasToBlob(c, "image/jpeg", 0.93), "jpg");
        await flush();
        setScene((s) => pushHistory(s, basePathRef.current));
        setBasePath(path);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import impossible");
      } finally {
        setBusy(null);
      }
    },
  };

  /** Rétablit une étape de l'historique : photo, surfaces visibles et premier plan. */
  async function restoreStep(s: Scene, base: string) {
    setScene(() => s);
    const fg = getMask("fg");
    const ctx = fg.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    if (s.foreground) {
      try {
        ctx.drawImage(await loadImage(photoUrl(s.foreground)), 0, 0, W, H);
      } catch {
        toast.error("Premier plan de cette étape introuvable");
      }
    }
    dirtyMasks.current.delete("fg");
    commits.current.set("fg", (commits.current.get("fg") ?? 0) + 1);
    setCommitTick((t) => t + 1);
    setBasePath(base);
    toast.success(s.baseHistory.length ? "Retouche annulée" : "Image importée rétablie");
  }

  // Changer de photo de base (gomme, décor) doit être enregistré.
  const firstBase = useRef(true);
  useEffect(() => {
    if (firstBase.current) {
      firstBase.current = false;
      return;
    }
    dirty.current = true;
    schedule();
  }, [basePath, schedule]);

  const overlayLabel =
    busy ??
    (finishing
      ? "Application des finitions…"
      : tool === "peindre" && pinceau
        ? zoneSurvolee
          ? `Cliquez pour peindre « ${zoneSurvolee.name} » en ${pinceau.name}`
          : `Cliquez sur un mur, le plafond, le sol ou une porte : « ${pinceau.name} »`
        : tool === "mur-clic"
        ? "Cliquez sur le mur à sélectionner"
        : tool === "mur-plus"
          ? "Peignez pour ajouter au mur"
          : tool === "mur-moins"
            ? "Peignez ce qui n'est pas le mur (fenêtre, plinthe, meuble)"
            : tool === "coins"
              ? "Faites glisser les 4 coins sur les angles du mur"
              : tool === "pp-clic"
                ? "Cliquez sur le meuble existant qui doit passer devant"
                : tool === "pp-plus" || tool === "pp-moins"
                  ? "Peignez le premier plan (en orange)"
                  : tool === "retouche"
                    ? "Peignez la zone à retoucher"
                    : tool === "pipette"
                      ? "Cliquez sur la couleur à prélever (coussin, tissu, échantillon…)"
                      : tool === "poser"
                      ? "Cliquez où poser la base de l'article (sol, plateau de la console…)"
                      : undefined);

  /** Calques envoyés à l'optimisation : le montage tel qu'affiché, la silhouette des
   *  articles ajoutés et leurs ombres (le premier plan existant les masque). */
  async function calquesOptimisation() {
    if (!baseImg) throw new Error("Photo non chargée");
    // Fond en pleine résolution pour l'export (l'écran montre un aperçu réduit).
    const zonesFinies = sceneRef.current.zones.filter((z) => z.finish && z.visible && masks.current.get(z.id) && maskBounds(masks.current.get(z.id)!, 16));
    const bg: CanvasImageSource = zonesFinies.length
      ? await renderFinished(basePathRef.current, await finishPayload(zonesFinies, (z) => masks.current.get(z.id) ?? null, W, H))
      : baseImg;
    const dessin = (fond: CanvasImageSource | null, opts: { noShadows?: boolean; foregroundErase?: boolean }) => {
      const c = newCanvas(W, H);
      drawComposition(c.getContext("2d")!, {
        W, H, background: fond ?? newCanvas(W, H), items: scene.items, asset: assetFor, foreground, cast: scene.cast, ...opts,
      });
      return c;
    };
    return {
      montage: dessin(bg, {}),
      articles: dessin(null, { noShadows: true, foregroundErase: true }),
      ombres: dessin(null, { foregroundErase: true }),
    };
  }
  const selection = maSelection(scene, products, finishes, { pro: tarifPro, discount });
  const nbSel = selection.finitions.length + selection.objets.reduce((n, o) => n + o.quantite, 0);
  async function presenter() {
    setSelOuverte(false);
    setPresente({ avant: null, apres: null });
    try {
      await flush();
      const c = await calquesOptimisation();
      const opt = scene.optimise && scene.optimise.cle === compositionKey(scene, basePath) ? photoUrl(scene.optimise.image) : null;
      const apres = opt ?? (await canvasToDataUrl(c.montage, "image/jpeg", 0.92));
      const b = newCanvas(W, H);
      b.getContext("2d")!.drawImage(baseImg!, 0, 0, W, H);
      setPresente({ avant: await canvasToDataUrl(b, "image/jpeg", 0.9), apres });
    } catch (e) {
      setPresente(null);
      toast.error(e instanceof Error ? e.message : "Présentation impossible");
    }
  }
  // Rendu photo réaliste par IA locale (module optionnel runtime\ia-rendu).
  const [iaDispo, setIaDispo] = useState(false);
  const [iaEtat, setIaEtat] = useState<{ progression: number; message: string } | null>(null);
  const iaTache = useRef<string | null>(null);
  useEffect(() => {
    fetch("/api/rendu-ia")
      .then((r) => r.json())
      .then((b) => setIaDispo(!!b?.data?.disponible))
      .catch(() => setIaDispo(false));
    return () => {
      const id = iaTache.current;
      iaTache.current = null;
      if (id) void fetch(`/api/rendu-ia/${id}/annuler`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    };
  }, []);
  /** Niveaux de gris (blanc = sélection) à partir de calques dont l'alpha est la sélection. */
  function enGris(calques: HTMLCanvasElement[]) {
    const c = newCanvas(W, H);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    for (const m of calques) {
      const t = newCanvas(W, H);
      const tc = t.getContext("2d")!;
      tc.drawImage(m, 0, 0, W, H);
      tc.globalCompositeOperation = "source-in";
      tc.fillStyle = "#fff";
      tc.fillRect(0, 0, W, H);
      ctx.drawImage(t, 0, 0);
    }
    return c;
  }
  async function lancerRenduIa() {
    setIaEtat({ progression: 0, message: "Préparation des calques…" });
    try {
      await flush();
      const cle = compositionKey(scene, basePathRef.current);
      const c = await calquesOptimisation();
      const finies = scene.zones.filter((z) => z.finish && z.visible && masks.current.get(z.id));
      const res = await fetch("/api/rendu-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          montage: await canvasToDataUrl(c.montage, "image/jpeg", 0.93),
          zones: await canvasToDataUrl(enGris(finies.map((z) => masks.current.get(z.id)!)), "image/png"),
          objets: scene.items.length ? await canvasToDataUrl(enGris([c.articles]), "image/png") : null,
          surfaces: finies.map((z) => ({ surface: z.surface, kind: z.finish!.kind, nom: z.finish!.name })),
          // Première version reproductible ; « Refaire » en propose une autre.
          graine: scene.renduIa ? 1 + Math.floor(Math.random() * 1e6) : 7,
        }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.data?.id) throw new Error(b?.error?.message ?? "Rendu réaliste impossible");
      const id: string = b.data.id;
      iaTache.current = id;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (iaTache.current !== id) return;
        const e = await (await fetch(`/api/rendu-ia/${id}`)).json().catch(() => null);
        const d = e?.data;
        if (!d) throw new Error(e?.error?.message ?? "Rendu réaliste interrompu");
        if (d.erreur) throw new Error(d.erreur);
        setIaEtat({ progression: d.progression ?? 0, message: d.message ?? "" });
        if (d.image) {
          setScene((s) => ({ ...s, renduIa: { image: d.image, cle, duree: d.duree ?? 0 } }));
          toast.success(`Photo réaliste prête${d.duree ? ` (${Math.round(d.duree)} s)` : ""} : elle sert à la présentation et au PDF`);
          return;
        }
        if (d.termine) throw new Error("Rendu réaliste interrompu");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rendu réaliste impossible");
    } finally {
      iaTache.current = null;
      setIaEtat(null);
    }
  }
  function annulerRenduIa() {
    const id = iaTache.current;
    iaTache.current = null;
    setIaEtat(null);
    if (id) void fetch(`/api/rendu-ia/${id}/annuler`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  }
  async function telechargerPdf(visuel?: string) {
    const image = visuel ?? presente?.apres;
    if (!presente || !image) return;
    const enJpeg = async (src: string) => {
      if (src.startsWith("data:")) return src;
      const img = await loadImage(src);
      const c = newCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext("2d")!.drawImage(img, 0, 0);
      return canvasToDataUrl(c, "image/jpeg", 0.92);
    };
    const sel = selection;
    const titre = projet?.nom ?? variant.name;
    const res = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fichier: `${titre} - ${variant.name}`,
        titre,
        client: projet?.client ?? null,
        variante: variant.name,
        date: new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date()),
        avant: presente.avant,
        apres: await enJpeg(image),
        selection: {
          ...sel,
          finitions: sel.finitions.map((f) => ({ ...f, zones: f.zones.map((z) => z.nom) })),
        },
      }),
    });
    if (!res.ok) throw new Error("PDF impossible : " + ((await res.json().catch(() => null))?.error?.message ?? res.status));
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${titre} - ${variant.name}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast.success("PDF enregistré dans vos Téléchargements");
  }
  const cleComposition = compositionKey(scene, basePath);
  const optimiseValide = scene.optimise && scene.optimise.cle === cleComposition ? scene.optimise : null;

  const surfaceOuverte = activeZone && panel === "murs" ? activeZone : null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 print:hidden">
        <Button size="sm" variant="ghost" disabled={!undo.current.canUndo} onClick={() => stepHistory("undo")} title="Annuler (Ctrl+Z)">
          <Undo2 className="h-4 w-4" /> Annuler
        </Button>
        <Button size="sm" variant="ghost" disabled={!undo.current.canRedo} onClick={() => stepHistory("redo")} title="Rétablir (Ctrl+Y)">
          <Redo2 className="h-4 w-4" /> Rétablir
        </Button>
        <span className="mx-1 h-6 w-px bg-border" />
        <Button size="sm" variant={avantPart !== null ? "default" : "outline"} onClick={() => setAvantPart((x) => (x === null ? 0.5 : null))} title="Glissez sur la photo pour comparer avant / après">
          <Columns2 className="h-4 w-4" /> Avant / après
        </Button>
        {(busy || finishing || analysing) && (
          <span className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {busy ?? (analysing ? "Reconnaissance des surfaces…" : "Rendu…")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setSelOuverte(true)}>
            <ShoppingBag className="h-4 w-4" /> Ma sélection{nbSel ? ` (${nbSel})` : ""}
          </Button>
          <Button size="sm" variant="hero" disabled={!baseImg} onClick={() => void presenter()}>
            <IconePresentation className="h-4 w-4" /> Présenter au client
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Plus d'actions"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setExportOuvert(true)}><Sparkles className="h-4 w-4" /> Exporter pour une IA (visuel + consigne)</DropdownMenuItem>
              <DropdownMenuItem disabled={!scene.items.length} onSelect={() => setOptimOuvert(true)}><Sparkles className="h-4 w-4" /> Optimiser sur ce PC (IA locale)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel("photo")}><ImageIcon className="h-4 w-4" /> Retoucher la photo (gomme, décor)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <section className="relative min-h-[420px] min-w-0 flex-1">
          <Stage
            ref={stage}
            remplir
            W={W}
            H={H}
            background={background}
            items={scene.items}
            asset={assetFor}
            foreground={foreground}
            overlay={overlay ?? apercuSurvol}
            overlayLabel={
              overlayLabel ??
              (tool === "deplacer" && zoneSurvolee
                ? `${zoneSurvolee.name}${zoneSurvolee.finish ? ` · ${zoneSurvolee.finish.name}` : ""} — cliquez pour l'habiller`
                : undefined)
            }
            contour={contour}
            avant={avantPart !== null && baseImg ? { image: baseImg, part: avantPart } : null}
            onAvantChange={setAvantPart}
            selected={selectedUid}
            tool={tool}
            brush={brush}
            quad={activeZone?.quad ?? null}
            cast={scene.cast}
            onSelect={(uid) => {
              setSelectedUid(uid);
              if (uid) {
                setPanel("articles");
                setActiveZoneId(null);
              }
            }}
            onItemChange={updateItem}
            onItemCommit={() => undefined}
            onStroke={onStroke}
            onStrokeEnd={onStrokeEnd}
            onClickImage={(p) => void onClickImage(p)}
            onQuadChange={(q: Quad) => activeZone && api.updateZone(activeZone.id, { quad: q })}
            onHoverImage={(p) => {
              if (tool !== "deplacer" && tool !== "peindre" && tool !== "pipette") return;
              const id = p && p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H ? (surfaceSous(p)?.id ?? null) : null;
              if (id !== survol) setSurvol(id);
            }}
            onDropImage={(p, data) => {
              const id = data.getData("text/x-produit");
              const prod = products.find((x) => x.id === id);
              if (!prod) return;
              api.addItem(prod);
              const uid = sceneRef.current.items.at(-1)?.uid;
              if (uid) updateItem(uid, { x: p[0] / W, y: p[1] / H });
              setTool("deplacer");
              setPanel("articles");
            }}
          />
        </section>
        <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-lg border bg-card print:hidden">
          <Tabs value={panel === "photo" ? "photo" : panel} onValueChange={setPanel} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-2 grid grid-cols-2">
              <TabsTrigger value="murs" className="gap-1"><Paintbrush2 className="h-3.5 w-3.5" /> Surfaces</TabsTrigger>
              <TabsTrigger value="articles" className="gap-1"><Package className="h-3.5 w-3.5" /> Objets</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <TabsContent value="murs" className="mt-0">{surfaceOuverte ? <PanneauSurface key={surfaceOuverte.id} api={api} z={surfaceOuverte} /> : <ListeSurfaces api={api} />}</TabsContent>
              <TabsContent value="articles" className="mt-0"><PanelArticles api={api} /></TabsContent>
              <TabsContent value="photo" className="mt-0">
                <Button size="sm" variant="ghost" className="mb-2" onClick={() => setPanel("murs")}>← Retour</Button>
                <PanelPhoto api={api} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </div>
      <MaSelectionSheet
        open={selOuverte}
        onOpenChange={setSelOuverte}
        sel={selection}
        onM2={(id, m2) => api.updateZone(id, { m2 })}
        pro={tarifPro}
        onPro={(v) => {
          setTarifPro(v);
          localStorageSet("studio-tarif", v ? "pro" : "public");
        }}
      />
      <Presentation
        open={!!presente}
        onClose={() => setPresente(null)}
        titre={projet?.nom ?? variant.name}
        sousTitre={[projet?.client, variant.name].filter(Boolean).join(" · ")}
        avant={presente?.avant ?? null}
        apres={presente?.apres ?? null}
        sel={selection}
        onPdf={telechargerPdf}
        ia={{
          disponible: iaDispo,
          image: scene.renduIa && scene.renduIa.cle === cleComposition ? photoUrl(scene.renduIa.image) : null,
          etat: iaEtat,
          lancer: () => void lancerRenduIa(),
          annuler: annulerRenduIa,
        }}
      />
      <ExportIaDialog
        open={exportOuvert}
        onOpenChange={setExportOuvert}
        montage={async () => (await calquesOptimisation()).montage}
        nom={variant.name}
        articles={scene.items.length}
        details={scene.zones.filter((z) => z.finish && z.visible).map((z) => z.name + ' : ' + [z.finish!.marque, z.finish!.name].filter(Boolean).join(' ') + (z.finish!.kind === 'peinture' ? ', ' + aspectLabel(zoneAspect(z)).toLowerCase() : ''))}
        onOptimiserIci={() => {
          setExportOuvert(false);
          setOptimOuvert(true);
        }}
      />
      <OptimisationDialog
        open={optimOuvert}
        onOpenChange={setOptimOuvert}
        calques={calquesOptimisation}
        onKeep={async (dataUrl, duree) => {
          const blob = await (await fetch(dataUrl)).blob();
          const image = await uploadBlob("optimise", blob, "png");
          setScene((s) => ({ ...s, optimise: { image, cle: compositionKey(s, basePathRef.current), duree } }));
          toast.success("Rendu optimisé gardé : il sert au visuel PNG et à la fiche client tant que la composition ne change pas");
        }}
      />
    </div>
  );
}

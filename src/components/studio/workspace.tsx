import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Brush, Image as ImageIcon, Loader2, Package, Paintbrush2, Redo2, Undo2 } from "lucide-react";
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
import type { ItemAsset } from "@/lib/render-scene";
import { finishPayload, itemImagePath, loadAsset, renderFinished } from "@/lib/compose";
import { defaultQuad, itemBox, parseScene, popHistory, pushHistory, serializeScene, type CastShadow, type Item, type Point, type Quad, type Scene, type Zone } from "@/lib/scene";
import { accordLight, stats as lumStats, UndoStack } from "@/lib/lumiere";
import { sampleColor } from "@/lib/couleur";
import { canvasToBlob, canvasToDataUrl, loadImage, pathToDataUrl, photoEngine, photoUrl, uploadBlob } from "@/lib/studio-api";

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
  addZone: () => void;
  updateZone: (id: string, patch: Partial<Zone>) => void;
  removeZone: (id: string) => void;
  applyFinish: (f: Finish) => void;
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

const kindHeight: Record<string, number> = { Mobilier: 0.34, Luminaire: 0.22, Textile: 0.14, "Objet déco": 0.1 };

export function Workspace({
  variant,
  products,
  photos,
  finishes,
  discount,
  onSaveState,
  flushRef,
}: {
  variant: Variant;
  products: ProductRow[];
  photos: Photo[];
  finishes: Finish[];
  discount: number;
  onSaveState: (s: SaveState) => void;
  flushRef: React.MutableRefObject<(() => Promise<void>) | null>;
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
        scene.zones.map((z) => [z.id, z.finish, z.quad, z.repetitions, z.lumiere, z.visible, commits.current.get(z.id) ?? 0]),
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
        const payload = await finishPayload(zones, (z) => masks.current.get(z.id) ?? null, W, H);
        const img = await renderFinished(basePath, payload, ctrl.signal);
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

  async function onClickImage(p: Point) {
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
      const zone = sceneRef.current.zones.find((z) => z.id === activeZoneId);
      if (!zone) {
        toast.info(`Teinte prélevée ${hex} : créez ou choisissez un mur pour l'appliquer`);
        return;
      }
      api.updateZone(zone.id, { finish: { id: null, kind: "peinture", name: `Teinte prélevée ${hex}`, reference: null, color: hex, texture: null } });
      toast.success(`Teinte ${hex} appliquée sur « ${zone.name} » — enregistrez-la dans la bibliothèque pour lui donner une référence`);
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

  const activeZone = scene.zones.find((z) => z.id === activeZoneId) ?? null;
  const selected = scene.items.find((i) => i.uid === selectedUid) ?? null;

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
    addZone: () => {
      const id = crypto.randomUUID();
      masks.current.set(id, newCanvas(W, H));
      setScene((s) => ({
        ...s,
        zones: [...s.zones, { id, name: `Mur ${s.zones.length + 1}`, mask: null, finish: null, quad: null, repetitions: 4, lumiere: 1, visible: true }],
      }));
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
      const m = masks.current.get(activeZone.id);
      const b = m ? maskBounds(m) : null;
      if (!b) toast.info("Le mur n'est pas encore sélectionné : cliquez dessus avec la baguette");
      const quad = activeZone.quad ?? (f.kind !== "peinture" && b ? defaultQuad({ x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H }) : null);
      const changeKind = activeZone.finish?.kind !== f.kind;
      api.updateZone(activeZone.id, {
        finish: { id: f.id, kind: f.kind, name: f.name, reference: f.reference, color: f.color, texture: f.texture_path },
        quad,
        // Échelle de départ adaptée : un enduit se lit en grandes plages, un papier en motifs.
        ...(changeKind ? { repetitions: f.kind === "enduit" ? 1.5 : 4 } : {}),
      });
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
      setTool("deplacer");
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

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
      <aside className="surface order-2 p-3 xl:order-1 print:hidden">
        <Tabs value={panel} onValueChange={setPanel}>
          <TabsList className="mb-3 grid w-full grid-cols-3">
            <TabsTrigger value="murs" className="gap-1"><Paintbrush2 className="h-3.5 w-3.5" /> Murs</TabsTrigger>
            <TabsTrigger value="articles" className="gap-1"><Package className="h-3.5 w-3.5" /> Articles</TabsTrigger>
            <TabsTrigger value="photo" className="gap-1"><ImageIcon className="h-3.5 w-3.5" /> Photo</TabsTrigger>
          </TabsList>
          <TabsContent value="murs"><PanelMurs api={api} /></TabsContent>
          <TabsContent value="articles"><PanelArticles api={api} /></TabsContent>
          <TabsContent value="photo"><PanelPhoto api={api} /></TabsContent>
        </Tabs>
      </aside>
      <section className="order-1 min-w-0 xl:order-2">
        <div className="mb-2 flex items-center gap-1 print:hidden">
          <Button size="sm" variant="ghost" disabled={!undo.current.canUndo} onClick={() => stepHistory("undo")} title="Annuler (Ctrl+Z)">
            <Undo2 className="h-4 w-4" /> Annuler
          </Button>
          <Button size="sm" variant="ghost" disabled={!undo.current.canRedo} onClick={() => stepHistory("redo")} title="Rétablir (Ctrl+Y)">
            <Redo2 className="h-4 w-4" /> Rétablir
          </Button>
          <span className="text-xs text-muted-foreground">articles, réglages et finitions</span>
        </div>
        <Stage
          ref={stage}
          W={W}
          H={H}
          background={background}
          items={scene.items}
          asset={assetFor}
          foreground={foreground}
          overlay={overlay}
          overlayLabel={overlayLabel}
          selected={selectedUid}
          tool={tool}
          brush={brush}
          quad={activeZone?.quad ?? null}
          cast={scene.cast}
          onSelect={setSelectedUid}
          onItemChange={updateItem}
          onItemCommit={() => undefined}
          onStroke={onStroke}
          onStrokeEnd={onStrokeEnd}
          onClickImage={(p) => {
            if (tool === "deplacer") return;
            void onClickImage(p);
          }}
          onQuadChange={(q: Quad) => activeZone && api.updateZone(activeZone.id, { quad: q })}
        />
        {(busy || finishing) && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {busy ?? "Application des finitions…"}
          </p>
        )}
        {!busy && !finishing && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground print:hidden">
            <Brush className="h-3 w-3" /> Molette : zoom · clic droit maintenu : déplacer la vue · {W} × {H} px, format d'origine conservé.
          </p>
        )}
      </section>
      <aside className="order-3 print:hidden">
        <PanelReferences api={api} discount={discount} />
      </aside>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { Eraser, Hand, Loader2, Minus, Paintbrush, Plus, RotateCcw, Save, Scan, Sparkles, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { fitView, toImage, zoomAt, type View } from "@/lib/scene";
import { newCanvas, maskFromImage, strokeMask } from "@/lib/mask-canvas";
import { blobToDataUrl, canvasToBlob, loadImage, photoEngine } from "@/lib/studio-api";

type Tool = "effacer" | "restaurer" | "precis" | "main";
const FONDS = [
  { id: "clair", label: "Fond clair", color: "#ece8e1" },
  { id: "sombre", label: "Fond sombre", color: "#24211f" },
  { id: "damier", label: "Damier", color: null },
] as const;

/**
 * Éditeur de détourage : part du détourage automatique (ou d'un détourage existant),
 * permet de zoomer, d'effacer ou de restaurer au pinceau, et renvoie un PNG transparent.
 * « Restaurer précis » ne rend que les pixels qui se distinguent du fond : un trait large
 * sur un pied fin ou un patin le récupère sans ramener le sol autour.
 */
export function CutoutEditor({
  source,
  cutout,
  onSave,
  onCancel,
  saveLabel = "Enregistrer le détourage",
}: {
  source: string;
  cutout?: string | null | undefined;
  onSave: (png: Blob) => Promise<void> | void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const view = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLImageElement | null>(null);
  const color = useRef<HTMLCanvasElement | null>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const indice = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const last = useRef<[number, number] | null>(null);
  const panning = useRef<{ x: number; y: number; v: View } | null>(null);
  const [v, setV] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [tool, setTool] = useState<Tool>("restaurer");
  const [radius, setRadius] = useState(12);
  const [fond, setFond] = useState<(typeof FONDS)[number]["id"]>("clair");
  const [ghost, setGhost] = useState(true);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState<string | null>("Détourage automatique…");
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);

  const fit = useCallback(() => {
    const c = view.current, s = src.current;
    if (!c || !s) return;
    setV(fitView(s.naturalWidth, s.naturalHeight, c.width, c.height));
  }, []);

  async function automatic(img: HTMLImageElement, dataUrl: string) {
    setBusy("Détourage automatique…");
    try {
      const blob = await photoEngine({ image: dataUrl, mode: "cutout" });
      const cut = await loadImage(URL.createObjectURL(blob));
      install(img, cut);
    } finally {
      setBusy(null);
    }
  }

  function install(img: HTMLImageElement, cut: HTMLImageElement) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = newCanvas(W, H);
    const cctx = c.getContext("2d")!;
    cctx.drawImage(img, 0, 0);
    cctx.drawImage(cut, 0, 0, W, H); // couleurs décontaminées par-dessus l'original
    color.current = c;
    mask.current = maskFromImage(cut, W, H);
    undo.current = [];
    redraw();
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await (await fetch(source)).blob();
        const dataUrl = await blobToDataUrl(blob);
        const img = await loadImage(dataUrl);
        if (!alive) return;
        src.current = img;
        fit();
        if (cutout) {
          install(img, await loadImage(cutout));
          setBusy(null);
        } else await automatic(img, dataUrl);
      } catch (e) {
        setBusy(null);
        toast.error(e instanceof Error ? e.message : "Photo illisible");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, cutout]);

  useEffect(() => {
    const c = view.current, w = wrap.current;
    if (!c || !w) return;
    const size = () => {
      if (!w.clientWidth || c.width === w.clientWidth) return;
      c.width = w.clientWidth;
      c.height = Math.max(320, Math.min(window.innerHeight * 0.62, w.clientWidth * 0.8));
      fit();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(w);
    return () => ro.disconnect();
  }, [fit]);

  // Dessin
  useEffect(() => {
    const c = view.current, s = src.current;
    if (!c || !s) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    const W = s.naturalWidth, H = s.naturalHeight;
    const f = FONDS.find((x) => x.id === fond)!;
    if (f.color) {
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, W, H);
    } else {
      const cell = 16 / v.scale;
      for (let y = 0; y < H; y += cell)
        for (let x = 0; x < W; x += cell) {
          ctx.fillStyle = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? "#d9d5ce" : "#f5f2ec";
          ctx.fillRect(x, y, Math.min(cell, W - x), Math.min(cell, H - y));
        }
    }
    if (original || !mask.current || !color.current) {
      ctx.drawImage(s, 0, 0);
      return;
    }
    if (ghost) {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(s, 0, 0);
      ctx.globalAlpha = 1;
    }
    const comp = newCanvas(W, H);
    const k = comp.getContext("2d")!;
    k.drawImage(color.current, 0, 0);
    k.globalCompositeOperation = "destination-in";
    k.drawImage(mask.current, 0, 0);
    ctx.imageSmoothingEnabled = v.scale < 2;
    ctx.drawImage(comp, 0, 0);
  });

  async function ensureIndice() {
    if (indice.current || !src.current) return;
    setBusy("Analyse des contours…");
    try {
      const s = src.current;
      const c = newCanvas(s.naturalWidth, s.naturalHeight);
      c.getContext("2d")!.drawImage(s, 0, 0);
      const blob = await photoEngine({ image: await blobToDataUrl(await canvasToBlob(c)), mode: "indice" });
      indice.current = maskFromImage(await loadImage(URL.createObjectURL(blob)), s.naturalWidth, s.naturalHeight, true);
    } finally {
      setBusy(null);
    }
  }

  const pos = (e: RPE<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toImage(v, ((e.clientX - r.left) * e.currentTarget.width) / r.width, ((e.clientY - r.top) * e.currentTarget.height) / r.height);
  };
  const imgRadius = () => radius / v.scale;

  function dab(p: [number, number]) {
    const m = mask.current;
    if (!m) return;
    const from = last.current ?? p;
    if (tool === "precis" && indice.current) {
      // Zone du trait : on reprend la carte « tranche sur le fond » seulement là.
      const zone = newCanvas(m.width, m.height);
      const z = zone.getContext("2d")!;
      z.strokeStyle = "#fff";
      z.fillStyle = "#fff";
      z.lineCap = "round";
      z.lineWidth = imgRadius() * 2;
      z.beginPath();
      z.moveTo(from[0], from[1]);
      z.lineTo(p[0], p[1]);
      z.stroke();
      z.beginPath();
      z.arc(p[0], p[1], imgRadius(), 0, Math.PI * 2);
      z.fill();
      z.globalCompositeOperation = "source-in";
      z.drawImage(indice.current, 0, 0);
      m.getContext("2d")!.drawImage(zone, 0, 0);
    } else strokeMask(m, from, p, imgRadius(), tool === "effacer", 0.9);
    last.current = p;
    redraw();
  }

  async function down(e: RPE<HTMLCanvasElement>) {
    if (busy) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    if (tool === "main" || e.button === 1 || e.button === 2) {
      panning.current = { x: e.clientX, y: e.clientY, v };
      return;
    }
    if (tool === "precis" && !indice.current) await ensureIndice();
    const m = mask.current;
    if (!m) return;
    undo.current.push(m.getContext("2d")!.getImageData(0, 0, m.width, m.height));
    if (undo.current.length > 20) undo.current.shift();
    last.current = null;
    dab(pos(e));
  }
  function move(e: RPE<HTMLCanvasElement>) {
    if (panning.current) {
      const r = e.currentTarget.getBoundingClientRect();
      const k = e.currentTarget.width / r.width;
      const p = panning.current;
      setV({ ...p.v, ox: p.v.ox + (e.clientX - p.x) * k, oy: p.v.oy + (e.clientY - p.y) * k });
      return;
    }
    if (e.buttons & 1 && last.current) dab(pos(e));
  }
  function up() {
    panning.current = null;
    last.current = null;
  }
  function wheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const k = e.currentTarget.width / r.width;
    setV((cur) => zoomAt(cur, e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) * k, (e.clientY - r.top) * k));
  }
  function zoomButton(f: number) {
    const c = view.current;
    if (c) setV((cur) => zoomAt(cur, f, c.width / 2, c.height / 2));
  }
  function doUndo() {
    const m = mask.current, d = undo.current.pop();
    if (m && d) {
      m.getContext("2d")!.putImageData(d, 0, 0);
      redraw();
    }
  }
  async function save() {
    const m = mask.current, c = color.current;
    if (!m || !c) return;
    const out = newCanvas(m.width, m.height);
    const k = out.getContext("2d")!;
    k.drawImage(c, 0, 0);
    k.globalCompositeOperation = "destination-in";
    k.drawImage(m, 0, 0);
    setBusy("Enregistrement…");
    try {
      await onSave(await canvasToBlob(out));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  const tools: { id: Tool; label: string; icon: typeof Eraser; hint: string }[] = [
    { id: "restaurer", label: "Restaurer", icon: Paintbrush, hint: "Reprend les pixels de la photo d'origine" },
    { id: "precis", label: "Restaurer précis", icon: Wand2, hint: "Ne reprend que ce qui se distingue du fond (pieds fins, patins)" },
    { id: "effacer", label: "Effacer", icon: Eraser, hint: "Retire un reste de fond" },
    { id: "main", label: "Déplacer la vue", icon: Hand, hint: "Glisser pour se déplacer (ou clic droit)" },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tools.map((t) => (
          <Button key={t.id} size="sm" variant={tool === t.id ? "default" : "outline"} title={t.hint} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            <t.icon className="h-4 w-4" /> {t.label}
          </Button>
        ))}
        <span className="ml-1 text-xs text-muted-foreground">Pinceau</span>
        <Slider className="w-28" min={2} max={60} value={[radius]} onValueChange={([r]) => setRadius(r ?? radius)} aria-label="Taille du pinceau" />
        <Button size="icon" variant="ghost" title="Annuler le dernier trait" aria-label="Annuler le dernier trait" onClick={doUndo}>
          <Undo2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Fond d'aperçu">
          {FONDS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={fond === f.id}
              onClick={() => setFond(f.id)}
              className={cn("rounded px-2 py-1 text-xs", fond === f.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant={ghost ? "secondary" : "ghost"} onClick={() => setGhost((g) => !g)}>
          <Scan className="h-4 w-4" /> Photo en transparence
        </Button>
        <Button size="sm" variant={original ? "secondary" : "ghost"} onPointerDown={() => setOriginal(true)} onPointerUp={() => setOriginal(false)} onPointerLeave={() => setOriginal(false)}>
          Maintenir pour voir l'original
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Dézoomer" onClick={() => zoomButton(1 / 1.4)}><Minus className="h-4 w-4" /></Button>
          <span className="tabular w-12 text-center text-xs">{Math.round(v.scale * 100)} %</span>
          <Button size="icon" variant="ghost" aria-label="Zoomer" onClick={() => zoomButton(1.4)}><Plus className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={fit}>Ajuster</Button>
        </span>
      </div>
      <div ref={wrap} className="relative overflow-hidden rounded-lg border bg-muted">
        <canvas
          ref={view}
          aria-label="Détourage à retoucher"
          className={cn("block w-full touch-none", tool === "main" ? "cursor-grab" : "cursor-crosshair")}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={wheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {busy && (
          <p className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card px-3 py-1 text-xs shadow">
            <Loader2 className="h-3 w-3 animate-spin" /> {busy}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Molette : zoom · clic droit maintenu : déplacer la vue. Vérifiez les pieds et les jours entre les éléments sur fond clair puis sur fond sombre.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="hero" disabled={!!busy} onClick={save}>
          <Save className="h-4 w-4" /> {saveLabel}
        </Button>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={async () => {
            const s = src.current;
            if (!s) return;
            const c = newCanvas(s.naturalWidth, s.naturalHeight);
            c.getContext("2d")!.drawImage(s, 0, 0);
            await automatic(s, await blobToDataUrl(await canvasToBlob(c))).catch((e) => toast.error(e.message));
          }}
        >
          <Sparkles className="h-4 w-4" /> Refaire l'automatique
        </Button>
        <Button
          variant="ghost"
          disabled={!!busy}
          onClick={() => {
            const m = mask.current;
            if (!m) return;
            undo.current.push(m.getContext("2d")!.getImageData(0, 0, m.width, m.height));
            const k = m.getContext("2d")!;
            k.fillStyle = "#fff";
            k.fillRect(0, 0, m.width, m.height);
            redraw();
          }}
        >
          <RotateCcw className="h-4 w-4" /> Tout restaurer
        </Button>
        <Button variant="ghost" onClick={onCancel}>Annuler</Button>
      </div>
    </section>
  );
}

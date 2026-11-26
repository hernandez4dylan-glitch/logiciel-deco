import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as RPE, type Ref } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { drawComposition, type ItemAsset } from "@/lib/render-scene";
import { fitView, hitItem, toImage, zoomAt, type Box, type CastShadow, type Item, type Point, type Quad, type View } from "@/lib/scene";

export type StageTool =
  | "deplacer"
  | "peindre"
  | "main"
  | "mur-clic"
  | "mur-plus"
  | "mur-moins"
  | "coins"
  | "pp-clic"
  | "pp-plus"
  | "pp-moins"
  | "retouche"
  | "poser"
  | "pipette";

export const BRUSH_TOOLS: StageTool[] = ["mur-plus", "mur-moins", "pp-plus", "pp-moins", "retouche"];

export type StageHandle = { fit: () => void };

/**
 * Plan de travail : affiche la composition au format d'origine (jamais recadrée),
 * avec zoom (molette, boutons) et déplacement de la vue (clic droit ou outil main).
 */
export function Stage({
  ref,
  W,
  H,
  background,
  items,
  asset,
  foreground,
  overlay,
  overlayLabel,
  selected,
  tool,
  brush,
  quad,
  cast,
  onSelect,
  onItemChange,
  onItemCommit,
  onStroke,
  onStrokeEnd,
  onClickImage,
  onQuadChange,
}: {
  ref?: Ref<StageHandle>;
  W: number;
  H: number;
  background: CanvasImageSource | null;
  items: Item[];
  asset: (item: Item) => ItemAsset | undefined;
  foreground: CanvasImageSource | null;
  overlay: CanvasImageSource | null;
  overlayLabel?: string | undefined;
  selected: string | null;
  tool: StageTool;
  brush: number;
  quad: Quad | null;
  cast?: CastShadow | undefined;
  onSelect: (uid: string | null) => void;
  onItemChange: (uid: string, patch: Partial<Item>) => void;
  onItemCommit: () => void;
  onStroke: (from: Point, to: Point, radius: number) => void;
  onStrokeEnd: () => void;
  onClickImage: (p: Point) => void;
  onQuadChange: (q: Quad) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, Box>());
  const [v, setV] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [hover, setHover] = useState<Point | null>(null);
  const drag = useRef<
    | { kind: "item"; uid: string; dx: number; dy: number }
    | { kind: "scale"; uid: string; baseY: number }
    | { kind: "pan"; x: number; y: number; v: View }
    | { kind: "brush"; last: Point }
    | { kind: "corner"; i: number }
    | null
  >(null);

  const fit = useCallback(() => {
    const c = canvas.current;
    if (c && W && H) setV(fitView(W, H, c.width, c.height));
  }, [W, H]);
  useImperativeHandle(ref, () => ({ fit }), [fit]);

  useEffect(() => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = w.clientWidth;
      if (!cw) return;
      // Hauteur du plan : celle de l'image à pleine largeur, bornée à l'écran.
      const ch = Math.max(280, Math.min(window.innerHeight * 0.72, (cw * H) / Math.max(1, W)));
      const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
      if (c.width === pw && c.height === ph) return;
      c.style.height = `${ch}px`;
      c.width = pw;
      c.height = ph;
      setV(fitView(W, H, c.width, c.height));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(w);
    window.addEventListener("resize", size);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", size);
    };
  }, [W, H]);

  // Dessin à chaque rendu.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!background) return;
    ctx.setTransform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    boxes.current.clear();
    drawComposition(ctx, { W, H, background, items, asset, foreground, boxes: boxes.current, ...(cast ? { cast } : {}) });
    if (overlay) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(overlay, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const px = 1 / v.scale;
    const sel = selected ? boxes.current.get(selected) : null;
    if (sel && (tool === "deplacer" || tool === "main")) {
      ctx.strokeStyle = "#c0694a";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.setLineDash([]);
      // point d'ancrage (base)
      const ax = sel.x + sel.w / 2, ay = sel.y + sel.h;
      ctx.fillStyle = "#c0694a";
      ctx.beginPath();
      ctx.arc(ax, ay, 6 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      // poignée d'échelle
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#c0694a";
      ctx.fillRect(sel.x + sel.w - 7 * px, sel.y - 7 * px, 14 * px, 14 * px);
      ctx.strokeRect(sel.x + sel.w - 7 * px, sel.y - 7 * px, 14 * px, 14 * px);
    }
    if (quad && tool === "coins") {
      const pts = quad.map(([x, y]) => [x * W, y * H] as Point);
      ctx.strokeStyle = "#2f5d62";
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      pts.forEach(([x, y]) => {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 9 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
    if (hover && BRUSH_TOOLS.includes(tool)) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(hover[0], hover[1], brush / v.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(hover[0], hover[1], brush / v.scale + px, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  const pos = (e: RPE<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return toImage(v, ((e.clientX - r.left) * e.currentTarget.width) / r.width, ((e.clientY - r.top) * e.currentTarget.height) / r.height);
  };

  function down(e: RPE<HTMLCanvasElement>) {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    const p = pos(e);
    if (tool === "main" || e.button === 1 || e.button === 2) {
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, v };
      return;
    }
    if (tool === "coins" && quad) {
      const tol = 14 / v.scale;
      const i = quad.findIndex(([x, y]) => Math.hypot(x * W - p[0], y * H - p[1]) < tol);
      if (i >= 0) drag.current = { kind: "corner", i };
      return;
    }
    if (BRUSH_TOOLS.includes(tool)) {
      drag.current = { kind: "brush", last: p };
      onStroke(p, p, brush / v.scale);
      return;
    }
    if (tool === "mur-clic" || tool === "pp-clic" || tool === "poser" || tool === "pipette" || tool === "peindre") {
      onClickImage(p);
      return;
    }
    // Déplacer : poignée d'échelle de l'article sélectionné, sinon article sous le pointeur.
    const sel = selected ? boxes.current.get(selected) : null;
    if (sel && Math.abs(p[0] - (sel.x + sel.w)) < 12 / v.scale && Math.abs(p[1] - sel.y) < 12 / v.scale) {
      drag.current = { kind: "scale", uid: selected!, baseY: sel.y + sel.h };
      return;
    }
    const uid = hitItem(items, boxes.current, p[0], p[1]);
    onSelect(uid);
    if (uid) {
      const it = items.find((i) => i.uid === uid)!;
      drag.current = { kind: "item", uid, dx: p[0] - it.x * W, dy: p[1] - it.y * H };
    }
  }

  function move(e: RPE<HTMLCanvasElement>) {
    const p = pos(e);
    if (BRUSH_TOOLS.includes(tool)) setHover(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const r = e.currentTarget.getBoundingClientRect();
      const k = e.currentTarget.width / r.width;
      setV({ ...d.v, ox: d.v.ox + (e.clientX - d.x) * k, oy: d.v.oy + (e.clientY - d.y) * k });
    } else if (d.kind === "item") {
      onItemChange(d.uid, { x: (p[0] - d.dx) / W, y: (p[1] - d.dy) / H });
    } else if (d.kind === "scale") {
      onItemChange(d.uid, { h: Math.max(0.02, (d.baseY - p[1]) / H) });
    } else if (d.kind === "brush") {
      onStroke(d.last, p, brush / v.scale);
      d.last = p;
    } else if (d.kind === "corner" && quad) {
      const q = quad.map((c) => [...c]) as Quad;
      q[d.i] = [p[0] / W, p[1] / H];
      onQuadChange(q);
    }
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "brush") onStrokeEnd();
    if (d.kind === "item" || d.kind === "scale") onItemCommit();
  }

  function wheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const k = e.currentTarget.width / r.width;
    setV((cur) => zoomAt(cur, e.deltaY < 0 ? 1.15 : 1 / 1.15, (e.clientX - r.left) * k, (e.clientY - r.top) * k));
  }
  const zoomBtn = (f: number) => {
    const c = canvas.current;
    if (c) setV((cur) => zoomAt(cur, f, c.width / 2, c.height / 2));
  };

  const cursor =
    tool === "main" ? "cursor-grab" : tool === "deplacer" ? "cursor-default" : tool === "coins" ? "cursor-move" : BRUSH_TOOLS.includes(tool) ? "cursor-none" : "cursor-crosshair";

  return (
    <div ref={wrap} className="relative overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#ece8e1_0%_25%,#f6f3ee_0%_50%)] bg-[length:20px_20px]">
      <canvas
        ref={canvas}
        aria-label="Plan de travail du studio"
        className={cn("block w-full touch-none", cursor)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setHover(null)}
        onWheel={wheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {overlayLabel && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-card/90 px-3 py-1 text-xs shadow">{overlayLabel}</p>
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-card/90 p-1 shadow print:hidden">
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Dézoomer" onClick={() => zoomBtn(1 / 1.3)}><Minus className="h-4 w-4" /></Button>
        <span className="tabular w-12 text-center text-xs">{Math.round(v.scale * 100 * (canvas.current ? canvas.current.clientWidth / canvas.current.width : 1))} %</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Zoomer" onClick={() => zoomBtn(1.3)}><Plus className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Voir toute l'image" title="Voir toute l'image" onClick={fit}><Maximize2 className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

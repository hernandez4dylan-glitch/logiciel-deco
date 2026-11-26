import { drawOrder, itemBox, NEUTRAL_LIGHT, type Box, type CastShadow, type Item, type ItemLight } from "@/lib/scene";
import { castMatrix, lightFilter, warmTint } from "@/lib/lumiere";
import { newCanvas } from "@/lib/mask-canvas";

/** Photo d'article prête à poser : image, partie utile (sans marges transparentes), silhouette. */
export type ItemAsset = {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  aspect: number;
  cut: boolean;
  silhouette: HTMLCanvasElement;
};

/** Prépare une photo d'article : retire les marges transparentes pour que la base
 *  de l'image soit vraiment le bas des pieds, et calcule la silhouette de l'ombre. */
export function prepareAsset(img: HTMLImageElement): ItemAsset {
  const W = img.naturalWidth, H = img.naturalHeight;
  const s = Math.min(1, 400 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const probe = newCanvas(w, h);
  const pctx = probe.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(img, 0, 0, w, h);
  const px = pctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, transparent = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3]!;
      if (a < 250) transparent++;
      if (a > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  const cut = transparent > w * h * 0.02;
  let sx = 0, sy = 0, sw = W, sh = H;
  if (cut && x1 >= 0) {
    sx = Math.max(0, Math.floor(x0 / s));
    sy = Math.max(0, Math.floor(y0 / s));
    sw = Math.min(W - sx, Math.ceil((x1 + 1) / s) - sx);
    sh = Math.min(H - sy, Math.ceil((y1 + 1) / s) - sy);
  }
  const sil = newCanvas(Math.max(1, Math.round(sw * s)), Math.max(1, Math.round(sh * s)));
  const sctx = sil.getContext("2d")!;
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, sil.width, sil.height);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, sil.width, sil.height);
  return { img, sx, sy, sw, sh, aspect: sw / sh, cut, silhouette: sil };
}

/** Ombre de contact : tache douce sous la base + silhouette écrasée au sol. */
export function drawShadow(ctx: CanvasRenderingContext2D, item: Item, box: Box, asset: ItemAsset) {
  const { opacity, blur, size } = item.shadow;
  if (opacity <= 0 || size <= 0) return;
  const cx = box.x + box.w / 2;
  const base = box.y + box.h;
  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity);
  ctx.filter = `blur(${Math.max(1, blur * box.w * 0.08)}px)`;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.beginPath();
  ctx.ellipse(cx, base - box.w * 0.015, box.w * 0.46 * size, Math.max(2, box.w * 0.06 * size), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Math.min(1, opacity * 0.9);
  ctx.filter = `blur(${Math.max(0.6, blur * box.w * 0.02)}px)`;
  ctx.translate(cx, base);
  ctx.scale(item.flip ? -1 : 1, 0.12 * size);
  ctx.drawImage(asset.silhouette, -box.w / 2, -box.h, box.w, box.h);
  ctx.restore();
}

/** Ombre portée : silhouette projetée au sol depuis la base, selon la lumière de la pièce. */
export function drawCast(ctx: CanvasRenderingContext2D, item: Item, box: Box, asset: ItemAsset, cast: CastShadow) {
  if (cast.length <= 0 || cast.opacity <= 0) return;
  const m = castMatrix(box, cast);
  ctx.save();
  ctx.globalAlpha = Math.min(1, cast.opacity);
  ctx.filter = `blur(${Math.max(1.5, box.w * 0.025 * (0.6 + cast.length))}px)`;
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  if (item.flip) ctx.scale(-1, 1);
  ctx.drawImage(asset.silhouette, -box.w / 2, -box.h, box.w, box.h);
  ctx.restore();
}

/** Copie de l'article ajustée à la lumière de la pièce (luminosité, chaleur), mise en cache. */
const litCache = new WeakMap<ItemAsset, { key: string; canvas: HTMLCanvasElement }>();
function litImage(asset: ItemAsset, light: ItemLight): CanvasImageSource {
  const tint = warmTint(light.warm);
  if (light.bright === 1 && !tint) return asset.img;
  const key = `${light.bright}|${light.warm}`;
  const hit = litCache.get(asset);
  if (hit?.key === key) return hit.canvas;
  const c = newCanvas(asset.sw, asset.sh);
  const ctx = c.getContext("2d")!;
  ctx.filter = lightFilter(light);
  ctx.drawImage(asset.img, asset.sx, asset.sy, asset.sw, asset.sh, 0, 0, asset.sw, asset.sh);
  ctx.filter = "none";
  if (tint) {
    ctx.globalCompositeOperation = "source-atop"; // le voile reste sur l'article, pas sur la transparence
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  litCache.set(asset, { key, canvas: c });
  return c;
}

export function drawItem(ctx: CanvasRenderingContext2D, item: Item, box: Box, asset: ItemAsset) {
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h);
  if (item.rot) ctx.rotate((item.rot * Math.PI) / 180);
  if (item.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = "high";
  const src = litImage(asset, item.light ?? NEUTRAL_LIGHT);
  if (src === asset.img) ctx.drawImage(asset.img, asset.sx, asset.sy, asset.sw, asset.sh, -box.w / 2, -box.h, box.w, box.h);
  else ctx.drawImage(src, -box.w / 2, -box.h, box.w, box.h);
  ctx.restore();
}

/**
 * Dessine la composition en coordonnées image (le contexte peut déjà être zoomé) :
 * fond fini → articles « derrière » → premier plan existant → autres articles.
 * La même fonction sert à l'écran et à l'export : ce que l'on voit est ce que l'on remet.
 */
function drawForeground(ctx: CanvasRenderingContext2D, o: { W: number; H: number; foreground: CanvasImageSource | null; foregroundErase?: boolean }) {
  if (!o.foreground) return;
  ctx.save();
  if (o.foregroundErase) ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(o.foreground, 0, 0, o.W, o.H);
  ctx.restore();
}

export function drawComposition(
  ctx: CanvasRenderingContext2D,
  o: {
    W: number;
    H: number;
    background: CanvasImageSource;
    items: Item[];
    asset: (item: Item) => ItemAsset | undefined;
    foreground: CanvasImageSource | null;
    boxes?: Map<string, Box>;
    cast?: CastShadow;
    /** Sans ombres : silhouette exacte des articles (optimisation finale). */
    noShadows?: boolean;
    /** Le premier plan efface au lieu de recouvrir (calque transparent des articles). */
    foregroundErase?: boolean;
  },
) {
  ctx.drawImage(o.background, 0, 0, o.W, o.H);
  const order = drawOrder(o.items);
  let fgDone = !o.foreground;
  for (const it of order) {
    if (!fgDone && !it.behind) {
      drawForeground(ctx, o);
      fgDone = true;
    }
    const a = o.asset(it);
    if (!a) continue;
    const box = itemBox(it, a.aspect, o.W, o.H);
    o.boxes?.set(it.uid, box);
    if (a.cut && !o.noShadows) {
      if (o.cast) drawCast(ctx, it, box, a, o.cast);
      drawShadow(ctx, it, box, a);
    }
    drawItem(ctx, it, box, a);
  }
  if (!fgDone) drawForeground(ctx, o);
}

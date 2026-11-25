import { drawOrder, itemBox, type Box, type Item } from "@/lib/scene";
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

export function drawItem(ctx: CanvasRenderingContext2D, item: Item, box: Box, asset: ItemAsset) {
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h);
  if (item.rot) ctx.rotate((item.rot * Math.PI) / 180);
  if (item.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(asset.img, asset.sx, asset.sy, asset.sw, asset.sh, -box.w / 2, -box.h, box.w, box.h);
  ctx.restore();
}

/**
 * Dessine la composition en coordonnées image (le contexte peut déjà être zoomé) :
 * fond fini → articles « derrière » → premier plan existant → autres articles.
 * La même fonction sert à l'écran et à l'export : ce que l'on voit est ce que l'on remet.
 */
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
  },
) {
  ctx.drawImage(o.background, 0, 0, o.W, o.H);
  const order = drawOrder(o.items);
  let fgDone = !o.foreground;
  for (const it of order) {
    if (!fgDone && !it.behind) {
      ctx.drawImage(o.foreground!, 0, 0, o.W, o.H);
      fgDone = true;
    }
    const a = o.asset(it);
    if (!a) continue;
    const box = itemBox(it, a.aspect, o.W, o.H);
    o.boxes?.set(it.uid, box);
    if (a.cut) drawShadow(ctx, it, box, a);
    drawItem(ctx, it, box, a);
  }
  if (!fgDone) ctx.drawImage(o.foreground!, 0, 0, o.W, o.H);
}

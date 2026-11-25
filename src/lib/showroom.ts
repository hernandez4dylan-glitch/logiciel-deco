import { autoEnhance } from "@/lib/couleur";

export type ShowroomOptions = { fond: "uni" | "decor"; couleur: string; lumiere: boolean };

/**
 * Photo d'annonce à partir d'un article détouré : lumière corrigée (facultatif) puis
 * fond uni, ou décor clair (mur crème, sol bois, ombre au sol) repris de l'ancienne
 * version en ligne. Renvoie une image PNG en data URL.
 */
export function composeShowroom(cut: HTMLImageElement, o: ShowroomOptions) {
  const W = cut.naturalWidth || cut.width, H = cut.naturalHeight || cut.height;
  const obj = document.createElement("canvas");
  obj.width = W;
  obj.height = H;
  const octx = obj.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(cut, 0, 0);
  if (o.lumiere) {
    const d = octx.getImageData(0, 0, W, H);
    const out = autoEnhance({ data: d.data, width: W, height: H });
    octx.putImageData(new ImageData(new Uint8ClampedArray(out.data), W, H), 0, 0);
  }
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  if (o.fond === "uni") {
    c.width = W;
    c.height = H;
    ctx.fillStyle = o.couleur;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(obj, 0, 0);
    return c.toDataURL("image/png");
  }
  // Décor clair, format carré d'annonce.
  const size = 1200;
  c.width = c.height = size;
  const wall = ctx.createLinearGradient(0, 0, 0, size * 0.72);
  wall.addColorStop(0, "#F7F2EA");
  wall.addColorStop(1, "#ECE3D6");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, size, size * 0.72);
  const floor = ctx.createLinearGradient(0, size * 0.72, 0, size);
  floor.addColorStop(0, "#D9C8B0");
  floor.addColorStop(1, "#C7B193");
  ctx.fillStyle = floor;
  ctx.fillRect(0, size * 0.72, size, size * 0.28);
  // Boîte englobante de l'objet (pixels assez opaques).
  const px = octx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let p = 0; p < W * H; p++) {
    if (px[p * 4 + 3]! < 200) continue;
    const x = p % W, y = (p / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 <= x0 || y1 <= y0) [x0, y0, x1, y1] = [0, 0, W, H];
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const k = Math.min((size * 0.7) / bw, (size * 0.68) / bh);
  const w = bw * k, h = bh * k;
  const x = (size - w) / 2, bottom = size * 0.86, y = bottom - h;
  ctx.save();
  ctx.filter = "blur(18px)";
  ctx.fillStyle = "rgba(60, 40, 20, 0.35)";
  ctx.beginPath();
  ctx.ellipse(size / 2, bottom, w * 0.45, h * 0.05 + 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(obj, x0, y0, bw, bh, x, y, w, h);
  return c.toDataURL("image/png");
}

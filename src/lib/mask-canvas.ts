/** Masques de sélection en mémoire : un canvas pleine résolution dont l'alpha est la sélection. */

export function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Masque vide ou copié depuis une image (alpha d'un PNG, ou niveaux de gris si opaque). */
export function maskFromImage(img: CanvasImageSource | null, w: number, h: number, grayscale = false) {
  const c = newCanvas(w, h);
  if (!img) return c;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  if (grayscale) {
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = px[i]!;
      px[i] = px[i + 1] = px[i + 2] = 255;
    }
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

/** Trait de pinceau entre deux points (coordonnées image), en ajout ou en retrait. */
export function strokeMask(mask: HTMLCanvasElement, from: [number, number], to: [number, number], radius: number, erase: boolean, hardness = 0.85) {
  const ctx = mask.getContext("2d")!;
  ctx.save();
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineWidth = radius * 2;
  if (hardness < 1) ctx.filter = `blur(${Math.max(0.5, radius * (1 - hardness) * 0.5)}px)`;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(to[0], to[1], radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Copie teintée d'un masque pour l'afficher par-dessus la photo. */
export function tinted(mask: HTMLCanvasElement, color: string, target?: HTMLCanvasElement) {
  const c = target ?? newCanvas(mask.width, mask.height);
  const ctx = c.getContext("2d")!;
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();
  return c;
}

/** Image découpée par un masque (premier plan qui repasse devant les articles). */
export function cutByMask(image: CanvasImageSource, mask: HTMLCanvasElement) {
  const c = newCanvas(mask.width, mask.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  return c;
}

/** Boîte englobante des pixels sélectionnés (en pixels), ou null si le masque est vide. */
export function maskBounds(mask: HTMLCanvasElement, threshold = 128) {
  const s = Math.min(1, 512 / Math.max(mask.width, mask.height));
  const w = Math.max(1, Math.round(mask.width * s));
  const h = Math.max(1, Math.round(mask.height * s));
  const c = newCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(mask, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[(y * w + x) * 4 + 3]! >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x0: x0 / s, y0: y0 / s, x1: (x1 + 1) / s, y1: (y1 + 1) / s };
}

export function isEmptyMask(mask: HTMLCanvasElement) {
  return maskBounds(mask, 16) === null;
}

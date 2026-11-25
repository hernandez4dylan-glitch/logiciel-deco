import { localStore } from "@/lib/local-client";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/data";

/** URL affichable d'un fichier du dossier photos (ou d'une image fournie avec le logiciel). */
export const photoUrl = (path: string) => (path.startsWith("/") || path.startsWith("data:") || path.startsWith("blob:") ? path : "/photos/" + encodeURIComponent(path));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = src;
  });
}

export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Export impossible"))), type, quality));

export async function canvasToDataUrl(c: HTMLCanvasElement, type = "image/png", quality?: number) {
  return blobToDataUrl(await canvasToBlob(c, type, quality));
}

/** Envoie un fichier dans le dossier photos local ; renvoie son nom. */
export async function uploadBlob(prefix: string, blob: Blob, ext: "png" | "jpg") {
  const name = `${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await localStore.storage.from(PRODUCT_IMAGES_BUCKET).upload(name, blob);
  if (error) throw new Error("Enregistrement impossible : " + error.message);
  return name;
}

const dataUrlCache = new Map<string, Promise<string>>();
/** Contenu d'un fichier du dossier photos en data URL (mis en cache : les fichiers ne changent jamais). */
export function pathToDataUrl(path: string) {
  let p = dataUrlCache.get(path);
  if (!p) {
    p = fetch(photoUrl(path)).then(async (r) => {
      if (!r.ok) throw new Error("Fichier introuvable : " + path);
      return blobToDataUrl(await r.blob());
    });
    p.catch(() => dataUrlCache.delete(path));
    dataUrlCache.set(path, p);
  }
  return p;
}

/** Appel au moteur photo local ; renvoie l'image PNG produite. */
export async function photoEngine(fields: Record<string, unknown>, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
    signal: signal ?? null,
  });
  if (!res.ok) {
    let msg = "Traitement impossible";
    try {
      msg = (await res.json()).error?.message || msg;
    } catch {
      /* réponse non JSON */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** Redimensionne une image (format conservé) et la renvoie en JPEG pour le dossier photos. */
export async function normalizeBase(src: string, maxSide = 2400) {
  const img = await loadImage(src);
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, width: c.width, height: c.height };
}

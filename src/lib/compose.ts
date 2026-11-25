import { drawComposition, prepareAsset, type ItemAsset } from "@/lib/render-scene";
import { maskFromImage, newCanvas, cutByMask } from "@/lib/mask-canvas";
import { canvasToDataUrl, loadImage, pathToDataUrl, photoEngine, photoUrl } from "@/lib/studio-api";
import { zoneAspect, type Item, type Scene, type Zone } from "@/lib/scene";

export type PhotoRow = { id: string; product_id: string; image_path: string; cutout_path: string | null };
export type ProductImages = { id: string; image_url: string | null; cutout_url: string | null };

/** Fichier à poser pour un article : le détourage de la photo choisie, sinon la photo elle-même. */
export function itemImagePath(item: Item, products: ProductImages[], photos: PhotoRow[]) {
  if (item.photoId) {
    const ph = photos.find((p) => p.id === item.photoId);
    if (ph) return ph.cutout_path ?? ph.image_path;
  }
  const p = products.find((x) => x.id === item.productId);
  return p ? (p.cutout_url ?? p.image_url) : null;
}

const assetCache = new Map<string, Promise<ItemAsset>>();
export function loadAsset(path: string) {
  let a = assetCache.get(path);
  if (!a) {
    a = loadImage(photoUrl(path)).then(prepareAsset);
    a.catch(() => assetCache.delete(path));
    assetCache.set(path, a);
  }
  return a;
}

/** Zones à envoyer au moteur de finitions (masques et textures en data URL, coins en pixels). */
export async function finishPayload(zones: Zone[], mask: (z: Zone) => HTMLCanvasElement | null, W: number, H: number) {
  const out: Record<string, unknown>[] = [];
  for (const z of zones) {
    const m = mask(z);
    if (!z.visible || !z.finish || !m) continue;
    out.push({
      mask: await canvasToDataUrl(m),
      type: z.finish.kind,
      couleur: z.finish.color,
      texture: z.finish.texture ? await pathToDataUrl(z.finish.texture) : null,
      quad: z.quad ? z.quad.map(([x, y]) => [x * W, y * H]) : null,
      repetitions: z.repetitions,
      lumiere: z.lumiere,
      finition: zoneAspect(z),
      surface: z.surface,
    });
  }
  return out;
}

/** Fond fini : la photo avec les peintures, papiers et enduits appliqués (moteur local). */
export async function renderFinished(basePath: string, payload: Record<string, unknown>[], signal?: AbortSignal) {
  if (!payload.length) return loadImage(photoUrl(basePath));
  const blob = await photoEngine({ image: await pathToDataUrl(basePath), mode: "finish", zones: payload }, signal);
  return loadImage(URL.createObjectURL(blob));
}

/** Compose une variante enregistrée telle qu'elle sera remise au client. */
export async function composeVariant(
  row: { base_path: string; width: number; height: number; data: string },
  scene: Scene,
  products: ProductImages[],
  photos: PhotoRow[],
  maxSide = 0,
) {
  const base = await loadImage(photoUrl(row.base_path));
  const W = base.naturalWidth, H = base.naturalHeight;
  const masks = new Map<string, HTMLCanvasElement>();
  for (const z of scene.zones) if (z.mask) masks.set(z.id, maskFromImage(await loadImage(photoUrl(z.mask)), W, H));
  const payload = await finishPayload(scene.zones, (z) => masks.get(z.id) ?? null, W, H);
  const background = await renderFinished(row.base_path, payload);
  const fg = scene.foreground ? cutByMask(background, maskFromImage(await loadImage(photoUrl(scene.foreground)), W, H)) : null;
  const assets = new Map<string, ItemAsset>();
  for (const it of scene.items) {
    const path = itemImagePath(it, products, photos);
    if (path) assets.set(it.uid, await loadAsset(path));
  }
  const s = maxSide ? Math.min(1, maxSide / Math.max(W, H)) : 1;
  const c = newCanvas(Math.round(W * s), Math.round(H * s));
  const ctx = c.getContext("2d")!;
  ctx.scale(s, s);
  drawComposition(ctx, { W, H, background, items: scene.items, asset: (it) => assets.get(it.uid), foreground: fg, cast: scene.cast });
  return c;
}

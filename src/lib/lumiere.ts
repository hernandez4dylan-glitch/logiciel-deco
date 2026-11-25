import type { Box, CastShadow, ItemLight } from "@/lib/scene";

/** Statistiques simples d'une zone d'image : luminance moyenne (0–255) et chaleur (R − B moyen). */
export type Stats = { lum: number; warm: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Mesure une zone de pixels RGBA (les pixels transparents sont ignorés). */
export function stats(data: Uint8ClampedArray, mask?: (i: number) => boolean): Stats | null {
  let n = 0, lum = 0, warm = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3]! < 128 || (mask && !mask(p))) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    warm += r - b;
    n++;
  }
  return n ? { lum: lum / n, warm: warm / n } : null;
}

/**
 * Accorde un article à l'endroit où il est posé : il prend une partie de la luminosité
 * et de la dominante de couleur de la pièce autour de lui (adaptation partielle, pour ne
 * pas dénaturer la vraie couleur du produit).
 */
export function accordLight(local: Stats, item: Stats): ItemLight {
  const ratio = local.lum / Math.max(item.lum, 1);
  return {
    bright: Math.round(clamp(Math.pow(ratio, 0.35), 0.65, 1.25) * 100) / 100,
    warm: Math.round(clamp((local.warm - item.warm) / 120, -0.6, 0.6) * 100) / 100,
  };
}

/** Filtre canvas correspondant à la lumière d'un article. */
export const lightFilter = (l: ItemLight) => (l.bright === 1 ? "none" : `brightness(${l.bright})`);

/** Voile de couleur (appliqué sur l'article seul) pour la chaleur de la lumière. */
export function warmTint(warm: number): string | null {
  if (Math.abs(warm) < 0.02) return null;
  const a = Math.min(0.22, Math.abs(warm) * 0.22).toFixed(3);
  return warm > 0 ? `rgba(255, 170, 90, ${a})` : `rgba(110, 150, 255, ${a})`;
}

/**
 * Transformation qui projette la silhouette d'un article au sol, depuis sa base :
 * point (x, y) de la silhouette (y de −h à 0) → (x + c·y + e, d·y + f).
 */
export function castMatrix(box: Box, cast: CastShadow) {
  const L = Math.max(0, cast.length);
  const d = (cast.behind ? 1 : -1) * 0.33 * L;
  const c = -Math.tan((cast.direction * Math.PI) / 180) * 0.6 * L;
  return { a: 1, b: 0, c, d, e: box.x + box.w / 2, f: box.y + box.h };
}

/** Historique annuler / rétablir (états sérialisés, taille bornée). */
export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private max = 60) {}
  /** À appeler avec l'état AVANT une modification. */
  record(state: T) {
    this.past.push(state);
    if (this.past.length > this.max) this.past.shift();
    this.future = [];
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}

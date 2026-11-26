/**
 * Composition du studio : finitions murales par zone, articles posés, premier plan.
 * Toutes les positions sont en fractions de l'image (0..1) : la composition reste
 * juste quel que soit le zoom ou la taille d'écran, et l'image n'est jamais recadrée.
 */

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point];
export type FinishKind = "peinture" | "papier" | "enduit";
/** Nature de la surface sélectionnée : change la finition par défaut et le rendu (reflets). */
export type Surface = "mur" | "plafond" | "porte" | "cadre" | "plinthe" | "sol" | "autre";
/** Aspect de la peinture : du plus mat au plus brillant. */
export type Aspect = "mat" | "velours" | "satin" | "brillant";

export const SURFACES: { id: Surface; label: string }[] = [
  { id: "mur", label: "Mur" },
  { id: "plafond", label: "Plafond" },
  { id: "porte", label: "Porte" },
  { id: "cadre", label: "Cadre / huisserie" },
  { id: "plinthe", label: "Plinthe" },
  { id: "sol", label: "Sol" },
  { id: "autre", label: "Autre (boiserie, meuble)" },
];
export const ASPECTS: { id: Aspect; label: string }[] = [
  { id: "mat", label: "Mat" },
  { id: "velours", label: "Velours" },
  { id: "satin", label: "Satiné" },
  { id: "brillant", label: "Brillant" },
];
/** Finition habituelle d'une surface quand la teinte n'en précise pas. */
export const SURFACE_ASPECT: Record<Surface, Aspect> = { mur: "mat", plafond: "mat", porte: "satin", cadre: "satin", plinthe: "satin", sol: "satin", autre: "mat" };
export const isAspect = (v: unknown): v is Aspect => typeof v === "string" && ASPECTS.some((a) => a.id === v);
export const isSurface = (v: unknown): v is Surface => typeof v === "string" && SURFACES.some((a) => a.id === v);
export const aspectLabel = (a: Aspect) => ASPECTS.find((x) => x.id === a)?.label ?? a;
export const surfaceLabel = (s: Surface) => SURFACES.find((x) => x.id === s)?.label ?? s;

/** Copie de la finition au moment du choix : la fiche client reste juste même si la bibliothèque change. */
export type FinishSnapshot = {
  id: string | null;
  kind: FinishKind;
  name: string;
  reference: string | null;
  color: string | null;
  texture: string | null;
  /** Fournisseur ou marque (saisi dans la bibliothèque), gamme. */
  marque: string | null;
  gamme: string | null;
  /** Finition conseillée par la fiche (mat, velours…) ; pour un papier, texte libre (intissé…). */
  finition: string | null;
};

export type Zone = {
  id: string;
  name: string;
  /** Fichier PNG (alpha = sélection) dans le dossier photos, ou null tant que rien n'est sélectionné. */
  mask: string | null;
  finish: FinishSnapshot | null;
  /** Rectangle du mur en perspective (haut-gauche, haut-droit, bas-droit, bas-gauche). */
  quad: Quad | null;
  /** Nombre de motifs sur la largeur du rectangle (papier peint, enduit). */
  repetitions: number;
  /** 1 = lumière d'origine conservée, 0 = aplat. */
  lumiere: number;
  visible: boolean;
  surface: Surface;
  /** Finition choisie pour cette surface ; null = celle de la teinte, sinon celle de la surface. */
  aspect: Aspect | null;
  /** Surface trouvée par l'analyse automatique de la pièce (correction manuelle repliée). */
  auto: boolean;
};

/** Résultat de la reconnaissance automatique de la pièce (lancée une seule fois). */
export type AnalyseInfo = {
  /** Durées en secondes : segmentation, profondeur, contours, pans, total. */
  temps: Record<string, number>;
  /** Secondes entre l'ouverture de la photo et le premier aperçu affiché. */
  apercu: number | null;
  date: string;
};

/** Rendu de l'« Optimisation finale » gardé : valable tant que la composition n'a pas changé. */
export type Optimise = { image: string; cle: string; duree: number };

/** Finition réellement rendue pour une zone. */
export function zoneAspect(z: Pick<Zone, "aspect" | "finish" | "surface">): Aspect {
  if (z.aspect) return z.aspect;
  if (z.finish?.kind === "peinture" && isAspect(z.finish.finition)) return z.finish.finition;
  return SURFACE_ASPECT[z.surface];
}

export type Shadow = { opacity: number; blur: number; size: number };

export type Item = {
  uid: string;
  productId: string;
  /** null = photo principale de la fiche, sinon identifiant de product_photos. */
  photoId: string | null;
  /** Point d'ancrage = milieu du bas de l'article (pieds, socle), en fractions de l'image. */
  x: number;
  y: number;
  /** Hauteur de l'article en fraction de la hauteur de l'image. */
  h: number;
  flip: boolean;
  rot: number;
  shadow: Shadow;
  /** Passe derrière les éléments existants peints en « premier plan ». */
  behind: boolean;
  /** Lumière propre à l'article : luminosité (1 = photo d'origine) et chaleur (−1 froid … +1 chaud). */
  light: ItemLight;
};

export type ItemLight = { bright: number; warm: number };
export const NEUTRAL_LIGHT: ItemLight = { bright: 1, warm: 0 };

/** Ombre portée commune à toute la pièce (une seule source de lumière principale). */
export type CastShadow = {
  /** 0 = pas d'ombre portée ; 1 = longueur égale à environ un tiers de la hauteur de l'article. */
  length: number;
  /** Inclinaison de l'ombre, en degrés (négatif = vers la gauche). */
  direction: number;
  /** true : l'ombre part vers le fond de la pièce (lumière de face) ; false : vers l'avant. */
  behind: boolean;
  opacity: number;
};
export const DEFAULT_CAST: CastShadow = { length: 0, direction: -25, behind: true, opacity: 0.35 };

export type Scene = {
  version: 1;
  zones: Zone[];
  items: Item[];
  cast: CastShadow;
  /** Masque PNG des éléments de la photo qui passent devant les articles marqués « derrière ». */
  foreground: string | null;
  /** Photo importée avant toute gomme ou changement de décor (pour revenir en arrière). */
  baseOriginal: string | null;
  /** États précédents de la photo, le plus récent en dernier (« Annuler la dernière retouche »). */
  baseHistory: BaseStep[];
  analyse: AnalyseInfo | null;
  optimise: Optimise | null;
};

export type BaseStep = { base: string; visibles: string[]; foreground: string | null };
export const MAX_HISTORY = 12;

/** Ajoute l'état actuel à l'historique avant une retouche (taille bornée). */
export function pushHistory(scene: Scene, base: string): Scene {
  const step: BaseStep = { base, visibles: scene.zones.filter((z) => z.visible).map((z) => z.id), foreground: scene.foreground };
  return { ...scene, baseOriginal: scene.baseOriginal ?? base, baseHistory: [...scene.baseHistory, step].slice(-MAX_HISTORY) };
}

/** Retire la dernière étape : renvoie la scène restaurée et la photo à réafficher. */
export function popHistory(scene: Scene): { scene: Scene; base: string } | null {
  const step = scene.baseHistory.at(-1);
  if (!step) return null;
  const rest = scene.baseHistory.slice(0, -1);
  return {
    base: step.base,
    scene: {
      ...scene,
      baseHistory: rest,
      baseOriginal: rest.length ? scene.baseOriginal : null,
      foreground: step.foreground,
      zones: scene.zones.map((z) => ({ ...z, visible: step.visibles.includes(z.id) })),
    },
  };
}

export const DEFAULT_SHADOW: Shadow = { opacity: 0.45, blur: 0.5, size: 1 };

export const newScene = (): Scene => ({
  version: 1,
  zones: [],
  items: [],
  cast: { ...DEFAULT_CAST },
  foreground: null,
  baseOriginal: null,
  baseHistory: [],
  analyse: null,
  optimise: null,
});

/** Empreinte de ce qui se voit sur le visuel (photo, finitions, articles, ombres) : un
 *  rendu optimisé n'est réutilisé que si rien n'a changé depuis. */
export function compositionKey(scene: Scene, basePath: string) {
  const vu = JSON.stringify([
    basePath,
    scene.foreground,
    scene.cast,
    scene.items,
    scene.zones.map((z) => [z.mask, z.finish, z.quad, z.repetitions, z.lumiere, z.visible, z.surface, z.aspect]),
  ]);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < vu.length; i++) {
    const c = vu.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

const num = (v: unknown, d: number, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

/** Lit une composition enregistrée en tolérant les champs manquants (anciennes versions). */
export function parseScene(text: string | null | undefined): Scene {
  let raw: Record<string, unknown> = {};
  try {
    const v = JSON.parse(text || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const zones = Array.isArray(raw["zones"]) ? (raw["zones"] as Record<string, unknown>[]) : [];
  const items = Array.isArray(raw["items"]) ? (raw["items"] as Record<string, unknown>[]) : [];
  return {
    version: 1,
    foreground: str(raw["foreground"]),
    cast: ((c: Record<string, unknown>) => ({
      length: num(c["length"], DEFAULT_CAST.length, 0, 2),
      direction: num(c["direction"], DEFAULT_CAST.direction, -75, 75),
      behind: c["behind"] !== false,
      opacity: num(c["opacity"], DEFAULT_CAST.opacity, 0, 1),
    }))((raw["cast"] ?? {}) as Record<string, unknown>),
    baseOriginal: str(raw["baseOriginal"]),
    analyse: ((a: unknown): AnalyseInfo | null => {
      if (!a || typeof a !== "object") return null;
      const o = a as Record<string, unknown>;
      const t = (o["temps"] ?? {}) as Record<string, unknown>;
      return {
        temps: Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>,
        apercu: typeof o["apercu"] === "number" && Number.isFinite(o["apercu"]) ? (o["apercu"] as number) : null,
        date: str(o["date"]) ?? "",
      };
    })(raw["analyse"]),
    optimise: ((o: unknown): Optimise | null => {
      if (!o || typeof o !== "object") return null;
      const r = o as Record<string, unknown>;
      const image = str(r["image"]), cle = str(r["cle"]);
      return image && cle ? { image, cle, duree: num(r["duree"], 0, 0, 3600) } : null;
    })(raw["optimise"]),
    baseHistory: (Array.isArray(raw["baseHistory"]) ? (raw["baseHistory"] as Record<string, unknown>[]) : [])
      .filter((h) => h && typeof h === "object" && typeof h["base"] === "string")
      .map((h) => ({
        base: h["base"] as string,
        visibles: Array.isArray(h["visibles"]) ? (h["visibles"] as unknown[]).filter((v): v is string => typeof v === "string") : [],
        foreground: str(h["foreground"]),
      }))
      .slice(-MAX_HISTORY),
    zones: zones
      .filter((z) => z && typeof z === "object" && typeof z["id"] === "string")
      .map((z) => {
        const f = z["finish"] as Record<string, unknown> | null | undefined;
        const q = z["quad"];
        return {
          id: z["id"] as string,
          name: str(z["name"]) ?? "Mur",
          mask: str(z["mask"]),
          finish:
            f && typeof f === "object" && ["peinture", "papier", "enduit"].includes(f["kind"] as string)
              ? {
                  id: str(f["id"]),
                  kind: f["kind"] as FinishKind,
                  name: str(f["name"]) ?? "Finition",
                  reference: str(f["reference"]),
                  color: str(f["color"]),
                  texture: str(f["texture"]),
                  marque: str(f["marque"]),
                  gamme: str(f["gamme"]),
                  finition: str(f["finition"]),
                }
              : null,
          quad: Array.isArray(q) && q.length === 4 && q.every(isPoint) ? (q as Quad) : null,
          repetitions: num(z["repetitions"], 4, 0.2, 60),
          lumiere: num(z["lumiere"], 1, 0, 2),
          visible: z["visible"] !== false,
          surface: isSurface(z["surface"]) ? z["surface"] : "mur",
          aspect: isAspect(z["aspect"]) ? z["aspect"] : null,
          auto: z["auto"] === true,
        };
      }),
    items: items
      .filter((i) => i && typeof i === "object" && typeof i["productId"] === "string")
      .map((i, n) => {
        const s = (i["shadow"] ?? {}) as Record<string, unknown>;
        return {
          uid: str(i["uid"]) ?? `item-${n}`,
          productId: i["productId"] as string,
          photoId: str(i["photoId"]),
          x: num(i["x"], 0.5, -0.5, 1.5),
          y: num(i["y"], 0.8, -0.5, 1.5),
          h: num(i["h"], 0.3, 0.01, 3),
          flip: i["flip"] === true,
          rot: num(i["rot"], 0, -180, 180),
          shadow: {
            opacity: num(s["opacity"], DEFAULT_SHADOW.opacity, 0, 1),
            blur: num(s["blur"], DEFAULT_SHADOW.blur, 0, 1),
            size: num(s["size"], DEFAULT_SHADOW.size, 0, 3),
          },
          behind: i["behind"] === true,
          light: {
            bright: num((i["light"] as Record<string, unknown> | undefined)?.["bright"], 1, 0.4, 1.8),
            warm: num((i["light"] as Record<string, unknown> | undefined)?.["warm"], 0, -1, 1),
          },
        };
      }),
  };
}

export const serializeScene = (scene: Scene) => JSON.stringify(scene);

/** Une variante dupliquée est indépendante (copie profonde). */
export const duplicateScene = (scene: Scene): Scene => parseScene(serializeScene(scene));

export type Box = { x: number; y: number; w: number; h: number };

/** Cadre d'un article en pixels de l'image : sa base (pieds) est posée sur le point d'ancrage. */
export function itemBox(item: Item, aspect: number, W: number, H: number): Box {
  const h = item.h * H;
  const w = h * (aspect > 0 ? aspect : 1);
  return { x: item.x * W - w / 2, y: item.y * H - h, w, h };
}

/** Ordre de dessin : d'abord les articles « derrière », puis les autres, dans l'ordre d'ajout. */
export const drawOrder = (items: Item[]) => [...items.filter((i) => i.behind), ...items.filter((i) => !i.behind)];

/** Article sous le pointeur (le plus en avant d'abord). */
export function hitItem(items: Item[], boxes: Map<string, Box>, px: number, py: number): string | null {
  const order = drawOrder(items).reverse();
  for (const it of order) {
    const b = boxes.get(it.uid);
    if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return it.uid;
  }
  return null;
}

/** Échelle « à la taille réelle » : hauteur de l'article à partir d'une hauteur de référence. */
export function scaleFromReference(objectCm: number, referenceCm: number, referenceFraction: number) {
  if (!(objectCm > 0) || !(referenceCm > 0)) return referenceFraction;
  return (objectCm / referenceCm) * referenceFraction;
}

export type View = { scale: number; ox: number; oy: number };

/** Vue qui montre toute l'image dans le cadre, centrée. */
export function fitView(W: number, H: number, cw: number, ch: number): View {
  const scale = Math.min(cw / W, ch / H);
  return { scale, ox: (cw - W * scale) / 2, oy: (ch - H * scale) / 2 };
}

export const toImage = (v: View, sx: number, sy: number): Point => [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];

/** Zoom autour d'un point de l'écran (le point sous la souris reste fixe). */
export function zoomAt(v: View, factor: number, sx: number, sy: number, min = 0.02, max = 16): View {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const k = scale / v.scale;
  return { scale, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
}

export type ProductLike = {
  id: string;
  sku: string;
  name: string;
  sale_price_ttc: number | string;
  pro_price_ttc: number | string;
};

export type ReferenceLine = { productId: string; sku: string; name: string; qty: number; unit: number; total: number };
export type FinishLine = {
  kind: FinishKind;
  name: string;
  reference: string | null;
  color: string | null;
  marque: string | null;
  aspect: Aspect | null;
  zones: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Liste des références et quantités utilisées dans une variante (articles puis finitions). */
export function referenceList(scene: Scene, products: ProductLike[], opts: { pro: boolean; discount: number }) {
  const lines = new Map<string, ReferenceLine>();
  for (const it of scene.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) continue;
    const unit = Number(opts.pro ? p.pro_price_ttc : p.sale_price_ttc);
    const l = lines.get(p.id) ?? { productId: p.id, sku: p.sku, name: p.name, qty: 0, unit, total: 0 };
    l.qty += 1;
    l.total = round2(l.qty * unit);
    lines.set(p.id, l);
  }
  const finishes = new Map<string, FinishLine>();
  for (const z of scene.zones) {
    if (!z.finish || !z.visible || !z.mask) continue;
    const aspect = z.finish.kind === "peinture" ? zoneAspect(z) : null;
    const key = `${z.finish.kind}|${z.finish.marque ?? ""}|${z.finish.reference ?? ""}|${z.finish.name}|${z.finish.color ?? ""}|${aspect ?? ""}`;
    const f = finishes.get(key) ?? {
      kind: z.finish.kind,
      name: z.finish.name,
      reference: z.finish.reference,
      color: z.finish.color,
      marque: z.finish.marque,
      aspect,
      zones: [],
    };
    f.zones.push(z.name);
    finishes.set(key, f);
  }
  const items = [...lines.values()];
  const subtotal = round2(items.reduce((s, l) => s + l.total, 0));
  const total = round2(subtotal * (1 - Math.min(100, Math.max(0, opts.discount)) / 100));
  return { items, finishes: [...finishes.values()], subtotal, total };
}

/** Lignes pour l'export CSV (compatible Excel FR). */
export function referenceRows(list: ReturnType<typeof referenceList>) {
  return [
    ...list.items.map((l) => ({ Type: "Article", Référence: l.sku, Désignation: l.name, Quantité: l.qty, "Prix unitaire TTC": l.unit, "Total TTC": l.total })),
    ...list.finishes.map((f) => ({
      Type: f.kind === "peinture" ? "Peinture" : f.kind === "papier" ? "Papier peint / revêtement" : "Enduit",
      Référence: [f.marque, f.reference].filter(Boolean).join(" · "),
      Désignation: finishLabel(f),
      Quantité: f.zones.length,
      "Prix unitaire TTC": "",
      "Total TTC": "",
    })),
  ];
}

/** « Marque – Nom (#couleur), satiné » pour la fiche client et le CSV. */
export function finishLabel(f: Pick<FinishLine, "name" | "color" | "marque" | "aspect">) {
  const nom = f.marque ? `${f.marque} – ${f.name}` : f.name;
  const couleur = f.color ? ` (${f.color})` : "";
  return `${nom}${couleur}${f.aspect ? `, ${aspectLabel(f.aspect).toLowerCase()}` : ""}`;
}

/** Rectangle par défaut pour un papier peint : la boîte englobante de la sélection. */
export function defaultQuad(bbox: { x0: number; y0: number; x1: number; y1: number }): Quad {
  return [
    [bbox.x0, bbox.y0],
    [bbox.x1, bbox.y0],
    [bbox.x1, bbox.y1],
    [bbox.x0, bbox.y1],
  ];
}

/** Rectangle de départ pour un sol vu en perspective : le bord du fond est plus étroit. */
export function floorQuad(bbox: { x0: number; y0: number; x1: number; y1: number }): Quad {
  const w = bbox.x1 - bbox.x0;
  return [
    [bbox.x0 + w * 0.3, bbox.y0],
    [bbox.x1 - w * 0.3, bbox.y0],
    [bbox.x1 + w * 0.5, bbox.y1],
    [bbox.x0 - w * 0.5, bbox.y1],
  ];
}

/** Nom libre suivant : « Variante B », « Variante C »… */
export function nextVariantName(existing: string[]) {
  for (let i = 0; i < 26; i++) {
    const n = `Variante ${String.fromCharCode(65 + i)}`;
    if (!existing.includes(n)) return n;
  }
  return `Variante ${existing.length + 1}`;
}

/** Taille de travail d'une photo importée : format d'origine conservé, grand côté limité. */
export function workingSize(w: number, h: number, max = 2400) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

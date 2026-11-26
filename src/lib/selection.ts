/**
 * « Ma sélection » : la liste d'achat de ce qui est visible dans la pièce, calculée à
 * chaque instant depuis la scène. Une surface ne retient que sa dernière finition ; deux
 * fauteuils identiques font deux unités. Les revêtements sont chiffrés à partir de la
 * surface réelle (m²) et du conditionnement du produit : quantité = ⌈ m² × couches ÷ m²
 * par unité ⌉. Ce qui manque (surface, prix, conditionnement) est « à renseigner » et
 * rend le total partiel.
 */
import type { StudioRows } from "@/lib/records";
import { aspectLabel, zoneAspect, type ProductLike, type Scene } from "@/lib/scene";

type Finish = StudioRows["finishes"];

export type LigneFinition = {
  cle: string;
  finishId: string | null;
  kind: Finish["kind"];
  nom: string;
  marque: string | null;
  reference: string | null;
  color: string | null;
  texture: string | null;
  aspect: string | null;
  zones: { id: string; nom: string; m2: number | null }[];
  /** Somme des m² des surfaces ; null si l'une d'elles n'est pas renseignée. */
  m2: number | null;
  couches: number;
  m2ParUnite: number | null;
  unite: string;
  quantite: number | null;
  prixUnitaire: number | null;
  total: number | null;
};

export type LigneObjet = { productId: string; sku: string; nom: string; image: string | null; quantite: number; prixUnitaire: number | null; total: number | null };

export type MaSelection = {
  finitions: LigneFinition[];
  objets: LigneObjet[];
  sousTotal: number;
  remise: number;
  total: number;
  /** Au moins une ligne n'est pas chiffrée : le total ne couvre pas tout. */
  partiel: boolean;
  manques: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const positif = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Quantité à acheter : ⌈ m² × couches ÷ m² par unité ⌉ (sans marge). */
export function quantiteRevetement(m2: number | null, couches: number, m2ParUnite: number | null) {
  if (!m2 || !m2ParUnite) return null;
  return Math.ceil((m2 * Math.max(1, couches)) / m2ParUnite - 1e-9);
}

export function maSelection(
  scene: Scene,
  products: (ProductLike & { image_url?: string | null; cutout_url?: string | null })[],
  finishes: Finish[],
  opts: { pro: boolean; discount: number },
): MaSelection {
  const finitions = new Map<string, LigneFinition>();
  for (const z of scene.zones) {
    if (!z.finish || !z.visible || !z.mask) continue;
    const f = z.finish;
    const aspect = f.kind === "peinture" ? aspectLabel(zoneAspect(z)).toLowerCase() : null;
    const cle = `${f.id ?? `couleur:${f.color}`}|${aspect ?? ""}`;
    const fiche = f.id ? finishes.find((x) => x.id === f.id) : undefined;
    const l = finitions.get(cle) ?? {
      cle,
      finishId: f.id,
      kind: f.kind,
      nom: fiche?.name ?? f.name,
      marque: fiche?.marque ?? f.marque,
      reference: fiche?.reference ?? f.reference,
      color: f.color,
      texture: f.texture,
      aspect,
      zones: [],
      m2: 0,
      couches: Math.max(1, Math.round(positif(fiche?.couches) ?? (f.kind === "peinture" ? 2 : 1))),
      m2ParUnite: positif(fiche?.m2_par_unite),
      unite: fiche?.unite?.trim() || (f.kind === "peinture" ? "pot" : f.kind === "papier" ? (z.surface === "sol" ? "paquet" : "rouleau") : "unité"),
      quantite: null,
      prixUnitaire: positif(fiche?.prix_ttc),
      total: null,
    };
    l.zones.push({ id: z.id, nom: z.name, m2: z.m2 });
    l.m2 = l.m2 === null || z.m2 === null ? null : r2(l.m2 + z.m2);
    finitions.set(cle, l);
  }
  const manques: string[] = [];
  for (const l of finitions.values()) {
    l.quantite = quantiteRevetement(l.m2, l.couches, l.m2ParUnite);
    l.total = l.quantite !== null && l.prixUnitaire !== null ? r2(l.quantite * l.prixUnitaire) : null;
    if (l.m2 === null) manques.push(`surface de ${l.zones.filter((z) => z.m2 === null).map((z) => z.nom).join(", ")}`);
    if (l.m2ParUnite === null) manques.push(`conditionnement de « ${l.nom} »`);
    if (l.prixUnitaire === null) manques.push(`prix de « ${l.nom} »`);
  }
  const objets = new Map<string, LigneObjet>();
  for (const it of scene.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) continue;
    const prix = positif(opts.pro ? p.pro_price_ttc : p.sale_price_ttc);
    const o = objets.get(p.id) ?? { productId: p.id, sku: p.sku, nom: p.name, image: p.cutout_url ?? p.image_url ?? null, quantite: 0, prixUnitaire: prix, total: null };
    o.quantite += 1;
    o.total = o.prixUnitaire !== null ? r2(o.quantite * o.prixUnitaire) : null;
    objets.set(p.id, o);
  }
  for (const o of objets.values()) if (o.prixUnitaire === null) manques.push(`prix de « ${o.nom} »`);
  const lignes = [...finitions.values(), ...objets.values()];
  const sousTotal = r2(lignes.reduce((s, l) => s + (l.total ?? 0), 0));
  const remise = opts.pro ? Math.min(100, Math.max(0, opts.discount)) : 0;
  return {
    finitions: [...finitions.values()],
    objets: [...objets.values()],
    sousTotal,
    remise,
    total: r2(sousTotal * (1 - remise / 100)),
    partiel: lignes.some((l) => l.total === null),
    manques,
  };
}

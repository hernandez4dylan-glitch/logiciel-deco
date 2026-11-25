/**
 * Import d'un nuancier fournisseur (CSV enregistré depuis Excel) dans la bibliothèque
 * de teintes et matières. Les références se saisissent une fois, puis s'enrichissent
 * au fil des imports : une ligne déjà connue (même marque + même référence) est mise
 * à jour au lieu d'être dupliquée.
 */
import type { CsvRow } from "@/lib/csv";
import type { Aspect, FinishKind, Surface } from "@/lib/scene";

export type NuancierLigne = {
  kind: FinishKind;
  marque: string | null;
  gamme: string | null;
  name: string;
  reference: string | null;
  color: string | null;
  finition: string | null;
  usage: Surface | null;
  motif_cm: number | null;
};

export type Existante = { id: string; kind: FinishKind; marque: string | null; reference: string | null; name: string };

export type PlanImport = {
  ajouts: NuancierLigne[];
  majs: { id: string; ligne: NuancierLigne }[];
  erreurs: { ligne: number; message: string }[];
};

/** Lecture CSV tolérante : « ; », « , » ou tabulation, guillemets, BOM, fins de ligne Windows. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, premiere.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COLONNES: Record<string, keyof NuancierLigne> = {
  type: "kind",
  categorie: "kind",
  marque: "marque",
  fournisseur: "marque",
  fabricant: "marque",
  gamme: "gamme",
  collection: "gamme",
  nom: "name",
  teinte: "name",
  designation: "name",
  reference: "reference",
  ref: "reference",
  code: "reference",
  couleur: "color",
  hex: "color",
  "code couleur": "color",
  finition: "finition",
  aspect: "finition",
  usage: "usage",
  pour: "usage",
  surface: "usage",
  motif: "motif_cm",
  "largeur du motif (cm)": "motif_cm",
  "motif (cm)": "motif_cm",
};

/** Finition normalisée d'une peinture (« Satiné », « laqué »…). */
export function lireAspect(v: string): Aspect | null {
  const s = sansAccent(v);
  if (!s) return null;
  if (s.startsWith("mat")) return "mat";
  if (s.startsWith("velour")) return "velours";
  if (s.startsWith("satin") || s.includes("semi")) return "satin";
  if (s.startsWith("brillant") || s.startsWith("laque") || s.includes("gloss")) return "brillant";
  return null;
}

function lireUsage(v: string): Surface | null {
  const s = sansAccent(v);
  if (!s || s.startsWith("tou")) return null;
  if (s.startsWith("mur")) return "mur";
  if (s.startsWith("plafond")) return "plafond";
  if (s.startsWith("porte")) return "porte";
  if (s.startsWith("cadre") || s.startsWith("huisserie") || s.startsWith("menuiserie")) return "cadre";
  if (s.startsWith("sol") || s.startsWith("parquet")) return "sol";
  return "autre";
}

function lireType(v: string): { kind: FinishKind; usage?: Surface } | null {
  const s = sansAccent(v);
  if (!s || s.startsWith("peinture") || s === "teinte") return { kind: "peinture" };
  if (s.startsWith("papier") || s.startsWith("tapisserie")) return { kind: "papier" };
  if (s.startsWith("sol") || s.startsWith("revetement") || s.startsWith("parquet") || s.startsWith("carrelage")) return { kind: "papier", usage: "sol" };
  if (s.startsWith("enduit") || s.startsWith("beton")) return { kind: "enduit" };
  return null;
}

function lireCouleur(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  const hex = s.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return "#" + hex.toUpperCase();
  const rgb = s.match(/^(?:rgb\s*\(?)?\s*(\d{1,3})\s*[,; ]\s*(\d{1,3})\s*[,; ]\s*(\d{1,3})\s*\)?$/i);
  if (rgb) {
    const n = rgb.slice(1, 4).map(Number);
    if (n.every((x) => x <= 255)) return "#" + n.map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return undefined; // illisible
}

/** Transforme les lignes du fichier en teintes, avec un message clair par ligne refusée. */
export function lireNuancier(text: string): { lignes: { n: number; ligne: NuancierLigne }[]; erreurs: PlanImport["erreurs"] } {
  const rows = parseCsv(text);
  const erreurs: PlanImport["erreurs"] = [];
  if (rows.length < 2) return { lignes: [], erreurs: [{ ligne: 1, message: "Fichier vide ou sans en-tête" }] };
  const entetes = rows[0]!.map((h) => COLONNES[sansAccent(h)] ?? null);
  if (!entetes.includes("name")) return { lignes: [], erreurs: [{ ligne: 1, message: "Colonne « Nom » introuvable (voir le modèle)" }] };
  const lignes: { n: number; ligne: NuancierLigne }[] = [];
  rows.slice(1).forEach((r, i) => {
    const n = i + 2;
    const v: Partial<Record<keyof NuancierLigne, string>> = {};
    entetes.forEach((k, j) => {
      if (k) v[k] = (r[j] ?? "").trim();
    });
    const type = lireType(v.kind ?? "");
    if (!type) return void erreurs.push({ ligne: n, message: `Type inconnu « ${v.kind} » (peinture, papier peint, sol, enduit)` });
    const name = (v.name ?? "").trim();
    if (!name) return void erreurs.push({ ligne: n, message: "Nom vide" });
    const color = lireCouleur(v.color ?? "");
    if (color === undefined) return void erreurs.push({ ligne: n, message: `Couleur illisible « ${v.color} » (ex. #8A9A8C ou 138,154,140)` });
    if (type.kind === "peinture" && !color) return void erreurs.push({ ligne: n, message: "Couleur manquante pour une peinture" });
    let finition: string | null = (v.finition ?? "").trim() || null;
    if (type.kind === "peinture" && finition) {
      const a = lireAspect(finition);
      if (!a) return void erreurs.push({ ligne: n, message: `Finition inconnue « ${finition} » (mat, velours, satiné, brillant)` });
      finition = a;
    }
    const motif = (v.motif_cm ?? "").replace(",", ".").trim();
    const motif_cm = motif ? Number(motif) : null;
    if (motif_cm !== null && !(motif_cm > 0)) return void erreurs.push({ ligne: n, message: `Largeur de motif invalide « ${v.motif_cm} »` });
    const trop = [v.marque, v.gamme, name, v.reference].some((x) => (x ?? "").length > 120);
    if (trop) return void erreurs.push({ ligne: n, message: "Texte trop long (120 caractères maximum)" });
    lignes.push({
      n,
      ligne: {
        kind: type.kind,
        marque: v.marque || null,
        gamme: v.gamme || null,
        name,
        reference: v.reference || null,
        color: type.kind === "papier" ? null : color,
        finition,
        usage: v.usage ? lireUsage(v.usage) : (type.usage ?? null),
        motif_cm,
      },
    });
  });
  return { lignes, erreurs };
}

const cle = (kind: FinishKind, marque: string | null, reference: string | null, name: string) =>
  reference ? `${kind}|${sansAccent(marque ?? "")}|ref:${sansAccent(reference)}` : `${kind}|${sansAccent(marque ?? "")}|nom:${sansAccent(name)}`;

/** Sépare les nouvelles teintes des teintes déjà connues (même marque + référence, ou même nom sans référence). */
export function planifierImport(text: string, existantes: Existante[]): PlanImport {
  const { lignes, erreurs } = lireNuancier(text);
  const connues = new Map(existantes.map((e) => [cle(e.kind, e.marque, e.reference, e.name), e.id]));
  const vues = new Set<string>();
  const plan: PlanImport = { ajouts: [], majs: [], erreurs };
  for (const { n, ligne } of lignes) {
    const k = cle(ligne.kind, ligne.marque, ligne.reference, ligne.name);
    if (vues.has(k)) {
      plan.erreurs.push({ ligne: n, message: "Doublon dans le fichier (même marque et référence)" });
      continue;
    }
    vues.add(k);
    const id = connues.get(k);
    if (id) plan.majs.push({ id, ligne });
    else plan.ajouts.push(ligne);
  }
  return plan;
}

/** Modèle à remplir dans Excel (exemples fictifs à remplacer par le nuancier du fournisseur). */
export const MODELE_NUANCIER: CsvRow[] = [
  { Type: "Peinture", Marque: "Marque exemple", Gamme: "Intérieur", Nom: "Vert sauge", Référence: "000", Couleur: "#8A9A8C", Finition: "Velours", Usage: "Mur", "Largeur du motif (cm)": "" },
  { Type: "Peinture", Marque: "Marque exemple", Gamme: "Boiseries", Nom: "Bleu nuit", Référence: "001", Couleur: "#1F2A3A", Finition: "Satiné", Usage: "Porte", "Largeur du motif (cm)": "" },
  { Type: "Peinture", Marque: "Marque exemple", Gamme: "Intérieur", Nom: "Blanc plafond", Référence: "002", Couleur: "#F1EDE4", Finition: "Mat", Usage: "Plafond", "Largeur du motif (cm)": "" },
];

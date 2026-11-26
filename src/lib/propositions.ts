/**
 * Propositions d'aménagement faites dès l'import, à partir des surfaces trouvées par
 * l'analyse de la pièce et des finitions réellement disponibles dans la bibliothèque.
 * Aucune finition n'est inventée : s'il n'y a qu'une peinture, il n'y a qu'une proposition.
 */
import type { StudioRows } from "@/lib/records";
import type { FinishSnapshot, Surface, Zone } from "@/lib/scene";

type Finish = StudioRows["finishes"];

export type Affectation = { zoneId: string; finish: Finish };
export type Proposition = { id: string; titre: string; affectations: Affectation[] };

export function snapshotDe(f: Finish): FinishSnapshot {
  return {
    id: f.id,
    kind: f.kind,
    name: f.name,
    reference: f.reference,
    color: f.color,
    texture: f.texture_path,
    marque: f.marque ?? null,
    gamme: f.gamme ?? null,
    finition: f.finition,
  };
}

/** Clarté d'une teinte (0 noir … 1 blanc) pour repérer un blanc de plafond. */
function clarte(hex: string | null) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const pour = (f: Finish, s: Surface) => !f.usage || f.usage === s;

/** Le pan de mur « du fond » : celui que l'analyse a nommé ainsi, sinon le plus grand. */
export function murDuFond(murs: Zone[]) {
  return murs.find((z) => z.name.startsWith("Mur du fond")) ?? murs[0] ?? null;
}

export function proposer(zones: Zone[], finishes: Finish[], max = 4): Proposition[] {
  const murs = zones.filter((z) => z.surface === "mur" && z.mask);
  if (!murs.length) return [];
  const plafond = zones.find((z) => z.surface === "plafond" && z.mask);
  const sol = zones.find((z) => z.surface === "sol" && z.mask);
  const peintures = finishes.filter((f) => f.kind === "peinture" && f.color && pour(f, "mur"));
  const enduits = finishes.filter((f) => f.kind === "enduit" && pour(f, "mur"));
  const papiers = finishes.filter((f) => f.kind === "papier" && f.texture_path && f.usage !== "sol" && pour(f, "mur"));
  const sols = finishes.filter((f) => f.kind === "papier" && f.texture_path && f.usage === "sol");
  const blancs = finishes
    .filter((f) => f.kind === "peinture" && f.color && pour(f, "plafond") && clarte(f.color) > 0.85)
    .sort((a, b) => Number(b.usage === "plafond") - Number(a.usage === "plafond") || clarte(b.color) - clarte(a.color));
  const fond = murDuFond(murs);
  const autres = murs.filter((z) => z !== fond);
  const plafondBlanc = (): Affectation[] => (plafond && blancs[0] ? [{ zoneId: plafond.id, finish: blancs[0] }] : []);
  const tous = (f: Finish): Affectation[] => murs.map((z) => ({ zoneId: z.id, finish: f }));
  const out: Proposition[] = [];
  const ajouter = (titre: string, a: Affectation[]) => {
    const cle = a.map((x) => x.zoneId + x.finish.id).sort().join();
    if (a.length && !out.some((p) => p.affectations.map((x) => x.zoneId + x.finish.id).sort().join() === cle))
      out.push({ id: `p${out.length + 1}`, titre, affectations: a });
  };
  // Teintes murales dans l'ordre de la bibliothèque, sans les blancs (réservés au plafond)
  // quand il y a d'autres choix.
  const murales = peintures.filter((f) => clarte(f.color) <= 0.9);
  const choix = murales.length ? murales : peintures;
  const p1 = choix[0], p2 = choix[1] ?? choix[0], p3 = choix[2] ?? choix[0];
  if (p1) ajouter(`${p1.name} sur les murs`, [...tous(p1), ...plafondBlanc()]);
  if (fond && enduits[0])
    ajouter(
      autres.length ? `${enduits[0].name} sur le mur du fond` : `${enduits[0].name} sur les murs`,
      [{ zoneId: fond.id, finish: enduits[0] }, ...(p2 ? autres.map((z) => ({ zoneId: z.id, finish: p2 })) : []), ...plafondBlanc()],
    );
  if (fond && papiers[0])
    ajouter(
      autres.length ? `Papier peint ${papiers[0].name} au fond` : `Papier peint ${papiers[0].name}`,
      [{ zoneId: fond.id, finish: papiers[0] }, ...(p1 ? autres.map((z) => ({ zoneId: z.id, finish: p1 })) : []), ...plafondBlanc()],
    );
  if (p3 && sol && sols[0]) ajouter(`${p3.name} et sol ${sols[0].name}`, [...tous(p3), { zoneId: sol.id, finish: sols[0] }, ...plafondBlanc()]);
  for (const f of choix.slice(1)) if (out.length < max) ajouter(`${f.name} sur les murs`, [...tous(f), ...plafondBlanc()]);
  return out.slice(0, max);
}

/** Lignes « Murs : Beige lin · réf. 204 » affichées sous un aperçu. */
export function lignesReferences(p: Proposition, zones: Zone[]) {
  const parFinition = new Map<string, { f: Finish; zones: string[] }>();
  for (const a of p.affectations) {
    const z = zones.find((x) => x.id === a.zoneId);
    if (!z) continue;
    const e = parFinition.get(a.finish.id) ?? { f: a.finish, zones: [] };
    e.zones.push(z.name);
    parFinition.set(a.finish.id, e);
  }
  return [...parFinition.values()].map(({ f, zones: zs }) => ({
    zones: zs.join(", "),
    nom: [f.marque, f.name].filter(Boolean).join(" – "),
    reference: f.reference,
    color: f.color,
    texture: f.texture_path,
  }));
}

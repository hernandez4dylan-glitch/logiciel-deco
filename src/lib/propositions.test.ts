import { describe, expect, it } from "vitest";
import { lignesReferences, proposer } from "./propositions";
import type { StudioRows } from "./records";
import type { Zone } from "./scene";

type F = StudioRows["finishes"];
const f = (p: Partial<F> & Pick<F, "id" | "kind" | "name">): F => ({
  reference: null, color: null, texture_path: null, motif_cm: null, finition: null, marque: null, gamme: null, usage: null,
  created_at: "", updated_at: "", ...p,
});
const z = (id: string, name: string, surface: Zone["surface"]): Zone => ({
  id, name, mask: `${id}.png`, finish: null, quad: null, repetitions: 4, lumiere: 1, visible: true, surface, aspect: null, auto: true,
});
const zones = [z("g", "Mur gauche", "mur"), z("f", "Mur du fond", "mur"), z("p", "Plafond", "plafond"), z("s", "Sol", "sol")];
const lib = [
  f({ id: "beige", kind: "peinture", name: "Beige lin", reference: "204", color: "#D8C7AE", marque: "Marque A" }),
  f({ id: "sauge", kind: "peinture", name: "Sauge", color: "#A9B5A0" }),
  f({ id: "blanc", kind: "peinture", name: "Blanc plafond", color: "#F4F1EA", usage: "plafond" }),
  f({ id: "chaux", kind: "enduit", name: "Chaux sable", color: "#CDBFA8", texture_path: "chaux.jpg" }),
  f({ id: "pp", kind: "papier", name: "Feuillage", texture_path: "feuillage.png" }),
  f({ id: "parquet", kind: "papier", name: "Chêne", texture_path: "parquet.jpg", usage: "sol" }),
  f({ id: "porte", kind: "peinture", name: "Bleu porte", color: "#1F2A3A", usage: "porte" }),
];

describe("propositions dès l'import", () => {
  it("combine les finitions réelles du catalogue sur les surfaces détectées", () => {
    const ps = proposer(zones, lib);
    expect(ps.map((p) => p.titre)).toEqual([
      "Beige lin sur les murs",
      "Chaux sable sur le mur du fond",
      "Papier peint Feuillage au fond",
      "Beige lin et sol Chêne",
    ]);
    const chaux = ps[1]!.affectations.map((a) => [a.zoneId, a.finish.id]);
    expect(chaux).toEqual([["f", "chaux"], ["g", "sauge"], ["p", "blanc"]]);
    // Une peinture réservée aux portes ne va jamais sur les murs.
    expect(ps.flatMap((p) => p.affectations).some((a) => a.finish.id === "porte" && a.zoneId !== "p")).toBe(false);
  });
  it("indique la référence sous chaque aperçu", () => {
    const l = lignesReferences(proposer(zones, lib)[0]!, zones);
    expect(l[0]).toMatchObject({ zones: "Mur gauche, Mur du fond", nom: "Marque A – Beige lin", reference: "204" });
    expect(l[1]).toMatchObject({ zones: "Plafond", nom: "Blanc plafond" });
  });
  it("rien à proposer sans mur détecté ni finition", () => {
    expect(proposer([z("p", "Plafond", "plafond")], lib)).toEqual([]);
    expect(proposer(zones, [])).toEqual([]);
  });
});

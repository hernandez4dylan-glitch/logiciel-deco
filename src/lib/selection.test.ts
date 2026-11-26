import { describe, expect, it } from "vitest";
import { maSelection, quantiteRevetement } from "./selection";
import { newScene, type Item, type Scene, type Zone } from "./scene";
import type { StudioRows } from "./records";

type F = StudioRows["finishes"];
const fin = (p: Partial<F> & Pick<F, "id" | "kind" | "name">): F => ({
  reference: null, color: null, texture_path: null, motif_cm: null, finition: null, marque: null, gamme: null, usage: null,
  created_at: "", updated_at: "", ...p,
});
const snap = (f: F) => ({ id: f.id, kind: f.kind, name: f.name, reference: f.reference, color: f.color, texture: f.texture_path, marque: f.marque, gamme: f.gamme, finition: f.finition });
const zone = (id: string, f: F | null, m2: number | null, surface: Zone["surface"] = "mur"): Zone => ({
  id, name: id, mask: `${id}.png`, finish: f ? snap(f) : null, quad: null, repetitions: 4, lumiere: 1, visible: true, surface, aspect: null, auto: true, m2, rotation: 0,
});
const item = (uid: string, productId: string): Item => ({
  uid, productId, photoId: null, x: 0.5, y: 0.8, h: 0.3, flip: false, rot: 0, shadow: { opacity: 0.4, blur: 0.5, size: 1 }, behind: false, light: { bright: 1, warm: 0 },
});
const products = [
  { id: "fauteuil", sku: "MOB-1", name: "Fauteuil", sale_price_ttc: 549, pro_price_ttc: 469, image_url: null, cutout_url: null },
  { id: "vase", sku: "DEC-2", name: "Vase", sale_price_ttc: 0, pro_price_ttc: 0, image_url: null, cutout_url: null },
];
const parquet = fin({ id: "parquet", kind: "papier", name: "Chêne clair", reference: "PQ-1", prix_ttc: 64.9, unite: "paquet", m2_par_unite: 2.2, couches: 1, usage: "sol" });
const bleu = fin({ id: "bleu", kind: "peinture", name: "Bleu", color: "#1F2A3A", prix_ttc: 39, unite: "pot 2,5 L", m2_par_unite: 25, couches: 2 });
const beige = fin({ id: "beige", kind: "peinture", name: "Beige", color: "#D8C7AE", prix_ttc: 35, m2_par_unite: 25, couches: 2 });

describe("Ma sélection", () => {
  it("18 m² de parquet en paquets de 2,2 m² : 9 paquets chiffrés", () => {
    expect(quantiteRevetement(18, 1, 2.2)).toBe(9);
    const s: Scene = { ...newScene(), zones: [zone("Sol", parquet, 18, "sol")] };
    const sel = maSelection(s, products, [parquet], { pro: false, discount: 0 });
    expect(sel.finitions[0]).toMatchObject({ quantite: 9, unite: "paquet", prixUnitaire: 64.9, total: 584.1 });
    expect(sel.partiel).toBe(false);
  });
  it("seule la dernière teinte d'un mur compte ; deux couches de peinture", () => {
    const s: Scene = { ...newScene(), zones: [zone("Mur du fond", beige, 30)] };
    // Le mur a d'abord été bleu : la scène ne garde que la finition actuelle.
    const sel = maSelection(s, products, [bleu, beige], { pro: false, discount: 0 });
    expect(sel.finitions.map((f) => f.nom)).toEqual(["Beige"]);
    expect(sel.finitions[0]).toMatchObject({ quantite: 3, total: 105 }); // 30 × 2 ÷ 25 = 2,4 → 3 pots
  });
  it("deux fauteuils identiques = 2 unités ; un retiré = 1", () => {
    const deux: Scene = { ...newScene(), items: [item("a", "fauteuil"), item("b", "fauteuil")] };
    expect(maSelection(deux, products, [], { pro: false, discount: 0 }).objets[0]).toMatchObject({ quantite: 2, total: 1098 });
    const un: Scene = { ...deux, items: [item("a", "fauteuil")] };
    expect(maSelection(un, products, [], { pro: false, discount: 0 }).objets[0]).toMatchObject({ quantite: 1, total: 549 });
  });
  it("surface ou prix manquant : à renseigner, total partiel", () => {
    const s: Scene = { ...newScene(), zones: [zone("Mur", beige, null)], items: [item("v", "vase"), item("f", "fauteuil")] };
    const sel = maSelection(s, products, [beige], { pro: false, discount: 0 });
    expect(sel.finitions[0]!.quantite).toBeNull();
    expect(sel.objets.find((o) => o.productId === "vase")!.total).toBeNull();
    expect(sel.partiel).toBe(true);
    expect(sel.total).toBe(549);
    expect(sel.manques.join(" ")).toMatch(/surface de Mur/);
  });
  it("tarif pro et remise", () => {
    const s: Scene = { ...newScene(), items: [item("a", "fauteuil")] };
    expect(maSelection(s, products, [], { pro: true, discount: 10 })).toMatchObject({ sousTotal: 469, total: 422.1 });
  });
});

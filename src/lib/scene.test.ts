import { describe, expect, it } from "vitest";
import {
  drawOrder,
  duplicateScene,
  fitView,
  hitItem,
  itemBox,
  newScene,
  nextVariantName,
  parseScene,
  referenceList,
  referenceRows,
  serializeScene,
  toImage,
  workingSize,
  zoomAt,
  type Item,
  type Scene,
} from "./scene";

const item = (p: Partial<Item> = {}): Item => ({
  uid: "a",
  productId: "p1",
  photoId: null,
  x: 0.5,
  y: 0.8,
  h: 0.3,
  flip: false,
  rot: 0,
  shadow: { opacity: 0.4, blur: 0.5, size: 1 },
  behind: false,
  ...p,
});

const products = [
  { id: "p1", sku: "MOB-BOU-002", name: "Fauteuil bouclette", sale_price_ttc: 549, pro_price_ttc: 469 },
  { id: "p2", sku: "DEC-GRE-003", name: "Vase en grès", sale_price_ttc: "59.00", pro_price_ttc: 49 },
];

describe("format conservé", () => {
  it("garde les proportions d'un panoramique et d'une photo verticale", () => {
    expect(workingSize(6000, 2000)).toEqual({ width: 2400, height: 800 });
    expect(workingSize(1080, 1920)).toEqual({ width: 1080, height: 1920 }); // jamais agrandie
    expect(workingSize(2160, 3840)).toEqual({ width: 1350, height: 2400 });
    expect(workingSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("ancrage des articles", () => {
  it("pose la base de l'article sur le point d'ancrage", () => {
    const b = itemBox(item({ x: 0.5, y: 0.8, h: 0.25 }), 0.8, 1600, 900);
    expect(b.y + b.h).toBeCloseTo(0.8 * 900); // les pieds touchent le sol
    expect(b.x + b.w / 2).toBeCloseTo(800);
    expect(b.h).toBeCloseTo(225);
    expect(b.w).toBeCloseTo(180);
  });
  it("trouve l'article sous le pointeur, celui de devant d'abord", () => {
    const items = [item({ uid: "dos", behind: true }), item({ uid: "face" })];
    const boxes = new Map(items.map((i) => [i.uid, itemBox(i, 1, 1000, 1000)]));
    expect(hitItem(items, boxes, 500, 700)).toBe("face");
    expect(hitItem(items, boxes, 10, 10)).toBeNull();
    expect(drawOrder(items).map((i) => i.uid)).toEqual(["dos", "face"]);
  });
});

describe("vue et zoom", () => {
  it("ajuste l'image au cadre puis zoome autour de la souris", () => {
    const v = fitView(2000, 1000, 1000, 1000);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.oy).toBeCloseTo(250);
    const before = toImage(v, 300, 400);
    const z = zoomAt(v, 2, 300, 400);
    const after = toImage(z, 300, 400);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(z.scale).toBeCloseTo(1);
  });
});

describe("composition enregistrée", () => {
  it("relit ce qu'elle a écrit et tolère les anciennes versions", () => {
    const s: Scene = {
      ...newScene(),
      items: [item()],
      zones: [
        {
          id: "z1",
          name: "Mur du fond",
          mask: "masque-1.png",
          finish: { id: "f1", kind: "peinture", name: "Beige mat", reference: "MAG-12", color: "#D8C7AE", texture: null },
          quad: null,
          repetitions: 4,
          lumiere: 1,
          visible: true,
        },
      ],
    };
    expect(parseScene(serializeScene(s))).toEqual(s);
    expect(parseScene("pas du json")).toEqual(newScene());
    const vieux = parseScene(JSON.stringify({ items: [{ productId: "p1", x: 9 }], zones: [{ id: "z", finish: { kind: "vernis" } }] }));
    expect(vieux.items[0]!.x).toBe(1.5);
    expect(vieux.items[0]!.shadow.opacity).toBeGreaterThan(0);
    expect(vieux.zones[0]!.finish).toBeNull();
  });
  it("duplique une variante sans lien avec l'originale", () => {
    const s: Scene = { ...newScene(), items: [item()] };
    const d = duplicateScene(s);
    d.items[0]!.x = 0.1;
    expect(s.items[0]!.x).toBe(0.5);
  });
  it("nomme les variantes A, B, C…", () => {
    expect(nextVariantName([])).toBe("Variante A");
    expect(nextVariantName(["Variante A", "Variante B"])).toBe("Variante C");
  });
});

describe("références et quantités", () => {
  it("compte les articles et liste les finitions avec leur référence", () => {
    const s: Scene = {
      ...newScene(),
      items: [item({ uid: "1" }), item({ uid: "2" }), item({ uid: "3", productId: "p2" }), item({ uid: "4", productId: "inconnu" })],
      zones: [
        { id: "z1", name: "Mur du fond", mask: "m1.png", finish: { id: "f", kind: "peinture", name: "Beige mat", reference: "MAG-12", color: "#D8C7AE", texture: null }, quad: null, repetitions: 4, lumiere: 1, visible: true },
        { id: "z2", name: "Mur gauche", mask: "m2.png", finish: { id: "f", kind: "peinture", name: "Beige mat", reference: "MAG-12", color: "#D8C7AE", texture: null }, quad: null, repetitions: 4, lumiere: 1, visible: true },
        { id: "z3", name: "Brouillon", mask: null, finish: { id: "g", kind: "papier", name: "Motif", reference: "PP-1", color: null, texture: "t.png" }, quad: null, repetitions: 4, lumiere: 1, visible: true },
      ],
    };
    const list = referenceList(s, products, { pro: true, discount: 10 });
    expect(list.items).toEqual([
      { productId: "p1", sku: "MOB-BOU-002", name: "Fauteuil bouclette", qty: 2, unit: 469, total: 938 },
      { productId: "p2", sku: "DEC-GRE-003", name: "Vase en grès", qty: 1, unit: 49, total: 49 },
    ]);
    expect(list.subtotal).toBe(987);
    expect(list.total).toBe(888.3);
    expect(list.finishes).toEqual([{ kind: "peinture", name: "Beige mat", reference: "MAG-12", color: "#D8C7AE", zones: ["Mur du fond", "Mur gauche"] }]);
    const rows = referenceRows(list);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ Type: "Peinture", Référence: "MAG-12", Quantité: 2 });
    expect(referenceList(s, products, { pro: false, discount: 0 }).items[1]!.unit).toBe(59);
  });
});

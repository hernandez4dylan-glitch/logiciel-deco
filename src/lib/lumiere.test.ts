import { describe, expect, it } from "vitest";
import { accordLight, castMatrix, lightFilter, stats, UndoStack, warmTint } from "./lumiere";
import { DEFAULT_CAST, newScene, parseScene, serializeScene } from "./scene";

const px = (rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe("lumière des articles", () => {
  it("mesure luminance et chaleur en ignorant la transparence", () => {
    const s = stats(px([[200, 150, 100, 255], [0, 0, 0, 0], [100, 100, 100, 255]]))!;
    expect(s.warm).toBe(50);
    expect(s.lum).toBeCloseTo((0.2126 * 200 + 0.7152 * 150 + 0.0722 * 100 + 100) / 2);
    expect(stats(px([[1, 2, 3, 0]]))).toBeNull();
  });
  it("assombrit un article de studio posé dans un coin sombre et chaud, sans le dénaturer", () => {
    const l = accordLight({ lum: 70, warm: 60 }, { lum: 200, warm: 5 });
    expect(l.bright).toBeLessThan(1);
    expect(l.bright).toBeGreaterThanOrEqual(0.65);
    expect(l.warm).toBeGreaterThan(0);
    expect(l.warm).toBeLessThanOrEqual(0.6);
    expect(accordLight({ lum: 150, warm: 10 }, { lum: 150, warm: 10 })).toEqual({ bright: 1, warm: 0 });
  });
  it("traduit la lumière en filtre et en voile", () => {
    expect(lightFilter({ bright: 1, warm: 0 })).toBe("none");
    expect(lightFilter({ bright: 0.8, warm: 0 })).toBe("brightness(0.8)");
    expect(warmTint(0)).toBeNull();
    expect(warmTint(0.5)).toMatch(/^rgba\(255, 170, 90/);
    expect(warmTint(-0.5)).toMatch(/^rgba\(110, 150, 255/);
  });
});

describe("ombre portée", () => {
  const box = { x: 100, y: 200, w: 80, h: 120 };
  it("part de la base de l'article, vers le fond ou vers l'avant", () => {
    const m = castMatrix(box, { ...DEFAULT_CAST, length: 1, direction: 0 });
    expect([m.e, m.f]).toEqual([140, 320]);
    // le haut de l'article (y = −h) tombe derrière la base (plus haut dans l'image)
    expect(m.d * -box.h + m.f).toBeLessThan(320);
    const devant = castMatrix(box, { ...DEFAULT_CAST, length: 1, behind: false });
    expect(devant.d * -box.h + devant.f).toBeGreaterThan(320);
    expect(castMatrix(box, { ...DEFAULT_CAST, length: 0 }).d).toBe(0);
  });
  it("s'incline selon la direction de la lumière", () => {
    const gauche = castMatrix(box, { ...DEFAULT_CAST, length: 1, direction: -30 });
    const droite = castMatrix(box, { ...DEFAULT_CAST, length: 1, direction: 30 });
    expect(gauche.c * -box.h).toBeLessThan(0); // le sommet de l'ombre part à gauche
    expect(droite.c * -box.h).toBeGreaterThan(0);
  });
});

describe("annuler / rétablir", () => {
  it("revient en arrière puis rétablit, et oublie le futur après une nouvelle action", () => {
    const u = new UndoStack<string>(3);
    u.record("a");
    u.record("b");
    expect(u.undo("c")).toBe("b");
    expect(u.undo("b")).toBe("a");
    expect(u.undo("a")).toBeNull();
    expect(u.redo("a")).toBe("b");
    u.record("b");
    expect(u.canRedo).toBe(false);
    for (const s of ["x", "y", "z", "w"]) u.record(s);
    let n = 0;
    while (u.undo("?") !== null) n++;
    expect(n).toBe(3);
  });
});

describe("composition enregistrée", () => {
  it("relit ombre portée et lumière d'article, avec des valeurs par défaut pour les anciens projets", () => {
    const s = parseScene(JSON.stringify({ items: [{ productId: "p", light: { bright: 9 } }] }));
    expect(s.cast).toEqual(DEFAULT_CAST);
    expect(s.items[0]!.light).toEqual({ bright: 1.8, warm: 0 });
    const n = { ...newScene(), cast: { length: 1.2, direction: 20, behind: false, opacity: 0.5 } };
    expect(parseScene(serializeScene(n)).cast).toEqual(n.cast);
  });
});

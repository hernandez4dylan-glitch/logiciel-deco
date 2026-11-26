import { describe, expect, it } from "vitest";
import { autoEnhance, rgbToHex, sampleColor, type Pixels } from "./couleur";
import { newScene, parseScene, popHistory, pushHistory, serializeScene, MAX_HISTORY, type Scene } from "./scene";

const plein = (w: number, h: number, rgb: [number, number, number], a = 255): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, a], i);
  return { data, width: w, height: h };
};

describe("pipette", () => {
  it("prélève la teinte sans être faussée par un pixel isolé", () => {
    const img = plein(20, 20, [216, 199, 174]);
    img.data.set([255, 255, 255, 255], (10 * 20 + 10) * 4); // reflet
    expect(sampleColor(img, 10, 10)).toBe("#D8C7AE");
    expect(sampleColor(img, 0, 0)).toBe("#D8C7AE"); // bord de l'image
    expect(sampleColor(img, -50, -50)).toBeNull();
    expect(rgbToHex(300, -4, 15.6)).toBe("#FF0010");
  });
});

describe("correction automatique de lumière", () => {
  it("éclaircit une photo terne et neutralise une dominante", () => {
    // Photo sous-exposée à dominante jaune : dégradé R 60→200, G 50→170, B 20→140.
    const img = plein(100, 1, [0, 0, 0]);
    for (let i = 0; i < 100; i++) img.data.set([60 + i * 1.4, 50 + i * 1.2, 20 + i * 1.2, 255], i * 4);
    const out = autoEnhance(img);
    const moy = (p: Pixels, c: number) => { let s = 0; for (let i = c; i < p.data.length; i += 4) s += p.data[i]!; return s / (p.data.length / 4); };
    expect(moy(out, 0)).toBeGreaterThan(moy(img, 0));
    // la dominante jaune (R ≫ B) est réduite
    expect(moy(out, 0) - moy(out, 2)).toBeLessThan(moy(img, 0) - moy(img, 2));
  });
  it("ignore et conserve les pixels transparents", () => {
    const img = plein(4, 4, [0, 0, 0], 0);
    img.data.set([120, 110, 90, 255], 0);
    const out = autoEnhance(img);
    expect(out.data[7]).toBe(0);
    expect(out.data[3]).toBe(255);
  });
});

describe("historique des retouches de la photo", () => {
  it("annule la dernière retouche et restaure surfaces et premier plan", () => {
    let s: Scene = {
      ...newScene(),
      foreground: "pp-1.png",
      zones: [
        { id: "z1", name: "Mur", mask: "m.png", finish: null, quad: null, repetitions: 4, lumiere: 1, visible: true, surface: "mur", aspect: null, auto: false, m2: null, rotation: 0 },
        { id: "z2", name: "Plafond", mask: "p.png", finish: null, quad: null, repetitions: 4, lumiere: 1, visible: false, surface: "mur", aspect: null, auto: false, m2: null, rotation: 0 },
      ],
    };
    s = pushHistory(s, "base-1.jpg");
    expect(s.baseOriginal).toBe("base-1.jpg");
    // changement de décor : surfaces masquées, premier plan vidé
    s = { ...s, foreground: null, zones: s.zones.map((z) => ({ ...z, visible: false })) };
    s = pushHistory(s, "base-2.jpg");
    const u1 = popHistory(s)!;
    expect(u1.base).toBe("base-2.jpg");
    const u2 = popHistory(u1.scene)!;
    expect(u2.base).toBe("base-1.jpg");
    expect(u2.scene.foreground).toBe("pp-1.png");
    expect(u2.scene.zones.map((z) => z.visible)).toEqual([true, false]);
    expect(u2.scene.baseOriginal).toBeNull();
    expect(popHistory(u2.scene)).toBeNull();
  });
  it("borne l'historique et le relit après enregistrement", () => {
    let s = newScene();
    for (let i = 0; i < MAX_HISTORY + 5; i++) s = pushHistory(s, `b-${i}.jpg`);
    expect(s.baseHistory).toHaveLength(MAX_HISTORY);
    expect(s.baseOriginal).toBe("b-0.jpg");
    expect(parseScene(serializeScene(s))).toEqual(s);
  });
});

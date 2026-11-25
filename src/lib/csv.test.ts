import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("utilise ; et la virgule décimale pour Excel", () => {
    expect(toCsv([{ Nom: "Vase", Prix: 59.5 }])).toBe("Nom;Prix\r\nVase;59,5");
  });
  it("protège les valeurs contenant un point-virgule", () => {
    expect(toCsv([{ Nom: 'a;b "c"' }])).toBe('Nom\r\n"a;b ""c"""');
  });
});

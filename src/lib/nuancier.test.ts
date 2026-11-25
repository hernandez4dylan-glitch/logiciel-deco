import { describe, expect, it } from "vitest";
import { lireAspect, lireNuancier, parseCsv, planifierImport, MODELE_NUANCIER } from "./nuancier";
import { toCsv } from "./csv";

describe("parseCsv", () => {
  it("lit le CSV d'Excel FR (point-virgule, guillemets, BOM)", () => {
    expect(parseCsv('﻿Nom;Couleur\r\n"Vert; sauge";#8A9A8C\r\n')).toEqual([["Nom", "Couleur"], ["Vert; sauge", "#8A9A8C"]]);
  });
  it("accepte la virgule comme séparateur", () => {
    expect(parseCsv("Nom,Couleur\nA,#000000")).toEqual([["Nom", "Couleur"], ["A", "#000000"]]);
  });
});

describe("lireNuancier", () => {
  it("relit le modèle téléchargé", () => {
    const { lignes, erreurs } = lireNuancier(toCsv(MODELE_NUANCIER));
    expect(erreurs).toEqual([]);
    expect(lignes.map((l) => l.ligne.finition)).toEqual(["velours", "satin", "mat"]);
    expect(lignes[1]!.ligne).toMatchObject({ kind: "peinture", marque: "Marque exemple", usage: "porte", color: "#1F2A3A" });
  });
  it("normalise finitions, couleurs et types", () => {
    expect(lireAspect("Satiné")).toBe("satin");
    expect(lireAspect("Laqué")).toBe("brillant");
    const { lignes, erreurs } = lireNuancier("Type;Nom;Couleur;Finition\nPeinture;A;8a9a8c;mat\nSol;Chêne;;\nPeinture;B;138,154,140;Velours");
    expect(erreurs).toEqual([]);
    expect(lignes[0]!.ligne.color).toBe("#8A9A8C");
    expect(lignes[1]!.ligne).toMatchObject({ kind: "papier", usage: "sol", color: null });
    expect(lignes[2]!.ligne.color).toBe("#8A9A8C");
  });
  it("refuse les lignes incomplètes avec un message par ligne", () => {
    const { lignes, erreurs } = lireNuancier("Type;Nom;Couleur;Finition\nPeinture;;#000000;mat\nPeinture;X;beige;mat\nVernis;Y;#000000;\nPeinture;Z;#000000;mouillé");
    expect(lignes).toEqual([]);
    expect(erreurs.map((e) => e.ligne)).toEqual([2, 3, 4, 5]);
  });
  it("exige une colonne Nom", () => {
    expect(lireNuancier("Couleur\n#000000").erreurs[0]!.message).toMatch(/Nom/);
  });
});

describe("planifierImport", () => {
  it("met à jour une référence connue au lieu de la dupliquer", () => {
    const csv = "Type;Marque;Nom;Référence;Couleur\nPeinture;Marque A;Vert;12;#00AA00\nPeinture;Marque A;Rouge;13;#AA0000\nPeinture;Marque A;Rouge bis;13;#AA0000";
    const plan = planifierImport(csv, [{ id: "x", kind: "peinture", marque: "marque a", reference: "12", name: "Ancien nom" }]);
    expect(plan.majs).toEqual([{ id: "x", ligne: expect.objectContaining({ name: "Vert", reference: "12" }) }]);
    expect(plan.ajouts.map((a) => a.name)).toEqual(["Rouge"]);
    expect(plan.erreurs).toEqual([{ ligne: 4, message: expect.stringMatching(/Doublon/) }]);
  });
});

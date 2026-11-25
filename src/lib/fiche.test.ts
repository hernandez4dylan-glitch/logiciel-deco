import { describe, expect, it } from "vitest";
import { ficheHtml } from "./fiche";

const list = {
  items: [{ productId: "p", sku: "MOB-BOU-002", name: "Fauteuil <bouclette>", qty: 2, unit: 549, total: 1098 }],
  finishes: [{ kind: "peinture" as const, name: "Beige mat", reference: "MAG-12", color: "#D8C7AE", zones: ["Mur du fond"] }],
  subtotal: 1098,
  total: 988.2,
};

describe("fiche client", () => {
  it("liste références, quantités, finitions et totaux, texte échappé", () => {
    const html = ficheHtml({ projet: "Salon Dupont", client: "Mme D.", variante: "Variante B", image: "data:image/jpeg;base64,AAA", list, tarif: "pro", remise: 10, date: new Date(2026, 10, 25) });
    expect(html).toContain("MOB-BOU-002");
    expect(html).toContain("Fauteuil &lt;bouclette&gt;");
    expect(html).not.toContain("<bouclette>");
    expect(html).toContain("MAG-12");
    expect(html).toContain("Mur du fond");
    expect(html).toContain("Remise 10 %");
    expect(html).toContain("Variante B");
    expect(html).toContain("25 novembre 2026");
  });
});

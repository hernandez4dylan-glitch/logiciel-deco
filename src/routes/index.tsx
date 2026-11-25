import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Un Instant Chez Moi — Gestion de boutique déco" },
      {
        name: "description",
        content: "Stock, fournisseurs, devis et dépenses de votre boutique de décoration au même endroit.",
      },
      { property: "og:title", content: "Un Instant Chez Moi — Gestion de boutique déco" },
      {
        property: "og:description",
        content: "Stock, fournisseurs, devis et dépenses de votre boutique de décoration au même endroit.",
      },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/tableau-de-bord" });
  },
});

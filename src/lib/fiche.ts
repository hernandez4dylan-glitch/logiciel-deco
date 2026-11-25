import { eur } from "@/lib/format";
import { finishLabel, type referenceList } from "@/lib/scene";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const KIND: Record<string, string> = { peinture: "Peinture", papier: "Papier peint / revêtement", enduit: "Enduit / béton ciré" };

/** Page HTML autonome de la proposition : visuel, articles retenus, finitions et totaux. */
export function ficheHtml(o: {
  projet: string;
  client: string | null;
  variante: string;
  image: string;
  list: ReturnType<typeof referenceList>;
  tarif: "public" | "pro";
  remise: number;
  date?: Date;
}) {
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(o.date ?? new Date());
  const rows = o.list.items
    .map((l) => `<tr><td>${esc(l.sku)}</td><td>${esc(l.name)}</td><td class="n">${l.qty}</td><td class="n">${eur(l.unit)}</td><td class="n">${eur(l.total)}</td></tr>`)
    .join("");
  const fin = o.list.finishes
    .map(
      (f) =>
        `<tr><td>${esc(f.reference ?? "—")}</td><td>${f.color ? `<span class="sw" style="background:${esc(f.color)}"></span>` : ""}${esc(KIND[f.kind] ?? f.kind)} · ${esc(finishLabel(f))}</td><td>${esc(f.zones.join(", "))}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(o.projet)} — ${esc(o.variante)}</title><style>
*{box-sizing:border-box}body{font:13px/1.45 system-ui,sans-serif;color:#2d2621;margin:24px}
h1{font:500 24px Georgia,serif;margin:0}p{margin:2px 0}img{width:100%;border-radius:6px;margin:14px 0}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e4ddd3;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#7a6d62}.n{text-align:right;white-space:nowrap}
.sw{display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid #0002;margin-right:6px;vertical-align:-2px}
.tot{font-size:15px;font-weight:600}.muted{color:#7a6d62;font-size:11px}@page{margin:12mm}
</style></head><body>
<h1>${esc(o.projet)}</h1><p>${o.client ? `Client : ${esc(o.client)} · ` : ""}${esc(o.variante)} · ${esc(date)}</p>
<img src="${o.image}" alt="Proposition ${esc(o.variante)}">
<h2>Articles retenus</h2>
<table><thead><tr><th>Référence</th><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire TTC${o.tarif === "pro" ? " (Pro)" : ""}</th><th class="n">Total TTC</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Aucun article</td></tr>`}</tbody></table>
<p class="tot">Sous-total : ${eur(o.list.subtotal)}${o.remise > 0 ? ` · Remise ${o.remise} % · Total : ${eur(o.list.total)}` : ""}</p>
${fin ? `<h2>Finitions murales</h2><table><thead><tr><th>Référence</th><th>Finition</th><th>Surfaces</th></tr></thead><tbody>${fin}</tbody></table>` : ""}
<p class="muted">Visuel de projection réalisé en magasin : les couleurs à l'écran ou à l'impression peuvent différer des échantillons réels.</p>
</body></html>`;
}

/** Ouvre la fiche dans une fenêtre et lance l'impression (choisir « Enregistrer en PDF » pour un fichier). */
export function printFiche(html: string) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) throw new Error("La fenêtre d'impression a été bloquée par le navigateur");
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => {
    w.focus();
    w.print();
  };
  const img = w.document.images[0];
  if (img && !img.complete) img.onload = go;
  else setTimeout(go, 50);
}

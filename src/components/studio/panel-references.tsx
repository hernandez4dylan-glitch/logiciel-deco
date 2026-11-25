import { useState } from "react";
import { eur } from "@/lib/format";
import { referenceList, finishLabel } from "@/lib/scene";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "@/components/studio/workspace";

export type Tarif = "public" | "pro";

/** Liste chiffrée de la variante : articles (références, quantités) et finitions murales. */
export function PanelReferences({ api, discount }: { api: WorkspaceApi; discount: number }) {
  const [tarif, setTarif] = useState<Tarif>(() => (localStorageGet("studio-tarif") as Tarif) || "public");
  const list = referenceList(api.scene, api.products, { pro: tarif === "pro", discount: tarif === "pro" ? discount : 0 });
  return (
    <section className="surface grid gap-3 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-medium">Liste chiffrée</h3>
        <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Tarif">
          {(["public", "pro"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tarif === t}
              onClick={() => {
                setTarif(t);
                localStorageSet("studio-tarif", t);
              }}
              className={cn("rounded px-2 py-0.5", tarif === t ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {t === "public" ? "Public" : "Pro"}
            </button>
          ))}
        </div>
      </div>
      {list.items.length === 0 ? (
        <p className="text-muted-foreground">Aucun article placé.</p>
      ) : (
        <ul className="divide-y">
          {list.items.map((l) => (
            <li key={l.productId} className="flex items-start justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.sku} · {l.qty} × {eur(l.unit)}</span>
              </span>
              <span className="tabular">{eur(l.total)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-1 border-t pt-2">
        <div className="flex justify-between"><dt className="text-muted-foreground">Sous-total TTC</dt><dd className="tabular">{eur(list.subtotal)}</dd></div>
        {tarif === "pro" && discount > 0 && (
          <div className="flex justify-between"><dt className="text-muted-foreground">Remise partenaire {discount} %</dt><dd className="tabular">− {eur(list.subtotal - list.total)}</dd></div>
        )}
        <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular text-primary">{eur(list.total)}</dd></div>
      </dl>
      {list.finishes.length > 0 && (
        <div className="grid gap-1 border-t pt-2">
          <p className="font-medium">Finitions</p>
          {list.finishes.map((f) => (
            <p key={`${f.kind}${f.marque}${f.reference}${f.name}${f.aspect}`} className="flex items-center gap-2 text-xs">
              {f.color && <span className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: f.color }} />}
              <span className="min-w-0">
                <span className="font-medium">{finishLabel(f)}</span>
                {f.reference ? ` · réf. ${f.reference}` : ""} — {f.zones.join(", ")}
              </span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export function localStorageGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function localStorageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : préférence non mémorisée */
  }
}

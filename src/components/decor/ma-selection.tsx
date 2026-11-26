import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { eur } from "@/lib/format";
import { photoUrl } from "@/lib/studio-api";
import type { MaSelection } from "@/lib/selection";
import { cn } from "@/lib/utils";

const fmtQ = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Liste d'achat de ce qui est visible dans la pièce, chiffrée en direct. */
export function ListeAchat({
  sel,
  onM2,
  compacte = false,
}: {
  sel: MaSelection;
  onM2?: (zoneId: string, m2: number | null) => void;
  compacte?: boolean;
}) {
  const aRenseigner = <span className="font-medium text-amber-700">À renseigner</span>;
  return (
    <div className="grid gap-3 text-sm">
      {sel.finitions.length === 0 && sel.objets.length === 0 && (
        <p className="text-muted-foreground">Rien encore dans la pièce : essayez une teinte ou glissez un objet.</p>
      )}
      {sel.finitions.length > 0 && (
        <section className="grid gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Finitions</h4>
          {sel.finitions.map((l) => (
            <div key={l.cle} className="grid gap-1 rounded-md border p-2">
              <div className="flex items-start gap-2">
                {l.texture ? (
                  <img src={photoUrl(l.texture)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded border" style={{ backgroundColor: l.color ?? "#ddd" }} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{[l.marque, l.nom].filter(Boolean).join(" – ")}{l.aspect ? `, ${l.aspect}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{l.reference ? `réf. ${l.reference}` : "sans référence"} · {l.zones.map((z) => z.nom).join(", ")}</p>
                </div>
                <div className="text-right text-xs">
                  {l.total !== null ? <span className="font-medium">{eur(l.total)}</span> : aRenseigner}
                </div>
              </div>
              {!compacte && onM2 && (
                <div className="grid gap-1 pl-11">
                  {l.zones.map((z) => (
                    <label key={z.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      {z.nom}
                      <span className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          step={0.1}
                          className={cn("h-7 w-20 text-right", z.m2 === null && "border-amber-500")}
                          value={z.m2 ?? ""}
                          placeholder="m²"
                          aria-label={`Surface de ${z.nom} en m²`}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(",", "."));
                            onM2(z.id, e.target.value === "" || !(v > 0) ? null : Math.round(v * 100) / 100);
                          }}
                        />
                        m²
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="pl-11 text-xs text-muted-foreground">
                {l.m2 === null ? <>Surface {aRenseigner}</> : <>{fmtQ(l.m2)} m²{l.couches > 1 ? ` × ${l.couches} couches` : ""}</>}
                {" → "}
                {l.quantite !== null ? (
                  <strong className="text-foreground">{l.quantite} {l.unite}{l.quantite > 1 && !/s$/.test(l.unite) ? "s" : ""}</strong>
                ) : l.m2ParUnite === null ? (
                  <>conditionnement {aRenseigner}</>
                ) : (
                  aRenseigner
                )}
                {l.m2ParUnite !== null ? ` (${fmtQ(l.m2ParUnite)} m² par ${l.unite}, hors marge)` : ""}
                {" · "}
                {l.prixUnitaire !== null ? `${eur(l.prixUnitaire)} / ${l.unite}` : <>prix {aRenseigner}</>}
              </p>
            </div>
          ))}
        </section>
      )}
      {sel.objets.length > 0 && (
        <section className="grid gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objets</h4>
          {sel.objets.map((o) => (
            <div key={o.productId} className="flex items-center gap-2 rounded-md border p-2">
              {o.image ? <img src={photoUrl(o.image)} alt="" className="h-9 w-9 shrink-0 rounded object-contain" /> : <span className="h-9 w-9 shrink-0 rounded bg-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium leading-tight">{o.nom}</p>
                <p className="text-xs text-muted-foreground">réf. {o.sku} · {o.quantite} × {o.prixUnitaire !== null ? eur(o.prixUnitaire) : "prix à renseigner"}</p>
              </div>
              <span className="text-xs font-medium">{o.total !== null ? eur(o.total) : aRenseigner}</span>
            </div>
          ))}
        </section>
      )}
      <section className="grid gap-1 border-t pt-2">
        {sel.remise > 0 && (
          <p className="flex justify-between text-xs text-muted-foreground"><span>Sous-total</span><span>{eur(sel.sousTotal)}</span></p>
        )}
        {sel.remise > 0 && (
          <p className="flex justify-between text-xs text-muted-foreground"><span>Remise partenaire {sel.remise} %</span><span>−{eur(sel.sousTotal - sel.total)}</span></p>
        )}
        <p className="flex justify-between font-semibold"><span>Total TTC{sel.partiel ? " (partiel)" : ""}</span><span>{eur(sel.total)}</span></p>
        {sel.partiel && (
          <p className="text-xs text-amber-700">Total partiel : {sel.manques.slice(0, 4).join(" ; ")}{sel.manques.length > 4 ? "…" : ""} à renseigner.</p>
        )}
      </section>
    </div>
  );
}

export function MaSelectionSheet({
  open,
  onOpenChange,
  sel,
  onM2,
  pro,
  onPro,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sel: MaSelection;
  onM2: (zoneId: string, m2: number | null) => void;
  pro: boolean;
  onPro: (pro: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Ma sélection</SheetTitle>
          <SheetDescription>Ce qui est visible dans la pièce. Renseignez les m² pour chiffrer les revêtements.</SheetDescription>
        </SheetHeader>
        <div className="my-3 flex gap-1 text-xs">
          <Button size="sm" variant={!pro ? "default" : "outline"} className="h-7" onClick={() => onPro(false)}>Tarif public</Button>
          <Button size="sm" variant={pro ? "default" : "outline"} className="h-7" onClick={() => onPro(true)}>Tarif pro</Button>
        </div>
        <ListeAchat sel={sel} onM2={onM2} />
      </SheetContent>
    </Sheet>
  );
}

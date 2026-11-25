import { useEffect, useState } from "react";
import { Columns2, Loader2, SplitSquareHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { composeVariant, type PhotoRow } from "@/lib/compose";
import type { ProductRow } from "@/lib/data";
import { eur } from "@/lib/format";
import type { StudioRows } from "@/lib/records";
import { parseScene, referenceList } from "@/lib/scene";
import { canvasToDataUrl } from "@/lib/studio-api";

type Variant = StudioRows["variants"];

/** Compare deux propositions : rideau glissant ou côte à côte, avec leurs listes de références. */
export function CompareDialog({
  open,
  onOpenChange,
  variants,
  initial,
  products,
  photos,
  tarifPro,
  discount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variants: Variant[];
  initial: [string, string];
  products: ProductRow[];
  photos: PhotoRow[];
  tarifPro: boolean;
  discount: number;
}) {
  const [a, setA] = useState(initial[0]);
  const [b, setB] = useState(initial[1]);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"rideau" | "cote">("rideau");
  const [cut, setCut] = useState(50);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setA(initial[0]);
      setB(initial[1]);
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    for (const id of [a, b]) {
      const row = variants.find((v) => v.id === id);
      if (!row || imgs[`${id}|${row.updated_at}`]) continue;
      composeVariant(row, parseScene(row.data), products, photos, 1800)
        .then((c) => canvasToDataUrl(c, "image/jpeg", 0.9))
        .then((url) => alive && setImgs((m) => ({ ...m, [`${id}|${row.updated_at}`]: url })))
        .catch((e) => alive && setError(e instanceof Error ? e.message : "Rendu impossible"));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, a, b, variants]);

  const rowA = variants.find((v) => v.id === a);
  const rowB = variants.find((v) => v.id === b);
  const imgA = rowA ? imgs[`${a}|${rowA.updated_at}`] : undefined;
  const imgB = rowB ? imgs[`${b}|${rowB.updated_at}`] : undefined;
  const opts = { pro: tarifPro, discount: tarifPro ? discount : 0 };
  const lists = [rowA, rowB].map((r) => (r ? referenceList(parseScene(r.data), products, opts) : null));

  const pick = (value: string, set: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger className="w-48" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {variants.map((v) => (
          <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[96vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comparer deux propositions</DialogTitle>
          <DialogDescription>Les deux variantes sont rendues telles qu'elles seront remises au client.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {pick(a, setA, "Proposition de gauche")}
          <span className="text-muted-foreground">et</span>
          {pick(b, setB, "Proposition de droite")}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant={mode === "rideau" ? "default" : "outline"} onClick={() => setMode("rideau")}><SplitSquareHorizontal className="h-4 w-4" /> Rideau</Button>
            <Button size="sm" variant={mode === "cote" ? "default" : "outline"} onClick={() => setMode("cote")}><Columns2 className="h-4 w-4" /> Côte à côte</Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!imgA || !imgB ? (
          <p className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Rendu des propositions…</p>
        ) : mode === "rideau" ? (
          <div className="grid gap-2">
            <div className="relative overflow-hidden rounded-lg border">
              <img src={imgB} alt={rowB?.name} className="block w-full" />
              <img src={imgA} alt={rowA?.name} className="absolute inset-0 block h-full w-full" style={{ clipPath: `inset(0 ${100 - cut}% 0 0)` }} />
              <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${cut}%` }} />
              <span className="absolute left-2 top-2 rounded bg-card/90 px-2 py-0.5 text-xs">{rowA?.name}</span>
              <span className="absolute right-2 top-2 rounded bg-card/90 px-2 py-0.5 text-xs">{rowB?.name}</span>
            </div>
            <Slider min={0} max={100} value={[cut]} onValueChange={([v]) => setCut(v ?? 50)} aria-label="Position du rideau" />
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            <figure><img src={imgA} alt={rowA?.name} className="w-full rounded-lg border" /><figcaption className="mt-1 text-sm">{rowA?.name}</figcaption></figure>
            <figure><img src={imgB} alt={rowB?.name} className="w-full rounded-lg border" /><figcaption className="mt-1 text-sm">{rowB?.name}</figcaption></figure>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {lists.map((l, i) => (
            <div key={i} className="rounded-lg border p-3 text-sm">
              <p className="mb-1 font-medium">{[rowA, rowB][i]?.name}</p>
              {l?.items.map((x) => (
                <p key={x.productId} className="flex justify-between gap-2"><span className="truncate">{x.qty} × {x.name} <span className="text-xs text-muted-foreground">{x.sku}</span></span><span className="tabular">{eur(x.total)}</span></p>
              ))}
              {l?.finishes.map((f) => (
                <p key={f.name + f.reference} className="text-xs text-muted-foreground">{f.name}{f.reference ? ` · ${f.reference}` : ""} — {f.zones.join(", ")}</p>
              ))}
              <p className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular">{eur(l?.total ?? 0)}</span></p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

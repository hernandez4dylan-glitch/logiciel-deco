import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, Crosshair, FlipHorizontal2, Layers, Paintbrush, Scissors, Search, ShieldMinus, Sun, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ProductImage } from "@/components/app/product-image";
import { ProductPhotosDialog, productPhotoChoices, saveCutout } from "@/components/app/product-photos-dialog";
import { cn } from "@/lib/utils";
import { photoEngine, photoUrl, pathToDataUrl } from "@/lib/studio-api";
import type { WorkspaceApi } from "@/components/studio/workspace";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function PanelArticles({ api }: { api: WorkspaceApi }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cutting, setCutting] = useState(false);
  const it = api.selected;
  const product = it ? api.products.find((p) => p.id === it.productId) : null;
  const choices = product ? productPhotoChoices(product, api.photos) : [];
  const choice = it ? (choices.find((c) => c.id === it.photoId) ?? choices[0]) : undefined;
  const asset = it ? api.assetFor(it) : undefined;
  const filtered = api.products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function autoCut() {
    if (!product || !choice) return;
    setCutting(true);
    try {
      const png = await photoEngine({ image: await pathToDataUrl(choice.image), mode: "cutout" });
      await saveCutout(product, choice, png);
      await qc.invalidateQueries({ queryKey: ["products"] });
      await qc.invalidateQueries({ queryKey: ["product_photos"] });
      toast.success("Détourage enregistré sur la fiche article");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Détourage impossible");
    } finally {
      setCutting(false);
    }
  }

  return (
    <div className="grid gap-4 text-sm">
      {it && product && (
        <section className="grid gap-2 rounded-lg border p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{product.name}</p>
              <p className="text-xs text-muted-foreground">{product.sku}</p>
            </div>
            {asset && !asset.cut && <Badge variant="warning">Non détouré</Badge>}
          </div>
          {choices.length > 1 && (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">Angle de vue</p>
              <div className="flex flex-wrap gap-1">
                {choices.map((c) => (
                  <button
                    key={c.id ?? "main"}
                    type="button"
                    title={c.label}
                    aria-pressed={choice === c}
                    onClick={() => api.updateItem(it.uid, { photoId: c.id })}
                    className={cn("h-12 w-12 overflow-hidden rounded border bg-muted", choice === c && "ring-2 ring-primary")}
                  >
                    <img src={photoUrl(c.cutout ?? c.image)} alt={c.label} className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {asset && !asset.cut && (
              <Button size="sm" variant="hero" disabled={cutting} onClick={autoCut}>
                <Scissors className="h-4 w-4" /> {cutting ? "Détourage…" : "Détourer"}
              </Button>
            )}
            <ProductPhotosDialog
              product={product}
              trigger={
                <Button size="sm" variant="outline">
                  <Scissors className="h-4 w-4" /> Retoucher le détourage
                </Button>
              }
            />
          </div>
          <Button size="sm" variant={api.tool === "poser" ? "default" : "outline"} onClick={() => api.setTool(api.tool === "poser" ? "deplacer" : "poser")} title="Cliquez ensuite sur le sol ou le plateau du meuble support">
            <Crosshair className="h-4 w-4" /> {api.tool === "poser" ? "Cliquez sur le support…" : "Poser sur un support (sol, console…)"}
          </Button>
          <Row label={`Taille : ${Math.round(it.h * 100)} % de la hauteur de l'image`}>
            <Slider min={0.02} max={0.95} step={0.005} value={[it.h]} onValueChange={([v]) => api.updateItem(it.uid, { h: v ?? it.h })} aria-label="Taille de l'article" />
          </Row>
          <Row label={`Inclinaison : ${it.rot}°`}>
            <Slider min={-20} max={20} step={0.5} value={[it.rot]} onValueChange={([v]) => api.updateItem(it.uid, { rot: v ?? 0 })} aria-label="Inclinaison" />
          </Row>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={it.flip ? "default" : "outline"} onClick={() => api.updateItem(it.uid, { flip: !it.flip })}>
              <FlipHorizontal2 className="h-4 w-4" /> Miroir
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Vers l'arrière" title="Vers l'arrière" onClick={() => api.moveItem(it.uid, -1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Vers l'avant" title="Vers l'avant" onClick={() => api.moveItem(it.uid, 1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Dupliquer" title="Dupliquer" onClick={() => api.duplicateItem(it.uid)}><Copy className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Retirer de la composition" title="Retirer" onClick={() => api.removeItem(it.uid)}><Trash2 className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Ombre de contact</p>
          <Row label={`Intensité : ${Math.round(it.shadow.opacity * 100)} %`}>
            <Slider min={0} max={1} step={0.05} value={[it.shadow.opacity]} onValueChange={([v]) => api.updateItem(it.uid, { shadow: { ...it.shadow, opacity: v ?? 0 } })} aria-label="Intensité de l'ombre" />
          </Row>
          <Row label="Douceur">
            <Slider min={0} max={1} step={0.05} value={[it.shadow.blur]} onValueChange={([v]) => api.updateItem(it.uid, { shadow: { ...it.shadow, blur: v ?? 0.5 } })} aria-label="Douceur de l'ombre" />
          </Row>
          <Row label="Étendue">
            <Slider min={0.2} max={2.5} step={0.05} value={[it.shadow.size]} onValueChange={([v]) => api.updateItem(it.uid, { shadow: { ...it.shadow, size: v ?? 1 } })} aria-label="Étendue de l'ombre" />
          </Row>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Lumière de l'article</p>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={!asset} onClick={() => api.accordItem(it.uid)} title="Adapte la luminosité et la teinte de l'article à la pièce autour de lui">
              <Sun className="h-4 w-4" /> Accorder à la pièce
            </Button>
            <Button size="sm" variant="ghost" onClick={() => api.updateItem(it.uid, { light: { bright: 1, warm: 0 } })}>
              Photo d'origine
            </Button>
          </div>
          <Row label={`Luminosité : ${Math.round(it.light.bright * 100)} %`}>
            <Slider min={0.5} max={1.5} step={0.01} value={[it.light.bright]} onValueChange={([v]) => api.updateItem(it.uid, { light: { ...it.light, bright: v ?? 1 } })} aria-label="Luminosité de l'article" />
          </Row>
          <Row label={`Teinte de la lumière : ${it.light.warm > 0.02 ? "chaude" : it.light.warm < -0.02 ? "froide" : "neutre"}`}>
            <Slider min={-1} max={1} step={0.02} value={[it.light.warm]} onValueChange={([v]) => api.updateItem(it.uid, { light: { ...it.light, warm: v ?? 0 } })} aria-label="Teinte de la lumière" />
          </Row>
          <label className="mt-1 flex items-center justify-between gap-2 text-xs">
            <span>Passe derrière le premier plan</span>
            <Switch checked={it.behind} onCheckedChange={(behind) => api.updateItem(it.uid, { behind })} aria-label="Passe derrière le premier plan" />
          </label>
        </section>
      )}

      <section className="grid gap-2 rounded-lg border p-2">
        <p className="flex items-center gap-1 font-medium"><Sun className="h-4 w-4" /> Ombre portée (lumière de la pièce)</p>
        <p className="text-xs text-muted-foreground">Une seule lumière pour toute la pièce : tous les articles projettent leur ombre dans la même direction.</p>
        <Row label={api.scene.cast.length > 0 ? `Longueur : ${Math.round(api.scene.cast.length * 100)} %` : "Longueur : sans ombre portée"}>
          <Slider min={0} max={2} step={0.05} value={[api.scene.cast.length]} onValueChange={([v]) => api.setCast({ length: v ?? 0 })} aria-label="Longueur de l'ombre portée" />
        </Row>
        {api.scene.cast.length > 0 && (
          <>
            <Row label={`Direction : ${api.scene.cast.direction > 0 ? "vers la droite" : api.scene.cast.direction < 0 ? "vers la gauche" : "droite devant"} (${Math.abs(api.scene.cast.direction)}°)`}>
              <Slider min={-70} max={70} step={1} value={[api.scene.cast.direction]} onValueChange={([v]) => api.setCast({ direction: v ?? 0 })} aria-label="Direction de l'ombre portée" />
            </Row>
            <Row label={`Intensité : ${Math.round(api.scene.cast.opacity * 100)} %`}>
              <Slider min={0.05} max={0.8} step={0.05} value={[api.scene.cast.opacity]} onValueChange={([v]) => api.setCast({ opacity: v ?? 0.35 })} aria-label="Intensité de l'ombre portée" />
            </Row>
            <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Sens de l'ombre portée">
              {([[true, "Vers le fond (lumière de face)"], [false, "Vers l'avant (contre-jour)"]] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={api.scene.cast.behind === v}
                  onClick={() => api.setCast({ behind: v })}
                  className={cn("flex-1 rounded px-1 py-1", api.scene.cast.behind === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-2 rounded-lg border p-2">
        <p className="flex items-center gap-1 font-medium"><Layers className="h-4 w-4" /> Premier plan existant</p>
        <p className="text-xs text-muted-foreground">
          Sélectionnez un meuble de la photo (canapé, console…) : les articles marqués « derrière » passent dessous.
        </p>
        <div className="grid grid-cols-3 gap-1">
          {([
            ["pp-clic", "Baguette", Wand2],
            ["pp-plus", "Ajouter", Paintbrush],
            ["pp-moins", "Retirer", ShieldMinus],
          ] as const).map(([id, label, Icon]) => (
            <Button key={id} size="sm" className="px-1" variant={api.tool === id ? "default" : "outline"} aria-pressed={api.tool === id} onClick={() => api.setTool(api.tool === id ? "deplacer" : id)}>
              <Icon className="h-4 w-4" /> {label}
            </Button>
          ))}
        </div>
        {(api.tool === "pp-plus" || api.tool === "pp-moins") && (
          <Row label="Taille du pinceau">
            <Slider min={3} max={80} value={[api.brush]} onValueChange={([v]) => api.setBrush(v ?? 20)} aria-label="Taille du pinceau" />
          </Row>
        )}
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={api.undoMask}>Annuler</Button>
          <Button size="sm" variant="ghost" onClick={() => api.clearMask("fg")}>Effacer le premier plan</Button>
        </div>
      </section>

      <section className="grid gap-2">
        <p className="font-medium">Catalogue</p>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" placeholder="Nom ou référence" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un article" />
        </div>
        <ul className="grid max-h-80 gap-1 overflow-auto pr-1">
          {filtered.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => api.addItem(p)} className="flex w-full items-center gap-2 rounded-md border p-1.5 text-left text-xs hover:border-primary">
                <ProductImage src={p.cutout_url ?? p.image_url} alt={p.name} className="h-10 w-10 shrink-0 bg-transparent [&_img]:object-contain" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {p.sku}
                    {p.cutout_url ? " · détouré" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {api.scene.items.length > 0 && (
          <>
            <p className="font-medium">Dans la composition</p>
            <ul className="grid gap-1">
              {api.scene.items.map((i) => {
                const p = api.products.find((x) => x.id === i.productId);
                return (
                  <li key={i.uid}>
                    <button
                      type="button"
                      onClick={() => {
                        api.setSelected(i.uid);
                        api.setTool("deplacer");
                      }}
                      className={cn("w-full truncate rounded-md border px-2 py-1 text-left text-xs", it?.uid === i.uid && "border-primary bg-primary/5")}
                    >
                      {p?.name ?? "Article supprimé du catalogue"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

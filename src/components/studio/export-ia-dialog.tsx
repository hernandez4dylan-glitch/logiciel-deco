import { useEffect, useState } from "react";
import { Check, Copy, Download, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canvasToBlob } from "@/lib/studio-api";

/** Consigne à coller dans l'IA de votre choix avec le visuel exporté. */
export const CONSIGNE_RENDU_3D =
  "Transforme cette image en rendu 3D photoréaliste d'architecture intérieure, digne d'un studio photo professionnel. " +
  "Conserve exactement la perspective, le cadrage, la disposition de la pièce et l'éclairage existant. " +
  "Garde à l'identique les teintes et finitions des murs, du plafond, du sol et des portes (couleurs, motif et taille du papier peint, matière de la chaux ou de l'enduit). " +
  "Conserve chaque meuble et chaque objet exactement : forme, couleurs, matières, proportions et position ; n'ajoute et ne retire aucun objet. " +
  "Harmonise les contours, les ombres de contact et les reflets des éléments ajoutés, avec une lumière et un grain cohérents avec la photo. " +
  "N'ajoute aucun texte ni logo.";
const CLE = "atelier.consigneRendu3D";

function lireConsigne() {
  try {
    return window.localStorage.getItem(CLE) || CONSIGNE_RENDU_3D;
  } catch {
    return CONSIGNE_RENDU_3D;
  }
}

/** Export du visuel pour une IA externe : image PNG + consigne prête à coller. */
export function ExportIaDialog({
  open,
  onOpenChange,
  montage,
  nom,
  articles,
  details,
  onOptimiserIci,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  montage: () => Promise<HTMLCanvasElement>;
  nom: string;
  articles: number;
  /** Finitions utilisées (« Murs : Beige lin »), ajoutées à la consigne. */
  details?: string[];
  onOptimiserIci: () => void;
}) {
  const [apercu, setApercu] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [consigne, setConsigne] = useState(lireConsigne);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!open) return;
    let vivant = true;
    setApercu(null);
    setBlob(null);
    setCopie(false);
    (async () => {
      try {
        const c = await montage();
        const b = await canvasToBlob(c);
        if (!vivant) return;
        setBlob(b);
        setApercu(URL.createObjectURL(b));
      } catch (e) {
        if (vivant) toast.error(e instanceof Error ? e.message : "Visuel indisponible");
      }
    })();
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const texte = details?.length ? `${consigne}\n\nFinitions à respecter : ${details.join(" ; ")}.` : consigne;
  const nomFichier = `${nom.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "visuel"} - pour IA.png`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Exporter pour l'IA</DialogTitle>
          <DialogDescription>
            1. Téléchargez le visuel. 2. Copiez la consigne. 3. Dans votre IA d'images, joignez le visuel et collez la consigne.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded border bg-muted">
          {apercu ? (
            <img src={apercu} alt="Visuel à exporter" className="block max-h-[45vh] w-full object-contain" />
          ) : (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Préparation du visuel…</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="hero"
            disabled={!blob}
            onClick={() => {
              if (!blob) return;
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = nomFichier;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            }}
          >
            <Download className="h-4 w-4" /> 1. Télécharger le visuel (PNG)
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(texte);
                setCopie(true);
                toast.success("Consigne copiée : collez-la dans votre IA avec le visuel");
              } catch {
                toast.error("Copie impossible : sélectionnez le texte et faites Ctrl+C");
              }
            }}
          >
            {copie ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} 2. Copier la consigne
          </Button>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Consigne (modifiable, mémorisée sur ce PC)
          <textarea
            className="min-h-[120px] rounded-md border bg-background p-2 text-sm text-foreground"
            value={consigne}
            onChange={(e) => {
              setConsigne(e.target.value);
              setCopie(false);
              try {
                window.localStorage.setItem(CLE, e.target.value);
              } catch {
                /* mémoire du navigateur indisponible : la consigne reste valable pour cet export */
              }
            }}
          />
        </label>
        {details && details.length > 0 && <p className="text-xs text-muted-foreground">Ajouté à la consigne : {details.join(" ; ")}.</p>}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setConsigne(CONSIGNE_RENDU_3D);
              try {
                window.localStorage.removeItem(CLE);
              } catch {
                /* rien à effacer */
              }
            }}
          >
            <RotateCcw className="h-4 w-4" /> Consigne d'origine
          </Button>
          <Button variant="outline" size="sm" disabled={!articles} title={articles ? "Retouche locale, sans Internet (30 à 60 s)" : "Placez d'abord un article"} onClick={onOptimiserIci}>
            Ou optimiser sur ce PC (IA locale)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

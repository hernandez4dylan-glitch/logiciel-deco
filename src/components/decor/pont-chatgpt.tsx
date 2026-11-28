import { useEffect, useRef, useState } from "react";
import { Check, ClipboardPaste, Copy, ExternalLink, ImageDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Visuel en PNG (seul format d'image accepté par le presse-papiers). */
async function enPng(src: string): Promise<Blob> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("Image indisponible"))), "image/png"));
}

/** Copie de texte : presse-papiers moderne, sinon l'ancienne commande de copie. */
async function copierTexte(texte: string) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = texte;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

/** Première image d'un presse-papiers ou d'un dépôt de fichiers. */
export function imageDe(items: DataTransferItemList | null | undefined): File | null {
  for (const it of Array.from(items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) return it.getAsFile();
  }
  return null;
}

/** Pont avec ChatGPT (ou toute IA d'images utilisée dans le navigateur) : copier le visuel
 *  et la consigne, ouvrir ChatGPT, puis coller ou déposer ici l'image obtenue. Le compte
 *  ChatGPT de l'utilisateur fait le rendu ; le logiciel ne s'y connecte pas. */
export function PontChatGpt({
  visuel,
  consigne,
  onImporter,
  onFermer,
}: {
  visuel: string;
  consigne: string;
  onImporter: (image: Blob) => Promise<void>;
  onFermer: () => void;
}) {
  const [fait, setFait] = useState<{ image?: boolean; consigne?: boolean; ouvert?: boolean }>({});
  const [import_, setImport] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);

  const importer = async (b: Blob | null) => {
    if (!b || import_) return;
    setImport(true);
    try {
      await onImporter(b);
      onFermer();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setImport(false);
    }
  };
  // Ctrl+V n'importe où dans la présentation : l'image copiée depuis ChatGPT est reprise.
  useEffect(() => {
    const coller = (e: ClipboardEvent) => {
      const f = imageDe(e.clipboardData?.items);
      if (f) {
        e.preventDefault();
        void importer(f);
      }
    };
    window.addEventListener("paste", coller);
    return () => window.removeEventListener("paste", coller);
  });

  const etape = (n: number, ok: boolean | undefined, titre: string, action: React.ReactNode) => (
    <li className="flex items-center gap-3">
      <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", ok ? "bg-emerald-600 text-white" : "bg-muted text-foreground")}>
        {ok ? <Check className="h-3.5 w-3.5" /> : n}
      </span>
      <span className="min-w-0 flex-1 text-sm">{titre}</span>
      {action}
    </li>
  );

  return (
    <div
      className="grid gap-3 rounded-lg bg-white p-4 text-foreground shadow-2xl"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importer(imageDe(e.dataTransfer.items) ?? e.dataTransfer.files?.[0] ?? null);
      }}
    >
      <div className="flex items-center gap-2">
        <p className="font-display text-lg">Rendu avec ChatGPT</p>
        <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label="Fermer" onClick={onFermer}><X className="h-4 w-4" /></Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Votre abonnement ChatGPT fait le rendu ; la photo passe par votre compte. Rien n'est envoyé sans ces clics.
      </p>
      <ol className="grid gap-2.5">
        {etape(1, fait.image, "Copier le visuel", (
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              // Promesse passée tout de suite : la copie reste liée au clic.
              await navigator.clipboard.write([new ClipboardItem({ "image/png": enPng(visuel) })]);
              setFait((f) => ({ ...f, image: true }));
              toast.success("Visuel copié");
            } catch {
              // Presse-papiers refusé : le visuel est enregistré, à glisser dans ChatGPT.
              const a = document.createElement("a");
              a.href = URL.createObjectURL(await enPng(visuel));
              a.download = "visuel pour ChatGPT.png";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              setFait((f) => ({ ...f, image: true }));
              toast.success("Visuel enregistré dans vos Téléchargements : glissez-le dans ChatGPT");
            }
          }}><Copy className="h-4 w-4" /> Copier</Button>
        ))}
        {etape(2, fait.ouvert, "Ouvrir ChatGPT et coller (Ctrl+V)", (
          <Button size="sm" variant="outline" onClick={() => {
            window.open("https://chatgpt.com/", "_blank", "noopener");
            setFait((f) => ({ ...f, ouvert: true }));
          }}><ExternalLink className="h-4 w-4" /> Ouvrir</Button>
        ))}
        {etape(3, fait.consigne, "Copier la consigne, la coller dans ChatGPT, envoyer", (
          <Button size="sm" variant="outline" onClick={async () => {
            if (await copierTexte(consigne)) {
              setFait((f) => ({ ...f, consigne: true }));
              toast.success("Consigne copiée");
            } else toast.error("Copie impossible : utilisez « Exporter pour l'IA » dans le menu « … »");
          }}><Copy className="h-4 w-4" /> Copier</Button>
        ))}
        {etape(4, false, "Copier l'image obtenue dans ChatGPT, revenir ici et Ctrl+V (ou la glisser ici)", (
          <Button size="sm" variant="hero" disabled={import_} onClick={async () => {
            try {
              for (const it of await navigator.clipboard.read()) {
                const t = it.types.find((x) => x.startsWith("image/"));
                if (t) return void importer(await it.getType(t));
              }
              toast.error("Aucune image copiée : dans ChatGPT, clic droit sur l'image → « Copier l'image »");
            } catch {
              fichier.current?.click();
            }
          }}>{import_ ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />} Coller</Button>
        ))}
      </ol>
      <button type="button" className="flex items-center justify-center gap-2 rounded-md border-2 border-dashed p-3 text-xs text-muted-foreground hover:border-primary" onClick={() => fichier.current?.click()}>
        <ImageDown className="h-4 w-4" /> Ou choisir l'image enregistrée (Téléchargements)
      </button>
      <input ref={fichier} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        void importer(f ?? null);
      }} />
    </div>
  );
}

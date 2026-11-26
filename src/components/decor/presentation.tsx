import { useEffect, useRef, useState } from "react";
import { FileDown, ListChecks, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MaSelection } from "@/lib/selection";
import { ListeAchat } from "@/components/decor/ma-selection";
import { cn } from "@/lib/utils";

/** Mode « Présenter au client » : le visuel en grand, rideau avant / après, la liste
 *  d'achat à la demande et le PDF à remettre, sans aucun outil d'édition. */
export function Presentation({
  open,
  onClose,
  titre,
  sousTitre,
  avant,
  apres,
  sel,
  onPdf,
}: {
  open: boolean;
  onClose: () => void;
  titre: string;
  sousTitre: string;
  avant: string | null;
  /** Visuel final (data URL) ; null pendant le calcul en pleine résolution. */
  apres: string | null;
  sel: MaSelection;
  onPdf: () => Promise<void>;
}) {
  const [part, setPart] = useState(0.5);
  const [liste, setListe] = useState(false);
  const [pdf, setPdf] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const glisse = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPart(0.5);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!open) return null;
  const bouge = (clientX: number) => {
    const r = zone.current?.getBoundingClientRect();
    if (r) setPart(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1d1915] text-white">
      <header className="flex items-center gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-xl">{titre}</p>
          <p className="truncate text-xs text-white/60">{sousTitre}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setListe((l) => !l)}><ListChecks className="h-4 w-4" /> {liste ? "Masquer la sélection" : "Ma sélection"}</Button>
          <Button
            size="sm"
            variant="hero"
            disabled={pdf || !apres}
            onClick={async () => {
              setPdf(true);
              try {
                await onPdf();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "PDF impossible");
              } finally {
                setPdf(false);
              }
            }}
          >
            {pdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Télécharger le PDF
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Quitter la présentation (Échap)" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-4 px-5 pb-5">
        <div className="relative flex min-w-0 flex-1 items-center justify-center">
          {!apres ? (
            <p className="flex items-center gap-2 text-white/70"><Loader2 className="h-5 w-5 animate-spin" /> Préparation du visuel en haute définition…</p>
          ) : (
            <div
              ref={zone}
              className="relative max-h-full max-w-full cursor-ew-resize select-none"
              onPointerDown={(e) => { glisse.current = true; e.currentTarget.setPointerCapture(e.pointerId); bouge(e.clientX); }}
              onPointerMove={(e) => glisse.current && bouge(e.clientX)}
              onPointerUp={() => (glisse.current = false)}
            >
              <img src={apres} alt="Proposition" className="block max-h-[calc(100vh-110px)] max-w-full rounded shadow-2xl" draggable={false} />
              {avant && (
                <img src={avant} alt="Avant" draggable={false} className="absolute inset-0 h-full w-full rounded" style={{ clipPath: `inset(0 ${100 - part * 100}% 0 0)` }} />
              )}
              {avant && (
                <>
                  <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${part * 100}%` }} />
                  <span className="pointer-events-none absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-sm text-[#1d1915] shadow" style={{ left: `${part * 100}%` }}>‹ ›</span>
                  <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-0.5 text-xs">Avant</span>
                  <span className="pointer-events-none absolute right-3 top-3 rounded bg-black/55 px-2 py-0.5 text-xs">Après</span>
                </>
              )}
            </div>
          )}
        </div>
        <aside className={cn("w-[380px] shrink-0 overflow-y-auto rounded-lg bg-white p-4 text-foreground", !liste && "hidden")}>
          <p className="mb-2 font-display text-lg">Ma sélection</p>
          <ListeAchat sel={sel} compacte />
        </aside>
      </div>
    </div>
  );
}

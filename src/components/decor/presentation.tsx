import { useEffect, useRef, useState } from "react";
import { Bot, Camera, FileDown, ListChecks, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MaSelection } from "@/lib/selection";
import { ListeAchat } from "@/components/decor/ma-selection";
import { PontChatGpt } from "@/components/decor/pont-chatgpt";
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
  ia,
  externe,
}: {
  open: boolean;
  onClose: () => void;
  titre: string;
  sousTitre: string;
  avant: string | null;
  /** Visuel final (data URL) ; null pendant le calcul en pleine résolution. */
  apres: string | null;
  sel: MaSelection;
  /** Télécharge le PDF avec le visuel affiché. */
  onPdf: (visuel: string) => Promise<void>;
  /** Rendu photo réaliste par IA locale (module optionnel). */
  ia?: {
    disponible: boolean;
    /** Visuel réaliste déjà calculé pour cette composition. */
    image: string | null;
    /** Calcul en cours. */
    etat: { progression: number; message: string } | null;
    lancer: () => void;
    annuler: () => void;
  };
  /** Rendu fait dans ChatGPT (compte de l'utilisateur) puis réimporté. */
  externe?: { consigne: string; importer: (image: Blob) => Promise<void> };
}) {
  const [part, setPart] = useState(0.5);
  const [liste, setListe] = useState(false);
  const [pdf, setPdf] = useState(false);
  const [realiste, setRealiste] = useState(true);
  const [pont, setPont] = useState(false);
  const visuel = ia?.image && realiste ? ia.image : apres;
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
          {ia?.image && (
            <div className="flex rounded-md bg-white/10 p-0.5 text-xs" role="group" aria-label="Visuel affiché">
              <button type="button" onClick={() => setRealiste(false)} className={cn("rounded px-2.5 py-1", !realiste && "bg-white text-[#1d1915]")}>Montage</button>
              <button type="button" onClick={() => setRealiste(true)} className={cn("rounded px-2.5 py-1", realiste && "bg-white text-[#1d1915]")}>Photo réaliste</button>
            </div>
          )}
          {ia?.disponible && ia.image && !ia.etat && (
            <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Refaire la photo réaliste" title="Refaire la photo réaliste (l'IA propose une autre version)" onClick={() => { setRealiste(true); ia.lancer(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {ia?.disponible && !ia.image && !ia.etat && apres && (
            <Button size="sm" variant="secondary" onClick={ia.lancer} title="L'IA installée sur ce PC redessine la lumière et les matières (1 à 5 minutes, sans Internet)">
              <Sparkles className="h-4 w-4" /> Créer la photo réaliste
            </Button>
          )}
          {externe && apres && (
            <Button size="sm" variant="secondary" onClick={() => setPont((o) => !o)} title="Faire le rendu dans votre ChatGPT puis le reprendre ici">
              <Bot className="h-4 w-4" /> Rendu avec ChatGPT
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setListe((l) => !l)}><ListChecks className="h-4 w-4" /> {liste ? "Masquer la sélection" : "Ma sélection"}</Button>
          <Button
            size="sm"
            variant="hero"
            disabled={pdf || !visuel || !!ia?.etat}
            onClick={async () => {
              if (!visuel) return;
              setPdf(true);
              try {
                await onPdf(visuel);
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
              <img src={visuel ?? apres} alt="Proposition" className="block max-h-[calc(100vh-110px)] max-w-full rounded shadow-2xl" draggable={false} />
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
              {ia?.etat && (
                <div className="absolute inset-x-6 bottom-6 rounded-lg bg-black/70 p-3 text-sm backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
                  <div className="mb-2 flex items-center gap-2">
                    <Camera className="h-4 w-4 animate-pulse" />
                    <span className="min-w-0 flex-1 truncate">Photo réaliste en préparation : {ia.etat.message}</span>
                    <Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/10" onClick={ia.annuler}>Annuler</Button>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-white/20">
                    <div className="h-full bg-white transition-all" style={{ width: `${Math.round(ia.etat.progression * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {pont && externe && apres && (
          <div className="absolute right-5 top-16 z-10 w-[420px]">
            <PontChatGpt
              visuel={apres}
              consigne={externe.consigne}
              onImporter={async (b) => {
                await externe.importer(b);
                setRealiste(true);
              }}
              onFermer={() => setPont(false)}
            />
          </div>
        )}
        <aside className={cn("w-[380px] shrink-0 overflow-y-auto rounded-lg bg-white p-4 text-foreground", !liste && "hidden")}>
          <p className="mb-2 font-display text-lg">Ma sélection</p>
          <ListeAchat sel={sel} compacte />
        </aside>
      </div>
    </div>
  );
}

/** Copie d'une fiche de la bibliothèque posée sur une surface (instantané : la fiche
 *  client reste juste même si la bibliothèque change ensuite). */
import type { StudioRows } from "@/lib/records";
import type { FinishSnapshot } from "@/lib/scene";

type Finish = StudioRows["finishes"];

export function snapshotDe(f: Finish): FinishSnapshot {
  return {
    id: f.id || null,
    kind: f.kind,
    name: f.name,
    reference: f.reference,
    color: f.color,
    texture: f.texture_path,
    marque: f.marque ?? null,
    gamme: f.gamme ?? null,
    finition: f.finition,
  };
}

const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const eur = (value: number | string | null | undefined) => eurFormatter.format(Number(value ?? 0));
export const shortDate = (value: string) => dateFormatter.format(new Date(value));
export const dateTime = (value: string) => dateTimeFormatter.format(new Date(value));
/** Lit un montant saisi à la française (« 1 200,50 € », « 38.5 »). Renvoie NaN si illisible. */
export function parseAmount(input: string): number {
  const cleaned = input.replace(/[\s  €]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100) / 100;
}

export const monthLabel = (d = new Date()) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);

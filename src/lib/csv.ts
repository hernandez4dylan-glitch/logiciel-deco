export type CsvRow = Record<string, string | number | boolean | null | undefined>;

/** CSV compatible Excel FR : séparateur « ; », virgule décimale, BOM UTF-8. */
export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const cell = (v: CsvRow[string]) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(";"), ...rows.map((r) => headers.map((h) => cell(r[h])).join(";"))].join("\r\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([mime.includes("csv") ? "\uFEFF" + content : content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(name: string, rows: CsvRow[]) {
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`${name}-${date}.csv`, toCsv(rows), "text/csv;charset=utf-8");
}

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, type CsvRow } from "@/lib/csv";

export function ExportCsvButton({ filename, rows, label = "Export Excel / CSV" }: { filename: string; rows: CsvRow[]; label?: string }) {
  return (
    <Button variant="outline" onClick={() => downloadCsv(filename, rows)} disabled={rows.length === 0}>
      <Download className="h-4 w-4" />
      {label}
    </Button>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { parseAmount } from "@/lib/format";
import type { LocalRows } from "@/lib/records";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_CATEGORIES, expensesQuery, startOfMonthDate } from "@/lib/data";
import { eur, shortDate } from "@/lib/format";
import { round2 } from "@/lib/pricing";
import { Receipt } from "lucide-react";

const TITLE = "Frais & Dépenses — Un Instant Chez Moi";
const DESC = "Saisissez les frais généraux, frais divers et dépenses du magasin.";

export const Route = createFileRoute("/_authenticated/depenses")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(expensesQuery()),
  component: Page,
});

function Page() {
  const { data: expenses } = useSuspenseQuery(expensesQuery());
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [filter, setFilter] = useState("all");

  const refresh = () => qc.invalidateQueries({ queryKey: ["expenses"] });
  const add = useMutation({
    mutationFn: async () => {
      const value = parseAmount(amount);
      if (!label.trim() || !(value > 0)) throw new Error("Indiquez un libellé et un montant positif");
      const { error } = await localStore.from("expenses").insert({ expense_date: date, label: label.trim(), category, amount: value });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dépense ajoutée");
      setLabel("");
      setAmount("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await localStore.from("expenses").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dépense supprimée");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const monthStart = startOfMonthDate();
  const month = expenses.filter((e) => e.expense_date >= monthStart);
  const total = (list: typeof expenses) => round2(list.reduce((s, e) => s + Number(e.amount), 0));
  const shown = filter === "all" ? expenses : expenses.filter((e) => e.category === filter);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <>
      <PageHeader
        title="Frais & Dépenses"
        description="Ces montants sont déduits de la marge nette du tableau de bord."
        actions={
          <ExportCsvButton
            filename="depenses"
            rows={shown.map((e) => ({ Date: e.expense_date, Libellé: e.label, Catégorie: e.category, Montant: Number(e.amount) }))}
          />
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total du mois" value={eur(total(month))} hint={`${month.length} dépense(s)`} icon={Receipt} />
        {EXPENSE_CATEGORIES.map((c) => (
          <StatCard key={c} label={c} value={eur(total(month.filter((e) => e.category === c)))} hint="Ce mois-ci" icon={Receipt} tone="warning" />
        ))}
      </div>

      <form onSubmit={submit} className="surface mb-6 grid gap-3 p-6 md:grid-cols-[160px_1fr_200px_140px_auto] md:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="d">Date</Label>
          <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="l">Libellé</Label>
          <Input id="l" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Loyer, électricité…" required />
        </div>
        <div className="grid gap-1.5">
          <Label>Catégorie</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="a">Montant (€)</Label>
          <Input id="a" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
        </div>
        <Button type="submit" variant="hero" disabled={add.isPending}>Ajouter</Button>
      </form>

      <section className="surface p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-xl font-medium">Toutes les dépenses</h2>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes catégories</SelectItem>
              {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-right">Montant</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{shortDate(e.expense_date)}</TableCell>
                <TableCell className="font-medium">{e.label}</TableCell>
                <TableCell><Badge variant="secondary">{e.category}</Badge></TableCell>
                <TableCell className="tabular text-right">{eur(e.amount)}</TableCell>
                <TableCell className="w-24">
                  <div className="flex justify-end">
                    <ExpenseDialog expense={e} />
                    <ConfirmButton
                      title={`Supprimer « ${e.label} » ?`}
                      description="Cette dépense sera retirée des totaux et du tableau de bord."
                      onConfirm={() => remove.mutate(e.id)}
                    >
                      <Button size="icon" variant="ghost" aria-label={`Supprimer ${e.label}`} title="Supprimer">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

type Expense = LocalRows["expenses"];

function ExpenseDialog({ expense }: { expense: Expense }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: "", label: "", category: "", amount: "" });
  const save = useMutation({
    mutationFn: async () => {
      const value = parseAmount(f.amount);
      if (!f.label.trim() || !(value > 0)) throw new Error("Indiquez un libellé et un montant positif");
      const { error } = await localStore
        .from("expenses")
        .update({ expense_date: f.date, label: f.label.trim(), category: f.category, amount: value })
        .eq("id", expense.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dépense modifiée");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next)
          setF({ date: expense.expense_date, label: expense.label, category: expense.category, amount: String(expense.amount).replace(".", ",") });
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Modifier ${expense.label}`} title="Modifier">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la dépense</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`d-${expense.id}`}>Date</Label>
              <Input id={`d-${expense.id}`} type="date" required value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`a-${expense.id}`}>Montant (€)</Label>
              <Input id={`a-${expense.id}`} inputMode="decimal" required value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`l-${expense.id}`}>Libellé</Label>
            <Input id={`l-${expense.id}`} required value={f.label} onChange={(e) => setF((s) => ({ ...s, label: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Catégorie</Label>
            <Select value={f.category} onValueChange={(category) => setF((s) => ({ ...s, category }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" variant="hero" disabled={save.isPending}>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

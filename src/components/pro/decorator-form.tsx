import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const empty = { name: "", company: "", email: "", phone: "", discount: "15" };

export function DecoratorForm() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(empty);
  const save = useMutation({
    mutationFn: async () => {
      const discount = Math.min(100, Math.max(0, Number(f.discount.replace(",", ".")) || 0));
      const { error } = await localStore.from("decorators").insert({
        name: f.name.trim(),
        company: f.company.trim() || null,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
        discount_percent: discount,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Décorateur ajouté");
      setF(empty);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["decorators"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const field = (key: keyof typeof empty, label: string, props: Record<string, unknown> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`deco-${key}`}>{label}</Label>
      <Input id={`deco-${key}`} value={f[key]} onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))} {...props} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="hero"><Plus className="h-4 w-4" /> Nouveau décorateur</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouveau décorateur partenaire</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {field("name", "Nom", { required: true })}
          {field("company", "Société")}
          {field("email", "Email", { type: "email" })}
          {field("phone", "Téléphone")}
          {field("discount", "Remise accordée (%)", { inputMode: "decimal" })}
          <DialogFooter><Button type="submit" variant="hero" disabled={save.isPending}>Enregistrer</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StockStepper({ productId, stock, low }: { productId: string; stock: number; low: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (delta: number) => {
      const { error } = await localStore.rpc("adjust_stock", {
        p_product_id: productId,
        p_delta: delta,
        p_reason: delta > 0 ? "Réassort" : "Sortie manuelle",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["stock_movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-background p-0.5">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-full"
        aria-label="Retirer 1 du stock"
        disabled={stock <= 0 || mutation.isPending}
        onClick={() => mutation.mutate(-1)}
      >
        <Minus />
      </Button>
      <span className={cn("min-w-8 text-center text-sm font-semibold tabular", low && "text-warning-foreground")}>
        {stock}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-full"
        aria-label="Ajouter 1 au stock"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(1)}
      >
        <Plus />
      </Button>
    </div>
  );
}

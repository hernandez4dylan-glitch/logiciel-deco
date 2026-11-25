import { queryOptions } from "@tanstack/react-query";
import { localStore } from "@/lib/local-client";

export const CATEGORIES = ["Luminaire", "Mobilier", "Textile", "Objet déco"] as const;
export type Category = (typeof CATEGORIES)[number];

export const EXPENSE_CATEGORIES = ["Frais généraux", "Frais divers", "Dépenses magasin"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PRODUCT_IMAGES_BUCKET = "product-images";

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const startOfMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};
export const startOfMonthDate = () => startOfMonthIso().slice(0, 10);

export const suppliersQuery = () =>
  queryOptions({
    queryKey: ["suppliers"],
    queryFn: async () =>
      unwrap(await localStore.from("suppliers").select("*").order("name", { ascending: true })),
  });

export const productsQuery = () =>
  queryOptions({
    queryKey: ["products"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("products")
          .select("*, supplier:suppliers(id, name)")
          .order("created_at", { ascending: true }),
      ),
  });
export type ProductRow = Awaited<ReturnType<NonNullable<ReturnType<typeof productsQuery>["queryFn"]>>>[number];

export const movementsQuery = (limit = 10) =>
  queryOptions({
    queryKey: ["stock_movements", limit],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("stock_movements")
          .select("*, product:products(name, sku)")
          .order("created_at", { ascending: false })
          .limit(limit),
      ),
  });

export const monthSalesQuery = () =>
  queryOptions({
    queryKey: ["sales", "month"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("sales")
          .select("id, total_ttc, total_cost_ht, created_at")
          .gte("created_at", startOfMonthIso()),
      ),
  });

export const recentSalesQuery = () =>
  queryOptions({
    queryKey: ["sales", "recent"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("sales")
          .select("*, items:sale_items(product_name, quantity, line_total_ttc)")
          .order("created_at", { ascending: false })
          .limit(8),
      ),
  });

export const expensesQuery = () =>
  queryOptions({
    queryKey: ["expenses"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("expenses")
          .select("*")
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ),
  });

/** Clés à rafraîchir après un mouvement de stock ou une vente. */
export const STOCK_KEYS = [["products"], ["stock_movements"], ["sales"]] as const;

export const decoratorsQuery = () =>
  queryOptions({
    queryKey: ["decorators"],
    queryFn: async () =>
      unwrap(await localStore.from("decorators").select("*").order("name", { ascending: true })),
  });

export const finishesQuery = () =>
  queryOptions({
    queryKey: ["finishes"],
    queryFn: async () => unwrap(await localStore.from("finishes").select("*").order("name", { ascending: true })),
  });

/** Toutes les photos complémentaires des articles (le studio en a besoin pour choisir l'angle). */
export const productPhotosQuery = () =>
  queryOptions({
    queryKey: ["product_photos"],
    queryFn: async () => unwrap(await localStore.from("product_photos").select("*").order("created_at", { ascending: true })),
  });

export const projectsQuery = () =>
  queryOptions({
    queryKey: ["projects"],
    queryFn: async () => unwrap(await localStore.from("projects").select("*").order("updated_at", { ascending: false })),
  });

export const variantsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["variants", projectId],
    queryFn: async () =>
      unwrap(await localStore.from("variants").select("*").eq("project_id", projectId).order("created_at", { ascending: true })),
  });

export const allSalesQuery = () =>
  queryOptions({
    queryKey: ["sales", "all"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("sales")
          .select("*, items:sale_items(product_name, quantity, unit_price_ttc, line_total_ttc)")
          .order("created_at", { ascending: false })
          .limit(200),
      ),
  });

export const allMovementsQuery = () =>
  queryOptions({
    queryKey: ["stock_movements", "all"],
    queryFn: async () =>
      unwrap(
        await localStore
          .from("stock_movements")
          .select("quantity, created_at, product:products(purchase_price_ht)")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
  });

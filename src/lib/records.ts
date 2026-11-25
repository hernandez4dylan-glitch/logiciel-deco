export interface Rows {
  decorators: {
    company: string | null;
    created_at: string;
    discount_percent: number;
    email: string | null;
    id: string;
    name: string;
    phone: string | null;
  };
  expenses: {
    amount: number;
    category: string;
    created_at: string;
    expense_date: string;
    id: string;
    label: string;
  };
  products: {
    category: string;
    created_at: string;
    cutout_url: string | null;
    id: string;
    image_url: string | null;
    low_stock_threshold: number;
    name: string;
    pro_price_ttc: number;
    published_web: boolean;
    purchase_price_ht: number;
    sale_price_ttc: number;
    sku: string;
    stock: number;
    supplier_id: string | null;
    web_synced_at: string | null;
  };
  sale_items: {
    id: string;
    line_total_ttc: number;
    product_id: string | null;
    product_name: string;
    quantity: number;
    sale_id: string;
    unit_cost_ht: number;
    unit_price_ttc: number;
  };
  sales: {
    created_at: string;
    customer_name: string | null;
    extra_discount_percent: number;
    id: string;
    is_pro: boolean;
    subtotal_ttc: number;
    total_cost_ht: number;
    total_ttc: number;
  };
  stock_movements: {
    created_at: string;
    id: string;
    product_id: string;
    quantity: number;
    reason: string;
  };
  suppliers: {
    contact_name: string | null;
    created_at: string;
    email: string | null;
    id: string;
    lead_time_days: number;
    name: string;
    phone: string | null;
  };
}
export interface StudioRows {
  finishes: {
    id: string;
    kind: "peinture" | "papier" | "enduit";
    name: string;
    reference: string | null;
    color: string | null;
    texture_path: string | null;
    motif_cm: number | null;
    finition: string | null;
    marque: string | null;
    gamme: string | null;
    usage: "mur" | "plafond" | "porte" | "cadre" | "sol" | "autre" | null;
    created_at: string;
    updated_at: string;
  };
  product_photos: {
    id: string;
    product_id: string;
    image_path: string;
    cutout_path: string | null;
    label: string | null;
    created_at: string;
  };
  projects: {
    id: string;
    name: string;
    client: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  variants: {
    id: string;
    project_id: string;
    name: string;
    base_path: string;
    width: number;
    height: number;
    data: string;
    created_at: string;
    updated_at: string;
  };
}

export type LocalRows = StudioRows & Omit<Rows, "products" | "stock_movements" | "sales"> & {
  products: Rows["products"] & {
    supplier: Pick<Rows["suppliers"], "id" | "name"> | null;
  };
  stock_movements: Rows["stock_movements"] & {
    product: Pick<
      Rows["products"],
      "id" | "sku" | "name" | "purchase_price_ht"
    > | null;
  };
  sales: Rows["sales"] & { items: Rows["sale_items"][] };
};

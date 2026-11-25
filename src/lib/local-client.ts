import type { LocalRows } from "./records";
type Fields = Record<string, unknown>;
type Result<T = unknown> = {
  data: T | null;
  error: null | { message: string; code?: string };
};
async function request<T = unknown>(
  path: string,
  body: BodyInit,
  json = true,
): Promise<Result<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : {},
      body,
    });
    return await response.json();
  } catch (err) {
    return { data: null, error: { message: String(err) } };
  }
}
class Query<T> {
  private spec: {
    table: string;
    op: string;
    id?: string;
    since?: string;
    limit?: number;
    where?: Record<string, string>;
  };
  constructor(table: string) {
    this.spec = { table, op: "select" };
  }
  select(_projection: string) {
    return this;
  }
  insert(values: Fields) {
    Object.assign(this.spec, { op: "insert", values });
    return this;
  }
  update(values: Fields) {
    Object.assign(this.spec, { op: "update", values });
    return this;
  }
  delete() {
    this.spec.op = "delete";
    return this;
  }
  /** `id` cible une ligne (modification, suppression) ; les autres colonnes filtrent une lecture. */
  eq(column: "id" | "project_id" | "product_id" | "kind", value: string) {
    if (column === "id") this.spec.id = value;
    else this.spec.where = { ...this.spec.where, [column]: value };
    return this;
  }
  order(order: string, { ascending }: { ascending: boolean }) {
    Object.assign(this.spec, { order, asc: ascending });
    return this;
  }
  gte(_column: "created_at", since: string) {
    this.spec.since = since;
    return this;
  }
  limit(limit: number) {
    this.spec.limit = limit;
    return this;
  }
  then(resolve: (r: Result<T[]>) => unknown, reject: (e: unknown) => unknown) {
    return request<T[]>("/api/data", JSON.stringify(this.spec)).then(
      resolve,
      reject,
    );
  }
}
export const localStore = {
  from: <K extends keyof LocalRows>(table: K) => new Query<LocalRows[K]>(table),
  rpc: (op: string, values: Fields) =>
    request("/api/data", JSON.stringify({ op, values })),
  storage: {
    from: (_bucket: string) => ({
      upload: (name: string, blob: Blob, _options?: unknown) =>
        request("/api/upload/" + encodeURIComponent(name), blob, false),
      createSignedUrl: async (name: string, _duration: number) => ({
        data: { signedUrl: "/photos/" + encodeURIComponent(name) },
        error: null,
      }),
    }),
  },
};

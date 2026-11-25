function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function streamImage(
  _endpoint: string,
  form: FormData,
  onFrame: (src: string, final: boolean) => void,
  signal?: AbortSignal,
) {
  const fields: Record<string, string> = {};
  for (const [key, value] of form)
    fields[key] = typeof value === "string" ? value : await readBlob(value);
  const res = await fetch("/api/photo", {
    method: "POST",
    signal: signal ?? null,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error?.message || "Retouche impossible");
  }
  onFrame(await readBlob(await res.blob()), true);
}

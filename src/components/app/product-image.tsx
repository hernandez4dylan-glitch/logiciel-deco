import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { localStore } from "@/lib/local-client";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/data";
import { cn } from "@/lib/utils";

const isDirectUrl = (v: string) => v.startsWith("/") || v.startsWith("http");

/** URL affichable d'une photo produit (chemin public ou fichier privé signé). */
export function useProductImageUrl(src: string | null | undefined) {
  const needsSigning = !!src && !isDirectUrl(src);
  const { data: signed } = useQuery({
    queryKey: ["signed-image", src],
    enabled: needsSigning,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await localStore.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .createSignedUrl(src!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  return needsSigning ? signed : (src ?? undefined);
}

export function ProductImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const url = useProductImageUrl(src);

  return (
    <div className={cn("overflow-hidden rounded-lg bg-muted", className)}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

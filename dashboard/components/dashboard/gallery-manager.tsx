"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type GalleryImage = { id: number; url: string; position: number };

export function GalleryManager({ productId }: { productId: number }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/images`);
      const data = (await res.json()) as { images: GalleryImage[] };
      setImages(data.images ?? []);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetch("/api/products/upload", { method: "POST", body: form });
      const upData = (await upRes.json()) as { url?: string; error?: string };
      if (!upRes.ok || !upData.url) {
        alert(upData.error ?? "ატვირთვა ვერ მოხერხდა");
        return;
      }
      const addRes = await fetch(`/api/products/${productId}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: upData.url }),
      });
      if (!addRes.ok) {
        alert("სურათი ვერ შეინახა");
        return;
      }
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(imageId: number) {
    await fetch(`/api/products/${productId}/images/${imageId}`, { method: "DELETE" });
    setImages((prev) => prev.filter((i) => i.id !== imageId));
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">დამატებითი სურათები (გალერეა)</p>

      {loading ? (
        <p className="text-xs text-muted-foreground">იტვირთება...</p>
      ) : images.length > 0 ? (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img) => (
            <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => void handleDelete(img.id)}
                className="absolute top-1 right-1 bg-destructive text-white rounded-full p-0.5 hover:bg-destructive/80 transition-colors"
                aria-label="წაშლა"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">დამატებითი სურათი არ არის</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="cursor-pointer w-full"
      >
        <Camera className="w-3.5 h-3.5 mr-1.5" />
        {uploading ? "იტვირთება..." : "სურათის დამატება"}
      </Button>
    </div>
  );
}

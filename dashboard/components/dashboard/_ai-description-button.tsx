"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

interface AiDescriptionButtonProps {
  productId: number;
  onGenerated: (text: string) => void;
}

export function AiDescriptionButton({ productId, onGenerated }: AiDescriptionButtonProps) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/generate-description`, { method: "POST" });
      const data = (await res.json()) as { description?: string; error?: string };
      if (!res.ok || !data.description) {
        toast.error(data.error ?? "AI-მ ვერ დაწერა აღწერა");
        return;
      }
      onGenerated(data.description);
    } catch {
      toast.error("კავშირის შეცდომა");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void generate()}
      disabled={loading}
      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Sparkles className="w-3 h-3" />
      {loading ? "იწერება..." : "AI-ით დაწერა"}
    </button>
  );
}

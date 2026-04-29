"use client";

import { useEffect, useState } from "react";
import { History, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { ImportHistoryEntry } from "@/app/api/products/[id]/import-history/route";

interface Props {
  productId: string;
}

function fmt(n: number, digits = 2) {
  return n.toFixed(digits);
}

export function ProductPriceHistory({ productId }: Props) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows,    setRows]    = useState<ImportHistoryEntry[] | null>(null);
  const [error,   setError]   = useState("");

  useEffect(() => {
    setRows(null);
    setError("");
    setOpen(false);
  }, [productId]);

  async function load() {
    if (rows !== null) { setOpen((o) => !o); return; }
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const res  = await fetch(`/api/products/${productId}/import-history`);
      const data = await res.json() as ImportHistoryEntry[];
      setRows(data);
    } catch {
      setError("ვერ ჩაიტვირთა");
    } finally {
      setLoading(false);
    }
  }

  if (!productId) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={load}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
      >
        <History className="h-3 w-3" />
        ფასების ისტორია
        {loading
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : open
            ? <ChevronUp className="h-3 w-3" />
            : <ChevronDown className="h-3 w-3" />
        }
      </button>

      {open && !loading && (
        <div className="mt-1.5 rounded-lg border border-border bg-muted/30 overflow-hidden">
          {error ? (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          ) : !rows || rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">ისტორია არ მოიძებნა</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-1.5 text-left font-medium">თარიღი</th>
                  <th className="px-3 py-1.5 text-left font-medium">მომწოდებელი</th>
                  <th className="px-3 py-1.5 text-right font-medium">ფასი ($)</th>
                  <th className="px-3 py-1.5 text-right font-medium">კურსი</th>
                  <th className="px-3 py-1.5 text-right font-medium">თვითღ. (₾)</th>
                  <th className="px-3 py-1.5 text-right font-medium">რაოდ.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.importId}`} className="border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5 truncate max-w-[120px]">{r.supplier}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(r.unitPriceUsd, 4)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(r.exchangeRate, 4)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {r.landedCostPerUnitGel != null ? fmt(r.landedCostPerUnitGel) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">{fmt(r.quantity, 0)} {r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

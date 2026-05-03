"use client";

import { cn } from "@/lib/utils";
import type { ProductRow } from "@/lib/queries";
import { getCatalogCompletion } from "./_utils";

export function CompletenessCell({ r }: { r: ProductRow }) {
  const fields = getCatalogCompletion(r);
  const score = fields.filter((f) => f.done).length;
  const total = fields.length;

  const badgeCls =
    score === total
      ? "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]"
      : score >= 4
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-destructive/10 text-destructive border-destructive/30";

  return (
    <div className="relative group/comp inline-flex justify-center">
      <span
        className={cn(
          "inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border cursor-default tabular-nums",
          badgeCls,
        )}
      >
        {score}/{total}
      </span>
      <div className="absolute bottom-full right-0 mb-2 w-44 bg-popover border border-border rounded-xl shadow-lg p-3 opacity-0 group-hover/comp:opacity-100 transition-opacity pointer-events-none z-50">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          კატალოგის სისრულე
        </p>
        <div className="space-y-1">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className={cn("text-xs font-bold", f.done ? "text-[hsl(var(--success))]" : "text-destructive")}>
                {f.done ? "✓" : "✗"}
              </span>
              <span className={cn("text-xs", f.done ? "text-muted-foreground line-through" : "text-foreground")}>
                {f.emoji} {f.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

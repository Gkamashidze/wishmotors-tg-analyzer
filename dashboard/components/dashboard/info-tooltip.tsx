"use client";

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="მეტი ინფორმაცია"
        className={cn(
          "ml-1 text-muted-foreground/60 hover:text-muted-foreground",
          "transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
          "touch-manipulation",
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="tooltip"
          className={cn(
            /* position: above the button, anchored to right edge so it won't overflow */
            "absolute z-50 bottom-full mb-2 right-0",
            /* size: capped so it never bleeds off small screens */
            "w-56 max-w-[min(14rem,80vw)]",
            "rounded-lg border border-border bg-popover text-popover-foreground",
            "px-3 py-2 text-xs leading-relaxed shadow-lg",
            "pointer-events-none",
          )}
        >
          {text}
          {/* caret arrow */}
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 right-2.5 h-3 w-3 rotate-45 border-b border-r border-border bg-popover"
          />
        </div>
      )}
    </div>
  );
}

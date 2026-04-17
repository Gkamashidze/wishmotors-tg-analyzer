import { cn } from "@/lib/utils";

interface ViewFieldProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function ViewField({ label, value, className }: ViewFieldProps) {
  return (
    <div className={cn("rounded-lg bg-muted/40 px-3 py-2", className)}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-sm font-medium">{value ?? <span className="text-muted-foreground italic">—</span>}</div>
    </div>
  );
}

export function ViewFieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {children}
    </div>
  );
}

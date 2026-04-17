import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Tone = "default" | "success" | "destructive" | "warning";

const toneStyles: Record<Tone, { icon: string; ring: string }> = {
  default: { icon: "bg-primary/10 text-primary", ring: "ring-primary/10" },
  success: { icon: "bg-success/10 text-success", ring: "ring-success/10" },
  destructive: {
    icon: "bg-destructive/10 text-destructive",
    ring: "ring-destructive/10",
  },
  warning: {
    icon: "bg-warning/10 text-warning-foreground",
    ring: "ring-warning/10",
  },
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  const t = toneStyles[tone];
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
            {hint && (
              <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            )}
          </div>
          <div
            className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center ring-1",
              t.icon,
              t.ring,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

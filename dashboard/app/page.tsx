import {
  PackageSearch,
  AlertTriangle,
} from "lucide-react";
import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { AiFinancialManager } from "@/components/dashboard/ai-financial-manager";
import { formatNumber } from "@/lib/utils";
import { getDailySeries, getDashboardSummaryRange } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [summary, series] = await Promise.all([
    getDashboardSummaryRange(monthStart, today),
    getDailySeries(30),
  ]);

  return (
    <>
      <TopBar title="მთავარი დაფა" />
      <main className="p-6 space-y-6 animate-fade-in">
        <DashboardStats initial={summary} />

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>ფინანსური მოძრაობა</CardTitle>
                  <CardDescription>
                    ბოლო 30 დღე — გაყიდვა, ხარჯი, მოგება
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Legend color="hsl(var(--primary))" label="გაყიდვა" />
                  <Legend color="hsl(var(--success))" label="მოგება" />
                  <Legend color="hsl(var(--destructive))" label="ხარჯი" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <RevenueChart data={series} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>შეკვეთები</CardTitle>
              <CardDescription>აქტიური პოზიციები</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MiniStat
                icon={PackageSearch}
                label="მოლოდინში"
                value={formatNumber(summary.pendingOrders)}
                tone="default"
              />
              <MiniStat
                icon={AlertTriangle}
                label="სასწრაფო"
                value={formatNumber(summary.urgentOrders)}
                tone="destructive"
              />
              <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                სრულ სიაში გადასვლისთვის გვერდით მენიუდან — „შეკვეთები".
              </p>
            </CardContent>
          </Card>
        </section>

        <section>
          <AiFinancialManager />
        </section>
      </main>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof PackageSearch;
  label: string;
  value: string;
  tone: "default" | "destructive";
}) {
  const classes =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive ring-destructive/10"
      : "bg-primary/10 text-primary ring-primary/10";
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-9 w-9 rounded-lg flex items-center justify-center ring-1 ${classes}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

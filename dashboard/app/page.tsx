import {
  TrendingUp,
  Receipt,
  Wallet,
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
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { formatGEL, formatNumber } from "@/lib/utils";
import { getDailySeries, getDashboardSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const [summary, series] = await Promise.all([
    getDashboardSummary(30),
    getDailySeries(30),
  ]);

  const netTone =
    summary.netProfit >= 0 ? "success" : ("destructive" as const);

  return (
    <>
      <TopBar title="მთავარი დაფა" />
      <main className="p-6 space-y-6 animate-fade-in">
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            label="ჯამური გაყიდვები (30 დღე)"
            value={formatGEL(summary.totalSales)}
            hint={`${formatNumber(summary.salesCount)} ტრანზაქცია`}
            icon={TrendingUp}
            tone="default"
          />
          <StatCard
            label="ჯამური ხარჯები"
            value={formatGEL(summary.totalExpenses)}
            hint="ბოლო 30 დღე"
            icon={Receipt}
            tone="warning"
          />
          <StatCard
            label="მთლიანი მოგება"
            value={formatGEL(summary.grossProfit)}
            hint={`თვითღირებულება: ${formatGEL(summary.totalCogs)}`}
            icon={Wallet}
            tone="default"
          />
          <StatCard
            label="წმინდა მოგება"
            value={formatGEL(summary.netProfit)}
            hint="გაყიდვები − ხარჯი − თვითღირებულება"
            icon={TrendingUp}
            tone={netTone}
          />
        </section>

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
                სრულ სიაში გადასვლისთვის გვერდით მენიუდან — „შეკვეთები“.
              </p>
            </CardContent>
          </Card>
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

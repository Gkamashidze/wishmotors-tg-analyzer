import { PackageSearch, AlertTriangle } from "lucide-react";
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
import { AccountBalancesSection } from "@/components/dashboard/account-balances-section";
import { ExpenseCategoryChart } from "@/components/dashboard/expense-category-chart";
import { formatNumber } from "@/lib/utils";
import {
  getDailySeries,
  getDashboardSummaryRange,
  getTopSellingProducts,
  getTopProfitableProducts,
  getExpensesByCategory,
  type DashboardSummary,
} from "@/lib/queries";
import { TopProductsSection } from "@/components/dashboard/top-products-section";
import { FinancialAllocationGuide } from "@/components/dashboard/financial-allocation-guide";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_SUMMARY: DashboardSummary = {
  totalSales: 0,
  totalExpenses: 0,
  totalCogs: 0,
  grossProfit: 0,
  netProfit: 0,
  salesCount: 0,
  pendingOrders: 0,
  urgentOrders: 0,
  ordersNew: 0,
  ordersProcessing: 0,
  ordersOrdered: 0,
  ordersReady: 0,
  ordersDelivered: 0,
  ordersCancelled: 0,
};

export default async function DashboardPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [summary, series, topSelling, topProfitable, expenseCategories] = await Promise.all([
    getDashboardSummaryRange(monthStart, today, "all").catch((err) => {
      console.error("[dashboard] getDashboardSummaryRange failed:", err);
      return DEFAULT_SUMMARY;
    }),
    getDailySeries(30, "all").catch((err) => {
      console.error("[dashboard] getDailySeries failed:", err);
      return [];
    }),
    getTopSellingProducts(10).catch((err) => {
      console.error("[dashboard] getTopSellingProducts failed:", err);
      return [];
    }),
    getTopProfitableProducts(10).catch((err) => {
      console.error("[dashboard] getTopProfitableProducts failed:", err);
      return [];
    }),
    getExpensesByCategory().catch((err) => {
      console.error("[dashboard] getExpensesByCategory failed:", err);
      return [];
    }),
  ]);

  return (
    <>
      <TopBar title="მთავარი დაფა" />
      <main className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
        <DashboardStats initial={summary} />

        <AccountBalancesSection />

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
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
              <CardDescription>სტატუსების მიხედვით</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <StatusRow label="ახალი" value={summary.ordersNew} tone="warning" />
              <StatusRow label="მუშავდება" value={summary.ordersProcessing} tone="default" />
              <StatusRow label="შეკვეთილი" value={summary.ordersOrdered} tone="default" />
              <StatusRow label="მზადაა" value={summary.ordersReady} tone="success" />
              <StatusRow label="მიტანილი" value={summary.ordersDelivered} tone="muted" />
              <StatusRow label="გაუქმებული" value={summary.ordersCancelled} tone="cancelled" />
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <MiniStat
                  icon={AlertTriangle}
                  label="სასწრაფო"
                  value={formatNumber(summary.urgentOrders)}
                  tone="destructive"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                სრული სია — გვერდით მენიუდან „შეკვეთები".
              </p>
            </CardContent>
          </Card>
        </section>

        <TopProductsSection
          topSelling={topSelling}
          topProfitable={topProfitable}
        />

        <FinancialAllocationGuide initialSummary={summary} />

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>ხარჯები კატეგორიების მიხედვით</CardTitle>
              <CardDescription>
                გადახდილი საოპერაციო ხარჯები — ჯამური განაწილება
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExpenseCategoryChart data={expenseCategories} />
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <AiFinancialManager />
          </div>
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

type StatusTone = "default" | "warning" | "success" | "muted" | "cancelled";

function StatusRow({ label, value, tone }: { label: string; value: number; tone: StatusTone }) {
  const dotClass: Record<StatusTone, string> = {
    default:   "bg-primary",
    warning:   "bg-amber-400",
    success:   "bg-emerald-500",
    muted:     "bg-muted-foreground",
    cancelled: "bg-border",
  };
  const countClass: Record<StatusTone, string> = {
    default:   "text-foreground",
    warning:   "text-amber-600",
    success:   "text-emerald-600",
    muted:     "text-muted-foreground",
    cancelled: "text-muted-foreground",
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass[tone]}`} aria-hidden="true" />
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${countClass[tone]}`}>
        {formatNumber(value)}
      </span>
    </div>
  );
}

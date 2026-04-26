"use client";

import { useState, useCallback, useEffect } from "react";
import {
  TrendingUp, Receipt, Wallet, RotateCcw, ShoppingCart,
  BarChart3, Layers, Banknote,
} from "lucide-react";
import { startOfMonth, format } from "date-fns";
import { StatCard } from "@/components/dashboard/stat-card";
import { DateRangePicker, type DateRange } from "@/components/dashboard/date-range-picker";
import { formatGEL, formatNumber } from "@/lib/utils";
import type { DashboardSummary, SellerFilter } from "@/lib/queries";
import type { FinancialMetricsData as FinancialMetricsResponse } from "@/lib/financial-queries";

interface DashboardStatsProps {
  initial: DashboardSummary;
}

const EMPTY_METRICS: FinancialMetricsResponse = {
  inventoryTurnoverRatio: 0,
  aovGel: 0,
  roiPct: 0,
  gmroi: 0,
  realtimeCashflowGel: 0,
  totalInventoryValueGel: 0,
};

const SELLER_OPTIONS: { value: SellerFilter; label: string }[] = [
  { value: "all",        label: "ყველა"  },
  { value: "llc",        label: "შპს"    },
  { value: "individual", label: "ფზ"     },
];

export function DashboardStats({ initial }: DashboardStatsProps) {
  const today = new Date();
  const [range, setRange] = useState<DateRange>({
    from: startOfMonth(today),
    to: today,
  });
  const [sellerType, setSellerType] = useState<SellerFilter>("all");
  const [summary, setSummary] = useState<DashboardSummary>(initial);
  const [metrics, setMetrics] = useState<FinancialMetricsResponse>(EMPTY_METRICS);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async (newRange: DateRange, seller: SellerFilter) => {
    setLoading(true);
    const from = format(newRange.from, "yyyy-MM-dd");
    const to = format(newRange.to, "yyyy-MM-dd");
    try {
      const [summaryRes, metricsRes] = await Promise.all([
        fetch(`/api/dashboard/summary?from=${from}&to=${to}&sellerType=${seller}`),
        fetch(`/api/financial-metrics?from=${from}&to=${to}&sellerType=${seller}`),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(range, sellerType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangeChange = useCallback(
    (newRange: DateRange) => {
      setRange(newRange);
      fetchAll(newRange, sellerType);
    },
    [fetchAll, sellerType],
  );

  const handleSellerChange = useCallback(
    (seller: SellerFilter) => {
      setSellerType(seller);
      fetchAll(range, seller);
    },
    [fetchAll, range],
  );

  const netTone = summary.netProfit >= 0 ? "success" : ("destructive" as const);
  const roiTone =
    metrics.roiPct >= 30 ? "success" : metrics.roiPct >= 10 ? "default" : "destructive";
  const gmroiTone =
    metrics.gmroi >= 2 ? "success" : metrics.gmroi >= 1 ? "default" : "destructive";
  const cfTone = metrics.realtimeCashflowGel >= 0 ? "success" : ("destructive" as const);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-1">
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangePicker value={range} onChange={handleRangeChange} defaultPreset="month" />
          <SellerFilterTabs value={sellerType} onChange={handleSellerChange} />
        </div>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">
            მოიტვირთება...
          </span>
        )}
      </div>

      {/* ── Row 1: Core P&L ── */}
      <section
        className={[
          "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 transition-opacity duration-200",
          loading ? "opacity-50 pointer-events-none" : "opacity-100",
        ].join(" ")}
      >
        <StatCard
          label="ჯამური გაყიდვები"
          value={formatGEL(summary.totalSales)}
          hint={`${formatNumber(summary.salesCount)} ტრანზაქცია`}
          icon={TrendingUp}
          tone="default"
        />
        <StatCard
          label="ჯამური ხარჯები"
          value={formatGEL(summary.totalExpenses)}
          hint="არჩეული პერიოდი"
          icon={Receipt}
          tone="warning"
        />
        <StatCard
          label="მთლიანი მოგება"
          value={formatGEL(summary.grossProfit)}
          hint={`თვითღირებ.: ${formatGEL(summary.totalCogs)}`}
          icon={Wallet}
          tone="default"
        />
        <StatCard
          label="წმინდა მოგება"
          value={formatGEL(summary.netProfit)}
          hint="გაყიდვები − ხარჯი − თვითღირ."
          icon={TrendingUp}
          tone={netTone}
          tooltip="სუფთა მოგება — მთლიან მოგებას მინუს ხარჯები."
        />
      </section>

      {/* ── Row 2: 5 Advanced Financial Metrics ── */}
      <section
        className={[
          "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 transition-opacity duration-200",
          loading ? "opacity-50 pointer-events-none" : "opacity-100",
        ].join(" ")}
      >
        <StatCard
          label="ინვ. ბრუნვა"
          value={metrics.inventoryTurnoverRatio.toFixed(2) + "×"}
          hint="COGS ÷ საშ. მარაგის ღირ."
          icon={RotateCcw}
          tone={metrics.inventoryTurnoverRatio >= 4 ? "success" : metrics.inventoryTurnoverRatio >= 1 ? "default" : "destructive"}
          tooltip="აჩვენებს, რამდენად სწრაფად იყიდება მარაგები. რაც მაღალია, მით უკეთესი."
        />
        <StatCard
          label="საშ. ჩეკი (AOV)"
          value={formatGEL(metrics.aovGel)}
          hint="შემოსავ. ÷ ტრანზაქციები"
          icon={ShoppingCart}
          tone="default"
          tooltip="საშუალოდ რამდენ ლარს ხარჯავს ერთი კლიენტი ერთ ყიდვაზე."
        />
        <StatCard
          label="ROI"
          value={metrics.roiPct.toFixed(1) + "%"}
          hint="წმ. მოგება ÷ თვითღირ. × 100"
          icon={BarChart3}
          tone={roiTone}
          tooltip="პროდუქტში ჩადებულმა თანხამ რა პროცენტული მოგება მოგიტანათ."
        />
        <StatCard
          label="GMROI"
          value={metrics.gmroi.toFixed(2) + "×"}
          hint="მთლ. მოგება ÷ მარაგის ღირ."
          icon={Layers}
          tone={gmroiTone}
          tooltip="საწყობში ჩადებულ 1 ლარზე, რამდენი ლარის მოგებას იღებთ."
        />
        <StatCard
          label="ნეტო ნაკადი"
          value={formatGEL(metrics.realtimeCashflowGel)}
          hint={`კაპ.: ${formatGEL(metrics.totalInventoryValueGel)}`}
          icon={Banknote}
          tone={cfTone}
          tooltip="რეალურად ხელზე არსებული ფული — შემოსულობებს მინუს ხარჯები და მარაგებში გადახდილი თანხა."
        />
      </section>
    </div>
  );
}

function SellerFilterTabs({
  value,
  onChange,
}: {
  value: SellerFilter;
  onChange: (v: SellerFilter) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 gap-0.5">
      {SELLER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={[
            "px-3 py-1 text-xs font-medium rounded-md transition-colors",
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

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
import type { DashboardSummary } from "@/lib/queries";
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

export function DashboardStats({ initial }: DashboardStatsProps) {
  const today = new Date();
  const [range, setRange] = useState<DateRange>({
    from: startOfMonth(today),
    to: today,
  });
  const [summary, setSummary] = useState<DashboardSummary>(initial);
  const [metrics, setMetrics] = useState<FinancialMetricsResponse>(EMPTY_METRICS);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async (newRange: DateRange) => {
    setLoading(true);
    const from = format(newRange.from, "yyyy-MM-dd");
    const to = format(newRange.to, "yyyy-MM-dd");
    try {
      const [summaryRes, metricsRes] = await Promise.all([
        fetch(`/api/dashboard/summary?from=${from}&to=${to}`),
        fetch(`/api/financial-metrics?from=${from}&to=${to}`),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangeChange = useCallback(
    (newRange: DateRange) => {
      setRange(newRange);
      fetchAll(newRange);
    },
    [fetchAll],
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
        <DateRangePicker value={range} onChange={handleRangeChange} defaultPreset="month" />
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
        />
        <StatCard
          label="საშ. ჩეკი (AOV)"
          value={formatGEL(metrics.aovGel)}
          hint="შემოსავ. ÷ ტრანზაქციები"
          icon={ShoppingCart}
          tone="default"
        />
        <StatCard
          label="ROI"
          value={metrics.roiPct.toFixed(1) + "%"}
          hint="წმ. მოგება ÷ თვითღირ. × 100"
          icon={BarChart3}
          tone={roiTone}
        />
        <StatCard
          label="GMROI"
          value={metrics.gmroi.toFixed(2) + "×"}
          hint="მთლ. მოგება ÷ მარაგის ღირ."
          icon={Layers}
          tone={gmroiTone}
        />
        <StatCard
          label="ნეტო ნაკადი"
          value={formatGEL(metrics.realtimeCashflowGel)}
          hint={`კაპ.: ${formatGEL(metrics.totalInventoryValueGel)}`}
          icon={Banknote}
          tone={cfTone}
        />
      </section>
    </div>
  );
}

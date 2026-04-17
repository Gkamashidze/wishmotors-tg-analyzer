"use client";

import { useState, useCallback } from "react";
import { TrendingUp, Receipt, Wallet } from "lucide-react";
import { startOfMonth, format } from "date-fns";
import { StatCard } from "@/components/dashboard/stat-card";
import { DateRangePicker, type DateRange } from "@/components/dashboard/date-range-picker";
import { formatGEL, formatNumber } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/queries";

interface DashboardStatsProps {
  initial: DashboardSummary;
}

export function DashboardStats({ initial }: DashboardStatsProps) {
  const today = new Date();
  const [range, setRange] = useState<DateRange>({
    from: startOfMonth(today),
    to: today,
  });
  const [summary, setSummary] = useState<DashboardSummary>(initial);
  const [loading, setLoading] = useState(false);

  const handleRangeChange = useCallback(async (newRange: DateRange) => {
    setRange(newRange);
    setLoading(true);
    try {
      const from = format(newRange.from, "yyyy-MM-dd");
      const to = format(newRange.to, "yyyy-MM-dd");
      const res = await fetch(`/api/dashboard/summary?from=${from}&to=${to}`);
      if (res.ok) {
        const data: DashboardSummary = await res.json();
        setSummary(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const netTone = summary.netProfit >= 0 ? "success" : ("destructive" as const);

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
    </div>
  );
}

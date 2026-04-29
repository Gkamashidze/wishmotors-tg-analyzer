"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CheckCircle2, AlertTriangle, XCircle, Calculator } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatGEL } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/queries";

type Status = "healthy" | "warning" | "critical";

interface BenchmarkRow {
  label: string;
  sublabel: string;
  value: number;
  range: [number, number];
  warnRange: [number, number];
  higherIsBetter?: boolean;
}

function getStatus(
  value: number,
  healthy: [number, number],
  warn: [number, number],
  higherIsBetter = false
): Status {
  if (higherIsBetter) {
    if (value >= healthy[0]) return "healthy";
    if (value >= warn[0]) return "warning";
    return "critical";
  }
  if (value <= healthy[1]) return "healthy";
  if (value <= warn[1]) return "warning";
  return "critical";
}

const STATUS_ICON: Record<Status, React.ReactNode> = {
  healthy: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  critical: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_BADGE: Record<Status, string> = {
  healthy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  critical: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

const DONUT_COLORS = [
  "hsl(var(--primary))",
  "#f59e0b",
  "#10b981",
];

const CALC_RATIOS = [
  { label: "ნაწილების შეძენა", pct: 55, color: "hsl(var(--primary))" },
  { label: "საოპერაციო ხარჯები", pct: 20, color: "#f59e0b" },
  { label: "დანაზოგი", pct: 10, color: "#10b981" },
  { label: "სამიზნე მოგება", pct: 15, color: "#6366f1" },
];

function pct(value: number, total: number): string {
  if (!total) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

interface Props {
  initialSummary: DashboardSummary;
}

export function FinancialAllocationGuide({ initialSummary }: Props) {
  const [revenue, setRevenue] = useState("");

  const { totalSales, totalCogs, totalExpenses, grossProfit, netProfit } = initialSummary;
  const hasData = totalSales > 0;

  const cogsRatio = hasData ? (totalCogs / totalSales) * 100 : 0;
  const expenseRatio = hasData ? (totalExpenses / totalSales) * 100 : 0;
  const grossMargin = hasData ? (grossProfit / totalSales) * 100 : 0;
  const netMargin = hasData ? (netProfit / totalSales) * 100 : 0;

  const donutData = hasData
    ? [
        { name: "ნაწილები", value: Math.max(totalCogs, 0) },
        { name: "ხარჯები", value: Math.max(totalExpenses, 0) },
        { name: "მოგება", value: Math.max(netProfit, 0) },
      ].filter((d) => d.value > 0)
    : [];

  const benchmarks: BenchmarkRow[] = [
    {
      label: "ნაწილების ღირებულება",
      sublabel: "COGS / შემოსავალი",
      value: cogsRatio,
      range: [45, 65],
      warnRange: [65, 75],
    },
    {
      label: "საოპერაციო ხარჯები",
      sublabel: "ხარჯები / შემოსავალი",
      value: expenseRatio,
      range: [15, 25],
      warnRange: [25, 35],
    },
    {
      label: "მთლიანი მოგება",
      sublabel: "გრ. მარჟა",
      value: grossMargin,
      range: [35, 55],
      warnRange: [25, 35],
      higherIsBetter: true,
    },
    {
      label: "სუფთა მოგება",
      sublabel: "ნეტ მარჟა",
      value: netMargin,
      range: [10, 25],
      warnRange: [5, 10],
      higherIsBetter: true,
    },
  ];

  const parsedRevenue = parseFloat(revenue.replace(/[^\d.]/g, "")) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          ფინანსური განაწილების ცნობარი
        </CardTitle>
        <CardDescription>
          ამ თვის რეალური მაჩვენებლები vs. რეკომენდებული სამიზნეები
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Donut chart */}
          <div className="flex flex-col items-center justify-center">
            {hasData ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatGEL(value),
                        name,
                      ]}
                      contentStyle={{ fontSize: 13 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap justify-center">
                  {donutData.map((d, i) => (
                    <span key={d.name} className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
                        aria-hidden
                      />
                      {d.name}{" "}
                      <span className="font-semibold text-foreground">
                        {pct(d.value, totalSales)}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">
                ამ თვის გაყიდვების მონაცემები არ არის
              </p>
            )}
          </div>

          {/* Benchmark table */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              მაჩვენებლები vs. სამიზნე
            </p>
            {benchmarks.map((b) => {
              const status = hasData
                ? getStatus(b.value, b.range, b.warnRange, b.higherIsBetter)
                : "healthy";
              const rangeLabel = b.higherIsBetter
                ? `${b.range[0]}–${b.range[1]}%`
                : `${b.range[0]}–${b.range[1]}%`;
              return (
                <div
                  key={b.label}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {STATUS_ICON[status]}
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none truncate">{b.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{b.sublabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-semibold tabular-nums">
                      {hasData ? formatPct(b.value) : "—"}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[status]}`}
                    >
                      {rangeLabel}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="rounded-lg border border-dashed border-border p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">ცხრილის გასაღები</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> ჯანსაღი
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-500" /> საყურადღებო
                </span>
                <span className="flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-red-500" /> პრობლემური
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Calculator */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">კალკულატორი — შემდეგი თვის დაგეგმვა</h3>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="text-sm text-muted-foreground shrink-0">
              მოსალოდნელი შემოსავალი:
            </label>
            <div className="relative w-full sm:w-64">
              <Input
                type="text"
                inputMode="decimal"
                placeholder="მაგ. 5000"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₾
              </span>
            </div>
          </div>

          {parsedRevenue > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CALC_RATIOS.map((row) => {
                const amount = (parsedRevenue * row.pct) / 100;
                return (
                  <div
                    key={row.label}
                    className="rounded-lg border border-border p-3 space-y-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: row.color }}
                        aria-hidden
                      />
                      <span className="text-xs text-muted-foreground">{row.label}</span>
                    </div>
                    <p className="text-lg font-bold tabular-nums">{formatGEL(amount)}</p>
                    <p className="text-xs text-muted-foreground">{row.pct}%</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              შეიყვანე მოსალოდნელი შემოსავალი — გაჩვენებ, სად რა თანხა უნდა გამოყო.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

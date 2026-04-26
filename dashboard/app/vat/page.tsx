"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VatSummaryResponse, VatMonthRow } from "@/app/api/accounting/vat/route";

const fmt = (n: number) =>
  n.toLocaleString("ka-GE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function currentYear() {
  return new Date().getFullYear();
}
function yearRange(year: number) {
  return {
    from: `${year}-01-01`,
    to:   `${year}-12-31`,
  };
}

type YearOption = { label: string; year: number };

function buildYearOptions(): YearOption[] {
  const y = currentYear();
  return [y, y - 1, y - 2].map((yr) => ({ label: `${yr} წელი`, year: yr }));
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  title,
  amount,
  icon: Icon,
  colorClass,
  subtitle,
}: {
  title: string;
  amount: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={cn("text-2xl font-bold", colorClass)}>
              {fmt(amount)} ₾
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={cn("rounded-full p-2", colorClass.replace("text-", "bg-").replace("-600", "-100").replace("-700", "-100"))}>
            <Icon className={cn("h-5 w-5", colorClass)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Monthly breakdown table ──────────────────────────────────────────────────

function MonthTable({ months }: { months: VatMonthRow[] }) {
  const [expanded, setExpanded] = useState(true);

  if (months.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">თვიური განაწილება</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            მონაცემები არ მოიძებნა
          </p>
        </CardContent>
      </Card>
    );
  }

  const GEO_MONTHS: Record<string, string> = {
    "01": "იანვარი",  "02": "თებერვალი", "03": "მარტი",
    "04": "აპრილი",   "05": "მაისი",     "06": "ივნისი",
    "07": "ივლისი",   "08": "აგვისტო",   "09": "სექტემბერი",
    "10": "ოქტომბერი","11": "ნოემბერი",  "12": "დეკემბერი",
  };

  function monthLabel(m: string) {
    const [year, mm] = m.split("-");
    return `${GEO_MONTHS[mm] ?? mm} ${year}`;
  }

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <CardTitle className="text-base">თვიური განაწილება</CardTitle>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    პერიოდი
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    გადასახდელი დღგ
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    ჩასათვლელი დღგ
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    გადასარიცხი
                  </th>
                </tr>
              </thead>
              <tbody>
                {months.map((row) => (
                  <tr
                    key={row.month}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      {monthLabel(row.month)}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600 tabular-nums">
                      {fmt(row.output_vat)} ₾
                    </td>
                    <td className="px-4 py-3 text-right text-green-600 tabular-nums">
                      {fmt(row.input_vat)} ₾
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-semibold tabular-nums",
                        row.net_payable > 0
                          ? "text-amber-600"
                          : row.net_payable < 0
                          ? "text-green-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {fmt(row.net_payable)} ₾
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VatPage() {
  const yearOptions = buildYearOptions();
  const [selectedYear, setSelectedYear] = useState(currentYear());
  const [data, setData]       = useState<VatSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = yearRange(year);
      const res = await fetch(`/api/accounting/vat?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: VatSummaryResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedYear);
  }, [selectedYear, load]);

  const totals = data?.totals ?? { output_vat: 0, input_vat: 0, net_payable: 0 };

  return (
    <>
      <TopBar title="დღგ-ს დეკლარაცია" />
      <main className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">

        {/* Header controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">დღგ-ს ანგარიში</h2>
          </div>
          <div className="flex items-center gap-2">
            {yearOptions.map((opt) => (
              <Button
                key={opt.year}
                variant={selectedYear === opt.year ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedYear(opt.year)}
              >
                {opt.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => load(selectedYear)}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>მონაცემების ჩატვირთვა ვერ მოხერხდა: {error}</span>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Metric cards */}
        {(data || loading) && (
          <div
            className={cn(
              "grid grid-cols-1 gap-4 sm:grid-cols-3",
              loading && "opacity-60 pointer-events-none",
            )}
          >
            <MetricCard
              title="გადასახდელი დღგ (გაყიდვები)"
              amount={totals.output_vat}
              icon={TrendingDown}
              colorClass="text-red-600"
              subtitle="Output VAT — მთლიანი გაყიდვებიდან"
            />
            <MetricCard
              title="ჩასათვლელი დღგ (იმპორტი)"
              amount={totals.input_vat}
              icon={TrendingUp}
              colorClass="text-green-600"
              subtitle="Input VAT — გადახდილი იმპორტზე"
            />
            <MetricCard
              title="გადასარიცხი დღგ (სახელმწიფოში)"
              amount={totals.net_payable}
              icon={Wallet}
              colorClass={totals.net_payable > 0 ? "text-amber-600" : totals.net_payable < 0 ? "text-green-600" : "text-muted-foreground"}
              subtitle={totals.net_payable < 0 ? "ჩასათვლელი > გადასახდელი — კრედიტი" : "Output − Input = სანიაღვრო"}
            />
          </div>
        )}

        {/* Monthly table */}
        {data && !loading && (
          <MonthTable months={data.months} />
        )}

        {/* Explanation footer */}
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <div>
                <span className="font-medium text-red-600">გადასახდელი დღგ</span>
                <p className="mt-1">
                  ყოველი გაყიდვის ჯამური თანხიდან ამოღებული 18%: თანხა − თანხა÷1.18
                </p>
              </div>
              <div>
                <span className="font-medium text-green-600">ჩასათვლელი დღგ</span>
                <p className="mt-1">
                  მომწოდებლის ინვოისზე გადახდილი დღგ (საბაჟო ღირებულება)
                </p>
              </div>
              <div>
                <span className="font-medium text-amber-600">გადასარიცხი</span>
                <p className="mt-1">
                  გადასახდელი − ჩასათვლელი. ეს თანხა ირიცხება შემოსავლების სამსახურში.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

      </main>
    </>
  );
}

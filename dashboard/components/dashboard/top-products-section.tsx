import { TrendingUp, DollarSign, Medal } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatGEL, formatNumber } from "@/lib/utils";
import type { TopProductRow } from "@/lib/queries";

const rankColors = [
  "bg-yellow-400 text-yellow-900",
  "bg-slate-300 text-slate-800",
  "bg-amber-600 text-amber-50",
];

function RankBadge({ rank }: { rank: number }) {
  const color = rankColors[rank - 1] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold tabular-nums ${color}`}
    >
      {rank}
    </span>
  );
}

function ProductList({
  rows,
  valueKey,
  valueLabel,
  valueFormat,
}: {
  rows: TopProductRow[];
  valueKey: "totalQuantity" | "totalProfit";
  valueLabel: string;
  valueFormat: (n: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        მონაცემები არ მოიძებნა
      </p>
    );
  }

  return (
    <ol className="space-y-2.5">
      {rows.map((row, idx) => (
        <li
          key={row.productId ?? row.productName}
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/60"
        >
          <RankBadge rank={idx + 1} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">
              {row.productName}
            </p>
            {row.oemCode && (
              <p className="truncate text-xs text-muted-foreground">
                {row.oemCode}
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">
              {valueFormat(row[valueKey])}
            </p>
            <p className="text-xs text-muted-foreground">{valueLabel}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TopProductsSection({
  topSelling,
  topProfitable,
}: {
  topSelling: TopProductRow[];
  topProfitable: TopProductRow[];
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                ტოპ 10 ყველაზე გაყიდვადი
              </CardTitle>
              <CardDescription className="text-xs">
                გაყიდული რაოდენობის მიხედვით — ყველა დრო
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ProductList
            rows={topSelling}
            valueKey="totalQuantity"
            valueLabel="ცალი"
            valueFormat={(n) => formatNumber(n)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success">
              <DollarSign className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                ტოპ 10 ყველაზე მომგებიანი
              </CardTitle>
              <CardDescription className="text-xs">
                წმინდა მოგების მიხედვით — ყველა დრო
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ProductList
            rows={topProfitable}
            valueKey="totalProfit"
            valueLabel="მოგება"
            valueFormat={(n) => formatGEL(n)}
          />
        </CardContent>
      </Card>
    </section>
  );
}

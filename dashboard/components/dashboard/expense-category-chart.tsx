"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ExpenseCategoryRow } from "@/lib/queries";
import { formatGEL } from "@/lib/utils";

const PALETTE = [
  "hsl(var(--primary))",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#ec4899",
];

function pct(value: number, total: number) {
  if (!total) return "0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

interface Props {
  data: ExpenseCategoryRow[];
}

export function ExpenseCategoryChart({ data }: Props) {
  if (!data.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        მონაცემები არ არის
      </p>
    );
  }

  const total = data.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [formatGEL(value), "ხარჯი"]}
            contentStyle={{ fontSize: 13 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="divide-y divide-border">
        {data.map((row, i) => (
          <div key={row.category} className="flex items-center justify-between py-2 text-sm">
            <span className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                aria-hidden="true"
              />
              <span className="font-medium">{row.category}</span>
            </span>
            <span className="flex items-center gap-3 tabular-nums">
              <span className="text-muted-foreground text-xs">
                {pct(row.total, total)}
              </span>
              <span className="font-semibold text-destructive">
                {formatGEL(row.total)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

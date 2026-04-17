"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrderRow } from "@/lib/queries";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

type PriorityFilter = "all" | "urgent" | "normal" | "low";
type StatusFilter = "all" | "pending" | "ordered" | "received" | "cancelled";

const PRIORITY_TABS: { key: PriorityFilter; label: string; icon?: string }[] = [
  { key: "all", label: "ყველა" },
  { key: "urgent", label: "სასწრაფო", icon: "🚨" },
  { key: "normal", label: "ჩვეულებრივი", icon: "🟢" },
  { key: "low", label: "დაბალი" },
];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "ყველა სტატუსი" },
  { key: "pending", label: "მოლოდინში" },
  { key: "ordered", label: "შეკვეთილი" },
  { key: "received", label: "მიღებული" },
  { key: "cancelled", label: "გაუქმებული" },
];

function priorityBadge(p: string) {
  if (p === "urgent")
    return (
      <Badge variant="destructive" className="gap-1">
        <span aria-hidden="true">🚨</span> სასწრაფო
      </Badge>
    );
  if (p === "low")
    return (
      <Badge variant="muted" className="gap-1">
        დაბალი
      </Badge>
    );
  return (
    <Badge variant="success" className="gap-1">
      <span aria-hidden="true">🟢</span> ჩვეულებრივი
    </Badge>
  );
}

function statusBadge(s: string) {
  switch (s) {
    case "pending":
      return <Badge variant="warning">მოლოდინში</Badge>;
    case "ordered":
      return <Badge variant="default">შეკვეთილი</Badge>;
    case "received":
      return <Badge variant="success">მიღებული</Badge>;
    case "cancelled":
      return <Badge variant="muted">გაუქმებული</Badge>;
    default:
      return <Badge variant="outline">{s}</Badge>;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ka-GE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [queryText, setQueryText] = useState("");

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return rows.filter((r) => {
      if (priority !== "all" && r.priority !== priority) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      const hay = [r.productName ?? "", r.oemCode ?? "", r.notes ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, priority, status, queryText]);

  const counts = useMemo(() => {
    const base = status === "all" ? rows : rows.filter((r) => r.status === status);
    return {
      all: base.length,
      urgent: base.filter((r) => r.priority === "urgent").length,
      normal: base.filter((r) => r.priority === "normal").length,
      low: base.filter((r) => r.priority === "low").length,
    };
  }, [rows, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRIORITY_TABS.map((t) => {
            const active = priority === t.key;
            const n = counts[t.key as keyof typeof counts] ?? 0;
            return (
              <Button
                key={t.key}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => setPriority(t.key)}
                className="gap-1.5"
              >
                {t.icon && <span aria-hidden="true">{t.icon}</span>}
                {t.label}
                <span
                  className={cn(
                    "ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="სტატუსის ფილტრი"
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
          >
            {STATUS_TABS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="ძიება..."
            aria-label="ძიება შეკვეთებში"
            className="h-9 w-56 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>პროდუქტი</TableHead>
              <TableHead>OEM</TableHead>
              <TableHead className="text-right">რაოდენობა</TableHead>
              <TableHead>პრიორიტეტი</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead>თარიღი</TableHead>
              <TableHead className="min-w-[200px]">შენიშვნა</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-12"
                >
                  შედეგი არ არის — შეცვალე ფილტრი
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium tabular-nums text-muted-foreground">
                    {r.id}
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.productName ?? (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.oemCode ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.quantityNeeded)}
                  </TableCell>
                  <TableCell>{priorityBadge(r.priority)}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm truncate max-w-[280px]">
                    {r.notes ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        ნაჩვენებია {formatNumber(filtered.length)} / {formatNumber(rows.length)}{" "}
        შეკვეთა
      </p>
    </div>
  );
}

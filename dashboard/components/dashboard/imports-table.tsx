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
import { Input } from "@/components/ui/input";
import type { ImportHistoryRow } from "@/lib/queries";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("ka-GE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("ka-GE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ImportsTable({ rows }: { rows: ImportHistoryRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.oem.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-3">
      <Input
        placeholder="OEM ან დასახელება..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">თარიღი</TableHead>
              <TableHead className="whitespace-nowrap">OEM კოდი</TableHead>
              <TableHead>დასახელება</TableHead>
              <TableHead className="text-right whitespace-nowrap">რაოდ.</TableHead>
              <TableHead className="whitespace-nowrap">ერთ.</TableHead>
              <TableHead className="text-right whitespace-nowrap">ფასი ($)</TableHead>
              <TableHead className="text-right whitespace-nowrap">კურსი</TableHead>
              <TableHead className="text-right whitespace-nowrap">ტრანსპ. (₾)</TableHead>
              <TableHead className="text-right whitespace-nowrap">სხვა (₾)</TableHead>
              <TableHead className="text-right whitespace-nowrap font-semibold">
                თვითღირებ. (₾)
              </TableHead>
              <TableHead className="text-right whitespace-nowrap font-semibold">
                სარეკომ. ფასი (₾)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  {search ? "ვერაფერი მოიძებნა" : "იმპორტის ჩანაწერი არ არის"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                    {fmtDate(r.importDate)}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{r.oem}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{r.name}</TableCell>
                  <TableCell className="text-right">{fmt(r.quantity, 0)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    ${fmt(r.unitPriceUsd, 2)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {fmt(r.exchangeRate, 4)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.transportCostGel > 0 ? fmt(r.transportCostGel, 2) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.otherCostGel > 0 ? fmt(r.otherCostGel, 2) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {fmt(r.totalUnitCostGel, 2)} ₾
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                    {fmt(r.suggestedRetailPriceGel, 2)} ₾
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          სულ: {filtered.length} ჩანაწერი
          {search && rows.length !== filtered.length && ` (${rows.length}-დან)`}
        </p>
      )}
    </div>
  );
}

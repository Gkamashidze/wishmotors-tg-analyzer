"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Eye,
  CheckCircle2,
  Clock,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button }    from "@/components/ui/button";
import { RevertImportButton } from "@/components/dashboard/erp-import-form";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportRow = {
  id:                 number;
  date:               string;
  supplier:           string;
  invoiceNumber:      string | null;
  exchangeRate:       number;
  totalTransportCost: number;
  totalTerminalCost:  number;
  totalAgencyCost:    number;
  totalVatCost:       number;
  documentName:       string | null;
  status:             string;
  createdAt:          string;
  updatedAt:          string;
  itemsCount:         number;
  totalValueGel:      number;
};

type ItemRow = {
  id:                     number;
  productId:              number;
  productName:            string;
  oemCode:                string | null;
  quantity:               number;
  unit:                   string;
  unitPriceUsd:           number;
  weight:                 number;
  totalPriceUsd:          number;
  totalPriceGel:          number;
  allocatedTransportCost: number;
  allocatedTerminalCost:  number;
  allocatedAgencyCost:    number;
  allocatedVatCost:       number;
  landedCostPerUnitGel:   number;
};

type FullImport = ImportRow & { items: ItemRow[] };

function fmt(n: number, digits = 2) {
  return n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtDate(s: string) {
  return s.slice(0, 10);
}

// ── Main component ────────────────────────────────────────────────────────────

export function ErpImportsHistoryTable({ rows: initial }: { rows: ImportRow[] }) {
  const router                          = useRouter();
  const [, startTransition]             = useTransition();
  const [rows, setRows]                 = useState<ImportRow[]>(initial);
  const [search, setSearch]             = useState("");
  const [fromDate, setFromDate]         = useState("");
  const [toDate, setToDate]             = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "completed">("");
  const [loading, setLoading]           = useState(false);
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [expandedData, setExpandedData] = useState<Record<number, FullImport>>({});
  const [expandLoading, setExpandLoading] = useState<number | null>(null);

  // ── Fetch rows ───────────────────────────────────────────────────────────
  const fetchRows = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search)       params.set("search", search);
    if (fromDate)     params.set("from",   fromDate);
    if (toDate)       params.set("to",     toDate);
    if (statusFilter) params.set("status", statusFilter);

    try {
      const res  = await fetch(`/api/erp-imports?${params.toString()}`);
      const data = await res.json() as ImportRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  // ── Expand row to see details ────────────────────────────────────────────
  const toggleExpand = async (row: ImportRow) => {
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    if (expandedData[row.id]) return;

    setExpandLoading(row.id);
    try {
      const res  = await fetch(`/api/erp-imports/${row.id}`);
      const data = await res.json() as FullImport;
      setExpandedData((prev) => ({ ...prev, [row.id]: data }));
    } catch {
      /* ignore */
    } finally {
      setExpandLoading(null);
    }
  };

  // ── Delete draft ─────────────────────────────────────────────────────────
  const deleteDraft = async (id: number) => {
    if (!confirm("წაშლა draft-ის?")) return;
    await fetch(`/api/erp-imports/${id}`, { method: "DELETE" });
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // ── After revert ─────────────────────────────────────────────────────────
  const handleReverted = (id: number) => {
    startTransition(() => {
      router.push(`/imports/${id}`);
      router.refresh();
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="მიმწოდებელი, ინვოისი..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchRows()}
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-9 w-full sm:w-36 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-9 w-full sm:w-36 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | "draft" | "completed")}
          className="h-9 w-full sm:w-36 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
        >
          <option value="">ყველა სტატუსი</option>
          <option value="draft">Draft</option>
          <option value="completed">დასრულებული</option>
        </select>
        <Button type="button" variant="outline" size="sm" onClick={fetchRows} disabled={loading}>
          <Search className="h-4 w-4" />
          ძებნა
        </Button>
        <Button type="button" size="sm" onClick={() => router.push("/imports/new")}>
          <Plus className="h-4 w-4" />
          ახალი
        </Button>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="text-sm">იმპორტები ვერ მოიძებნა</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => router.push("/imports/new")}
          >
            <Plus className="h-4 w-4" />
            პირველი იმპორტის შექმნა
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">თარიღი</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">მიმწოდებელი</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">ინვოისი</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-center">პოზ.</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">სულ (₾)</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">კურსი</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">სტატუსი</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">მოქმედება</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row.date)}</td>
                    <td className="px-4 py-3 font-medium">{row.supplier || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.invoiceNumber || "—"}</td>
                    <td className="px-4 py-3 text-center">{row.itemsCount}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(row.totalValueGel)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fmt(row.exchangeRate, 4)}</td>
                    <td className="px-4 py-3">
                      {row.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 text-xs font-medium">
                          <CheckCircle2 className="h-3 w-3" /> დასრულებული
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-2.5 py-0.5 text-xs font-medium">
                          <Clock className="h-3 w-3" /> Draft
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Expand */}
                        <button
                          type="button"
                          title="დეტალები"
                          onClick={() => toggleExpand(row)}
                          className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                        >
                          {expandLoading === row.id
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : expandedId === row.id
                              ? <ChevronUp className="h-3.5 w-3.5" />
                              : <ChevronDown className="h-3.5 w-3.5" />
                          }
                        </button>
                        {/* Edit (draft only) */}
                        {row.status === "draft" && (
                          <button
                            type="button"
                            title="რედაქტირება"
                            onClick={() => router.push(`/imports/${row.id}`)}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Delete draft */}
                        {row.status === "draft" && (
                          <button
                            type="button"
                            title="წაშლა"
                            onClick={() => deleteDraft(row.id)}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail panel */}
                  {expandedId === row.id && (
                    <tr key={`exp-${row.id}`}>
                      <td colSpan={8} className="bg-muted/20 px-4 py-4">
                        {!expandedData[row.id] ? (
                          <p className="text-sm text-muted-foreground">იტვირთება...</p>
                        ) : (
                          <ExpandedDetail
                            data={expandedData[row.id]}
                            onReverted={() => handleReverted(row.id)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Expanded detail panel ─────────────────────────────────────────────────────

function ExpandedDetail({ data, onReverted }: { data: FullImport; onReverted: () => void }) {
  const totalOverhead = data.totalTransportCost + data.totalTerminalCost + data.totalAgencyCost + data.totalVatCost;

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[
          { label: "კურსი",        value: `${fmt(data.exchangeRate, 4)} ₾/$` },
          { label: "ტრანსპორტი",  value: `${fmt(data.totalTransportCost)} ₾` },
          { label: "ტერმინალი",   value: `${fmt(data.totalTerminalCost)} ₾` },
          { label: "სააგენტო",    value: `${fmt(data.totalAgencyCost)} ₾` },
          { label: "სატბო",       value: `${fmt(data.totalVatCost)} ₾` },
          { label: "ჯამი დანახ.", value: `${fmt(totalOverhead)} ₾` },
          { label: "ფაილი",       value: data.documentName ?? "—" },
          { label: "განახლდა",    value: data.updatedAt.slice(0, 16).replace("T", " ") },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-background border border-border p-2.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-medium truncate" title={value}>{value}</p>
          </div>
        ))}
      </div>

      {/* Items table */}
      {data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">პროდუქტი</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">რაოდ.</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">ფასი ($)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">სულ (₾)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">ტრანსპ. (₾)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">ტერმ. (₾)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">სააგ. (₾)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">სატბო (₾)</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">ჩასვ.ღირ./ც (₾)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((it) => (
                <tr key={it.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <p className="font-medium">{it.productName}</p>
                    {it.oemCode && <p className="text-muted-foreground">{it.oemCode}</p>}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(it.quantity, 4)} {it.unit}</td>
                  <td className="px-3 py-2 text-right">{fmt(it.unitPriceUsd, 4)}</td>
                  <td className="px-3 py-2 text-right text-blue-700 dark:text-blue-300">{fmt(it.totalPriceGel)}</td>
                  <td className="px-3 py-2 text-right">{fmt(it.allocatedTransportCost)}</td>
                  <td className="px-3 py-2 text-right">{fmt(it.allocatedTerminalCost)}</td>
                  <td className="px-3 py-2 text-right">{fmt(it.allocatedAgencyCost)}</td>
                  <td className="px-3 py-2 text-right">{fmt(it.allocatedVatCost)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700 dark:text-emerald-300">
                    {fmt(it.landedCostPerUnitGel)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Revert button for completed */}
      {data.status === "completed" && (
        <div className="pt-1">
          <RevertImportButton importId={data.id} onSuccess={onReverted} />
        </div>
      )}
    </div>
  );
}

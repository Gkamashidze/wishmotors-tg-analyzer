"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Textarea, Select } from "@/components/ui/input";
import type { OrderRow, ProductRow } from "@/lib/queries";
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

const STATUS_OPTIONS = STATUS_TABS.slice(1).map((s) => ({ value: s.key, label: s.label }));
const PRIORITY_OPTIONS = [
  { value: "urgent", label: "სასწრაფო" },
  { value: "normal", label: "ჩვეულებრივი" },
  { value: "low", label: "დაბალი" },
];

function priorityBadge(p: string) {
  if (p === "urgent") return <Badge variant="destructive" className="gap-1"><span aria-hidden="true">🚨</span> სასწრაფო</Badge>;
  if (p === "low") return <Badge variant="muted" className="gap-1">დაბალი</Badge>;
  return <Badge variant="success" className="gap-1"><span aria-hidden="true">🟢</span> ჩვეულებრივი</Badge>;
}

function statusBadge(s: string) {
  switch (s) {
    case "pending": return <Badge variant="warning">მოლოდინში</Badge>;
    case "ordered": return <Badge variant="default">შეკვეთილი</Badge>;
    case "received": return <Badge variant="success">მიღებული</Badge>;
    case "cancelled": return <Badge variant="muted">გაუქმებული</Badge>;
    default: return <Badge variant="outline">{s}</Badge>;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

interface EditState {
  product_id: string;
  quantity_needed: string;
  status: string;
  priority: string;
  notes: string;
}

function rowToEdit(r: OrderRow): EditState {
  return {
    product_id: String(r.productId ?? ""),
    quantity_needed: String(r.quantityNeeded),
    status: r.status,
    priority: r.priority,
    notes: r.notes ?? "",
  };
}

export function OrdersTable({ rows, products = [] }: { rows: OrderRow[]; products?: ProductRow[] }) {
  const router = useRouter();
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [queryText, setQueryText] = useState("");
  const [editRow, setEditRow] = useState<OrderRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<OrderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const productOptions = useMemo(() => [
    { value: "", label: "— პროდუქტი არ არის —" },
    ...products.map((p) => ({ value: String(p.id), label: p.name })),
  ], [products]);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return rows.filter((r) => {
      if (priority !== "all" && r.priority !== priority) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.productName ?? "", r.oemCode ?? "", r.notes ?? ""].join(" ").toLowerCase().includes(q);
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

  const openEdit = useCallback((r: OrderRow) => { setEditRow(r); setEditState(rowToEdit(r)); }, []);
  const closeEdit = useCallback(() => { setEditRow(null); setEditState(null); }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: editState.product_id ? Number(editState.product_id) : null,
          quantity_needed: Number(editState.quantity_needed),
          status: editState.status,
          priority: editState.priority,
          notes: editState.notes || null,
        }),
      });
      if (!res.ok) throw new Error("server error");
      closeEdit();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [editRow, editState, closeEdit, router]);

  const handleDelete = useCallback(async () => {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/orders/${deleteRow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteRow(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [deleteRow, router]);

  const set = (key: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRIORITY_TABS.map((t) => {
            const active = priority === t.key;
            const n = counts[t.key as keyof typeof counts] ?? 0;
            return (
              <Button key={t.key} size="sm" variant={active ? "default" : "outline"} onClick={() => setPriority(t.key)} className="gap-1.5 cursor-pointer">
                {t.icon && <span aria-hidden="true">{t.icon}</span>}
                {t.label}
                <span className={cn("ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {n}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="სტატუსის ფილტრი" className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
            {STATUS_TABS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="ძიება..." aria-label="ძიება შეკვეთებში" className="h-9 w-56 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
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
              <TableHead className="min-w-[160px]">შენიშვნა</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის — შეცვალე ფილტრი
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium tabular-nums text-muted-foreground">{r.id}</TableCell>
                  <TableCell className="font-medium">{r.productName ?? <span className="text-muted-foreground italic">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.oemCode ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.quantityNeeded)}</TableCell>
                  <TableCell>{priorityBadge(r.priority)}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm truncate max-w-[200px]">{r.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => openEdit(r)} aria-label="რედაქტირება">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive cursor-pointer" onClick={() => setDeleteRow(r)} aria-label="წაშლა">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        ნაჩვენებია {formatNumber(filtered.length)} / {formatNumber(rows.length)} შეკვეთა
      </p>

      <Dialog open={!!editRow} onClose={closeEdit} title={`შეკვეთის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Select id="ord-product" label="პროდუქტი" options={productOptions} value={editState.product_id} onChange={set("product_id")} />
            <Input id="ord-qty" label="საჭირო რაოდენობა" type="number" min="1" value={editState.quantity_needed} onChange={set("quantity_needed")} />
            <div className="grid grid-cols-2 gap-3">
              <Select id="ord-status" label="სტატუსი" options={STATUS_OPTIONS} value={editState.status} onChange={set("status")} />
              <Select id="ord-priority" label="პრიორიტეტი" options={PRIORITY_OPTIONS} value={editState.priority} onChange={set("priority")} />
            </div>
            <Textarea id="ord-notes" label="შენიშვნა" value={editState.notes} onChange={set("notes")} rows={2} placeholder="სურვილისამებრ..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeEdit} disabled={saving} className="cursor-pointer">გაუქმება</Button>
              <Button onClick={handleSave} disabled={saving} className="cursor-pointer">{saving ? "ინახება..." : "შენახვა"}</Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={handleDelete}
        title="შეკვეთის წაშლა"
        description={`გსურთ შეკვეთა #${deleteRow?.id} (${deleteRow?.productName ?? "—"}) წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />
    </div>
  );
}

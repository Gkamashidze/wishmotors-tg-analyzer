"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Pencil, Trash2, Undo2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Textarea, Select } from "@/components/ui/input";
import { CreatableCombobox } from "@/components/ui/creatable-combobox";
import type { ComboOption } from "@/components/ui/creatable-combobox";
import type { OrderRow, ProductRow } from "@/lib/queries";
import { formatNumber } from "@/lib/utils";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";
import { cn } from "@/lib/utils";

type PriorityFilter = "all" | "urgent" | "low";
type StatusFilter = "all" | "pending" | "ordered" | "received" | "cancelled" | "completed";

const PRIORITY_TABS: { key: PriorityFilter; label: string; icon?: string }[] = [
  { key: "all", label: "ყველა" },
  { key: "urgent", label: "სასწრაფო", icon: "🚨" },
  { key: "low", label: "არც ისე სასწრაფო", icon: "🟢" },
];

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "ყველა სტატუსი" },
  { key: "pending", label: "მოლოდინში" },
  { key: "ordered", label: "შეკვეთილი" },
  { key: "received", label: "მიღებული" },
  { key: "cancelled", label: "გაუქმებული" },
  { key: "completed", label: "შესრულდა" },
];

const STATUS_OPTIONS = STATUS_TABS.slice(1).map((s) => ({ value: s.key, label: s.label }));
const PRIORITY_OPTIONS = [
  { value: "urgent", label: "🚨 სასწრაფო" },
  { value: "low", label: "🟢 არც ისე სასწრაფო" },
];

function normalizePriority(p: string): "urgent" | "low" {
  return p === "urgent" ? "urgent" : "low";
}

function priorityBadge(p: string) {
  const n = normalizePriority(p);
  if (n === "urgent") return <Badge variant="destructive" className="gap-1"><span aria-hidden="true">🚨</span> სასწრაფო</Badge>;
  return <Badge variant="success" className="gap-1"><span aria-hidden="true">🟢</span> არც ისე სასწრაფო</Badge>;
}

function statusBadge(s: string) {
  switch (s) {
    case "pending": return <Badge variant="warning">მოლოდინში</Badge>;
    case "ordered": return <Badge variant="default">შეკვეთილი</Badge>;
    case "received": return <Badge variant="success">მიღებული</Badge>;
    case "cancelled": return <Badge variant="muted">გაუქმებული</Badge>;
    case "completed": return <Badge variant="success"><span aria-hidden="true">✅</span> შესრულდა</Badge>;
    default: return <Badge variant="outline">{s}</Badge>;
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

interface EditState {
  product_id: string;
  oem_code: string;
  quantity_needed: string;
  status: string;
  priority: string;
  notes: string;
}

function rowToEdit(r: OrderRow): EditState {
  return {
    product_id: String(r.productId ?? ""),
    oem_code: r.oemCode ?? "",
    quantity_needed: String(r.quantityNeeded),
    status: r.status,
    priority: normalizePriority(r.priority),
    notes: r.notes ?? "",
  };
}

export function OrdersTable({ rows, products = [] }: { rows: OrderRow[]; products?: ProductRow[] }) {
  const router = useRouter();
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [queryText, setQueryText] = useState("");
  const [viewRow, setViewRow] = useState<OrderRow | null>(null);
  const [editRow, setEditRow] = useState<OrderRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<OrderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [undoingId, setUndoingId] = useState<number | null>(null);
  const [localProducts, setLocalProducts] = useState<ProductRow[]>(products);

  const productOptions = useMemo<ComboOption[]>(() => [
    { value: "", label: "— პროდუქტი არ არის —" },
    ...localProducts.map((p) => ({
      value: String(p.id),
      label: p.name,
      sublabel: p.oemCode ?? undefined,
    })),
  ], [localProducts]);

  const handleCreateProduct = useCallback(async (name: string): Promise<ComboOption> => {
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("product create failed");
    const data = (await res.json()) as { id: number; name: string };
    const newProduct: ProductRow = {
      id: data.id,
      name: data.name,
      oemCode: null,
      currentStock: 0,
      minStock: 20,
      unitPrice: 0,
      unit: "ც",
      createdAt: new Date().toISOString(),
    };
    setLocalProducts((prev) => [...prev, newProduct].sort((a, b) => a.name.localeCompare(b.name)));
    return { value: String(data.id), label: data.name };
  }, []);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    return rows.filter((r) => {
      const normalizedPriority = normalizePriority(r.priority);
      if (priority !== "all" && normalizedPriority !== priority) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.productName ?? "", r.oemCode ?? "", r.notes ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [rows, priority, status, queryText]);

  const counts = useMemo(() => {
    const base = status === "all" ? rows : rows.filter((r) => r.status === status);
    return {
      all: base.length,
      urgent: base.filter((r) => normalizePriority(r.priority) === "urgent").length,
      low: base.filter((r) => normalizePriority(r.priority) === "low").length,
    };
  }, [rows, status]);

  const openEdit = useCallback((r: OrderRow) => { setEditRow(r); setEditState(rowToEdit(r)); }, []);
  const closeEdit = useCallback(() => { setEditRow(null); setEditState(null); }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    try {
      const productId = editState.product_id ? Number(editState.product_id) : null;

      if (productId && editState.oem_code !== (editRow.oemCode ?? "")) {
        const product = localProducts.find((p) => p.id === productId);
        if (product) {
          await fetch(`/api/inventory/${productId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: product.name,
              oem_code: editState.oem_code || null,
              current_stock: product.currentStock,
              min_stock: product.minStock,
              unit_price: product.unitPrice,
              unit: product.unit,
            }),
          });
        }
      }

      const res = await fetch(`/api/orders/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          quantity_needed: Number(editState.quantity_needed),
          status: editState.status,
          priority: editState.priority,
          notes: editState.notes || null,
          oem_code: editState.oem_code || null,
        }),
      });
      if (!res.ok) throw new Error("server error");
      closeEdit();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [editRow, editState, localProducts, closeEdit, router]);

  const handleUndo = useCallback(async (r: OrderRow) => {
    setUndoingId(r.id);
    try {
      const res = await fetch(`/api/orders/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: r.productId ?? null,
          quantity_needed: r.quantityNeeded,
          status: "pending",
          priority: r.priority,
          notes: r.notes ?? null,
        }),
      });
      if (!res.ok) throw new Error("server error");
      router.refresh();
    } finally {
      setUndoingId(null);
    }
  }, [router]);

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
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="სტატუსის ფილტრი" className="h-9 w-full sm:w-auto rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer">
            {STATUS_TABS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="ძიება..." aria-label="ძიება შეკვეთებში" className="h-9 w-full sm:w-56 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <a
            href={`/api/orders/export?priority=${priority}&status=${status}&q=${encodeURIComponent(queryText)}`}
            download
            aria-label="ექსელში ჩამოტვირთვა"
            className="w-full sm:w-auto"
          >
            <Button size="sm" variant="outline" className="gap-1.5 cursor-pointer w-full sm:w-auto">
              <Download className="h-4 w-4" />
              📥 ექსელში ჩამოტვირთვა
            </Button>
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
                  <div className="space-y-2">
                    <p>შედეგი არ არის ამ ფილტრით.</p>
                    {(priority !== "all" || status !== "all" || queryText) && (
                      <button
                        type="button"
                        onClick={() => { setPriority("all"); setStatus("all"); setQueryText(""); }}
                        className="text-sm text-primary underline underline-offset-2 cursor-pointer hover:opacity-75"
                      >
                        ფილტრის გასუფთავება
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-medium">{r.productName ?? <span className="text-muted-foreground italic">—</span>}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.oemCode ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.quantityNeeded)}</TableCell>
                  <TableCell>{priorityBadge(r.priority)}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm truncate max-w-[200px]">{r.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => setViewRow(r)} aria-label="ნახვა">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {r.status === "completed" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 gap-1 cursor-pointer text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          onClick={() => handleUndo(r)}
                          disabled={undoingId === r.id}
                          aria-label="სტატუსის გაუქმება"
                          title="მოლოდინში დაბრუნება"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span className="text-xs">{undoingId === r.id ? "..." : "↩️"}</span>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => openEdit(r)} aria-label="რედაქტირება">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
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

      {/* View Modal */}
      <Dialog open={!!viewRow} onClose={() => setViewRow(null)} title={`შეკვეთის დეტალები #${viewRow?.id}`}>
        {viewRow && (
          <div className="space-y-3">
            <ViewFieldGrid>
              <ViewField label="პროდუქტი" value={viewRow.productName} />
              <ViewField label="OEM კოდი" value={viewRow.oemCode} />
              <ViewField label="საჭირო რ-ბა" value={formatNumber(viewRow.quantityNeeded)} />
              <ViewField label="თარიღი" value={formatDate(viewRow.createdAt)} />
              <ViewField label="პრიორიტეტი" value={priorityBadge(viewRow.priority)} />
              <ViewField label="სტატუსი" value={statusBadge(viewRow.status)} />
              {viewRow.notes && <ViewField label="შენიშვნა" value={viewRow.notes} className="sm:col-span-2" />}
            </ViewFieldGrid>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setViewRow(null)} className="cursor-pointer">დახურვა</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!editRow} onClose={closeEdit} title={`შეკვეთის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <CreatableCombobox
                id="ord-product"
                label="პროდუქტი"
                options={productOptions}
                value={editState.product_id}
                onChange={(val) => {
                  const product = localProducts.find((p) => String(p.id) === val);
                  setEditState((prev) => prev ? { ...prev, product_id: val, oem_code: product?.oemCode ?? "" } : prev);
                }}
                onCreateOption={handleCreateProduct}
                createLabel="ახალი პროდუქტი"
              />
            <Input id="ord-oem" label="OEM კოდი" type="text" value={editState.oem_code} onChange={set("oem_code")} placeholder="სურვილისამებრ" />
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

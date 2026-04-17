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
import type { SaleRow, ProductRow } from "@/lib/queries";
import { formatGEL, formatNumber } from "@/lib/utils";

const PAYMENT_OPTIONS = [
  { value: "cash", label: "ნაღდი" },
  { value: "card", label: "ბარათი" },
  { value: "transfer", label: "გადარიცხვა" },
];

const SELLER_OPTIONS = [
  { value: "shop", label: "მაღაზია" },
  { value: "telegram", label: "Telegram" },
  { value: "other", label: "სხვა" },
];

function paymentLabel(m: string) {
  return PAYMENT_OPTIONS.find((o) => o.value === m)?.label ?? m;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

function toDatetimeLocal(iso: string) {
  try {
    return new Date(iso).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

interface EditState {
  product_id: string;
  quantity: string;
  unit_price: string;
  cost_amount: string;
  payment_method: string;
  seller_type: string;
  customer_name: string;
  sold_at: string;
  notes: string;
}

function rowToEdit(r: SaleRow): EditState {
  return {
    product_id: String(r.productId ?? ""),
    quantity: String(r.quantity),
    unit_price: String(r.unitPrice),
    cost_amount: String(r.costAmount),
    payment_method: r.paymentMethod,
    seller_type: r.sellerType,
    customer_name: r.customerName ?? "",
    sold_at: toDatetimeLocal(r.soldAt),
    notes: r.notes ?? "",
  };
}

export function SalesTable({ rows, products }: { rows: SaleRow[]; products: ProductRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<SaleRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<SaleRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const productOptions = useMemo(() => [
    { value: "", label: "— პროდუქტი არ არის —" },
    ...products.map((p) => ({ value: String(p.id), label: p.name })),
  ], [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.productName ?? "", r.customerName ?? "", r.notes ?? "", String(r.id)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const openEdit = useCallback((r: SaleRow) => {
    setEditRow(r);
    setEditState(rowToEdit(r));
  }, []);

  const closeEdit = useCallback(() => {
    setEditRow(null);
    setEditState(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sales/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: editState.product_id ? Number(editState.product_id) : null,
          quantity: Number(editState.quantity),
          unit_price: Number(editState.unit_price),
          cost_amount: Number(editState.cost_amount),
          payment_method: editState.payment_method,
          seller_type: editState.seller_type,
          customer_name: editState.customer_name || null,
          sold_at: editState.sold_at,
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
      const res = await fetch(`/api/sales/${deleteRow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteRow(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [deleteRow, router]);

  const set = (key: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ძიება (პროდუქტი, მომხმარებელი...)"
          aria-label="ძიება გაყიდვებში"
          className="h-9 w-72 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          {formatNumber(filtered.length)} / {formatNumber(rows.length)} ჩანაწერი
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>პროდუქტი</TableHead>
              <TableHead className="text-right">რ-ბა</TableHead>
              <TableHead className="text-right">ფასი</TableHead>
              <TableHead className="text-right">ჯამი</TableHead>
              <TableHead className="text-right">ღირ.</TableHead>
              <TableHead className="text-right">მოგება</TableHead>
              <TableHead>გადახდა</TableHead>
              <TableHead>მყიდველი</TableHead>
              <TableHead>თარიღი</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const total = r.quantity * r.unitPrice;
                const profit = total - r.costAmount;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground text-xs">{r.id}</TableCell>
                    <TableCell className="font-medium">
                      {r.productName ?? <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatGEL(r.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatGEL(total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatGEL(r.costAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={profit >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                        {formatGEL(profit)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{paymentLabel(r.paymentMethod)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.customerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(r.soldAt)}
                    </TableCell>
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Modal */}
      <Dialog open={!!editRow} onClose={closeEdit} title={`გაყიდვის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Select id="sale-product" label="პროდუქტი" options={productOptions} value={editState.product_id} onChange={set("product_id")} />
            <div className="grid grid-cols-2 gap-3">
              <Input id="sale-qty" label="რაოდენობა" type="number" min="1" value={editState.quantity} onChange={set("quantity")} />
              <Input id="sale-price" label="გასაყიდი ფასი (₾)" type="number" min="0" step="0.01" value={editState.unit_price} onChange={set("unit_price")} />
            </div>
            <Input id="sale-cost" label="თვითღირებულება (₾)" type="number" min="0" step="0.01" value={editState.cost_amount} onChange={set("cost_amount")} />
            <div className="grid grid-cols-2 gap-3">
              <Select id="sale-payment" label="გადახდის მეთოდი" options={PAYMENT_OPTIONS} value={editState.payment_method} onChange={set("payment_method")} />
              <Select id="sale-seller" label="გამყიდველი" options={SELLER_OPTIONS} value={editState.seller_type} onChange={set("seller_type")} />
            </div>
            <Input id="sale-customer" label="მომხმარებელი" type="text" value={editState.customer_name} onChange={set("customer_name")} placeholder="სახელი (სურვილისამებრ)" />
            <Input id="sale-date" label="გაყიდვის თარიღი" type="datetime-local" value={editState.sold_at} onChange={set("sold_at")} />
            <Textarea id="sale-notes" label="შენიშვნა" value={editState.notes} onChange={set("notes")} rows={2} placeholder="სურვილისამებრ..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeEdit} disabled={saving} className="cursor-pointer">გაუქმება</Button>
              <Button onClick={handleSave} disabled={saving} className="cursor-pointer">{saving ? "ინახება..." : "შენახვა"}</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={handleDelete}
        title="გაყიდვის წაშლა"
        description={`გსურთ გაყიდვა #${deleteRow?.id} (${deleteRow?.productName ?? "—"}) წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />
    </div>
  );
}

"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { startOfMonth, format } from "date-fns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Textarea, Select } from "@/components/ui/input";
import { ProductCombobox } from "@/components/ui/product-combobox";
import { DateRangePicker, type DateRange } from "@/components/dashboard/date-range-picker";
import type { SaleRow, ProductRow } from "@/lib/queries";
import { formatGEL, formatNumber } from "@/lib/utils";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";

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
  oem_code: string;
  product_name: string;
  quantity: string;
  unit_price: string;
  cost_amount: string;
  payment_method: string;
  seller_type: string;
  customer_name: string;
  sold_at: string;
  notes: string;
  vat_amount: string;
  is_vat_included: string;
}

function rowToEdit(r: SaleRow): EditState {
  return {
    product_id: String(r.productId ?? ""),
    oem_code: r.oemCode ?? "",
    product_name: r.productName ?? "",
    quantity: String(r.quantity),
    unit_price: String(r.unitPrice),
    cost_amount: String(r.costAmount),
    payment_method: r.paymentMethod,
    seller_type: r.sellerType,
    customer_name: r.customerName ?? "",
    sold_at: toDatetimeLocal(r.soldAt),
    notes: r.notes ?? "",
    vat_amount: String(r.vatAmount),
    is_vat_included: String(r.isVatIncluded),
  };
}

export function SalesTable({ rows, products }: { rows: SaleRow[]; products: ProductRow[] }) {
  const router = useRouter();
  const today = new Date();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(today),
    to: today,
  });
  const [search, setSearch] = useState("");
  const [viewRow, setViewRow] = useState<SaleRow | null>(null);
  const [editRow, setEditRow] = useState<SaleRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<SaleRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [returnRow, setReturnRow] = useState<SaleRow | null>(null);
  const [returning, setReturning] = useState(false);
  const [localProducts, setLocalProducts] = useState<ProductRow[]>(products);

  const fromTime = useMemo(() => dateRange.from.getTime(), [dateRange.from]);
  const toTime = useMemo(() => {
    const d = new Date(dateRange.to);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, [dateRange.to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const t = new Date(r.soldAt).getTime();
      if (t < fromTime || t > toTime) return false;
      if (!q) return true;
      return [r.productName ?? "", r.customerName ?? "", r.notes ?? "", String(r.id)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, fromTime, toTime]);

  const totals = useMemo(() => ({
    sales: filtered.reduce((s, r) => s + r.quantity * r.unitPrice, 0),
    cost: filtered.reduce((s, r) => s + r.costAmount, 0),
    profit: filtered.reduce((s, r) => s + (r.quantity * r.unitPrice - r.costAmount), 0),
  }), [filtered]);

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
          oem_code: editState.oem_code.trim() || null,
          product_name: editState.product_name.trim() || null,
          quantity: Number(editState.quantity),
          unit_price: Number(editState.unit_price),
          cost_amount: Number(editState.cost_amount),
          payment_method: editState.payment_method,
          seller_type: editState.seller_type,
          customer_name: editState.customer_name || null,
          sold_at: editState.sold_at,
          notes: editState.notes || null,
          vat_amount: Number(editState.vat_amount) || 0,
          is_vat_included: editState.is_vat_included === "true",
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

  const handleReturn = useCallback(async (method: "cash" | "bank") => {
    if (!returnRow) return;
    setReturning(true);
    try {
      const res = await fetch(`/api/sales/${returnRow.id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refund_method: method }),
      });
      if (!res.ok) throw new Error("server error");
      setReturnRow(null);
      closeEdit();
      router.refresh();
    } finally {
      setReturning(false);
    }
  }, [returnRow, closeEdit, router]);

  const set = (key: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);
  };

  return (
    <div className="space-y-4">
      {/* Date range picker */}
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} defaultPreset="month" />
      </div>

      {/* Totals summary */}
      <div className="flex flex-wrap items-center gap-4 px-1">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{formatNumber(filtered.length)}</span> ჩანაწერი
          {filtered.length < rows.length && (
            <span className="ml-1 text-xs text-muted-foreground">/ {formatNumber(rows.length)}</span>
          )}
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="text-sm">
          <span className="text-muted-foreground">გაყიდვა: </span>
          <span className="font-semibold">{formatGEL(totals.sales)}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="text-sm">
          <span className="text-muted-foreground">ღირებ.: </span>
          <span className="font-medium text-muted-foreground">{formatGEL(totals.cost)}</span>
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="text-sm">
          <span className="text-muted-foreground">მოგება: </span>
          <span className={["font-semibold", totals.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"].join(" ")}>
            {formatGEL(totals.profit)}
          </span>
        </span>
      </div>

      {/* Search */}
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ძიება (პროდუქტი, მომხმარებელი...)"
          aria-label="ძიება გაყიდვებში"
          className="h-9 w-72 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          {format(dateRange.from, "d MMM yyyy")} — {format(dateRange.to, "d MMM yyyy")}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
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
              <TableHead className="text-right">დღგ</TableHead>
              <TableHead>გადახდა</TableHead>
              <TableHead>მყიდველი</TableHead>
              <TableHead>თარიღი</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => {
                const total = r.quantity * r.unitPrice;
                const profit = total - r.costAmount;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground text-xs">{idx + 1}</TableCell>
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
                    <TableCell className="text-right tabular-nums">
                      {r.isVatIncluded ? (
                        <span className="text-purple-600 font-medium">{formatGEL(r.vatAmount)}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
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
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => setViewRow(r)} aria-label="ნახვა">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
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

      {/* View Modal */}
      <Dialog open={!!viewRow} onClose={() => setViewRow(null)} title={`გაყიდვის დეტალები #${viewRow?.id}`}>
        {viewRow && (() => {
          const total = viewRow.quantity * viewRow.unitPrice;
          const profit = total - viewRow.costAmount;
          return (
            <div className="space-y-3">
              <ViewFieldGrid>
                <ViewField label="პროდუქტი" value={viewRow.productName} className="sm:col-span-2" />
                <ViewField label="OEM კოდი" value={viewRow.oemCode} />
                <ViewField label="რაოდენობა" value={formatNumber(viewRow.quantity)} />
                <ViewField label="ერთ. ფასი" value={formatGEL(viewRow.unitPrice)} />
                <ViewField label="ჯამი" value={formatGEL(total)} />
                <ViewField label="თვითღირებულება" value={formatGEL(viewRow.costAmount)} />
                <ViewField label="მოგება" value={<span className={profit >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}>{formatGEL(profit)}</span>} />
                <ViewField label="გადახდა" value={paymentLabel(viewRow.paymentMethod)} />
                <ViewField label="გამყიდველი ტიპი" value={viewRow.sellerType} />
                <ViewField label="მყიდველი" value={viewRow.customerName} />
                <ViewField label="თარიღი" value={formatDate(viewRow.soldAt)} />
                {viewRow.notes && <ViewField label="შენიშვნა" value={viewRow.notes} className="sm:col-span-2" />}
              </ViewFieldGrid>
              <div className="flex justify-end pt-2">
                <Button variant="outline" onClick={() => setViewRow(null)} className="cursor-pointer">დახურვა</Button>
              </div>
            </div>
          );
        })()}
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editRow} onClose={closeEdit} title={`გაყიდვის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            {/* Product selector — auto-fills OEM and Name below */}
            <ProductCombobox
              id="sale-product"
              label="პროდუქტი (სიიდან)"
              products={localProducts}
              value={editState.product_id}
              onChange={(val) => {
                const prod = localProducts.find((p) => String(p.id) === val);
                setEditState((prev) => prev ? {
                  ...prev,
                  product_id: val,
                  oem_code: prod?.oemCode ?? "",
                  product_name: prod?.name ?? "",
                } : prev);
              }}
              onProductAdded={(p) => setLocalProducts((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))}
            />

            {/* OEM Code + Product Name — directly editable; backend uses these to find/create product */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="sale-oem"
                label="OEM კოდი"
                type="text"
                value={editState.oem_code}
                onChange={set("oem_code")}
                placeholder="მაგ. 16400-0L010"
              />
              <Input
                id="sale-product-name"
                label="პროდუქტის სახელი"
                type="text"
                value={editState.product_name}
                onChange={set("product_name")}
                placeholder="პროდუქტის სახელი"
              />
            </div>

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
            <div className="grid grid-cols-2 gap-3">
              <Input id="sale-vat" label="დღგ-ს თანხა (₾)" type="number" min="0" step="0.01" value={editState.vat_amount} onChange={set("vat_amount")} />
              <Select id="sale-vat-inc" label="დღგ ჩართულია?" options={[{ value: "false", label: "არა" }, { value: "true", label: "დიახ" }]} value={editState.is_vat_included} onChange={set("is_vat_included")} />
            </div>
            <Textarea id="sale-notes" label="შენიშვნა" value={editState.notes} onChange={set("notes")} rows={2} placeholder="სურვილისამებრ..." />
            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setReturnRow(editRow)}
                disabled={saving}
                className="cursor-pointer text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                დაბრუნება
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={closeEdit} disabled={saving} className="cursor-pointer">გაუქმება</Button>
                <Button onClick={handleSave} disabled={saving} className="cursor-pointer">{saving ? "ინახება..." : "შენახვა"}</Button>
              </div>
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

      {/* Return — Refund Method Modal */}
      <Dialog
        open={!!returnRow}
        onClose={() => setReturnRow(null)}
        title="გაყიდვის დაბრუნება"
      >
        {returnRow && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{returnRow.productName ?? `#${returnRow.id}`}</span>
              {" — "}
              {formatGEL(returnRow.quantity * returnRow.unitPrice)}
            </p>
            <p className="text-sm font-medium">რა ფორმით დაუბრუნეთ თანხა კლიენტს?</p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-16 flex-col gap-1 cursor-pointer text-base"
                disabled={returning}
                onClick={() => handleReturn("cash")}
              >
                <span className="text-2xl">💵</span>
                <span>ხელზე</span>
              </Button>
              <Button
                variant="outline"
                className="h-16 flex-col gap-1 cursor-pointer text-base"
                disabled={returning}
                onClick={() => handleReturn("bank")}
              >
                <span className="text-2xl">💳</span>
                <span>ბანკით</span>
              </Button>
            </div>
            {returning && (
              <p className="text-center text-sm text-muted-foreground">მუშავდება...</p>
            )}
            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={() => setReturnRow(null)} disabled={returning} className="cursor-pointer">
                გაუქმება
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

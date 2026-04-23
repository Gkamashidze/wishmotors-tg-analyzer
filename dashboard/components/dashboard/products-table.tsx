"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";
import type { ProductRow } from "@/lib/queries";
import { PRODUCTS_PAGE_SIZE } from "@/lib/constants";
import type { ProductMetricRow } from "@/lib/financial-queries";
import { formatGEL, formatNumber, cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16);
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "ხელზე 💵",
  transfer: "დარიცხვა 🏦",
  credit: "ნისია 📋",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "⏳ მოლოდინი",
  completed: "✅ შესრულდა",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "🔴 სასწრაფო",
  normal: "🟡 ჩვეულებრივი",
  low: "🟢 დაბალი",
};

// ─── Sub-transaction types ────────────────────────────────────────────────────

interface ProductSale {
  id: number;
  quantity: number;
  unitPrice: number;
  paymentMethod: string;
  customerName: string | null;
  soldAt: string;
  notes: string | null;
  topicId: number | null;
  topicMessageId: number | null;
}

interface ProductOrder {
  id: number;
  quantityNeeded: number;
  status: string;
  priority: string;
  createdAt: string;
  notes: string | null;
  topicId: number | null;
  topicMessageId: number | null;
}

interface SaleEditState {
  quantity: string;
  unit_price: string;
  payment_method: string;
  customer_name: string;
  sold_at: string;
  notes: string;
}

interface OrderEditState {
  quantity_needed: string;
  status: string;
  priority: string;
  notes: string;
}

// ─── Product edit / add state ─────────────────────────────────────────────────

interface EditState {
  name: string;
  oem_code: string;
}

interface AddState {
  name: string;
  oem_code: string;
  unit: string;
  unit_price: string;
  current_stock: string;
  min_stock: string;
}

type WizardStep = 1 | 2 | 3 | 4;

const WIZARD_STEPS: Record<WizardStep, string> = {
  1: "დასახელება",
  2: "OEM კოდი",
  3: "მარაგი",
  4: "ფასი",
};

const DEFAULT_ADD: AddState = {
  name: "",
  oem_code: "",
  unit: "ცალი",
  unit_price: "0",
  current_stock: "0",
  min_stock: "0",
};

function rowToEdit(r: ProductRow): EditState {
  return { name: r.name, oem_code: r.oemCode ?? "" };
}

function saleToEdit(s: ProductSale): SaleEditState {
  return {
    quantity: String(s.quantity),
    unit_price: String(s.unitPrice),
    payment_method: s.paymentMethod,
    customer_name: s.customerName ?? "",
    sold_at: toDatetimeLocal(s.soldAt),
    notes: s.notes ?? "",
  };
}

function orderToEdit(o: ProductOrder): OrderEditState {
  return {
    quantity_needed: String(o.quantityNeeded),
    status: o.status,
    priority: o.priority,
    notes: o.notes ?? "",
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

type TxTab = "info" | "sales" | "orders";

export function ProductsTable({
  rows,
  total,
  page,
}: {
  rows: ProductRow[];
  total: number;
  page: number;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showNegative, setShowNegative] = useState(false);
  const [productMetrics, setProductMetrics] = useState<ProductMetricRow[]>([]);

  useEffect(() => {
    fetch("/api/products/metrics")
      .then((r) => r.json())
      .then((data: ProductMetricRow[]) => setProductMetrics(data))
      .catch(() => {});
  }, []);

  // Product-level state
  const [viewRow, setViewRow] = useState<ProductRow | null>(null);
  const [editRow, setEditRow] = useState<ProductRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<ProductRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add product wizard state
  const [isAdding, setIsAdding] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [addState, setAddState] = useState<AddState>(DEFAULT_ADD);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Transactions tab state
  const [txTab, setTxTab] = useState<TxTab>("info");
  const [txSales, setTxSales] = useState<ProductSale[]>([]);
  const [txOrders, setTxOrders] = useState<ProductOrder[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Sub-sale edit
  const [editSaleRow, setEditSaleRow] = useState<ProductSale | null>(null);
  const [editSaleState, setEditSaleState] = useState<SaleEditState | null>(null);
  const [deleteSaleId, setDeleteSaleId] = useState<number | null>(null);

  // Sub-order edit
  const [editOrderRow, setEditOrderRow] = useState<ProductOrder | null>(null);
  const [editOrderState, setEditOrderState] = useState<OrderEditState | null>(null);
  const [deleteOrderId, setDeleteOrderId] = useState<number | null>(null);

  const [subSaving, setSubSaving] = useState(false);
  const [subDeleting, setSubDeleting] = useState(false);

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  const goToPage = useCallback((p: number) => {
    router.push(`?page=${p}`);
  }, [router]);

  // ── Load transactions when viewRow changes ──────────────────────────────────

  const reloadTx = useCallback(async (productId: number) => {
    setTxLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/transactions`);
      if (!res.ok) return;
      const data = (await res.json()) as { sales: ProductSale[]; orders: ProductOrder[] };
      setTxSales(data.sales);
      setTxOrders(data.orders);
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!viewRow) {
      setTxSales([]);
      setTxOrders([]);
      setTxTab("info");
      return;
    }
    let cancelled = false;
    setTxLoading(true);
    fetch(`/api/products/${viewRow.id}/transactions`)
      .then((r) => r.json())
      .then((data: { sales: ProductSale[]; orders: ProductOrder[] }) => {
        if (!cancelled) { setTxSales(data.sales); setTxOrders(data.orders); }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTxLoading(false); });
    return () => { cancelled = true; };
  }, [viewRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered rows (client-side within current page) ─────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (showNegative && r.currentStock >= 0) return false;
      if (!q) return true;
      return [r.name, r.oemCode ?? ""].join(" ").toLowerCase().includes(q);
    });
  }, [rows, search, showNegative]);

  // ── Add product ─────────────────────────────────────────────────────────────

  const openAdd = useCallback(() => {
    setAddState(DEFAULT_ADD);
    setAddError(null);
    setWizardStep(1);
    setIsAdding(true);
  }, []);

  const closeAdd = useCallback(() => {
    setIsAdding(false);
    setAddError(null);
    setWizardStep(1);
  }, []);

  const wizardNext = useCallback(() => {
    setAddError(null);
    if (wizardStep === 1 && !addState.name.trim()) {
      setAddError("დასახელება სავალდებულოა");
      return;
    }
    if (wizardStep === 2 && addState.oem_code.trim() && !/^[A-Za-z0-9]{4,}$/.test(addState.oem_code.trim())) {
      setAddError("OEM კოდი უნდა შეიცავდეს მინიმუმ 4 სიმბოლოს (ციფრებს ან/და ლათინურ ასოებს)");
      return;
    }
    if (wizardStep < 4) setWizardStep((s) => (s + 1) as WizardStep);
  }, [wizardStep, addState.name, addState.oem_code]);

  const wizardBack = useCallback(() => {
    setAddError(null);
    if (wizardStep > 1) setWizardStep((s) => (s - 1) as WizardStep);
  }, [wizardStep]);

  const handleAdd = useCallback(async () => {
    if (!addState.name.trim()) {
      setAddError("დასახელება სავალდებულოა");
      return;
    }
    if (addState.oem_code.trim() && !/^[A-Za-z0-9]{4,}$/.test(addState.oem_code.trim())) {
      setAddError("OEM კოდი უნდა შეიცავდეს მინიმუმ 4 სიმბოლოს (ციფრებს ან/და ლათინურ ასოებს)");
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addState.name.trim(),
          oem_code: addState.oem_code.trim() || null,
          unit: addState.unit.trim() || "ცალი",
          unit_price: Number(addState.unit_price) || 0,
          current_stock: Number(addState.current_stock) || 0,
          min_stock: Number(addState.min_stock) || 0,
        }),
      });
      if (res.status === 200) {
        setAddError("ამ სახელის პროდუქტი უკვე არსებობს");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setAddError(body.error ?? "შეცდომა. სცადეთ თავიდან.");
        return;
      }
      closeAdd();
      router.push("?page=1");
      router.refresh();
    } finally {
      setAddSaving(false);
    }
  }, [addState, closeAdd, router]);

  const setAdd = (key: keyof AddState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setAddState((prev) => ({ ...prev, [key]: e.target.value }));

  // ── Product edit/delete ─────────────────────────────────────────────────────

  const openEdit = useCallback((r: ProductRow) => {
    setEditRow(r); setEditState(rowToEdit(r));
  }, []);

  const closeEdit = useCallback(() => {
    setEditRow(null); setEditState(null); setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/inventory/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editState.name,
          oem_code: editState.oem_code || null,
          current_stock: editRow.currentStock,
          min_stock: editRow.minStock,
          unit_price: editRow.unitPrice,
          unit: editRow.unit,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? "შენახვა ვერ მოხერხდა. სცადეთ თავიდან.");
        return;
      }
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
      const res = await fetch(`/api/inventory/${deleteRow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteRow(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [deleteRow, router]);

  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  // ── Sub-sale edit/delete ────────────────────────────────────────────────────

  const openEditSale = (s: ProductSale) => {
    setEditSaleRow(s); setEditSaleState(saleToEdit(s));
  };

  const handleSaveSale = useCallback(async () => {
    if (!editSaleRow || !editSaleState || !viewRow) return;
    setSubSaving(true);
    try {
      const res = await fetch(`/api/sales/${editSaleRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: viewRow.id,
          quantity: Number(editSaleState.quantity),
          unit_price: Number(editSaleState.unit_price),
          cost_amount: editSaleRow.unitPrice,
          payment_method: editSaleState.payment_method,
          seller_type: "individual",
          customer_name: editSaleState.customer_name || null,
          sold_at: new Date(editSaleState.sold_at).toISOString(),
          notes: editSaleState.notes || null,
        }),
      });
      if (!res.ok) throw new Error("server error");
      setEditSaleRow(null); setEditSaleState(null);
      await reloadTx(viewRow.id);
    } finally {
      setSubSaving(false);
    }
  }, [editSaleRow, editSaleState, viewRow, reloadTx]);

  const handleDeleteSale = useCallback(async () => {
    if (!deleteSaleId || !viewRow) return;
    setSubDeleting(true);
    try {
      const res = await fetch(`/api/sales/${deleteSaleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteSaleId(null);
      await reloadTx(viewRow.id);
    } finally {
      setSubDeleting(false);
    }
  }, [deleteSaleId, viewRow, reloadTx]);

  const setSaleField = (key: keyof SaleEditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEditSaleState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  // ── Sub-order edit/delete ───────────────────────────────────────────────────

  const openEditOrder = (o: ProductOrder) => {
    setEditOrderRow(o); setEditOrderState(orderToEdit(o));
  };

  const handleSaveOrder = useCallback(async () => {
    if (!editOrderRow || !editOrderState || !viewRow) return;
    setSubSaving(true);
    try {
      const res = await fetch(`/api/orders/${editOrderRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: viewRow.id,
          quantity_needed: Number(editOrderState.quantity_needed),
          status: editOrderState.status,
          priority: editOrderState.priority,
          notes: editOrderState.notes || null,
        }),
      });
      if (!res.ok) throw new Error("server error");
      setEditOrderRow(null); setEditOrderState(null);
      await reloadTx(viewRow.id);
    } finally {
      setSubSaving(false);
    }
  }, [editOrderRow, editOrderState, viewRow, reloadTx]);

  const handleDeleteOrder = useCallback(async () => {
    if (!deleteOrderId || !viewRow) return;
    setSubDeleting(true);
    try {
      const res = await fetch(`/api/orders/${deleteOrderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteOrderId(null);
      await reloadTx(viewRow.id);
    } finally {
      setSubDeleting(false);
    }
  }, [deleteOrderId, viewRow, reloadTx]);

  const setOrderField = (key: keyof OrderEditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEditOrderState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ძიება (დასახელება, OEM...)"
            aria-label="ძიება პროდუქციაში"
            className="h-9 w-72 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => setShowNegative((v) => !v)}
            aria-pressed={showNegative}
            className={cn(
              "h-9 px-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer",
              showNegative
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-destructive/50",
            )}
          >
            ⚠️ უარყოფითი მარაგები
          </button>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {formatNumber(filtered.length)} / {formatNumber(total)} პროდუქტი
          </p>
          <Button size="sm" onClick={openAdd} className="h-9 cursor-pointer gap-1.5">
            <Plus className="h-4 w-4" />
            პროდუქტის დამატება
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>OEM კოდი</TableHead>
              <TableHead>დასახელება</TableHead>
              <TableHead className="w-24 text-right">მარაგი</TableHead>
              <TableHead className="w-24 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground text-xs">
                    {(page - 1) * PRODUCTS_PAGE_SIZE + idx + 1}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.oemCode ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className={cn(
                    "text-right tabular-nums text-sm font-medium",
                    r.currentStock < 0 ? "text-destructive" : "text-foreground",
                  )}>
                    {formatNumber(r.currentStock)}
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="gap-1 cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            წინა
          </Button>
          <span className="text-sm text-muted-foreground">
            გვ. <span className="font-medium text-foreground">{page}</span> / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="gap-1 cursor-pointer"
          >
            შემდეგი
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Add Product Wizard ───────────────────────────────────────────────── */}
      <Dialog open={isAdding} onClose={closeAdd} title="ახალი პროდუქტის დამატება">
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              {([1, 2, 3, 4] as WizardStep[]).map((s) => (
                <span
                  key={s}
                  className={cn(
                    "font-medium transition-colors",
                    s === wizardStep ? "text-primary" :
                    s < wizardStep ? "text-[hsl(var(--success))]" : ""
                  )}
                >
                  {WIZARD_STEPS[s]}
                </span>
              ))}
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(wizardStep / 4) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-right">
              ნაბიჯი {wizardStep} / 4
            </p>
          </div>

          {/* Step 1 — Product name */}
          {wizardStep === 1 && (
            <div className="space-y-2 min-h-[80px]">
              <p className="text-sm font-medium">პროდუქტის სახელი რა არის?</p>
              <Input
                id="add-name"
                label="დასახელება *"
                type="text"
                value={addState.name}
                onChange={setAdd("name")}
                placeholder="მაგ: ზეთის ფილტრი, მარჯვენა სარკე..."
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && wizardNext()}
              />
            </div>
          )}

          {/* Step 2 — OEM code */}
          {wizardStep === 2 && (
            <div className="space-y-2 min-h-[80px]">
              <p className="text-sm font-medium">OEM კოდი გაქვთ? <span className="text-muted-foreground font-normal">(სურვილისამებრ)</span></p>
              <Input
                id="add-oem"
                label="OEM კოდი"
                type="text"
                value={addState.oem_code}
                onChange={setAdd("oem_code")}
                placeholder="მაგ: 8390132500 ან გამოტოვეთ"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && wizardNext()}
              />
            </div>
          )}

          {/* Step 3 — Stock & unit */}
          {wizardStep === 3 && (
            <div className="space-y-2 min-h-[80px]">
              <p className="text-sm font-medium">ამჟამად რამდენია მარაგში?</p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  id="add-stock"
                  label="რაოდენობა"
                  type="number"
                  min="0"
                  value={addState.current_stock}
                  onChange={setAdd("current_stock")}
                  autoFocus
                />
                <Input
                  id="add-unit"
                  label="ერთეული"
                  type="text"
                  value={addState.unit}
                  onChange={setAdd("unit")}
                  placeholder="ცალი"
                />
              </div>
            </div>
          )}

          {/* Step 4 — Price & min stock + summary */}
          {wizardStep === 4 && (
            <div className="space-y-3 min-h-[80px]">
              <p className="text-sm font-medium">ფასი და მინიმალური მარაგი</p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  id="add-price"
                  label="ერთ. ფასი (₾)"
                  type="number"
                  min="0"
                  step="0.01"
                  value={addState.unit_price}
                  onChange={setAdd("unit_price")}
                  autoFocus
                />
                <Input
                  id="add-min"
                  label="მინ. მარაგი"
                  type="number"
                  min="0"
                  value={addState.min_stock}
                  onChange={setAdd("min_stock")}
                />
              </div>
              {/* Summary */}
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 space-y-1 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">შეჯამება</p>
                <div className="flex justify-between"><span className="text-muted-foreground">სახელი</span><span className="font-medium">{addState.name}</span></div>
                {addState.oem_code && <div className="flex justify-between"><span className="text-muted-foreground">OEM</span><span className="font-mono text-xs">{addState.oem_code}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">მარაგი</span><span>{addState.current_stock} {addState.unit}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">ფასი</span><span>{Number(addState.unit_price).toFixed(2)}₾</span></div>
              </div>
            </div>
          )}

          {addError && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {addError}
            </p>
          )}

          {/* Navigation */}
          <div className="flex justify-between gap-2 pt-1">
            <Button
              variant="outline"
              onClick={wizardStep === 1 ? closeAdd : wizardBack}
              disabled={addSaving}
              className="cursor-pointer"
            >
              {wizardStep === 1 ? "გაუქმება" : "← უკან"}
            </Button>
            {wizardStep < 4 ? (
              <Button onClick={wizardNext} className="cursor-pointer">
                შემდეგი →
              </Button>
            ) : (
              <Button onClick={handleAdd} disabled={addSaving} className="cursor-pointer">
                {addSaving ? "ემატება..." : "✓ დამატება"}
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      {/* ── View Modal ──────────────────────────────────────────────────────── */}
      <Dialog
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={`პროდუქტი: ${viewRow?.name ?? ""}`}
        className="max-w-3xl"
      >
        {viewRow && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 border-b border-border -mx-5 px-5">
              {(["info", "sales", "orders"] as TxTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setTxTab(tab)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                    txTab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "info" && "ინფორმაცია"}
                  {tab === "sales" && `გაყიდვები${txLoading ? "" : ` (${txSales.length})`}`}
                  {tab === "orders" && `შეკვეთები${txLoading ? "" : ` (${txOrders.length})`}`}
                </button>
              ))}
            </div>

            {/* Info tab */}
            {txTab === "info" && (() => {
              const pm = productMetrics.find((m) => m.productId === viewRow.id);
              const roiColor =
                !pm || pm.roiPct === 0 ? "text-muted-foreground" :
                pm.roiPct >= 30 ? "text-[hsl(var(--success))] font-semibold" :
                pm.roiPct >= 10 ? "text-primary font-medium" : "text-destructive font-semibold";
              const turnColor =
                !pm || pm.turnoverRatio === 0 ? "text-muted-foreground" :
                pm.turnoverRatio >= 4 ? "text-[hsl(var(--success))] font-semibold" :
                pm.turnoverRatio >= 1 ? "text-primary font-medium" : "text-destructive font-semibold";
              return (
                <div className="space-y-4">
                  <ViewFieldGrid>
                    <ViewField label="დასახელება" value={viewRow.name} className="sm:col-span-2" />
                    <ViewField label="OEM კოდი" value={viewRow.oemCode} />
                    <ViewField label="ერთეული" value={viewRow.unit} />
                    <ViewField label="მარაგი" value={formatNumber(viewRow.currentStock)} />
                    <ViewField label="მინ. მარაგი" value={formatNumber(viewRow.minStock)} />
                    <ViewField label="ერთ. ფასი" value={formatGEL(viewRow.unitPrice)} />
                    <ViewField label="დამატების თარიღი" value={formatDate(viewRow.createdAt)} />
                  </ViewFieldGrid>
                  {pm && (
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        ფინანსური მაჩვენებლები (ბოლო 90 დღე)
                      </p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">ROI</span>
                          <span className={roiColor}>{pm.roiPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">ბრუნვა (Turnover)</span>
                          <span className={turnColor}>{pm.turnoverRatio.toFixed(2)}×</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">შემოსავ.</span>
                          <span className="tabular-nums">{formatGEL(pm.revenueGel)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">თვითღირ.</span>
                          <span className="tabular-nums">{formatGEL(pm.cogsGel)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-muted-foreground">მარაგის ღირ.</span>
                          <span className="tabular-nums">{formatGEL(pm.inventoryValueGel)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Sales tab */}
            {txTab === "sales" && (
              <div className="min-h-[200px]">
                {txLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-10">იტვირთება...</p>
                ) : txSales.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">გაყიდვები არ არის</p>
                ) : (
                  <div className="overflow-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>თარიღი</TableHead>
                          <TableHead className="text-right">რ-ბა</TableHead>
                          <TableHead className="text-right">ფასი</TableHead>
                          <TableHead className="text-right">ჯამი</TableHead>
                          <TableHead>გადახდა</TableHead>
                          <TableHead>მყიდველი</TableHead>
                          <TableHead className="w-16 text-right">მოქ.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {txSales.map((s, idx) => (
                          <TableRow key={s.id}>
                            <TableCell className="text-xs text-muted-foreground tabular-nums">{idx + 1}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(s.soldAt)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{s.quantity}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{s.unitPrice.toFixed(2)}₾</TableCell>
                            <TableCell className="text-right tabular-nums text-xs font-medium">
                              {(s.quantity * s.unitPrice).toFixed(2)}₾
                            </TableCell>
                            <TableCell className="text-xs">
                              {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {s.customerName ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 cursor-pointer" onClick={() => openEditSale(s)} aria-label="რედაქტირება">
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive cursor-pointer" onClick={() => setDeleteSaleId(s.id)} aria-label="წაშლა">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            {/* Orders tab */}
            {txTab === "orders" && (
              <div className="min-h-[200px]">
                {txLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-10">იტვირთება...</p>
                ) : txOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">შეკვეთები არ არის</p>
                ) : (
                  <div className="overflow-auto rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>თარიღი</TableHead>
                          <TableHead className="text-right">რ-ბა</TableHead>
                          <TableHead>სტატუსი</TableHead>
                          <TableHead>პრიორ.</TableHead>
                          <TableHead>შენ.</TableHead>
                          <TableHead className="w-16 text-right">მოქ.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {txOrders.map((o, idx) => (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs text-muted-foreground tabular-nums">{idx + 1}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDateTime(o.createdAt)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{o.quantityNeeded}</TableCell>
                            <TableCell className="text-xs">
                              {STATUS_LABELS[o.status] ?? o.status}
                            </TableCell>
                            <TableCell className="text-xs">
                              {PRIORITY_LABELS[o.priority] ?? o.priority}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                              {o.notes ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 cursor-pointer" onClick={() => openEditOrder(o)} aria-label="რედაქტირება">
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive cursor-pointer" onClick={() => setDeleteOrderId(o.id)} aria-label="წაშლა">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button variant="outline" onClick={() => setViewRow(null)} className="cursor-pointer">
                დახურვა
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Product Edit Modal ───────────────────────────────────────────────── */}
      <Dialog open={!!editRow} onClose={closeEdit} title={`პროდუქტის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Input id="prod-name" label="დასახელება" type="text" value={editState.name} onChange={set("name")} />
            <Input id="prod-oem" label="OEM კოდი" type="text" value={editState.oem_code} onChange={set("oem_code")} placeholder="სურვილისამებრ" />
            {saveError && (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeEdit} disabled={saving} className="cursor-pointer">გაუქმება</Button>
              <Button onClick={handleSave} disabled={saving} className="cursor-pointer">
                {saving ? "ინახება..." : "შენახვა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Product Delete Confirm ───────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteRow}
        onClose={() => setDeleteRow(null)}
        onConfirm={handleDelete}
        title="პროდუქტის წაშლა"
        description={`გსურთ პროდუქტი "${deleteRow?.name}" წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />

      {/* ── Sub-sale Edit Modal ──────────────────────────────────────────────── */}
      <Dialog
        open={!!editSaleRow}
        onClose={() => { setEditSaleRow(null); setEditSaleState(null); }}
        title={`გაყიდვის რედაქტირება #${editSaleRow?.id}`}
      >
        {editSaleState && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input id="sale-qty" label="რაოდენობა" type="number" min="1" value={editSaleState.quantity} onChange={setSaleField("quantity")} />
              <Input id="sale-price" label="ერთ. ფასი (₾)" type="number" min="0" step="0.01" value={editSaleState.unit_price} onChange={setSaleField("unit_price")} />
            </div>
            <Select
              id="sale-pay"
              label="გადახდის მეთოდი"
              value={editSaleState.payment_method}
              onChange={setSaleField("payment_method")}
              options={[
                { value: "cash", label: "ხელზე 💵" },
                { value: "transfer", label: "დარიცხვა 🏦" },
                { value: "credit", label: "ნისია 📋" },
              ]}
            />
            <Input id="sale-cust" label="მყიდველი" type="text" value={editSaleState.customer_name} onChange={setSaleField("customer_name")} placeholder="სურვილისამებრ" />
            <Input id="sale-date" label="გაყიდვის თარიღი" type="datetime-local" value={editSaleState.sold_at} onChange={setSaleField("sold_at")} />
            <Input id="sale-notes" label="შენიშვნა" type="text" value={editSaleState.notes} onChange={setSaleField("notes")} placeholder="სურვილისამებრ" />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setEditSaleRow(null); setEditSaleState(null); }} disabled={subSaving} className="cursor-pointer">
                გაუქმება
              </Button>
              <Button onClick={handleSaveSale} disabled={subSaving} className="cursor-pointer">
                {subSaving ? "ინახება..." : "შენახვა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Sub-sale Delete Confirm ──────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteSaleId}
        onClose={() => setDeleteSaleId(null)}
        onConfirm={handleDeleteSale}
        title="გაყიდვის წაშლა"
        description={`გსურთ გაყიდვა #${deleteSaleId} წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={subDeleting}
      />

      {/* ── Sub-order Edit Modal ─────────────────────────────────────────────── */}
      <Dialog
        open={!!editOrderRow}
        onClose={() => { setEditOrderRow(null); setEditOrderState(null); }}
        title={`შეკვეთის რედაქტირება #${editOrderRow?.id}`}
      >
        {editOrderState && (
          <div className="space-y-3">
            <Input id="ord-qty" label="საჭირო რ-ბა" type="number" min="1" value={editOrderState.quantity_needed} onChange={setOrderField("quantity_needed")} />
            <Select
              id="ord-status"
              label="სტატუსი"
              value={editOrderState.status}
              onChange={setOrderField("status")}
              options={[
                { value: "pending", label: "⏳ მოლოდინი" },
                { value: "completed", label: "✅ შესრულდა" },
              ]}
            />
            <Select
              id="ord-priority"
              label="პრიორიტეტი"
              value={editOrderState.priority}
              onChange={setOrderField("priority")}
              options={[
                { value: "urgent", label: "🔴 სასწრაფო" },
                { value: "normal", label: "🟡 ჩვეულებრივი" },
                { value: "low", label: "🟢 დაბალი" },
              ]}
            />
            <Input id="ord-notes" label="შენიშვნა" type="text" value={editOrderState.notes} onChange={setOrderField("notes")} placeholder="სურვილისამებრ" />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setEditOrderRow(null); setEditOrderState(null); }} disabled={subSaving} className="cursor-pointer">
                გაუქმება
              </Button>
              <Button onClick={handleSaveOrder} disabled={subSaving} className="cursor-pointer">
                {subSaving ? "ინახება..." : "შენახვა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Sub-order Delete Confirm ─────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteOrderId}
        onClose={() => setDeleteOrderId(null)}
        onConfirm={handleDeleteOrder}
        title="შეკვეთის წაშლა"
        description={`გსურთ შეკვეთა #${deleteOrderId} წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={subDeleting}
      />
    </div>
  );
}

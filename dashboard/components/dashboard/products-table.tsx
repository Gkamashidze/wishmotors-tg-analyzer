"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PackageMinus, X, Camera } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";
import type { ProductRow, CompatibilityRow } from "@/lib/queries";
import { PRODUCTS_PAGE_SIZE } from "@/lib/constants";
import type { ProductMetricRow } from "@/lib/financial-queries";
import { formatGEL, formatNumber, cn } from "@/lib/utils";
import { GalleryManager } from "./gallery-manager";
import { Tooltip } from "./_tooltip";
import { CompletenessCell } from "./_completeness-cell";
import { AiDescriptionButton } from "./_ai-description-button";
import { AddProductWizard } from "./_add-product-wizard";
import { WriteoffDialog } from "./_writeoff-dialog";
import {
  formatDate, formatDateTime,
  PAYMENT_LABELS, STATUS_LABELS, PRIORITY_LABELS,
  SSANGYONG_MODELS, DRIVE_OPTIONS, FUEL_OPTIONS, DEFAULT_NEW_COMPAT, ALL_MODELS_SENTINEL,
  nameToSlug, rowToEdit, saleToEdit, orderToEdit, ITEM_TYPE_FILTERS, PUBLISHED_FILTERS,
} from "./_utils";
import type {
  EditState, SaleEditState, OrderEditState,
  ProductSale, ProductOrder, NewCompatState, TxTab,
} from "./_types";

export function ProductsTable({
  rows,
  total,
  page,
  search: initialSearch = "",
  itemType: initialItemType = "",
  published: initialPublished = "",
}: {
  rows: ProductRow[];
  total: number;
  page: number;
  search?: string;
  itemType?: string;
  published?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [itemType, setItemType] = useState(initialItemType);
  const [published, setPublished] = useState(initialPublished);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [productMetrics, setProductMetrics] = useState<ProductMetricRow[]>([]);

  // Catalog publish / inline edit state
  const [publishedMap, setPublishedMap] = useState<Record<number, boolean>>(
    () => Object.fromEntries(rows.map((r) => [r.id, r.isPublished])),
  );

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
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Compatibility entries state
  const [compatEntries, setCompatEntries] = useState<CompatibilityRow[]>([]);
  const [compatLoading, setCompatLoading] = useState(false);
  const [newCompat, setNewCompat] = useState<NewCompatState>(DEFAULT_NEW_COMPAT);
  const [compatAdding, setCompatAdding] = useState(false);

  // Add product wizard — open state only (wizard manages its own internal state)
  const [isAdding, setIsAdding] = useState(false);

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

  // Write-off — trigger row only (WriteoffDialog manages its own internal state)
  const [writeoffRow, setWriteoffRow] = useState<ProductRow | null>(null);

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  const buildParams = useCallback((overrides: { page?: number; search?: string; itemType?: string; published?: string }) => {
    const params = new URLSearchParams();
    const p = overrides.page ?? page;
    const s = overrides.search ?? search;
    const t = overrides.itemType !== undefined ? overrides.itemType : itemType;
    const pub = overrides.published !== undefined ? overrides.published : published;
    params.set("page", String(p));
    if (s.trim()) params.set("search", s.trim());
    if (t) params.set("item_type", t);
    if (pub) params.set("published", pub);
    return params.toString();
  }, [page, search, itemType, published]);

  const goToPage = useCallback((p: number) => {
    router.push(`?${buildParams({ page: p })}`);
  }, [router, buildParams]);

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

  // ── Search (server-side — updates URL, triggers server re-render) ─────────────

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.push(`?${buildParams({ page: 1, search: value })}`);
    }, 350);
  }, [router, buildParams]);

  const handleItemTypeFilter = useCallback((value: string) => {
    setItemType(value);
    router.push(`?${buildParams({ page: 1, itemType: value })}`);
  }, [router, buildParams]);

  const handlePublishedFilter = useCallback((value: string) => {
    setPublished(value);
    router.push(`?${buildParams({ page: 1, published: value })}`);
  }, [router, buildParams]);

  // rows are already filtered server-side; no client-side filtering needed
  const filtered = useMemo(() => rows, [rows]);

  // ── Product edit/delete ─────────────────────────────────────────────────────

  const openEdit = useCallback((r: ProductRow) => {
    const isPublished = publishedMap[r.id] ?? r.isPublished;
    setEditRow(r);
    setEditState(rowToEdit(r, isPublished));
    setCompatEntries([]);
    setNewCompat(DEFAULT_NEW_COMPAT);
    setCompatLoading(true);
    fetch(`/api/products/${r.id}/compatibility`)
      .then((res) => res.json())
      .then((data: CompatibilityRow[]) => setCompatEntries(data))
      .catch(() => {})
      .finally(() => setCompatLoading(false));
  }, []);

  const closeEdit = useCallback(() => {
    setEditRow(null); setEditState(null); setSaveError(null);
    setCompatEntries([]); setNewCompat(DEFAULT_NEW_COMPAT);
  }, []);

  const handleAddCompat = useCallback(async () => {
    if (!editRow || !newCompat.model) return;
    setCompatAdding(true);
    try {
      const res = await fetch(`/api/products/${editRow.id}/compatibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: newCompat.model,
          drive: newCompat.drive || null,
          engine: newCompat.engine.trim() || null,
          fuel_type: newCompat.fuel_type || null,
          year_from: newCompat.year_from ? Number(newCompat.year_from) : null,
          year_to: newCompat.year_to ? Number(newCompat.year_to) : null,
        }),
      });
      if (!res.ok) return;
      const created = await res.json() as CompatibilityRow;
      setCompatEntries((prev) => [...prev, created]);
      setNewCompat(DEFAULT_NEW_COMPAT);
    } finally {
      setCompatAdding(false);
    }
  }, [editRow, newCompat]);

  const handleDeleteCompat = useCallback(async (compatId: number) => {
    if (!editRow) return;
    await fetch(`/api/products/${editRow.id}/compatibility/${compatId}`, { method: "DELETE" });
    setCompatEntries((prev) => prev.filter((c) => c.id !== compatId));
  }, [editRow]);

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
          unit_price: Number(editState.unit_price) || 0,
          unit: editRow.unit,
          category: editState.category.trim() || null,
          compatibility_notes: editState.compatibility_notes.trim() || null,
          image_url: editState.image_url.trim() || null,
          item_type: editState.item_type || "inventory",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? "შენახვა ვერ მოხერხდა. სცადეთ თავიდან.");
        return;
      }

      const pubRes = await fetch(`/api/products/${editRow.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: editState.slug.trim() || null,
          description: editState.description.trim() || null,
          is_published: editState.is_published,
          image_url: editState.image_url.trim() || null,
        }),
      });
      if (pubRes.status === 409) {
        setSaveError("ეს slug სხვა პროდუქტს უჭირავს");
        return;
      }
      if (!pubRes.ok) {
        const body = await pubRes.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? "კატალოგის შენახვა ვერ მოხერხდა.");
        return;
      }

      setPublishedMap((prev) => ({ ...prev, [editRow.id]: editState.is_published }));
      closeEdit();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }, [editRow, editState, closeEdit, router]);

  const handleImageUpload = useCallback(async (file: File) => {
    setUploadingImage(true);
    setSaveError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/products/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? "ფოტოს ატვირთვა ვერ მოხერხდა");
        return;
      }
      const { url } = await res.json() as { url: string };
      setEditState((prev) => prev ? { ...prev, image_url: url } : prev);
    } finally {
      setUploadingImage(false);
    }
  }, []);

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

  // ── Catalog publish toggle (table column quick-toggle) ─────────────────────

  const handleTogglePublish = useCallback(async (r: ProductRow) => {
    const next = !publishedMap[r.id];
    setPublishedMap((prev) => ({ ...prev, [r.id]: next }));
    try {
      const res = await fetch(`/api/products/${r.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: next }),
      });
      if (!res.ok) throw new Error("server error");
      toast.success(next ? "გამოქვეყნდა" : "დაიმალა");
    } catch {
      setPublishedMap((prev) => ({ ...prev, [r.id]: !next }));
      toast.error("შეცდომა");
    }
  }, [publishedMap]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="ძიება (დასახელება, OEM, კატეგორია...)"
            aria-label="ძიება პროდუქციაში"
            className="h-9 w-80 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">
              {formatNumber(filtered.length)} / {formatNumber(total)} პროდუქტი
            </p>
            <Button size="sm" onClick={() => setIsAdding(true)} className="h-9 cursor-pointer gap-1.5">
              <Plus className="h-4 w-4" />
              პროდუქტის დამატება
            </Button>
          </div>
        </div>
        {/* Item type filter */}
        <div className="flex gap-1.5 flex-wrap">
          {ITEM_TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleItemTypeFilter(f.value)}
              className={cn(
                "h-7 px-3 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                itemType === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Published filter */}
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-muted-foreground">კატალოგი:</span>
          {PUBLISHED_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handlePublishedFilter(f.value)}
              className={cn(
                "h-7 px-3 rounded-full text-xs font-medium border transition-colors cursor-pointer",
                published === f.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>OEM კოდი</TableHead>
              <TableHead>დასახელება</TableHead>
              <TableHead>ტიპი / კატეგორია</TableHead>
              <TableHead className="w-20">ერთეული</TableHead>
              <TableHead className="w-28 text-right">გასაყიდი ფასი</TableHead>
              <TableHead>თავსებადობა / შენ.</TableHead>
              <TableHead className="w-24 text-center">კატალოგი</TableHead>
              <TableHead className="w-16 text-center">სისრულე</TableHead>
              <TableHead className="w-24 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => {
                const isPublished = publishedMap[r.id] ?? r.isPublished;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground text-xs">
                      {(page - 1) * PRODUCTS_PAGE_SIZE + idx + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.oemCode ?? <span className="italic">—</span>}
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.category ?? <span className="italic text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatGEL(r.unitPrice)}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">
                      {r.compatCount > 0 ? (
                        <span className="text-[hsl(var(--success))] font-medium">✓ {r.compatCount} ჩანაწ.</span>
                      ) : r.compatibilityNotes ? (
                        <span className="text-muted-foreground truncate">{r.compatibilityNotes}</span>
                      ) : (
                        <span className="italic text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={isPublished}
                        onCheckedChange={() => handleTogglePublish(r)}
                        aria-label={isPublished ? "კატალოგიდან დამალვა" : "კატალოგში გამოქვეყნება"}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {r.itemType === "inventory" ? <CompletenessCell r={r} /> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Tooltip label="ნახვა">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => setViewRow(r)} aria-label="ნახვა">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                        <Tooltip label="რედაქტირება">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 cursor-pointer" onClick={() => openEdit(r)} aria-label="რედაქტირება">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                        <Tooltip label="ჩამოწერა">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400 cursor-pointer" onClick={() => setWriteoffRow(r)} aria-label="ჩამოწერა">
                            <PackageMinus className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                        <Tooltip label="წაშლა">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive cursor-pointer" onClick={() => setDeleteRow(r)} aria-label="წაშლა">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-3">
          <button
            onClick={() => goToPage(1)}
            disabled={page <= 1}
            className="group h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35 cursor-pointer"
            aria-label="პირველი გვერდი"
          >
            <ChevronsLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </button>

          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="group h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35 cursor-pointer"
            aria-label="წინა გვერდი"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </button>

          <div className="flex items-center gap-1 px-3 h-8 rounded-lg bg-muted/60 text-sm select-none">
            <span className="text-muted-foreground">გვ.</span>
            <span className="font-semibold text-primary mx-0.5">{page}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-muted-foreground ml-0.5">{totalPages}</span>
          </div>

          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="group h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35 cursor-pointer"
            aria-label="შემდეგი გვერდი"
          >
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>

          <button
            onClick={() => goToPage(totalPages)}
            disabled={page >= totalPages}
            className="group h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35 cursor-pointer"
            aria-label="ბოლო გვერდი"
          >
            <ChevronsRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      )}

      {/* ── Add Product Wizard ───────────────────────────────────────────────── */}
      <AddProductWizard
        open={isAdding}
        onClose={() => setIsAdding(false)}
        onAdded={() => { router.push("?page=1"); router.refresh(); }}
      />

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
            <Input id="prod-name" label="დასახელება *" type="text" value={editState.name} onChange={set("name")} />
            <Input id="prod-oem" label="OEM კოდი" type="text" value={editState.oem_code} onChange={set("oem_code")} placeholder="სურვილისამებრ" />
            <Select
              id="prod-item-type"
              label="ჩანაწერის ტიპი"
              value={editState.item_type}
              onChange={(e) => setEditState((prev) => prev ? { ...prev, item_type: e.target.value } : prev)}
              options={[
                { value: "inventory",   label: "საქონელი" },
                { value: "fixed_asset", label: "ძირ. საშ." },
                { value: "consumable",  label: "სახარჯი" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input id="prod-price" label="გასაყიდი ფასი (₾)" type="number" min="0" step="0.01" value={editState.unit_price} onChange={set("unit_price")} />
              <Select
                id="prod-category"
                label="კატეგორია"
                value={editState.category}
                onChange={(e) => setEditState((prev) => prev ? { ...prev, category: e.target.value } : prev)}
                options={[
                  { value: "",                         label: "— აირჩიეთ —" },
                  { value: "ძრავი",                    label: "ძრავი" },
                  { value: "გადაცემათა კოლოფი",        label: "გადაცემათა კოლოფი" },
                  { value: "სამუხრუჭე სისტემა",        label: "სამუხრუჭე სისტემა" },
                  { value: "სარეზინო სისტემა",         label: "სარეზინო სისტემა" },
                  { value: "საჭის მექანიზმი",          label: "საჭის მექანიზმი" },
                  { value: "ელექტრიკა და სენსორები",   label: "ელექტრიკა და სენსორები" },
                  { value: "ფილტრები",                 label: "ფილტრები" },
                  { value: "გაგრილება",                label: "გაგრილება" },
                  { value: "საწვავის სისტემა",         label: "საწვავის სისტემა" },
                  { value: "სავალი ნაწილები",          label: "სავალი ნაწილები" },
                  { value: "სხეული",                   label: "სხეული" },
                  { value: "სხვადასხვა",               label: "სხვადასხვა" },
                ]}
              />
            </div>
            {/* Image upload */}
            <div className="space-y-2">
              <p className="text-sm font-medium">ფოტო</p>
              {editState.image_url ? (
                <div className="relative w-full rounded-lg overflow-hidden border border-border bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={editState.image_url}
                    alt="პროდუქტის ფოტო"
                    className="w-full max-h-48 object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setEditState((prev) => prev ? { ...prev, image_url: "" } : prev)}
                    className="absolute top-2 right-2 bg-destructive text-white rounded-full p-1 hover:bg-destructive/80 transition-colors"
                    aria-label="ფოტოს წაშლა"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="w-full h-28 rounded-lg border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                  <Camera className="w-6 h-6" />
                  <span className="text-xs">ფოტო არ არის</span>
                </div>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImageUpload(file);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
                className="cursor-pointer w-full"
              >
                <Camera className="w-3.5 h-3.5 mr-1.5" />
                {uploadingImage ? "იტვირთება..." : "ფოტოს ატვირთვა"}
              </Button>
            </div>

            {/* Multi-image gallery (optional, additional images) */}
            {editRow && (
              <div className="rounded-xl border border-border p-3">
                <GalleryManager productId={editRow.id} />
              </div>
            )}

            {/* Structured compatibility */}
            <div className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm font-medium">თავსებადი მოდელები</p>

              {/* Existing entries */}
              {compatLoading ? (
                <p className="text-xs text-muted-foreground">იტვირთება...</p>
              ) : compatEntries.length > 0 ? (
                <ul className="space-y-1.5">
                  {compatEntries.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                      <span>
                        {c.model === ALL_MODELS_SENTINEL ? (
                          <span className="font-medium">🌐 ყველა მოდელი</span>
                        ) : (
                          <>
                            <span className="font-medium">{c.model}</span>
                            {c.drive && <span className="ml-1.5 text-muted-foreground">· {c.drive}</span>}
                            {c.engine && <span className="ml-1.5 text-muted-foreground">· {c.engine}</span>}
                            {c.fuelType && <span className="ml-1.5 text-muted-foreground">· {c.fuelType}</span>}
                            {(c.yearFrom || c.yearTo) && (
                              <span className="ml-1.5 text-muted-foreground">
                                · {c.yearFrom ?? "?"} – {c.yearTo ?? "?"}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      <button
                        onClick={() => handleDeleteCompat(c.id)}
                        className="text-destructive hover:text-destructive/80 text-xs font-medium cursor-pointer"
                        aria-label="წაშლა"
                      >
                        წაშლა
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">ჩანაწერი არ არის</p>
              )}

              {/* Add new entry form */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Select
                  id="nc-model"
                  label="მოდელი *"
                  value={newCompat.model}
                  onChange={(e) => setNewCompat((p) => ({ ...p, model: e.target.value }))}
                  options={[
                    { value: "", label: "— აირჩიეთ —" },
                    { value: ALL_MODELS_SENTINEL, label: "🌐 ყველა მოდელისთვის" },
                    ...SSANGYONG_MODELS.map((m) => ({ value: m, label: m })),
                  ]}
                />
                {newCompat.model !== ALL_MODELS_SENTINEL && (
                  <>
                    <Select
                      id="nc-drive"
                      label="წამყვანი"
                      value={newCompat.drive}
                      onChange={(e) => setNewCompat((p) => ({ ...p, drive: e.target.value }))}
                      options={[
                        { value: "", label: "— ყველა —" },
                        ...DRIVE_OPTIONS.map((d) => ({ value: d, label: d })),
                      ]}
                    />
                    <Input
                      id="nc-engine"
                      label="ძრავი (მაგ: 2.0, 2.7)"
                      type="text"
                      value={newCompat.engine}
                      onChange={(e) => setNewCompat((p) => ({ ...p, engine: e.target.value }))}
                      placeholder="სურვილისამებრ"
                    />
                    <Select
                      id="nc-fuel"
                      label="საწვავი"
                      value={newCompat.fuel_type}
                      onChange={(e) => setNewCompat((p) => ({ ...p, fuel_type: e.target.value }))}
                      options={[
                        { value: "", label: "— ყველა —" },
                        ...FUEL_OPTIONS.map((f) => ({ value: f, label: f })),
                      ]}
                    />
                    <div className="flex gap-1.5 items-end">
                      <Input
                        id="nc-yfrom"
                        label="წელი: დან"
                        type="number"
                        min="1990"
                        max="2030"
                        value={newCompat.year_from}
                        onChange={(e) => setNewCompat((p) => ({ ...p, year_from: e.target.value }))}
                        placeholder="2008"
                      />
                      <Input
                        id="nc-yto"
                        label="მდე"
                        type="number"
                        min="1990"
                        max="2030"
                        value={newCompat.year_to}
                        onChange={(e) => setNewCompat((p) => ({ ...p, year_to: e.target.value }))}
                        placeholder="2014"
                      />
                    </div>
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddCompat}
                disabled={!newCompat.model || compatAdding}
                className="cursor-pointer w-full"
              >
                {compatAdding ? "ემატება..." : "+ დამატება"}
              </Button>
            </div>

            <Input
              id="prod-compat"
              label="დამატებითი შენიშვნა"
              type="text"
              value={editState.compatibility_notes}
              onChange={set("compatibility_notes")}
              placeholder="სხვა ინფო (სურვილისამებრ)"
            />

            {/* ── კატალოგის ველები ── */}
            <div className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">კატალოგი</p>

              {/* Slug */}
              <div className="space-y-1">
                <label htmlFor="prod-slug" className="text-xs font-medium text-muted-foreground">
                  Slug (URL identifier)
                </label>
                <input
                  id="prod-slug"
                  type="text"
                  value={editState.slug}
                  onChange={(e) => setEditState((prev) => prev ? { ...prev, slug: e.target.value } : prev)}
                  placeholder={editState.slug || nameToSlug(editState.name) || "product-slug"}
                  className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {!editState.slug && nameToSlug(editState.name) && (
                  <button
                    type="button"
                    onClick={() => setEditState((prev) => prev ? { ...prev, slug: nameToSlug(prev.name) } : prev)}
                    className="text-xs text-primary hover:underline cursor-pointer"
                  >
                    ↳ გამოიყენე: {nameToSlug(editState.name)}
                  </button>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="prod-desc" className="text-xs font-medium text-muted-foreground">
                    აღწერა (მაქს. 2000 სიმბოლო)
                  </label>
                  {editRow && (
                    <AiDescriptionButton
                      productId={editRow.id}
                      onGenerated={(text) => setEditState((prev) => prev ? { ...prev, description: text } : prev)}
                    />
                  )}
                </div>
                <textarea
                  id="prod-desc"
                  rows={4}
                  maxLength={2000}
                  value={editState.description}
                  onChange={(e) => setEditState((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                  placeholder="პროდუქტის დეტალური აღწერა..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{editState.description.length} / 2000</p>
              </div>

              {/* Publish toggle */}
              <div className="flex items-center justify-between">
                <label htmlFor="prod-publish" className="text-sm font-medium">
                  🌐 კატალოგში გამოქვეყნება
                </label>
                <Switch
                  id="prod-publish"
                  checked={editState.is_published}
                  onCheckedChange={(v) => setEditState((prev) => prev ? { ...prev, is_published: v } : prev)}
                />
              </div>
            </div>

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

      {/* ── Write-off Modal ──────────────────────────────────────────────────── */}
      <WriteoffDialog
        writeoffRow={writeoffRow}
        onClose={() => setWriteoffRow(null)}
        onDone={() => { router.refresh(); }}
      />
    </div>
  );
}

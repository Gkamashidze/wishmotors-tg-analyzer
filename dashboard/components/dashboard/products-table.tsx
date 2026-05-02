"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2, Plus, ChevronLeft, ChevronRight, PackageMinus, X, Camera, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
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

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative group/tip inline-flex">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs bg-popover text-popover-foreground border border-border rounded shadow-sm whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-50">
        {label}
      </div>
    </div>
  );
}

// ─── Catalog completeness ─────────────────────────────────────────────────────

const CATALOG_FIELDS: { key: string; emoji: string; label: string }[] = [
  { key: "photo",         emoji: "📷", label: "ფოტო" },
  { key: "slug",          emoji: "🔗", label: "Slug" },
  { key: "description",   emoji: "📝", label: "აღწერა" },
  { key: "oem",           emoji: "🏷️",  label: "OEM კოდი" },
  { key: "category",      emoji: "📂", label: "კატეგორია" },
  { key: "compatibility", emoji: "🚗", label: "თავსებადობა" },
];

function getCatalogCompletion(r: ProductRow) {
  return [
    { ...CATALOG_FIELDS[0], done: !!r.imageUrl },
    { ...CATALOG_FIELDS[1], done: !!r.slug },
    { ...CATALOG_FIELDS[2], done: !!r.description },
    { ...CATALOG_FIELDS[3], done: !!r.oemCode },
    { ...CATALOG_FIELDS[4], done: !!r.category },
    { ...CATALOG_FIELDS[5], done: r.compatCount > 0 },
  ];
}

function CompletenessCell({ r }: { r: ProductRow }) {
  const fields = getCatalogCompletion(r);
  const score = fields.filter((f) => f.done).length;
  const total = fields.length;

  const badgeCls =
    score === total
      ? "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.3)]"
      : score >= 4
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : "bg-destructive/10 text-destructive border-destructive/30";

  return (
    <div className="relative group/comp inline-flex justify-center">
      <span
        className={cn(
          "inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border cursor-default tabular-nums",
          badgeCls,
        )}
      >
        {score}/{total}
      </span>
      {/* Tooltip */}
      <div className="absolute bottom-full right-0 mb-2 w-44 bg-popover border border-border rounded-xl shadow-lg p-3 opacity-0 group-hover/comp:opacity-100 transition-opacity pointer-events-none z-50">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          კატალოგის სისრულე
        </p>
        <div className="space-y-1">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className={cn("text-xs font-bold", f.done ? "text-[hsl(var(--success))]" : "text-destructive")}>
                {f.done ? "✓" : "✗"}
              </span>
              <span className={cn("text-xs", f.done ? "text-muted-foreground line-through" : "text-foreground")}>
                {f.emoji} {f.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Compatibility constants ──────────────────────────────────────────────────

const SSANGYONG_MODELS = [
  "Korando Sport",
  "Korando C",
  "Rexton",
  "Turismo",
  "G4 Rexton",
  "Korando II",
  "Musso (GRAND)",
  "Tivoli",
] as const;

const DRIVE_OPTIONS = ["წინა", "უკანა", "4x4"] as const;
const FUEL_OPTIONS = ["ბენზინი", "დიზელი", "ჰიბრიდი"] as const;

interface NewCompatState {
  model: string;
  drive: string;
  engine: string;
  fuel_type: string;
  year_from: string;
  year_to: string;
}

const DEFAULT_NEW_COMPAT: NewCompatState = { model: "", drive: "", engine: "", fuel_type: "", year_from: "", year_to: "" };

// ─── AI Description Button ────────────────────────────────────────────────────

function AiDescriptionButton({ productId, onGenerated }: { productId: number; onGenerated: (text: string) => void }) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/generate-description`, { method: "POST" });
      const data = (await res.json()) as { description?: string; error?: string };
      if (!res.ok || !data.description) {
        toast.error(data.error ?? "AI-მ ვერ დაწერა აღწერა");
        return;
      }
      onGenerated(data.description);
    } catch {
      toast.error("კავშირის შეცდომა");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void generate()}
      disabled={loading}
      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Sparkles className="w-3 h-3" />
      {loading ? "იწერება..." : "AI-ით დაწერა"}
    </button>
  );
}

// ─── Georgian → Latin transliteration (for slug suggestion) ──────────────────

const GEO_LATIN: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z",
  თ: "t", ი: "i", კ: "k", ლ: "l", მ: "m", ნ: "n", ო: "o",
  პ: "p", ჟ: "zh", რ: "r", ს: "s", ტ: "t", უ: "u", ფ: "f",
  ქ: "k", ღ: "gh", ყ: "k", შ: "sh", ჩ: "ch", ც: "ts", ძ: "dz",
  წ: "ts", ჭ: "ch", ხ: "kh", ჯ: "j", ჰ: "h",
};

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .split("")
    .map((c) => GEO_LATIN[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

// ─── Catalog inline edit state ────────────────────────────────────────────────

interface CatalogEditState {
  slug: string;
  description: string;
  image_url: string;
}

// ─── Product edit / add state ─────────────────────────────────────────────────

interface EditState {
  name: string;
  oem_code: string;
  unit_price: string;
  category: string;
  compatibility_notes: string;
  image_url: string;
  item_type: string;
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
  return {
    name: r.name,
    oem_code: r.oemCode ?? "",
    unit_price: String(r.unitPrice),
    category: r.category ?? "",
    compatibility_notes: r.compatibilityNotes ?? "",
    image_url: r.imageUrl ?? "",
    item_type: r.itemType ?? "inventory",
  };
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

const ITEM_TYPE_FILTERS = [
  { value: "",             label: "ყველა" },
  { value: "inventory",   label: "საქონელი" },
  { value: "fixed_asset", label: "ძირ. საშ." },
  { value: "consumable",  label: "სახარჯი" },
] as const;

export function ProductsTable({
  rows,
  total,
  page,
  search: initialSearch = "",
  itemType: initialItemType = "",
}: {
  rows: ProductRow[];
  total: number;
  page: number;
  search?: string;
  itemType?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);
  const [itemType, setItemType] = useState(initialItemType);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [productMetrics, setProductMetrics] = useState<ProductMetricRow[]>([]);

  // Catalog publish / inline edit state
  const [publishedMap, setPublishedMap] = useState<Record<number, boolean>>(
    () => Object.fromEntries(rows.map((r) => [r.id, r.isPublished])),
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [catalogEdit, setCatalogEdit] = useState<CatalogEditState | null>(null);
  const [catalogSaving, setCatalogSaving] = useState(false);

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

  // Write-off state
  const [writeoffRow, setWriteoffRow] = useState<ProductRow | null>(null);
  const [writeoffQty, setWriteoffQty] = useState("1");
  const [writeoffReason, setWriteoffReason] = useState("");
  const [writeoffSaving, setWriteoffSaving] = useState(false);
  const [writeoffError, setWriteoffError] = useState<string | null>(null);

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  const buildParams = useCallback((overrides: { page?: number; search?: string; itemType?: string }) => {
    const params = new URLSearchParams();
    const p = overrides.page ?? page;
    const s = overrides.search ?? search;
    const t = overrides.itemType !== undefined ? overrides.itemType : itemType;
    params.set("page", String(p));
    if (s.trim()) params.set("search", s.trim());
    if (t) params.set("item_type", t);
    return params.toString();
  }, [page, search, itemType]);

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

  // rows are already filtered server-side; no client-side filtering needed
  const filtered = useMemo(() => rows, [rows]);

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
    setEditRow(r);
    setEditState(rowToEdit(r));
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

  // ── Write-off ───────────────────────────────────────────────────────────────

  const openWriteoff = useCallback((r: ProductRow) => {
    setWriteoffRow(r);
    setWriteoffQty("1");
    setWriteoffReason("");
    setWriteoffError(null);
  }, []);

  const closeWriteoff = useCallback(() => {
    setWriteoffRow(null);
    setWriteoffError(null);
  }, []);

  const handleWriteoff = useCallback(async () => {
    if (!writeoffRow) return;
    const qty = parseInt(writeoffQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setWriteoffError("რაოდენობა უნდა იყოს დადებითი მთელი რიცხვი");
      return;
    }
    if (!writeoffReason.trim()) {
      setWriteoffError("მიზეზის მითითება სავალდებულოა");
      return;
    }
    setWriteoffSaving(true);
    setWriteoffError(null);
    try {
      const res = await fetch(`/api/products/${writeoffRow.id}/writeoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty, reason: writeoffReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setWriteoffError(body.error ?? "ჩამოწერა ვერ განხორციელდა. სცადეთ თავიდან.");
        return;
      }
      closeWriteoff();
      router.refresh();
    } finally {
      setWriteoffSaving(false);
    }
  }, [writeoffRow, writeoffQty, writeoffReason, closeWriteoff, router]);

  // ── Catalog publish toggle ──────────────────────────────────────────────────

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

  // ── Catalog inline expand/save ───────────────────────────────────────────────

  const openExpand = useCallback((r: ProductRow) => {
    if (expandedId === r.id) {
      setExpandedId(null);
      setCatalogEdit(null);
      return;
    }
    setExpandedId(r.id);
    setCatalogEdit({
      slug: r.slug ?? "",
      description: r.description ?? "",
      image_url: r.imageUrl ?? "",
    });
  }, [expandedId]);

  const handleSaveCatalog = useCallback(async (r: ProductRow) => {
    if (!catalogEdit) return;
    const original: CatalogEditState = {
      slug: r.slug ?? "",
      description: r.description ?? "",
      image_url: r.imageUrl ?? "",
    };
    const payload: Record<string, unknown> = {};
    if (catalogEdit.slug !== original.slug) payload.slug = catalogEdit.slug;
    if (catalogEdit.description !== original.description) payload.description = catalogEdit.description || null;
    if (catalogEdit.image_url !== original.image_url) payload.image_url = catalogEdit.image_url || null;
    if (Object.keys(payload).length === 0) {
      setExpandedId(null);
      setCatalogEdit(null);
      return;
    }
    setCatalogSaving(true);
    try {
      const res = await fetch(`/api/products/${r.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        toast.error("ეს slug სხვა პროდუქტს უჭირავს");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast.error(body.error ?? "შეცდომა");
        return;
      }
      toast.success("შენახულია");
      setExpandedId(null);
      setCatalogEdit(null);
      router.refresh();
    } finally {
      setCatalogSaving(false);
    }
  }, [catalogEdit, router]);

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
            <Button size="sm" onClick={openAdd} className="h-9 cursor-pointer gap-1.5">
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
              filtered.flatMap((r, idx) => {
                const isExpanded = expandedId === r.id;
                const isPublished = publishedMap[r.id] ?? r.isPublished;
                const mainRow = (
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
                        <Tooltip label="კატალოგის რედ.">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 cursor-pointer"
                            onClick={() => openExpand(r)}
                            aria-label="კატალოგის რედაქტირება"
                          >
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        </Tooltip>
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
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400 cursor-pointer" onClick={() => openWriteoff(r)} aria-label="ჩამოწერა">
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

                if (!isExpanded || !catalogEdit) return [mainRow];

                const suggestedSlug = !r.slug ? nameToSlug(r.name) : "";
                const previewUrl = catalogEdit.image_url.startsWith("http")
                  ? catalogEdit.image_url
                  : null;

                const expandRow = (
                  <TableRow key={`${r.id}-expand`} className="bg-muted/30 border-t-0">
                    <TableCell colSpan={10} className="py-4 px-6">
                      <div className="space-y-3 max-w-2xl">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          კატალოგის ინფო — {r.name}
                        </p>

                        {/* Slug */}
                        <div className="space-y-1">
                          <label htmlFor={`slug-${r.id}`} className="text-xs font-medium text-muted-foreground">
                            Slug (URL identifier)
                          </label>
                          <input
                            id={`slug-${r.id}`}
                            type="text"
                            value={catalogEdit.slug}
                            onChange={(e) =>
                              setCatalogEdit((prev) =>
                                prev ? { ...prev, slug: e.target.value } : prev,
                              )
                            }
                            placeholder={suggestedSlug || "product-slug"}
                            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          {suggestedSlug && !catalogEdit.slug && (
                            <button
                              type="button"
                              onClick={() =>
                                setCatalogEdit((prev) =>
                                  prev ? { ...prev, slug: suggestedSlug } : prev,
                                )
                              }
                              className="text-xs text-primary hover:underline cursor-pointer"
                            >
                              ↳ გამოიყენე: {suggestedSlug}
                            </button>
                          )}
                        </div>

                        {/* Description */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label htmlFor={`desc-${r.id}`} className="text-xs font-medium text-muted-foreground">
                              აღწერა (მაქს. 2000 სიმბოლო)
                            </label>
                            <AiDescriptionButton
                              productId={r.id}
                              onGenerated={(text) =>
                                setCatalogEdit((prev) =>
                                  prev ? { ...prev, description: text } : prev,
                                )
                              }
                            />
                          </div>
                          <textarea
                            id={`desc-${r.id}`}
                            rows={4}
                            maxLength={2000}
                            value={catalogEdit.description}
                            onChange={(e) =>
                              setCatalogEdit((prev) =>
                                prev ? { ...prev, description: e.target.value } : prev,
                              )
                            }
                            placeholder="პროდუქტის დეტალური აღწერა..."
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                          />
                          <p className="text-xs text-muted-foreground text-right">
                            {catalogEdit.description.length} / 2000
                          </p>
                        </div>

                        {/* Image URL */}
                        <div className="space-y-1">
                          <label htmlFor={`imgurl-${r.id}`} className="text-xs font-medium text-muted-foreground">
                            სურათის URL
                          </label>
                          <input
                            id={`imgurl-${r.id}`}
                            type="url"
                            value={catalogEdit.image_url}
                            onChange={(e) =>
                              setCatalogEdit((prev) =>
                                prev ? { ...prev, image_url: e.target.value } : prev,
                              )
                            }
                            placeholder="https://..."
                            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                          {previewUrl && (
                            <div className="mt-2 w-32 h-20 rounded-md border border-border overflow-hidden bg-muted/30">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={previewUrl}
                                alt="preview"
                                className="w-full h-full object-contain"
                              />
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => handleSaveCatalog(r)}
                            disabled={catalogSaving}
                            className="cursor-pointer"
                          >
                            {catalogSaving ? "ინახება..." : "შენახვა"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setExpandedId(null); setCatalogEdit(null); }}
                            disabled={catalogSaving}
                            className="cursor-pointer"
                          >
                            გაუქმება
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );

                return [mainRow, expandRow];
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-3">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="group h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35 cursor-pointer"
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
          >
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
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
                        <span className="font-medium">{c.model}</span>
                        {c.drive && <span className="ml-1.5 text-muted-foreground">· {c.drive}</span>}
                        {c.engine && <span className="ml-1.5 text-muted-foreground">· {c.engine}</span>}
                        {c.fuelType && <span className="ml-1.5 text-muted-foreground">· {c.fuelType}</span>}
                        {(c.yearFrom || c.yearTo) && (
                          <span className="ml-1.5 text-muted-foreground">
                            · {c.yearFrom ?? "?"} – {c.yearTo ?? "?"}
                          </span>
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
                    ...SSANGYONG_MODELS.map((m) => ({ value: m, label: m })),
                  ]}
                />
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
      <Dialog
        open={!!writeoffRow}
        onClose={closeWriteoff}
        title="ინვენტარის ჩამოწერა"
      >
        {writeoffRow && (() => {
          const qty = parseInt(writeoffQty, 10);
          const validQty = Number.isFinite(qty) && qty > 0;
          const totalLoss = validQty ? qty * writeoffRow.unitPrice : 0;
          return (
            <div className="space-y-4">
              {/* Product info */}
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 space-y-1 text-sm">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  {writeoffRow.name}
                </p>
                {writeoffRow.oemCode && (
                  <p className="font-mono text-xs text-amber-600 dark:text-amber-400">
                    {writeoffRow.oemCode}
                  </p>
                )}
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  მიმდინარე მარაგი:{" "}
                  <span className="font-semibold">{formatNumber(writeoffRow.currentStock)} {writeoffRow.unit}</span>
                </p>
              </div>

              {/* Quantity */}
              <Input
                id="writeoff-qty"
                label="ჩამოსაწერი რაოდენობა *"
                type="number"
                min="1"
                step="1"
                value={writeoffQty}
                onChange={(e) => { setWriteoffQty(e.target.value); setWriteoffError(null); }}
                autoFocus
              />

              {/* Reason */}
              <Input
                id="writeoff-reason"
                label="მიზეზი *"
                type="text"
                value={writeoffReason}
                onChange={(e) => { setWriteoffReason(e.target.value); setWriteoffError(null); }}
                placeholder="მაგ: დაზიანებული, ფიზიკური ნარჩენი, დაკარგული..."
              />

              {/* Financial preview */}
              {validQty && (
                <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    ფინანსური ზემოქმედება
                  </p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ერთ. ღირებულება</span>
                    <span className="tabular-nums">{formatGEL(writeoffRow.unitPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ჩამოსაწერი რ-ბა</span>
                    <span className="tabular-nums">{qty} {writeoffRow.unit}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                    <span className="font-medium text-destructive">სულ ზარალი</span>
                    <span className="font-semibold tabular-nums text-destructive">
                      -{formatGEL(totalLoss)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-0.5">
                    ჩამოწერა დაფიქსირდება P&amp;L-ში არანაღდ ხარჯად (ბალანსზე გავლენა: 0)
                  </p>
                </div>
              )}

              {writeoffError && (
                <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                  {writeoffError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={closeWriteoff} disabled={writeoffSaving} className="cursor-pointer">
                  გაუქმება
                </Button>
                <Button
                  onClick={handleWriteoff}
                  disabled={writeoffSaving}
                  className="cursor-pointer bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {writeoffSaving ? "მიმდინარეობს..." : "ჩამოწერა"}
                </Button>
              </div>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}

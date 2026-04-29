"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useId,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Save,
  CheckCircle,
  Upload,
  FileText,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button }       from "@/components/ui/button";
import { Input }        from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductCombobox }    from "@/components/ui/product-combobox";
import type { ProductRow }    from "@/lib/queries";
import type { ItemType, InventorySubType } from "@/lib/erp-imports";
import { calcRecommendedPrice } from "@/lib/utils";
import { calcLanded, type CalcLine } from "@/lib/import-calc";
import { ProductPriceHistory } from "@/components/dashboard/product-price-history";

// ── Types ────────────────────────────────────────────────────────────────────

const INVENTORY_CATEGORIES = [
  "ძრავი", "გადაცემათა კოლოფი", "სამუხრუჭე სისტემა",
  "სარეზინო სისტემა", "საჭე და მართვა", "ელექტრიკა და სენსორები",
  "განათება", "ფილტრები", "გაგრილება", "საწვავის სისტემა",
  "სხეული", "სხვადასხვა",
] as const;

type LineItem = {
  _key:              string;
  productId:         string;
  isNew:             boolean;
  oemCode:           string;
  productName:       string;
  quantity:          string;
  unit:              string;
  unitPriceUsd:      string;
  weight:            string;
  itemType:          ItemType;
  inventorySubType:  InventorySubType;
  accountingCategory: string;
  margin:            string;
};

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  inventory:   "საქონელი",
  fixed_asset: "ძირითადი საშ.",
  consumable:  "სახარჯი",
};

const ITEM_TYPE_COLORS: Record<ItemType, string> = {
  inventory:   "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-800",
  fixed_asset: "text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-300 dark:bg-purple-950/30 dark:border-purple-800",
  consumable:  "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface Props {
  importId?: number;
  initialData?: {
    date: string;
    supplier: string;
    invoiceNumber: string;
    declarationNumber: string;
    exchangeRate: string;
    totalTransportCost: string;
    totalTerminalCost: string;
    totalAgencyCost: string;
    totalVatCost: string;
    invoiceDate?: string;
    invoiceExchangeRate?: string;
    documentName: string;
    items: Array<{
      productId: number;
      quantity: number;
      unit: string;
      unitPriceUsd: number;
      weight: number;
      itemType?: string;
      inventorySubType?: string;
      accountingCategory?: string;
    }>;
  };
  products: ProductRow[];
}

type RelatedImport = { id: number; supplier: string; invoiceNumber: string | null; status: string };

function useRelatedImports(declarationNumber: string, currentId: number | undefined) {
  const [related, setRelated] = useState<RelatedImport[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!declarationNumber.trim()) { setRelated([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/erp-imports?search=${encodeURIComponent(declarationNumber.trim())}`);
        if (!res.ok) return;
        const data = await res.json() as Array<{ id: number; supplier: string; invoiceNumber: string | null; declarationNumber: string | null; status: string }>;
        setRelated(
          data.filter((r) => r.declarationNumber?.trim() === declarationNumber.trim() && r.id !== currentId),
        );
      } catch { /* ignore */ }
    }, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [declarationNumber, currentId]);

  return related;
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

let _keyCounter = 0;
function newKey(): string { return String(++_keyCounter); }

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

// ── Component ─────────────────────────────────────────────────────────────────

export function ErpImportForm({ importId: initialId, initialData, products: initialProducts }: Props) {
  const router    = useRouter();
  const formIdBase = useId();

  // ── Header state ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const [date,               setDate]               = useState(initialData?.date               ?? today);
  const [supplier,           setSupplier]           = useState(initialData?.supplier           ?? "");
  const [invoiceNumber,      setInvoiceNumber]      = useState(initialData?.invoiceNumber      ?? "");
  const [declarationNumber,  setDeclarationNumber]  = useState(initialData?.declarationNumber  ?? "");
  const [exchangeRate,       setExchangeRate]       = useState(initialData?.exchangeRate       ?? "");
  const [totalTransportCost, setTotalTransportCost] = useState(initialData?.totalTransportCost ?? "");
  const [totalTerminalCost,  setTotalTerminalCost]  = useState(initialData?.totalTerminalCost  ?? "");
  const [totalAgencyCost,    setTotalAgencyCost]    = useState(initialData?.totalAgencyCost    ?? "");
  const [totalVatCost,       setTotalVatCost]       = useState(initialData?.totalVatCost       ?? "");
  const [invoiceDate,         setInvoiceDate]         = useState(initialData?.invoiceDate         ?? "");
  const [invoiceExchangeRate, setInvoiceExchangeRate] = useState(initialData?.invoiceExchangeRate ?? "");
  const [documentUrl,         setDocumentUrl]         = useState("");
  const [documentName,        setDocumentName]        = useState(initialData?.documentName        ?? "");

  // ── Line items ───────────────────────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>(() => {
    if (initialData?.items?.length) {
      return initialData.items.map((it) => ({
        _key:               newKey(),
        productId:          String(it.productId),
        isNew:              false,
        oemCode:            "",
        productName:        "",
        quantity:           String(it.quantity),
        unit:               it.unit,
        unitPriceUsd:       String(it.unitPriceUsd),
        weight:             String(it.weight),
        itemType:           (it.itemType as ItemType) || "inventory",
        inventorySubType:   (it.inventorySubType as InventorySubType) || "regular",
        accountingCategory: it.accountingCategory ?? "",
        margin:             "30",
      }));
    }
    return [{ _key: newKey(), productId: "", isNew: false, oemCode: "", productName: "", quantity: "", unit: "ცალი", unitPriceUsd: "", weight: "", itemType: "inventory", inventorySubType: "regular", accountingCategory: "", margin: "30" }];
  });

  // ── Products list (can grow if user adds new) ─────────────────────────────
  const [products, setProducts] = useState<ProductRow[]>(initialProducts);

  // ── Import id (set after first save) ─────────────────────────────────────
  const [importId,  setImportId]  = useState<number | undefined>(initialId);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError,  setSaveError]  = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const [errors,     setErrors]     = useState<string[]>([]);

  // ── File upload ref ────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Related imports (same declaration number) ────────────────────────────
  const relatedImports = useRelatedImports(declarationNumber, importId);

  // ── Derived calculations ──────────────────────────────────────────────────
  const rate      = parseFloat(exchangeRate)       || 0;
  const transport = parseFloat(totalTransportCost) || 0;
  const terminal  = parseFloat(totalTerminalCost)  || 0;
  const agency    = parseFloat(totalAgencyCost)    || 0;
  const vatCost   = parseFloat(totalVatCost)       || 0;
  const invRate   = parseFloat(invoiceExchangeRate) || 0;

  const calcLines = useMemo(
    () => calcLanded(items, rate, transport, terminal, agency, vatCost),
    [items, rate, transport, terminal, agency, vatCost],
  );

  const grandTotalUsd  = calcLines.reduce((s, l) => s + l.totalPriceUsd, 0);
  const grandTotalGel  = calcLines.reduce((s, l) => s + l.totalPriceGel, 0);
  const totalOverhead  = transport + terminal + agency + vatCost;
  // VAT is recoverable — grand landed cost excludes it
  const grandLandedGel = grandTotalGel + transport + terminal + agency;

  // ── Build payload ─────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => {
    const validItems = items
      .map((it, idx) => {
        const landed  = calcLines[idx]?.landedCostPerUnit ?? 0;
        const margin  = parseFloat(it.margin) || 0;
        const recPriceRaw = it.itemType === "inventory"
          ? calcRecommendedPrice(landed, margin)
          : null;
        const recPrice = recPriceRaw != null
          ? parseFloat(recPriceRaw.toFixed(2))
          : undefined;
        return {
          productId:              Number(it.productId) || 0,
          newProductOem:          it.isNew ? it.oemCode.trim()       : undefined,
          newProductName:         it.isNew ? it.productName.trim()   : undefined,
          quantity:               parseFloat(it.quantity)     || 0,
          unit:                   it.unit || "ცალი",
          unitPriceUsd:           parseFloat(it.unitPriceUsd) || 0,
          weight:                 parseFloat(it.weight)       || 0,
          totalPriceUsd:          calcLines[idx]?.totalPriceUsd          ?? 0,
          totalPriceGel:          calcLines[idx]?.totalPriceGel          ?? 0,
          allocatedTransportCost: calcLines[idx]?.allocatedTransport     ?? 0,
          allocatedTerminalCost:  calcLines[idx]?.allocatedTerminal      ?? 0,
          allocatedAgencyCost:    calcLines[idx]?.allocatedAgency        ?? 0,
          allocatedVatCost:       calcLines[idx]?.allocatedVat           ?? 0,
          landedCostPerUnitGel:   landed,
          itemType:               it.itemType || "inventory",
          inventorySubType:       it.inventorySubType || "regular",
          accountingCategory:     it.accountingCategory || undefined,
          recommendedPrice:       recPrice,
        };
      })
      .filter((mapped, idx) => {
        const orig = items[idx];
        const qty  = mapped.quantity;
        if (orig.isNew) return !!orig.oemCode.trim() && !!orig.productName.trim() && qty > 0;
        return mapped.productId > 0 && qty > 0;
      });

    return {
      date,
      supplier,
      invoiceNumber:       invoiceNumber       || undefined,
      declarationNumber:   declarationNumber   || undefined,
      exchangeRate:        rate,
      totalTransportCost:  transport,
      totalTerminalCost:   terminal,
      totalAgencyCost:     agency,
      totalVatCost:        vatCost,
      invoiceDate:         invoiceDate         || undefined,
      invoiceExchangeRate: invRate > 0 ? invRate : undefined,
      documentUrl:         documentUrl         || undefined,
      documentName:        documentName        || undefined,
      items:               validItems,
    };
  }, [
    items, calcLines, date, supplier, invoiceNumber, declarationNumber,
    rate, transport, terminal, agency, vatCost,
    invoiceDate, invRate,
    documentUrl, documentName,
  ]);

  // ── Validate ──────────────────────────────────────────────────────────────
  const validate = useCallback((): string[] => {
    const errs: string[] = [];
    if (!supplier.trim()) errs.push("მომწოდებელი სავალდებულოა");
    if (!date)            errs.push("თარიღი სავალდებულოა");
    if (rate <= 0)        errs.push("კურსი უნდა იყოს > 0");
    const validItems = items.filter((it) =>
      (it.productId && parseFloat(it.quantity) > 0) ||
      (it.isNew && it.oemCode.trim() && it.productName.trim() && parseFloat(it.quantity) > 0),
    );
    if (validItems.length === 0) errs.push("მინიმუმ ერთი პოზიცია სავალდებულოა");
    items.forEach((it, i) => {
      if (it.isNew) {
        if (!it.productName.trim())    errs.push(`სტრიქონი ${i + 1}: დასახელება სავალდებულოა`);
        if (!parseFloat(it.quantity))  errs.push(`სტრიქონი ${i + 1}: რაოდენობა სავალდებულოა`);
      } else if (it.productId && !parseFloat(it.quantity)) {
        errs.push(`სტრიქონი ${i + 1}: რაოდენობა სავალდებულოა`);
      }
    });
    return errs;
  }, [supplier, date, rate, items]);

  // ── Save draft ────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (silent = false): Promise<number | null> => {
    if (!silent) setSaveStatus("saving");
    setSaveError("");
    try {
      const payload = buildPayload();
      let id = importId;

      if (!id) {
        const res  = await fetch("/api/erp-imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json() as { id: number };
        id = data.id;
        setImportId(id);
        router.replace(`/imports/${id}`);
      } else {
        const res = await fetch(`/api/erp-imports/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
      return id ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveStatus("error");
      setSaveError(msg);
      return null;
    }
  }, [buildPayload, importId, router]);

  // ── Auto-save every 2 minutes ────────────────────────────────────────────
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      saveDraft(true);
    }, 120_000);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [saveDraft]);

  // ── Finalize ──────────────────────────────────────────────────────────────
  const handleFinalize = useCallback(async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    setFinalizing(true);
    try {
      const id = await saveDraft(true);
      if (!id) { setFinalizing(false); return; }

      const res = await fetch(`/api/erp-imports/${id}/finalize`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Finalize failed");
      }
      router.push("/imports");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors([msg]);
    } finally {
      setFinalizing(false);
    }
  }, [validate, saveDraft, router]);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setErrors(["დაუშვებელი ფაილის ტიპი. მიღებულია: PDF, სურათი, Excel (.xlsx, .xls), CSV"]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setDocumentUrl(e.target?.result as string);
      setDocumentName(file.name);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── Line item helpers ─────────────────────────────────────────────────────
  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { _key: newKey(), productId: "", isNew: false, oemCode: "", productName: "", quantity: "", unit: "ცალი", unitPriceUsd: "", weight: "", itemType: "inventory", inventorySubType: "regular", accountingCategory: "", margin: "30" },
    ]);

  const handleNewOem = (key: string, oem: string) =>
    setItems((prev) =>
      prev.map((it) => it._key === key ? { ...it, isNew: true, oemCode: oem, productId: "" } : it),
    );

  const resetNewItem = (key: string) =>
    setItems((prev) =>
      prev.map((it) => it._key === key ? { ...it, isNew: false, oemCode: "", productName: "", productId: "" } : it),
    );

  const removeItem = (key: string) =>
    setItems((prev) => prev.filter((it) => it._key !== key));

  const updateItem = (key: string, field: keyof Omit<LineItem, "_key">, value: string) =>
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, [field]: value } : it)),
    );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Error Banner ── */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <ul className="text-sm text-destructive space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── Header Card ── */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">სათაური</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Input
              id={`${formIdBase}-date`}
              label="თარიღი *"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              id={`${formIdBase}-supplier`}
              label="მომწოდებელი *"
              placeholder="კომპანიის დასახელება"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            />
            <Input
              id={`${formIdBase}-invoice`}
              label="ინვოისის ნომერი"
              placeholder="INV-2024-001"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
            <Input
              id={`${formIdBase}-declaration`}
              label="შეფასების #"
              placeholder="DC-2024-001"
              value={declarationNumber}
              onChange={(e) => setDeclarationNumber(e.target.value)}
            />
            <Input
              id={`${formIdBase}-rate`}
              label="კურსი — დეკლ. (USD→GEL) *"
              type="text"
              inputMode="decimal"
              placeholder="2.75"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
            />
            <Input
              id={`${formIdBase}-transport`}
              label="ტრანსპორტი (₾)"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={totalTransportCost}
              onChange={(e) => setTotalTransportCost(e.target.value)}
            />
            <Input
              id={`${formIdBase}-terminal`}
              label="ტერმინალი (₾)"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={totalTerminalCost}
              onChange={(e) => setTotalTerminalCost(e.target.value)}
            />
            <Input
              id={`${formIdBase}-agency`}
              label="სააგენტო (₾)"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={totalAgencyCost}
              onChange={(e) => setTotalAgencyCost(e.target.value)}
            />
            <Input
              id={`${formIdBase}-vat`}
              label="საბაჟო დღგ (₾)"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={totalVatCost}
              onChange={(e) => setTotalVatCost(e.target.value)}
            />

            {/* File Upload */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">ინვოისის ფაილი</label>
              {documentName ? (
                <div className="flex items-center gap-2 h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate flex-1">{documentName}</span>
                  <button
                    type="button"
                    onClick={() => { setDocumentUrl(""); setDocumentName(""); }}
                    className="text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-9 flex items-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  <Upload className="h-4 w-4" />
                  <span>ფაილის ატვირთვა (PDF / სურათი / Excel / CSV)</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>

            {/* Invoice date */}
            <Input
              id={`${formIdBase}-invoice-date`}
              label="ინვოისის თარიღი"
              type="date"
              value={invoiceDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setInvoiceDate(e.target.value)}
            />

            {/* Invoice exchange rate */}
            <div className="space-y-1.5">
              <Input
                id={`${formIdBase}-invoice-rate`}
                label="კურსი — ინვოისის (USD→GEL)"
                type="text"
                inputMode="decimal"
                placeholder="2.70"
                value={invoiceExchangeRate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInvoiceExchangeRate(e.target.value)}
              />
              {/* Live rate diff badge */}
              {rate > 0 && invRate > 0 && grandTotalUsd > 0 && (
                (() => {
                  const diff = (rate - invRate) * grandTotalUsd;
                  const positive = diff >= 0;
                  return (
                    <p className={`text-xs font-medium px-2 py-1 rounded-md ${positive ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
                      კურსთა სხვ.: {positive ? "+" : ""}{diff.toFixed(2)}₾
                      &nbsp;({invRate.toFixed(4)} → {rate.toFixed(4)})
                      &nbsp;{positive ? "დეკლ. ძვირია" : "დეკლ. იაფია"}
                    </p>
                  );
                })()
              )}
            </div>
          </div>

          {/* Related imports under same declaration */}
          {relatedImports.length > 0 && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3 text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">
                შეფასების # &ldquo;{declarationNumber}&rdquo; ქვეშ სხვა იმპორტები:
              </p>
              <ul className="space-y-0.5 text-blue-700 dark:text-blue-400">
                {relatedImports.map((r) => (
                  <li key={r.id}>
                    <a href={`/imports/${r.id}`} className="underline hover:no-underline">
                      #{r.id} — {r.supplier}{r.invoiceNumber ? ` (${r.invoiceNumber})` : ""}&nbsp;
                      <span className="text-xs opacity-70">[{r.status}]</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Line Items Card ── */}
      <Card>
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base">პოზიციები</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-4 w-4" />
            პოზიციის დამატება
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item, idx) => {
              const calc = calcLines[idx];
              return (
                <div
                  key={item._key}
                  className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
                >
                  {/* ── Row 1: classification + trash ──────────────────────── */}
                  <div className={`flex items-center gap-2 px-3 py-2 border-b border-border ${ITEM_TYPE_COLORS[item.itemType]}`}>
                    <span className="text-xs font-semibold opacity-60 shrink-0 w-5 text-center">#{idx + 1}</span>

                    {/* Item type */}
                    <select
                      value={item.itemType}
                      onChange={(e) => updateItem(item._key, "itemType", e.target.value)}
                      className="h-7 rounded-md border-0 bg-white/40 dark:bg-black/20 px-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer backdrop-blur-sm"
                    >
                      <option value="inventory">საქონელი</option>
                      <option value="fixed_asset">ძირ. საშ.</option>
                      <option value="consumable">სახარჯი</option>
                    </select>

                    {/* Sub-type (only for inventory) */}
                    {item.itemType === "inventory" ? (
                      <select
                        value={item.inventorySubType}
                        onChange={(e) => updateItem(item._key, "inventorySubType", e.target.value)}
                        className="h-7 rounded-md border-0 bg-white/40 dark:bg-black/20 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                      >
                        <option value="regular">ჩვეულებრივი</option>
                        <option value="small_value">მცირეფასიანი</option>
                      </select>
                    ) : null}

                    {/* Category (only for regular inventory) */}
                    {item.itemType === "inventory" && item.inventorySubType === "regular" ? (
                      <select
                        value={item.accountingCategory}
                        onChange={(e) => updateItem(item._key, "accountingCategory", e.target.value)}
                        className="h-7 flex-1 rounded-md border-0 bg-white/40 dark:bg-black/20 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
                      >
                        <option value="">— კატეგ. —</option>
                        {INVENTORY_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : <div className="flex-1" />}

                    {/* Trash */}
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item._key)}
                        className="ml-auto h-7 w-7 flex items-center justify-center rounded-md text-current opacity-50 hover:opacity-100 hover:bg-white/30 dark:hover:bg-black/20 transition-all cursor-pointer shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="p-3 space-y-2">
                    {/* ── Row 2: product selector ─────────────────────────── */}
                    <div className="flex gap-2">
                      <div className="flex-1 min-w-0">
                        {item.isNew ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={item.oemCode}
                              onChange={(e) => updateItem(item._key, "oemCode", e.target.value)}
                              className="h-9 flex-1 min-w-0 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 text-xs font-mono text-amber-700 dark:text-amber-300 placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
                              placeholder="OEM კოდი"
                            />
                            <button
                              type="button"
                              title="გაუქმება"
                              onClick={() => resetNewItem(item._key)}
                              className="shrink-0 text-amber-500 hover:text-destructive cursor-pointer transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <ProductCombobox
                            products={products}
                            value={item.productId}
                            onChange={(v) => {
                              updateItem(item._key, "productId", v);
                              const prod = products.find((p) => String(p.id) === v);
                              if (prod?.category) {
                                updateItem(item._key, "accountingCategory", prod.category);
                              }
                            }}
                            onProductAdded={(p) => setProducts((prev) => [...prev, p])}
                            onNewOem={(oem) => handleNewOem(item._key, oem)}
                            placeholder="OEM / პროდ..."
                          />
                        )}
                      </div>

                      {item.isNew ? (
                        <input
                          type="text"
                          placeholder="დასახელება *"
                          value={item.productName}
                          onChange={(e) => updateItem(item._key, "productName", e.target.value)}
                          className="h-9 flex-1 min-w-0 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      ) : (
                        <div className="h-9 flex-1 min-w-0 flex items-center px-3 rounded-lg bg-muted/40 text-sm truncate">
                          {item.productId
                            ? <span className="truncate text-foreground">{products.find((p) => String(p.id) === item.productId)?.name ?? "—"}</span>
                            : <span className="text-muted-foreground/40 text-xs">— დასახელება —</span>
                          }
                        </div>
                      )}
                    </div>

                    {/* ── Row 3: numeric inputs ────────────────────────────── */}
                    <div className="grid grid-cols-5 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">რაოდ.</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={item.quantity}
                          onChange={(e) => updateItem(item._key, "quantity", e.target.value)}
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">ერთეული</label>
                        <input
                          type="text"
                          placeholder="ცალი"
                          value={item.unit}
                          onChange={(e) => updateItem(item._key, "unit", e.target.value)}
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">ფასი ($)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={item.unitPriceUsd}
                          onChange={(e) => updateItem(item._key, "unitPriceUsd", e.target.value)}
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">წონა (კგ)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.0"
                          value={item.weight}
                          onChange={(e) => updateItem(item._key, "weight", e.target.value)}
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">მარჟა (%)</label>
                        {item.itemType === "inventory" ? (
                          <input
                            type="number"
                            min="0"
                            max="99"
                            step="1"
                            placeholder="30"
                            value={item.margin}
                            onChange={(e) => updateItem(item._key, "margin", e.target.value)}
                            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        ) : (
                          <div className="h-9 flex items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">—</div>
                        )}
                      </div>
                    </div>

                    {/* ── Row 4: calculated values ─────────────────────────── */}
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">სულ ($)</p>
                        <p className="text-sm font-semibold">{fmt(calc?.totalPriceUsd ?? 0)}</p>
                      </div>
                      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-center">
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 mb-0.5">სულ (₾)</p>
                        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">{fmt(calc?.totalPriceGel ?? 0)}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-center">
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-0.5">თვითღ. (₾/ც)</p>
                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{fmt(calc?.landedCostPerUnit ?? 0)}</p>
                      </div>
                    </div>

                    {/* ── Row 5: price history ──────────────────────────────── */}
                    {item.productId && !item.isNew && (
                      <ProductPriceHistory productId={item.productId} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals row */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-border bg-card p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">სულ ($)</p>
                <p className="text-base font-semibold">{fmt(grandTotalUsd)}</p>
              </div>
              <div className="rounded-lg border border-border bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">სულ (₾) ფასად</p>
                <p className="text-base font-semibold text-blue-700 dark:text-blue-300">{fmt(grandTotalGel)}</p>
              </div>
              <div className="rounded-lg border border-border bg-amber-50 dark:bg-amber-950/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">საერთო დანახარჯი (₾)</p>
                <p className="text-base font-semibold text-amber-700 dark:text-amber-300">{fmt(totalOverhead)}</p>
              </div>
              <div className="rounded-lg border border-border bg-emerald-50 dark:bg-emerald-950/30 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">სულ თვითღირებულება (₾)</p>
                <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">{fmt(grandLandedGel)}</p>
              </div>
            </div>
          </div>

          {/* Overhead allocation breakdown */}
          {(transport + terminal + agency + vatCost) > 0 && calcLines.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
                განაწილების დეტალები
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="pb-2 pr-3 font-medium">პოზიცია</th>
                      <th className="pb-2 pr-3 font-medium text-right">ტრანსპ. (₾)</th>
                      <th className="pb-2 pr-3 font-medium text-right">ტერმ. (₾)</th>
                      <th className="pb-2 pr-3 font-medium text-right">სააგ. (₾)</th>
                      <th className="pb-2 pr-3 font-medium text-right">საბ.დღგ (₾)</th>
                      <th className="pb-2 font-medium text-right">თვითღირ./ც (₾)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const prod = products.find((p) => String(p.id) === item.productId);
                      const label = item.isNew
                        ? `${item.oemCode}${item.productName ? ` – ${item.productName}` : ""}`
                        : prod
                          ? (prod.oemCode ? `${prod.oemCode} – ${prod.name}` : prod.name)
                          : `სტრ. ${idx + 1}`;
                      const calc = calcLines[idx];
                      return (
                        <tr key={item._key} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 truncate max-w-[180px]">{label}</td>
                          <td className="py-1.5 pr-3 text-right">{fmt(calc?.allocatedTransport ?? 0)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmt(calc?.allocatedTerminal  ?? 0)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmt(calc?.allocatedAgency    ?? 0)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmt(calc?.allocatedVat       ?? 0)}</td>
                          <td className="py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-300">
                            {fmt(calc?.landedCostPerUnit ?? 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── Action Bar ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-8">
        {/* Save status indicator */}
        <div className="flex items-center gap-2 text-sm">
          {saveStatus === "saving" && (
            <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground">ინახება...</span></>
          )}
          {saveStatus === "saved" && (
            <><CheckCircle className="h-4 w-4 text-emerald-600" /><span className="text-emerald-600">შენახულია (draft)</span></>
          )}
          {saveStatus === "error" && (
            <><AlertCircle className="h-4 w-4 text-destructive" /><span className="text-destructive text-xs truncate max-w-xs">{saveError}</span></>
          )}
          {saveStatus === "idle" && importId && (
            <span className="text-xs text-muted-foreground">ავტო-შენახვა 2 წთ-ში</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => saveDraft(false)}
            disabled={saveStatus === "saving" || finalizing}
          >
            <Save className="h-4 w-4" />
            Draft-ის შენახვა
          </Button>
          <Button
            type="button"
            onClick={handleFinalize}
            disabled={saveStatus === "saving" || finalizing}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {finalizing
              ? <><Loader2 className="h-4 w-4 animate-spin" />მუშავდება...</>
              : <><CheckCircle className="h-4 w-4" />დასრულება & მარაგის განახლება</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Revert button (separate component used in history) ────────────────────────

interface RevertButtonProps {
  importId: number;
  onSuccess: () => void;
}

export function RevertImportButton({ importId, onSuccess }: RevertButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleRevert = async () => {
    if (!confirm("დარწმუნებული ხარ? ეს გამოაქვეყნებს ოპერაციას და სტოკი გამოაკლდება.")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/erp-imports/${importId}/revert`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Revert failed");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRevert}
        disabled={loading}
        className="border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400"
      >
        {loading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RefreshCw className="h-3.5 w-3.5" />
        }
        გაუქმება & რედაქტირება
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

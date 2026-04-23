"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, ChevronDown, ChevronRight, Link2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { formatGEL, formatNumber } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnknownProduct {
  id: number;
  name: string;
  oemCode: string | null;
  currentStock: number;
  minStock: number;
  unitPrice: number;
  unit: string;
  lastSaleAt: string | null;
  saleCount: number;
  totalQty: number;
  totalRevenue: number;
}

interface ProductSaleContext {
  productId: number;
  id: number;
  quantity: number;
  unitPrice: number;
  soldAt: string;
  paymentMethod: string;
  customerName: string | null;
}

interface OrphanedGroup {
  notesText: string | null;
  saleIds: number[];
  saleCount: number;
  totalQty: number;
  totalRevenue: number;
  avgPrice: number;
  firstSaleAt: string;
  lastSaleAt: string;
}

interface OrphanedSaleContext {
  id: number;
  quantity: number;
  unitPrice: number;
  soldAt: string;
  paymentMethod: string;
  customerName: string | null;
  notes: string | null;
}

interface ProductOption {
  id: number;
  name: string;
  oemCode: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  cash: "ხელზე 💵",
  transfer: "დარიცხვა 🏦",
  credit: "ნისია 📋",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("ka-GE", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Orphaned sales section ───────────────────────────────────────────────────

function OrphanedSection({
  groups,
  saleContext,
  products,
  onLinked,
}: {
  groups: OrphanedGroup[];
  saleContext: OrphanedSaleContext[];
  products: ProductOption[];
  onLinked: () => void;
}) {
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [linkGroup, setLinkGroup] = useState<OrphanedGroup | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const productOptions = [
    { value: "", label: "— აირჩიეთ პროდუქტი —" },
    ...products.map((p) => ({
      value: String(p.id),
      label: p.oemCode ? `${p.oemCode} — ${p.name}` : p.name,
    })),
  ];

  const openLink = (g: OrphanedGroup) => {
    setLinkGroup(g);
    setSelectedProductId("");
    setLinkError(null);
  };

  const handleLink = async () => {
    if (!linkGroup || !selectedProductId) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch("/api/unknowns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_ids: linkGroup.saleIds,
          product_id: Number(selectedProductId),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLinkError(body.error ?? "შენახვა ვერ მოხერხდა");
        return;
      }
      setLinkGroup(null);
      onLinked();
    } finally {
      setLinking(false);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <span className="text-green-600">✓</span>
        <span>პროდუქტ-გარეშე გაყიდვები არ მოიძებნა</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
        <p className="text-sm text-orange-700 dark:text-orange-400">
          <strong>{groups.length}</strong> ჯგუფი პროდუქტ-გარეშე გაყიდვებისა (ჯამი:{" "}
          <strong>{groups.reduce((s, g) => s + g.saleCount, 0)}</strong> ჩ.) —
          ამ გაყიდვებში ბოტმა ვერ ამოიცნო პროდუქტი. დააჭირეთ{" "}
          <strong>Link</strong>-ს და მიუბამეთ.
        </p>
      </div>

      <div className="rounded-xl border border-orange-200 dark:border-orange-900 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>ორიგინალი ტექსტი (notes)</TableHead>
              <TableHead className="text-right">ჩ-ბა</TableHead>
              <TableHead className="text-right">ჯამ. შემ.</TableHead>
              <TableHead>პერიოდი</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const key = g.notesText ?? "";
              const isExpanded = expandedNotes === key;
              const preview = saleContext.filter(
                (s) => g.saleIds.slice(0, 5).includes(s.id),
              );

              return (
                <React.Fragment key={key}>
                  <TableRow
                    className="cursor-pointer hover:bg-orange-50/60 dark:hover:bg-orange-950/20"
                    onClick={() => setExpandedNotes(isExpanded ? null : key)}
                  >
                    <TableCell className="pl-3">
                      {preview.length > 0 ? (
                        isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium text-orange-700 dark:text-orange-400 max-w-[280px] truncate">
                      {g.notesText ?? <span className="italic text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {g.saleCount} ({formatNumber(g.totalQty)} ც.)
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs font-medium">
                      {formatGEL(g.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(g.firstSaleAt)} – {fmtDate(g.lastSaleAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 cursor-pointer border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:text-orange-400"
                        onClick={(e) => { e.stopPropagation(); openLink(g); }}
                        aria-label="მიბმა პროდუქტთან"
                      >
                        <Link2 className="h-3 w-3 mr-1" />
                        Link
                      </Button>
                    </TableCell>
                  </TableRow>

                  {isExpanded && preview.length > 0 && (
                    <TableRow key={`${key}-detail`}>
                      <TableCell colSpan={6} className="bg-muted/30 p-0">
                        <div className="px-8 py-3">
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            ბოლო {preview.length} გაყიდვა — კონტექსტი:
                          </p>
                          <div className="overflow-auto rounded-lg border border-border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs py-1.5">თარიღი</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">რ-ბა</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">ფასი</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">ჯამი</TableHead>
                                  <TableHead className="text-xs py-1.5">გადახდა</TableHead>
                                  <TableHead className="text-xs py-1.5">მყიდველი</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {preview.map((s) => (
                                  <TableRow key={s.id}>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground whitespace-nowrap">
                                      {fmtDateTime(s.soldAt)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">{s.quantity}</TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">{s.unitPrice.toFixed(2)}₾</TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums font-medium">
                                      {(s.quantity * s.unitPrice).toFixed(2)}₾
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                                      {s.customerName ?? "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {g.saleCount > 5 && (
                            <p className="text-xs text-muted-foreground mt-1.5">
                              ... და კიდევ {g.saleCount - 5} გაყიდვა ამ ჯგუფში
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Link Modal */}
      <Dialog
        open={!!linkGroup}
        onClose={() => setLinkGroup(null)}
        title="პროდუქტთან მიბმა"
      >
        {linkGroup && (
          <div className="space-y-4">
            <div className="rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30 px-3 py-2 text-xs text-orange-700 dark:text-orange-400 leading-relaxed space-y-1">
              <p>
                <strong>ორიგინალი ტექსტი:</strong>{" "}
                <span className="font-mono">{linkGroup.notesText ?? "—"}</span>
              </p>
              <p>
                ეს მოქმედება <strong>{linkGroup.saleCount} გაყიდვას</strong> მიაბამს
                არჩეულ პროდუქტს (ჯამი: {formatGEL(linkGroup.totalRevenue)}).
              </p>
            </div>

            <Select
              id="link-product"
              label="პროდუქტი"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              options={productOptions}
            />

            {linkError && (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                {linkError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setLinkGroup(null)}
                disabled={linking}
                className="cursor-pointer"
              >
                გაუქმება
              </Button>
              <Button
                onClick={handleLink}
                disabled={linking || !selectedProductId}
                className="cursor-pointer"
              >
                {linking ? "ინახება..." : "მიბმა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ─── Unknown products section ─────────────────────────────────────────────────

function UnknownProductsSection({
  products,
  productSales,
  onFixed,
}: {
  products: UnknownProduct[];
  productSales: ProductSaleContext[];
  onFixed: () => void;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState<UnknownProduct | null>(null);
  const [editName, setEditName] = useState("");
  const [editOem, setEditOem] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEdit = (p: UnknownProduct) => {
    setEditProduct(p);
    setEditName(p.name);
    setEditOem(p.oemCode ?? "");
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editProduct) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/inventory/${editProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          oem_code: editOem.trim() || null,
          current_stock: editProduct.currentStock,
          min_stock: editProduct.minStock,
          unit_price: editProduct.unitPrice,
          unit: editProduct.unit,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? "შენახვა ვერ მოხერხდა");
        return;
      }
      setEditProduct(null);
      onFixed();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (products.length === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <span className="text-green-600">✓</span>
        <span>&apos;უცნობი&apos; სახელის პროდუქტები არ მოიძებნა</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-700 dark:text-amber-400">
          <strong>{products.length}</strong> პროდუქტი &apos;უცნობი&apos; დასახელებით —
          დააჭირეთ <strong>Fix</strong>-ს და შეიყვანეთ რეალური მონაცემი.
        </p>
      </div>

      <div className="rounded-xl border border-amber-200 dark:border-amber-900 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>OEM კოდი</TableHead>
              <TableHead>დასახელება</TableHead>
              <TableHead className="text-right">გაყიდვები</TableHead>
              <TableHead className="text-right">ჯამ. შემ.</TableHead>
              <TableHead>ბოლო გაყიდვა</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const sales = productSales.filter((s) => s.productId === p.id);
              const isExpanded = expandedId === p.id;

              return (
                <React.Fragment key={p.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/20"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    <TableCell className="pl-3">
                      {sales.length > 0 ? (
                        isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.oemCode ?? <span className="italic">—</span>}
                    </TableCell>
                    <TableCell className="font-medium text-amber-700 dark:text-amber-400">
                      {p.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {p.saleCount} ({formatNumber(p.totalQty)} ც.)
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs font-medium">
                      {formatGEL(p.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastSaleAt ? fmtDate(p.lastSaleAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 cursor-pointer border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-400"
                        onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                        aria-label="გასწორება"
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Fix
                      </Button>
                    </TableCell>
                  </TableRow>

                  {isExpanded && sales.length > 0 && (
                    <TableRow key={`${p.id}-detail`}>
                      <TableCell colSpan={7} className="bg-muted/30 p-0">
                        <div className="px-8 py-3">
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            გაყიდვების კონტექსტი:
                          </p>
                          <div className="overflow-auto rounded-lg border border-border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs py-1.5">თარიღი</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">რ-ბა</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">ფასი</TableHead>
                                  <TableHead className="text-right text-xs py-1.5">ჯამი</TableHead>
                                  <TableHead className="text-xs py-1.5">გადახდა</TableHead>
                                  <TableHead className="text-xs py-1.5">მყიდველი</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sales.slice(0, 15).map((s) => (
                                  <TableRow key={s.id}>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground whitespace-nowrap">
                                      {fmtDateTime(s.soldAt)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">{s.quantity}</TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">{s.unitPrice.toFixed(2)}₾</TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums font-medium">
                                      {(s.quantity * s.unitPrice).toFixed(2)}₾
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      {PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground">
                                      {s.customerName ?? "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {sales.length > 15 && (
                            <p className="text-xs text-muted-foreground mt-1.5">
                              ... და კიდევ {sales.length - 15} გაყიდვა
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!editProduct}
        onClose={() => setEditProduct(null)}
        title={`'უცნობი' პროდუქტის გასწორება #${editProduct?.id}`}
      >
        {editProduct && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              ეს პროდუქტი <strong>{editProduct.saleCount} ჯერ</strong> გაიყიდა,
              ჯამური შემოსავლით{" "}
              <strong>{formatGEL(editProduct.totalRevenue)}</strong>.
            </div>
            <Input
              id="fix-name"
              label="პროდუქტის დასახელება"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="შეიყვანეთ რეალური დასახელება"
            />
            <Input
              id="fix-oem"
              label="OEM კოდი"
              type="text"
              value={editOem}
              onChange={(e) => setEditOem(e.target.value)}
              placeholder="შეიყვანეთ OEM კოდი (სურვილისამებრ)"
            />
            {saveError && (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditProduct(null)} disabled={saving} className="cursor-pointer">
                გაუქმება
              </Button>
              <Button onClick={handleSave} disabled={saving || !editName.trim()} className="cursor-pointer">
                {saving ? "ინახება..." : "შენახვა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface UnknownsData {
  unknownProducts: UnknownProduct[];
  productSales: ProductSaleContext[];
  orphanedGroups: OrphanedGroup[];
  orphanedSalesContext: OrphanedSaleContext[];
}

export function FixUnknownsPanel() {
  const [data, setData] = useState<UnknownsData | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [unknownsRes, productsRes] = await Promise.all([
        fetch("/api/unknowns"),
        fetch("/api/products"),
      ]);
      if (unknownsRes.ok) setData((await unknownsRes.json()) as UnknownsData);
      if (productsRes.ok) {
        const json = (await productsRes.json()) as
          | { data: { id: number; name: string; oemCode: string | null }[] }
          | { id: number; name: string; oemCode: string | null }[];
        const prods = Array.isArray(json) ? json : json.data;
        setProducts(prods);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <p className="py-6 text-sm text-muted-foreground text-center">
        იტვირთება...
      </p>
    );
  }

  const totalIssues = (data?.unknownProducts.length ?? 0) + (data?.orphanedGroups.length ?? 0);

  if (totalIssues === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <span className="text-green-600 text-base">✓</span>
        <span>გასასწორებელი ჩანაწერები არ მოიძებნა — ყველაფერი სუფთაა</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section 1: unknown named products */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          1. პროდუქტები &apos;უცნობი&apos; სახელით
        </h3>
        <UnknownProductsSection
          products={data?.unknownProducts ?? []}
          productSales={data?.productSales ?? []}
          onFixed={load}
        />
      </div>

      {/* Section 2: orphaned sales (product_id IS NULL) */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          2. პროდუქტ-გარეშე გაყიდვები (ბოტმა ვერ ამოიცნო)
        </h3>
        <OrphanedSection
          groups={data?.orphanedGroups ?? []}
          saleContext={data?.orphanedSalesContext ?? []}
          products={products}
          onLinked={load}
        />
      </div>
    </div>
  );
}

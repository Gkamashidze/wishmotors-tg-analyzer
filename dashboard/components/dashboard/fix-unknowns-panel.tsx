"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatGEL, formatNumber } from "@/lib/utils";

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

interface RecentSale {
  productId: number;
  id: number;
  quantity: number;
  unitPrice: number;
  soldAt: string;
  paymentMethod: string;
  customerName: string | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "ხელზე 💵",
  transfer: "დარიცხვა 🏦",
  credit: "ნისია 📋",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("ka-GE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FixUnknownsPanel() {
  const router = useRouter();
  const [products, setProducts] = useState<UnknownProduct[]>([]);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [editProduct, setEditProduct] = useState<UnknownProduct | null>(null);
  const [editName, setEditName] = useState("");
  const [editOem, setEditOem] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/unknowns");
      if (!res.ok) return;
      const data = (await res.json()) as {
        products: UnknownProduct[];
        recentSales: RecentSale[];
      };
      setProducts(data.products);
      setRecentSales(data.recentSales);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="py-6 text-sm text-muted-foreground text-center">
        იტვირთება...
      </p>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <span className="text-green-600">✓</span>
        <span>&apos;უცნობი&apos; ჩანაწერები არ მოიძებნა — ყველაფერი გასწორებულია</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-700 dark:text-amber-400">
          ნაპოვნია <strong>{products.length}</strong> პროდუქტი &apos;უცნობი&apos;
          დასახელებით. დააჭირეთ <strong>Fix</strong>-ს მწკრივზე, შეიყვანეთ
          რეალური მონაცემი და შეინახეთ.
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
              const sales = recentSales.filter((s) => s.productId === p.id);
              const isExpanded = expandedId === p.id;

              return (
                <React.Fragment key={p.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/20"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    <TableCell className="pl-3">
                      {sales.length > 0 ? (
                        isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )
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
                        className="h-7 px-2 cursor-pointer border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(p);
                        }}
                        aria-label="გასწორება"
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Fix
                      </Button>
                    </TableCell>
                  </TableRow>

                  {isExpanded && sales.length > 0 && (
                    <TableRow key={`${p.id}-detail`}>
                      <TableCell
                        colSpan={7}
                        className="bg-muted/30 dark:bg-muted/10 p-0"
                      >
                        <div className="px-8 py-3">
                          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                            გაყიდვების კონტექსტი — მათი ნახვა დაგეხმარება იმის
                            გარჩევაში, რა ნაწილი გაიყიდა
                          </p>
                          <div className="overflow-auto rounded-lg border border-border bg-background">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs py-1.5">
                                    თარიღი
                                  </TableHead>
                                  <TableHead className="text-right text-xs py-1.5">
                                    რ-ბა
                                  </TableHead>
                                  <TableHead className="text-right text-xs py-1.5">
                                    ფასი
                                  </TableHead>
                                  <TableHead className="text-right text-xs py-1.5">
                                    ჯამი
                                  </TableHead>
                                  <TableHead className="text-xs py-1.5">
                                    გადახდა
                                  </TableHead>
                                  <TableHead className="text-xs py-1.5">
                                    მყიდველი
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sales.slice(0, 15).map((s) => (
                                  <TableRow key={s.id}>
                                    <TableCell className="text-xs py-1.5 text-muted-foreground whitespace-nowrap">
                                      {fmtDateTime(s.soldAt)}
                                    </TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">
                                      {s.quantity}
                                    </TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums">
                                      {s.unitPrice.toFixed(2)}₾
                                    </TableCell>
                                    <TableCell className="text-right text-xs py-1.5 tabular-nums font-medium">
                                      {(s.quantity * s.unitPrice).toFixed(2)}₾
                                    </TableCell>
                                    <TableCell className="text-xs py-1.5">
                                      {PAYMENT_LABELS[s.paymentMethod] ??
                                        s.paymentMethod}
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
              ეს პროდუქტი{" "}
              <strong>{editProduct.saleCount} ჯერ</strong> გაიყიდა,
              ჯამური შემოსავლით{" "}
              <strong>{formatGEL(editProduct.totalRevenue)}</strong>.
              შეიყვანეთ რეალური მონაცემები — ყველა მიბმული გაყიდვა
              ავტომატურად განახლდება.
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
              <Button
                variant="outline"
                onClick={() => setEditProduct(null)}
                disabled={saving}
                className="cursor-pointer"
              >
                გაუქმება
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !editName.trim()}
                className="cursor-pointer"
              >
                {saving ? "ინახება..." : "შენახვა"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

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
import { Input } from "@/components/ui/input";
import type { ProductRow } from "@/lib/queries";
import { formatGEL, formatNumber, cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

interface EditState {
  name: string;
  oem_code: string;
  current_stock: string;
  min_stock: string;
  unit_price: string;
  unit: string;
}

function rowToEdit(r: ProductRow): EditState {
  return {
    name: r.name,
    oem_code: r.oemCode ?? "",
    current_stock: String(r.currentStock),
    min_stock: String(r.minStock),
    unit_price: String(r.unitPrice),
    unit: r.unit,
  };
}

export function InventoryTable({ rows }: { rows: ProductRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showLow, setShowLow] = useState(false);
  const [showNegative, setShowNegative] = useState(false);
  const [editRow, setEditRow] = useState<ProductRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<ProductRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (showNegative && r.currentStock >= 0) return false;
      if (showLow && r.currentStock >= r.minStock) return false;
      if (!q) return true;
      return [r.name, r.oemCode ?? "", r.unit].join(" ").toLowerCase().includes(q);
    });
  }, [rows, search, showLow, showNegative]);

  const lowCount = useMemo(() => rows.filter((r) => r.currentStock < r.minStock).length, [rows]);
  const negativeCount = useMemo(() => rows.filter((r) => r.currentStock < 0).length, [rows]);

  const openEdit = useCallback((r: ProductRow) => {
    setEditRow(r);
    setEditState(rowToEdit(r));
  }, []);

  const closeEdit = useCallback(() => { setEditRow(null); setEditState(null); }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editState.name,
          oem_code: editState.oem_code || null,
          current_stock: Number(editState.current_stock),
          min_stock: Number(editState.min_stock),
          unit_price: Number(editState.unit_price),
          unit: editState.unit,
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
      const res = await fetch(`/api/inventory/${deleteRow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteRow(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [deleteRow, router]);

  const set = (key: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ძიება (სახელი, OEM...)"
            aria-label="ძიება მარაგში"
            className="h-9 w-64 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            size="sm"
            variant={showLow ? "destructive" : "outline"}
            onClick={() => setShowLow((v) => !v)}
            className="gap-1.5 cursor-pointer"
          >
            მინიმუმზე დაბალი
            {lowCount > 0 && (
              <span className="ml-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-white/20">
                {lowCount}
              </span>
            )}
          </Button>
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
            {negativeCount > 0 && (
              <span className={cn(
                "ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                showNegative ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground",
              )}>
                {negativeCount}
              </span>
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{formatNumber(filtered.length)} / {formatNumber(rows.length)} პროდუქტი</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>სახელი</TableHead>
              <TableHead>OEM</TableHead>
              <TableHead className="text-right">მარაგი</TableHead>
              <TableHead className="text-right">მინ.</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead className="text-right">ფასი</TableHead>
              <TableHead>ერთ.</TableHead>
              <TableHead>თარიღი</TableHead>
              <TableHead className="w-20 text-right">მოქ.</TableHead>
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
                const isLow = r.currentStock < r.minStock;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground text-xs">{idx + 1}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.oemCode ?? "—"}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${isLow ? "text-destructive" : ""}`}>
                      {formatNumber(r.currentStock)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(r.minStock)}</TableCell>
                    <TableCell>
                      {isLow ? (
                        <Badge variant="destructive">მარაგი ამოიწურა</Badge>
                      ) : (
                        <Badge variant="success">ნორმა</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatGEL(r.unitPrice)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.unit}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
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

      <Dialog open={!!editRow} onClose={closeEdit} title={`პროდუქტის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Input id="inv-name" label="სახელი" type="text" value={editState.name} onChange={set("name")} />
            <Input id="inv-oem" label="OEM კოდი" type="text" value={editState.oem_code} onChange={set("oem_code")} placeholder="სურვილისამებრ" />
            <div className="grid grid-cols-2 gap-3">
              <Input id="inv-stock" label="მიმდინარე მარაგი" type="number" min="0" value={editState.current_stock} onChange={set("current_stock")} />
              <Input id="inv-min" label="მინიმალური მარაგი" type="number" min="0" value={editState.min_stock} onChange={set("min_stock")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input id="inv-price" label="ფასი (₾)" type="number" min="0" step="0.01" value={editState.unit_price} onChange={set("unit_price")} />
              <Input id="inv-unit" label="ერთეული" type="text" value={editState.unit} onChange={set("unit")} placeholder="მაგ. ც, კგ, ლ" />
            </div>
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
        title="პროდუქტის წაშლა"
        description={`გსურთ პროდუქტი "${deleteRow?.name}" წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />
    </div>
  );
}

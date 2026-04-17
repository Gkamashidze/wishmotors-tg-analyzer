"use client";

import { useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";
import type { ProductRow } from "@/lib/queries";
import { formatGEL, formatNumber } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

interface EditState {
  name: string;
  oem_code: string;
}

function rowToEdit(r: ProductRow): EditState {
  return {
    name: r.name,
    oem_code: r.oemCode ?? "",
  };
}

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [viewRow, setViewRow] = useState<ProductRow | null>(null);
  const [editRow, setEditRow] = useState<ProductRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<ProductRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.oemCode ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const openEdit = useCallback((r: ProductRow) => {
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

  const set = (key: keyof EditState) => (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ძიება (დასახელება, OEM...)"
          aria-label="ძიება პროდუქციაში"
          className="h-9 w-72 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          {formatNumber(filtered.length)} / {formatNumber(rows.length)} პროდუქტი
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>OEM კოდი</TableHead>
              <TableHead>დასახელება</TableHead>
              <TableHead className="w-24 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground text-xs">{idx + 1}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.oemCode ?? <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
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

      {/* View Modal */}
      <Dialog open={!!viewRow} onClose={() => setViewRow(null)} title={`პროდუქტის დეტალები #${viewRow?.id}`}>
        {viewRow && (
          <div className="space-y-3">
            <ViewFieldGrid>
              <ViewField label="დასახელება" value={viewRow.name} className="sm:col-span-2" />
              <ViewField label="OEM კოდი" value={viewRow.oemCode} />
              <ViewField label="ერთეული" value={viewRow.unit} />
              <ViewField label="მარაგი" value={formatNumber(viewRow.currentStock)} />
              <ViewField label="მინ. მარაგი" value={formatNumber(viewRow.minStock)} />
              <ViewField label="ერთ. ფასი" value={formatGEL(viewRow.unitPrice)} />
              <ViewField label="დამატების თარიღი" value={formatDate(viewRow.createdAt)} />
            </ViewFieldGrid>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setViewRow(null)} className="cursor-pointer">დახურვა</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editRow} onClose={closeEdit} title={`პროდუქტის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Input id="prod-name" label="დასახელება" type="text" value={editState.name} onChange={set("name")} />
            <Input id="prod-oem" label="OEM კოდი" type="text" value={editState.oem_code} onChange={set("oem_code")} placeholder="სურვილისამებრ" />
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
        title="პროდუქტის წაშლა"
        description={`გსურთ პროდუქტი "${deleteRow?.name}" წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />
    </div>
  );
}

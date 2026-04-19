"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2, Tag } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Input, Textarea, Select } from "@/components/ui/input";
import { ViewField, ViewFieldGrid } from "@/components/ui/view-field";
import type { ExpenseRow } from "@/lib/queries";
import { formatGEL, formatNumber } from "@/lib/utils";

const PAYMENT_OPTIONS = [
  { value: "cash", label: "ნაღდი" },
  { value: "card", label: "ბარათი" },
  { value: "transfer", label: "გადარიცხვა" },
];

const ALL = "__all__";

function paymentLabel(m: string) {
  return PAYMENT_OPTIONS.find((o) => o.value === m)?.label ?? m;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", { year: "numeric", month: "short", day: "numeric" });
}

function toDatetimeLocal(iso: string) {
  try { return new Date(iso).toISOString().slice(0, 16); } catch { return ""; }
}

interface EditState {
  amount: string;
  description: string;
  category: string;
  payment_method: string;
  created_at: string;
}

function rowToEdit(r: ExpenseRow): EditState {
  return {
    amount: String(r.amount),
    description: r.description ?? "",
    category: r.category ?? "",
    payment_method: r.paymentMethod,
    created_at: toDatetimeLocal(r.createdAt),
  };
}

export function ExpensesTable({ rows }: { rows: ExpenseRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [viewRow, setViewRow] = useState<ExpenseRow | null>(null);
  const [editRow, setEditRow] = useState<ExpenseRow | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteRow, setDeleteRow] = useState<ExpenseRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [apiCategories, setApiCategories] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/expenses/categories")
      .then((r) => r.json())
      .then((data: string[]) => setApiCategories(data))
      .catch(() => {});
  }, []);

  // Merge API categories with categories present in loaded rows (handles fresh entries)
  const categories = useMemo(() => {
    const fromRows = rows
      .map((r) => r.category)
      .filter((c): c is string => !!c && c.trim() !== "");
    const merged = Array.from(new Set([...apiCategories, ...fromRows])).sort();
    return merged;
  }, [rows, apiCategories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesCategory =
        selectedCategory === ALL || r.category === selectedCategory;
      const matchesSearch =
        !q ||
        [r.description ?? "", r.category ?? "", String(r.id)]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [rows, search, selectedCategory]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, r) => s + r.amount, 0),
    [filtered],
  );

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const openEdit = useCallback((r: ExpenseRow) => {
    setEditRow(r);
    setEditState(rowToEdit(r));
  }, []);

  const closeEdit = useCallback(() => { setEditRow(null); setEditState(null); }, []);

  const handleSave = useCallback(async () => {
    if (!editRow || !editState) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(editState.amount),
          description: editState.description || null,
          category: editState.category || null,
          payment_method: editState.payment_method,
          created_at: editState.created_at,
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
      const res = await fetch(`/api/expenses/${deleteRow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("server error");
      setDeleteRow(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }, [deleteRow, router]);

  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setEditState((prev) => prev ? { ...prev, [key]: e.target.value } : prev);

  return (
    <div className="space-y-4">
      {/* Search + totals row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ძიება (კატეგორია, აღწერა...)"
          aria-label="ძიება ხარჯებში"
          className="h-9 w-72 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{formatNumber(filtered.length)} ჩანაწერი</span>
          <span className="font-semibold">
            ჯამი:{" "}
            <span className="text-destructive tabular-nums">
              {selectedCategory === ALL && !search.trim()
                ? formatGEL(total)
                : formatGEL(filteredTotal)}
            </span>
          </span>
        </div>
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0">
            <Tag className="h-3.5 w-3.5" />
            კატეგორია:
          </span>
          <button
            onClick={() => setSelectedCategory(ALL)}
            className={[
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
              selectedCategory === ALL
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
            ].join(" ")}
          >
            ყველა
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? ALL : cat)}
              className={[
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                selectedCategory === cat
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
              ].join(" ")}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead className="text-right">თანხა</TableHead>
              <TableHead className="text-right">დღგ</TableHead>
              <TableHead>კატეგორია</TableHead>
              <TableHead>აღწერა</TableHead>
              <TableHead>გადახდა</TableHead>
              <TableHead>თარიღი</TableHead>
              <TableHead className="w-24 text-right">მოქ.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                  შედეგი არ არის
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, idx) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums text-muted-foreground text-xs">{idx + 1}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-destructive">
                    {formatGEL(r.amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.isVatIncluded ? (
                      <span className="text-purple-600 font-medium">{formatGEL(r.vatAmount)}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.category ? (
                      <Badge
                        variant={selectedCategory === r.category ? "default" : "secondary"}
                        className="cursor-pointer"
                        onClick={() => setSelectedCategory(r.category === selectedCategory ? ALL : r.category!)}
                      >
                        {r.category}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground italic text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {r.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{paymentLabel(r.paymentMethod)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 cursor-pointer"
                        onClick={() => setViewRow(r)}
                        aria-label="ნახვა"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 cursor-pointer"
                        onClick={() => openEdit(r)}
                        aria-label="რედაქტირება"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive cursor-pointer"
                        onClick={() => setDeleteRow(r)}
                        aria-label="წაშლა"
                      >
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
      <Dialog
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        title={`ხარჯის დეტალები #${viewRow?.id}`}
      >
        {viewRow && (
          <div className="space-y-3">
            <ViewFieldGrid>
              <ViewField
                label="თანხა"
                value={
                  <span className="text-destructive font-semibold tabular-nums">
                    {formatGEL(viewRow.amount)}
                  </span>
                }
              />
              <ViewField label="კატეგორია" value={viewRow.category} />
              <ViewField label="აღწერა" value={viewRow.description} className="sm:col-span-2" />
              <ViewField label="გადახდის მეთოდი" value={paymentLabel(viewRow.paymentMethod)} />
              <ViewField label="თარიღი" value={formatDate(viewRow.createdAt)} />
            </ViewFieldGrid>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setViewRow(null)} className="cursor-pointer">
                დახურვა
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editRow} onClose={closeEdit} title={`ხარჯის რედაქტირება #${editRow?.id}`}>
        {editState && (
          <div className="space-y-3">
            <Input id="exp-amount" label="თანხა (₾)" type="number" min="0" step="0.01" value={editState.amount} onChange={set("amount")} />
            <Input id="exp-category" label="კატეგორია" type="text" value={editState.category} onChange={set("category")} placeholder="მაგ. საწვავი, მასალა..." />
            <Textarea id="exp-desc" label="აღწერა" value={editState.description} onChange={set("description")} rows={2} placeholder="დეტალები..." />
            <Select id="exp-payment" label="გადახდის მეთოდი" options={PAYMENT_OPTIONS} value={editState.payment_method} onChange={set("payment_method")} />
            <Input id="exp-date" label="თარიღი" type="datetime-local" value={editState.created_at} onChange={set("created_at")} />
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
        title="ხარჯის წაშლა"
        description={`გსურთ ხარჯი #${deleteRow?.id} (${deleteRow ? formatGEL(deleteRow.amount) : ""}) წაშლა? ეს მოქმედება შეუქცევადია.`}
        loading={deleting}
      />
    </div>
  );
}

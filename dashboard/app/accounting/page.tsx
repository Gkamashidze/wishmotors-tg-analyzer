"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Scale,
  TrendingUp,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  AlertCircle,
  Loader2,
  Check,
  X,
  Users,
  Building2,
  CreditCard,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartOfAccount, AccountType } from "@/app/api/accounting/chart-of-accounts/route";
import type { TrialBalanceRow } from "@/app/api/accounting/trial-balance/route";
import type { ProfitLossResponse } from "@/app/api/accounting/profit-loss/route";
import type { PartnerRow } from "@/app/api/accounting/partners/route";
import type { VatSummaryResponse } from "@/app/api/accounting/vat/route";

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString("ka-GE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function today() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const TYPE_LABELS: Record<AccountType, string> = {
  asset:     "აქტივი",
  liability: "პასივი",
  equity:    "კაპიტალი",
  revenue:   "შემოსავალი",
  expense:   "ხარჯი",
};

const TYPE_COLORS: Record<AccountType, string> = {
  asset:     "bg-blue-100 text-blue-800",
  liability: "bg-red-100 text-red-800",
  equity:    "bg-purple-100 text-purple-800",
  revenue:   "bg-green-100 text-green-800",
  expense:   "bg-orange-100 text-orange-800",
};

// ─── Tab type ─────────────────────────────────────────────────────────────────
type Tab = "chart" | "trial" | "pl" | "debtors" | "creditors";

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AccountingPage() {
  const [tab, setTab]       = useState<Tab>("chart");
  const [from, setFrom]     = useState(firstOfMonth());
  const [to, setTo]         = useState(today());

  return (
    <>
      <TopBar title="ბუღალტერია" />
      <main className="p-6 space-y-6 animate-fade-in">

        {/* ── Header card with tab switcher + date range ── */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div>
                <CardTitle className="text-xl">ბუღალტრული მოდული</CardTitle>
                <CardDescription>
                  ანგარიშთა გეგმა · ბრუნვითი უწყისი · მოგება-ზარალი
                </CardDescription>
              </div>

              {/* Date range */}
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm text-muted-foreground whitespace-nowrap">პერიოდი:</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-muted-foreground text-sm">—</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Tab buttons */}
            <div className="flex gap-1 mt-4 p-1 bg-muted rounded-xl w-fit flex-wrap">
              {(
                [
                  { id: "chart",     label: "ანგარიშთა გეგმა",  icon: BookOpen   },
                  { id: "trial",     label: "ბრუნვითი უწყისი",  icon: Scale      },
                  { id: "pl",        label: "მოგება-ზარალი",    icon: TrendingUp },
                  { id: "debtors",   label: "დებიტორები",        icon: Users      },
                  { id: "creditors", label: "კრედიტორები",       icon: Building2  },
                ] as { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[]
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    tab === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
        </Card>

        {/* ── Tab content ── */}
        {tab === "chart"     && <ChartOfAccountsTab />}
        {tab === "trial"     && <TrialBalanceTab from={from} to={to} />}
        {tab === "pl"        && <ProfitLossTab    from={from} to={to} />}
        {tab === "debtors"   && <PartnerTab type="debtor" />}
        {tab === "creditors" && <PartnerTab type="creditor" />}
      </main>
    </>
  );
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────
function flattenGroupTree(
  group: ChartOfAccount[],
): Array<{ acc: ChartOfAccount; depth: number }> {
  const groupIds = new Set(group.map((a) => a.id));
  const childrenOf = new Map<number, ChartOfAccount[]>();

  for (const acc of group) {
    if (acc.parent_id != null && groupIds.has(acc.parent_id)) {
      if (!childrenOf.has(acc.parent_id)) childrenOf.set(acc.parent_id, []);
      childrenOf.get(acc.parent_id)!.push(acc);
    }
  }
  for (const [, ch] of childrenOf) ch.sort((a, b) => a.code.localeCompare(b.code));

  const roots = group
    .filter((a) => a.parent_id == null || !groupIds.has(a.parent_id))
    .sort((a, b) => a.code.localeCompare(b.code));

  const result: Array<{ acc: ChartOfAccount; depth: number }> = [];

  function visit(acc: ChartOfAccount, depth: number) {
    result.push({ acc, depth });
    for (const child of childrenOf.get(acc.id) ?? []) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Chart of Accounts
// ═══════════════════════════════════════════════════════════════════════════════
function ChartOfAccountsTab() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/chart-of-accounts");
      if (!res.ok) throw new Error("ჩატვირთვა ვერ მოხდა");
      setAccounts(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("წაშლა? (ლეჯერში ჩაწერილ ანგარიშს მხოლოდ გამორთავს)")) return;
    await fetch(`/api/accounting/chart-of-accounts/${id}`, { method: "DELETE" });
    void load();
  };

  const grouped = accounts.reduce<Record<AccountType, ChartOfAccount[]>>(
    (acc, a) => {
      const t = a.type as AccountType;
      if (!acc[t]) acc[t] = [];
      acc[t].push(a);
      return acc;
    },
    {} as Record<AccountType, ChartOfAccount[]>,
  );

  const ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

  return (
    <div className="space-y-4">
      {/* Add button */}
      <div className="flex justify-end">
        <Button onClick={() => { setShowForm(true); setEditId(null); }}>
          <Plus className="h-4 w-4" />
          ახალი ანგარიში
        </Button>
      </div>

      {/* Inline form */}
      {showForm && (
        <AccountForm
          editAccount={editId ? accounts.find((a) => a.id === editId) : undefined}
          allAccounts={accounts}
          onSave={() => { setShowForm(false); setEditId(null); void load(); }}
          onCancel={() => { setShowForm(false); setEditId(null); }}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          იტვირთება...
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && ORDER.map((type) => {
        const group = grouped[type] ?? [];
        if (group.length === 0) return null;
        const tree = flattenGroupTree(group);
        return (
          <Card key={type}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-3">
                <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold", TYPE_COLORS[type])}>
                  {TYPE_LABELS[type]}
                </span>
                <span className="text-sm text-muted-foreground">{group.length} ანგარიში</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-border bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-24">კოდი</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">დასახელება</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground hidden md:table-cell">აღწერა</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground w-20">სტატუსი</th>
                    <th className="px-4 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {tree.map(({ acc, depth }) => (
                    <tr
                      key={acc.id}
                      className={cn(
                        "border-t border-border hover:bg-muted/30 transition-colors",
                        !acc.is_active && "opacity-50",
                        depth > 0 && "bg-muted/10",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-primary">
                        <span style={{ paddingLeft: `${depth * 16}px` }} className="block">
                          {acc.code}
                        </span>
                      </td>
                      <td className="py-2.5 font-medium">
                        <span
                          className="flex items-center gap-1"
                          style={{ paddingLeft: `${16 + depth * 16}px`, paddingRight: "16px" }}
                        >
                          {depth > 0 && (
                            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          {acc.name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                        {acc.description ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {acc.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <Check className="h-3 w-3" /> აქტიური
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <X className="h-3 w-3" /> გამორთული
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setEditId(acc.id); setShowForm(true); }}
                            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(acc.id)}
                            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Account form ─────────────────────────────────────────────────────────────
function AccountForm({
  editAccount,
  allAccounts,
  onSave,
  onCancel,
}: {
  editAccount?: ChartOfAccount;
  allAccounts: ChartOfAccount[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [code, setCode]           = useState(editAccount?.code ?? "");
  const [name, setName]           = useState(editAccount?.name ?? "");
  const [type, setType]           = useState<AccountType>(editAccount?.type ?? "asset");
  const [description, setDesc]    = useState(editAccount?.description ?? "");
  const [parentId, setParentId]   = useState<number | null>(editAccount?.parent_id ?? null);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

  const parentOptions = allAccounts.filter((a) => a.id !== editAccount?.id && a.is_active);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const url = editAccount
        ? `/api/accounting/chart-of-accounts/${editAccount.id}`
        : "/api/accounting/chart-of-accounts";
      const method = editAccount ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, type, description, parent_id: parentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "შეცდომა");
        return;
      }
      onSave();
    } catch {
      setErr("შეცდომა");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/30 shadow-sm">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base">
          {editAccount ? "ანგარიშის რედაქტირება" : "ახალი ანგარიში"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">კოდი *</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="მაგ: 1110"
              required
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">დასახელება *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="მაგ: სალარო"
              required
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">ტიპი *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">მშობელი ანგარიში</label>
            <select
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— მთავარი ანგარიში —</option>
              {parentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} – {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">აღწერა</label>
            <input
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="სურვილისამებრ"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {err && (
            <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-5 flex gap-2">
            <Button type="submit" disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editAccount ? "შენახვა" : "დამატება"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              გაუქმება
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 2 — Trial Balance
// ═══════════════════════════════════════════════════════════════════════════════
function TrialBalanceTab({ from, to }: { from: string; to: string }) {
  const [data, setData]     = useState<{ rows: TrialBalanceRow[]; totals: Omit<TrialBalanceRow, "account_code" | "account_name" | "account_type"> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/trial-balance?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("ჩატვირთვა ვერ მოხდა");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  // Memoize row rendering to avoid expensive re-renders on unrelated state changes
  const renderedRows = useMemo(() => {
    if (!data) return null;
    const colCell = "px-3 py-2.5 text-right tabular-nums text-sm";
    return data.rows.map((row) => (
      <tr key={row.account_code} className="border-t border-border hover:bg-muted/30 transition-colors">
        <td className="px-3 py-2.5 font-mono font-semibold text-primary">{row.account_code}</td>
        <td className="px-3 py-2.5 font-medium">
          <div>{row.account_name}</div>
          <div className="text-xs text-muted-foreground capitalize">{TYPE_LABELS[row.account_type as AccountType] ?? row.account_type}</div>
        </td>
        <td className={cn(colCell, "text-muted-foreground")}>{row.opening_debit > 0 ? fmt(row.opening_debit) : "—"}</td>
        <td className={cn(colCell, "text-muted-foreground")}>{row.opening_credit > 0 ? fmt(row.opening_credit) : "—"}</td>
        <td className={cn(colCell, "text-blue-700 font-medium")}>{row.period_debit > 0 ? fmt(row.period_debit) : "—"}</td>
        <td className={cn(colCell, "text-red-600 font-medium")}>{row.period_credit > 0 ? fmt(row.period_credit) : "—"}</td>
        <td className={colCell}>{row.closing_debit > 0 ? fmt(row.closing_debit) : "—"}</td>
        <td className={colCell}>{row.closing_credit > 0 ? fmt(row.closing_credit) : "—"}</td>
      </tr>
    ));
  }, [data]);

  const colHead = "px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide";
  const colCell = "px-3 py-2.5 text-right tabular-nums text-sm";

  const exportUrl = (format: "xlsx" | "pdf") =>
    `/api/accounting/trial-balance/export?from=${from}&to=${to}&format=${format}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              ბრუნვითი უწყისი
            </CardTitle>
            <CardDescription>
              {from} — {to} · ყველა ანგარიშზე დებეტ/კრედიტ ბრუნვები
            </CardDescription>
          </div>
          {data && data.rows.length > 0 && (
            <div className="flex gap-2 shrink-0">
              <a href={exportUrl("xlsx")} download>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  Excel
                </Button>
              </a>
              <a href={exportUrl("pdf")} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileText className="h-4 w-4 text-red-600" />
                  PDF
                </Button>
              </a>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            იტვირთება...
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {!loading && !error && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">კოდი</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">ანგარიში</th>
                  <th className={colHead}>გახსნ. დებ.</th>
                  <th className={colHead}>გახსნ. კრედ.</th>
                  <th className={colHead}>პერ. დებ.</th>
                  <th className={colHead}>პერ. კრედ.</th>
                  <th className={colHead}>დახ. დებ.</th>
                  <th className={colHead}>დახ. კრედ.</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground text-sm">
                      ამ პერიოდში გატარებები არ არის
                    </td>
                  </tr>
                )}
                {renderedRows}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                  <td colSpan={2} className="px-3 py-2.5 text-sm">სულ</td>
                  <td className={colCell}>{fmt(data.totals.opening_debit)}</td>
                  <td className={colCell}>{fmt(data.totals.opening_credit)}</td>
                  <td className={cn(colCell, "text-blue-700")}>{fmt(data.totals.period_debit)}</td>
                  <td className={cn(colCell, "text-red-600")}>{fmt(data.totals.period_credit)}</td>
                  <td className={colCell}>{fmt(data.totals.closing_debit)}</td>
                  <td className={colCell}>{fmt(data.totals.closing_credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 3 — Profit & Loss
// ═══════════════════════════════════════════════════════════════════════════════
function ProfitLossTab({ from, to }: { from: string; to: string }) {
  const [data, setData]             = useState<ProfitLossResponse | null>(null);
  const [vatData, setVatData]       = useState<VatSummaryResponse | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [expOpen, setExpOpen]       = useState(true);
  const [ncExpOpen, setNcExpOpen]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plRes, vatRes] = await Promise.all([
        fetch(`/api/accounting/profit-loss?from=${from}&to=${to}`),
        fetch(`/api/accounting/vat?from=${from}&to=${to}`),
      ]);
      if (!plRes.ok) throw new Error("ჩატვირთვა ვერ მოხდა");
      setData(await plRes.json());
      if (vatRes.ok) setVatData(await vatRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  // Memoize KPI cards to avoid re-renders when expOpen toggled
  const kpiCards = useMemo(() => {
    if (!data) return null;
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="შემოსავალი" value={`₾ ${fmt(data.revenue.total)}`} color="text-green-700" bgColor="bg-green-50" />
          <KpiCard label="მთლიანი მოგება" value={`₾ ${fmt(data.gross_profit)}`} sub={`მარჟა ${data.gross_margin_pct.toFixed(1)}%`} color={data.gross_profit >= 0 ? "text-blue-700" : "text-red-600"} bgColor={data.gross_profit >= 0 ? "bg-blue-50" : "bg-red-50"} />
          <KpiCard label="ნაღდი ხარჯები" value={`₾ ${fmt(data.total_cash_expenses)}`} sub={data.total_non_cash_expenses > 0 ? `+ ჩამოწ. ₾${fmt(data.total_non_cash_expenses)}` : undefined} color="text-orange-700" bgColor="bg-orange-50" />
          <KpiCard label="წმინდა მოგება" value={`₾ ${fmt(data.net_profit)}`} sub={`მარჟა ${data.net_margin_pct.toFixed(1)}%`} color={data.net_profit >= 0 ? "text-green-700" : "text-red-600"} bgColor={data.net_profit >= 0 ? "bg-green-50" : "bg-red-50"} />
        </div>
        {vatData && (
          <Card className="border-purple-200 bg-purple-50/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="h-4 w-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-900">მიმდინარე თვის დღგ (18%)</span>
                <span className="text-xs text-muted-foreground">{from} — {to}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">შემოსული დღგ (გაყიდვებიდან)</p>
                  <p className="text-lg font-bold tabular-nums text-green-700">₾ {fmt(vatData.vat_collected)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">გადახდილი დღგ (ხარჯებიდან)</p>
                  <p className="text-lg font-bold tabular-nums text-orange-700">₾ {fmt(vatData.vat_paid)}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">ბიუჯეტში გადასახდელი</p>
                  <p className={cn("text-lg font-bold tabular-nums", vatData.vat_payable >= 0 ? "text-purple-700" : "text-green-600")}>
                    {vatData.vat_payable < 0 ? "− " : ""}₾ {fmt(Math.abs(vatData.vat_payable))}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </>
    );
  }, [data, vatData, from, to]);

  const exportUrl = (format: "xlsx" | "pdf") =>
    `/api/accounting/profit-loss/export?from=${from}&to=${to}&format=${format}`;

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          იტვირთება...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* KPI chips */}
          {kpiCards}

          {/* Detailed P&L report */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    მოგება-ზარალის ანგარიში
                  </CardTitle>
                  <CardDescription>{data.period.from} — {data.period.to}</CardDescription>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a href={exportUrl("xlsx")} download>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      Excel
                    </Button>
                  </a>
                  <a href={exportUrl("pdf")} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <FileText className="h-4 w-4 text-red-600" />
                      PDF
                    </Button>
                  </a>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-0">

              {/* Revenue */}
              <PLSection label="საოპერაციო შემოსავლები" accent="green">
                <PLRow label="გაყიდვების შემოსავალი" value={data.revenue.sales_revenue} />
                <PLTotalRow label="სულ შემოსავალი" value={data.revenue.total} positive />
              </PLSection>

              {/* COGS */}
              <PLSection label="გაყიდვების თვითღირებულება" accent="orange">
                <PLRow label="საქონლის ღირებულება (COGS)" value={data.cost_of_goods_sold.cogs} negative />
                <PLTotalRow label="სულ COGS" value={-data.cost_of_goods_sold.total} />
              </PLSection>

              {/* Gross profit line */}
              <div className="flex justify-between items-center px-4 py-3 bg-blue-50 border-y border-blue-100 font-semibold">
                <span className="text-blue-900">მთლიანი მოგება</span>
                <span className={cn("tabular-nums text-base", data.gross_profit >= 0 ? "text-blue-700" : "text-red-600")}>
                  {data.gross_profit < 0 ? "− " : ""}₾ {fmt(Math.abs(data.gross_profit))}
                  <span className="ml-2 text-xs font-normal text-blue-500">
                    ({data.gross_margin_pct.toFixed(1)}%)
                  </span>
                </span>
              </div>

              {/* Cash Expenses */}
              <PLSection
                label="ნაღდი / გადახდილი ხარჯები"
                accent="red"
                collapsible
                open={expOpen}
                onToggle={() => setExpOpen((v) => !v)}
              >
                {data.cash_expenses.map((exp) => (
                  <PLRow key={exp.category} label={exp.category} value={exp.amount} negative />
                ))}
                {data.cash_expenses.length === 0 && (
                  <div className="px-4 py-2 text-sm text-muted-foreground">ნაღდი ხარჯები არ არის</div>
                )}
                <PLTotalRow label="სულ ნაღდი ხარჯები" value={-data.total_cash_expenses} />
              </PLSection>

              {/* Non-Cash Expenses / Write-offs */}
              <PLSection
                label="ჩამოწერები / ინვენტარის ნაკლოვანებები"
                accent="orange"
                collapsible
                open={ncExpOpen}
                onToggle={() => setNcExpOpen((v) => !v)}
              >
                {data.non_cash_expenses.map((exp) => (
                  <PLRow key={exp.category} label={exp.category} value={exp.amount} negative />
                ))}
                {data.non_cash_expenses.length === 0 && (
                  <div className="px-4 py-2 text-sm text-muted-foreground">ჩამოწერა არ არის</div>
                )}
                <PLTotalRow label="სულ ჩამოწერები" value={-data.total_non_cash_expenses} />
              </PLSection>

              {/* Net profit line */}
              <div className={cn(
                "flex justify-between items-center px-4 py-4 rounded-b-xl font-bold text-base",
                data.net_profit >= 0 ? "bg-green-50" : "bg-red-50",
              )}>
                <span className={data.net_profit >= 0 ? "text-green-900" : "text-red-900"}>
                  წმინდა მოგება
                </span>
                <span className={data.net_profit >= 0 ? "text-green-700" : "text-red-600"}>
                  {data.net_profit < 0 ? "− " : ""}₾ {fmt(Math.abs(data.net_profit))}
                  <span className="ml-2 text-sm font-normal opacity-70">
                    ({data.net_margin_pct.toFixed(1)}%)
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── P&L sub-components ───────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color, bgColor,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className={cn("rounded-xl p-4 space-y-1", bgColor)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PLSection({
  label, accent, children, collapsible, open, onToggle,
}: {
  label: string;
  accent: "green" | "orange" | "red";
  children: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const accentClass = {
    green:  "text-green-800 bg-green-50/60 border-green-100",
    orange: "text-orange-800 bg-orange-50/60 border-orange-100",
    red:    "text-red-800 bg-red-50/60 border-red-100",
  }[accent];

  return (
    <div className="border-t border-border">
      <button
        onClick={onToggle}
        disabled={!collapsible}
        className={cn(
          "w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold border-b",
          accentClass,
          collapsible && "cursor-pointer hover:opacity-80",
        )}
      >
        <span>{label}</span>
        {collapsible && (
          open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {(!collapsible || open) && children}
    </div>
  );
}

function PLRow({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex justify-between items-center px-6 py-2 text-sm border-b border-border/50 hover:bg-muted/20">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", negative ? "text-red-600" : "text-foreground")}>
        {negative ? "− " : ""}₾ {fmt(Math.abs(value))}
      </span>
    </div>
  );
}

function PLTotalRow({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <div className="flex justify-between items-center px-4 py-2 font-semibold text-sm bg-muted/30">
      <span>{label}</span>
      <span className={cn(
        "tabular-nums",
        positive ? "text-green-700" : value < 0 ? "text-red-600" : "text-foreground",
      )}>
        {value < 0 ? "− " : ""}₾ {fmt(Math.abs(value))}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tab 4/5 — Debtors / Creditors
// ═══════════════════════════════════════════════════════════════════════════════
function PartnerTab({ type }: { type: "debtor" | "creditor" }) {
  const [partners, setPartners]         = useState<PartnerRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [payTarget, setPayTarget]       = useState<PartnerRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/partners?type=${type}`);
      if (!res.ok) throw new Error("ჩატვირთვა ვერ მოხდა");
      setPartners(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { void load(); }, [load]);

  const totalOpening   = partners.reduce((s, p) => s + p.opening_balance, 0);
  const totalPaid      = partners.reduce((s, p) => s + p.paid_amount, 0);
  const totalRemaining = partners.reduce((s, p) => s + p.remaining, 0);
  const label          = type === "debtor" ? "დებიტორი" : "კრედიტორი";

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl p-4 bg-blue-50 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">საწყისი დავალიანება</p>
          <p className="text-xl font-bold tabular-nums text-blue-700">₾ {fmt(totalOpening)}</p>
        </div>
        <div className="rounded-xl p-4 bg-green-50 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">დაფარული თანხა</p>
          <p className="text-xl font-bold tabular-nums text-green-700">₾ {fmt(totalPaid)}</p>
        </div>
        <div className={cn("rounded-xl p-4 space-y-1", totalRemaining > 0 ? "bg-red-50" : "bg-green-50")}>
          <p className="text-xs font-medium text-muted-foreground">მიმდინარე ნაშთი</p>
          <p className={cn("text-xl font-bold tabular-nums", totalRemaining > 0 ? "text-red-600" : "text-green-700")}>
            ₾ {fmt(totalRemaining)}
          </p>
        </div>
      </div>

      {/* Add button */}
      <div className="flex justify-end">
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4" />
          ახალი {label}ის ჩანაწერი
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              იტვირთება...
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">კონტრაგენტი</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">საწყისი დავალიანება</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">დაფარული თანხა</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">დარჩენილი ნაშთი</th>
                    <th className="px-4 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {partners.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                        {label}ები არ არის. დაამატეთ პირველი ჩანაწერი.
                      </td>
                    </tr>
                  )}
                  {partners.map((p) => (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        {p.phone && (
                          <div className="text-xs text-muted-foreground">{p.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(p.opening_balance)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-700">{fmt(p.paid_amount)}</td>
                      <td className={cn(
                        "px-4 py-3 text-right tabular-nums font-semibold",
                        p.remaining > 0 ? "text-red-600" : "text-green-700",
                      )}>
                        {fmt(p.remaining)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPayTarget(p)}
                          className="h-7 text-xs gap-1"
                          disabled={p.remaining <= 0}
                        >
                          <CreditCard className="h-3 w-3" />
                          გადახდა
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {partners.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                      <td className="px-4 py-2.5 text-sm">სულ</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm">{fmt(totalOpening)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm text-green-700">{fmt(totalPaid)}</td>
                      <td className={cn(
                        "px-4 py-2.5 text-right tabular-nums text-sm font-bold",
                        totalRemaining > 0 ? "text-red-600" : "text-green-700",
                      )}>
                        {fmt(totalRemaining)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showAddModal && (
        <AddEntryModal
          partnerType={type}
          existingPartners={partners}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); void load(); }}
        />
      )}
      {payTarget && (
        <PaymentModal
          partner={payTarget}
          onClose={() => setPayTarget(null)}
          onSaved={() => { setPayTarget(null); void load(); }}
        />
      )}
    </div>
  );
}

// ─── Add Entry Modal ──────────────────────────────────────────────────────────
function AddEntryModal({
  partnerType,
  existingPartners,
  onClose,
  onSaved,
}: {
  partnerType: "debtor" | "creditor";
  existingPartners: PartnerRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode]             = useState<"new" | "existing">("new");
  const [partnerId, setPartnerId]   = useState<number | null>(null);
  const [name, setName]             = useState("");
  const [phone, setPhone]           = useState("");
  const [amount, setAmount]         = useState("");
  const [description, setDesc]      = useState("");
  const [date, setDate]             = useState(today());
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const label = partnerType === "debtor" ? "დებიტორი" : "კრედიტორი";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
    setSaving(true);
    try {
      if (mode === "new") {
        if (!name.trim()) { setErr("სახელი სავალდებულოა"); setSaving(false); return; }
        const res = await fetch("/api/accounting/partners", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            type: partnerType,
            phone: phone || undefined,
            initial_amount: amountNum,
            initial_description: description || undefined,
            initial_date: date,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setErr(data.error ?? "შეცდომა"); return; }
      } else {
        if (!partnerId) { setErr("კონტრაგენტი აირჩიეთ"); setSaving(false); return; }
        const res = await fetch(`/api/accounting/partners/${partnerId}/transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tx_type: "debit",
            amount: amountNum,
            description: description || undefined,
            tx_date: date,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setErr(data.error ?? "შეცდომა"); return; }
      }
      onSaved();
    } catch {
      setErr("შეცდომა");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-2xl shadow-2xl w-full max-w-md border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold">ახალი {label}ის ჩანაწერი</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {(["new", "existing"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 py-1.5 rounded-md text-sm font-medium transition-all",
                  mode === m
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "new" ? "ახალი კონტრაგენტი" : "არსებული"}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">სახელი / კომპანია *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">ტელეფონი</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="სურვილისამებრ"
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">კონტრაგენტი *</label>
              <select
                value={partnerId ?? ""}
                onChange={(e) => setPartnerId(Number(e.target.value) || null)}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— აირჩიეთ კონტრაგენტი —</option>
                {existingPartners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">თანხა (₾) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">თარიღი</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">აღწერა</label>
            <input
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="სურვილისამებრ"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              შენახვა
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>გაუქმება</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function PaymentModal({
  partner,
  onClose,
  onSaved,
}: {
  partner: PartnerRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");
  const [date, setDate]     = useState(today());
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounting/partners/${partner.id}/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_type: "credit",
          amount: amountNum,
          description: note || "გადახდა",
          tx_date: date,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "შეცდომა"); return; }
      onSaved();
    } catch {
      setErr("შეცდომა");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-2xl shadow-2xl w-full max-w-sm border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">თანხის დაფარვა</h2>
            <p className="text-sm text-muted-foreground">
              {partner.name} · ნაშთი ₾ {fmt(partner.remaining)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">თანხა (₾) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`მაქს. ${fmt(partner.remaining)}`}
                required
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">თარიღი</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">შენიშვნა</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="სურვილისამებრ"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              გადახდის ჩაწერა
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>გაუქმება</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

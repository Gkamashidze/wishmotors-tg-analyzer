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
  const [partners, setPartners]               = useState<PartnerRow[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [showAddModal, setShowAddModal]       = useState(false);
  const [payTarget, setPayTarget]             = useState<PartnerRow | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);

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
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">ვალუტა</th>
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
                    <tr
                      key={p.id}
                      className="border-t border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedPartnerId(p.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        {p.phone && (
                          <div className="text-xs text-muted-foreground">{p.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                          p.primary_currency === "GEL"
                            ? "bg-green-100 text-green-800"
                            : p.primary_currency === "USD"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-purple-100 text-purple-800",
                        )}>
                          {p.primary_currency ?? "GEL"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {p.primary_currency !== "GEL" && p.total_original_foreign > 0
                          ? <><span className="text-muted-foreground text-xs mr-1">{p.primary_currency}</span>{fmt(p.total_original_foreign)}</>
                          : fmt(p.opening_balance)
                        }
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-green-700">{fmt(p.paid_amount)}</td>
                      <td className={cn(
                        "px-4 py-3 text-right tabular-nums font-semibold",
                        p.remaining > 0 ? "text-red-600" : "text-green-700",
                      )}>
                        ₾ {fmt(p.remaining)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setPayTarget(p); }}
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
                      <td></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm">{fmt(totalOpening)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-sm text-green-700">{fmt(totalPaid)}</td>
                      <td className={cn(
                        "px-4 py-2.5 text-right tabular-nums text-sm font-bold",
                        totalRemaining > 0 ? "text-red-600" : "text-green-700",
                      )}>
                        ₾ {fmt(totalRemaining)}
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
      {selectedPartnerId !== null && (
        <PartnerDetailDrawer
          partnerId={selectedPartnerId}
          onClose={() => setSelectedPartnerId(null)}
          onPayment={(p) => { setSelectedPartnerId(null); setPayTarget(p); }}
          partners={partners}
        />
      )}
    </div>
  );
}

// ─── Partner Detail Drawer ────────────────────────────────────────────────────
type PartnerDetail = {
  partner: {
    id: number;
    name: string;
    type: string;
    phone: string | null;
    note: string | null;
    is_active: boolean;
  };
  transactions: Array<{
    id: number;
    tx_type: "debit" | "credit";
    amount: number;
    description: string | null;
    tx_date: string;
    currency: string;
    original_amount: number | null;
    exchange_rate: number;
    created_at: string;
  }>;
};

function PartnerDetailDrawer({
  partnerId,
  onClose,
  onPayment,
  partners,
}: {
  partnerId: number;
  onClose: () => void;
  onPayment: (p: PartnerRow) => void;
  partners: PartnerRow[];
}) {
  const [data, setData]       = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/accounting/partners/${partnerId}`)
      .then((r) => r.json())
      .then((d) => setData(d as PartnerDetail))
      .catch(() => setError("ჩატვირთვა ვერ მოხდა"))
      .finally(() => setLoading(false));
  }, [partnerId]);

  const partnerRow = partners.find((p) => p.id === partnerId);
  const totalDebit  = data?.transactions.filter((t) => t.tx_type === "debit").reduce((s, t) => s + Number(t.amount), 0) ?? 0;
  const totalCredit = data?.transactions.filter((t) => t.tx_type === "credit").reduce((s, t) => s + Number(t.amount), 0) ?? 0;
  const balance     = totalDebit - totalCredit;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-lg bg-background border-l border-border shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="text-base font-semibold">{data?.partner.name ?? "..."}</p>
            {data?.partner.phone && (
              <p className="text-xs text-muted-foreground">{data.partner.phone}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {partnerRow && balance > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onPayment(partnerRow)}>
                <CreditCard className="h-3 w-3" />
                გადახდა
              </Button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 px-5 py-3 border-b border-border shrink-0">
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">ჯამი</p>
            <p className="text-sm font-bold text-blue-700 dark:text-blue-300 tabular-nums">₾ {fmt(totalDebit)}</p>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">გადახდილი</p>
            <p className="text-sm font-bold text-green-700 dark:text-green-300 tabular-nums">₾ {fmt(totalCredit)}</p>
          </div>
          <div className={cn("rounded-lg p-2 text-center", balance > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-green-50 dark:bg-green-950/30")}>
            <p className="text-[10px] text-muted-foreground">ნაშთი</p>
            <p className={cn("text-sm font-bold tabular-nums", balance > 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-300")}>₾ {fmt(balance)}</p>
          </div>
        </div>

        {/* Transaction list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              იტვირთება...
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive p-3 rounded-lg bg-destructive/10">{error}</div>
          )}
          {!loading && !error && data?.transactions.length === 0 && (
            <p className="text-sm text-center text-muted-foreground py-12">ტრანზაქციები არ არის</p>
          )}
          {!loading && !error && data?.transactions.map((tx) => (
            <div
              key={tx.id}
              className={cn(
                "rounded-lg border px-3 py-2.5 flex items-start justify-between gap-3",
                tx.tx_type === "debit"
                  ? "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
                  : "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20",
              )}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">
                  {tx.description ?? (tx.tx_type === "debit" ? "ჩანაწერი" : "გადახდა")}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(tx.tx_date).toLocaleDateString("ka-GE", { day: "2-digit", month: "short", year: "numeric" })}
                  {tx.currency !== "GEL" && tx.original_amount != null && (
                    <span className="ml-1.5 text-muted-foreground/70">
                      {tx.currency} {Number(tx.original_amount).toFixed(2)} × {Number(tx.exchange_rate).toFixed(4)}
                    </span>
                  )}
                </p>
              </div>
              <div className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                tx.tx_type === "debit" ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-300",
              )}>
                {tx.tx_type === "debit" ? "+" : "−"} ₾ {fmt(Number(tx.amount))}
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const [mode, setMode]           = useState<"new" | "existing">("new");
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [name, setName]           = useState("");
  const [phone, setPhone]         = useState("");
  const [foreignAmount, setForeignAmount] = useState("");
  const [currency, setCurrency]   = useState("GEL");
  const [fxRate, setFxRate]       = useState("");
  const [description, setDesc]    = useState("");
  const [date, setDate]           = useState(today());
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const label      = partnerType === "debtor" ? "დებიტორი" : "კრედიტორი";
  const isForeign  = currency !== "GEL";
  const rate       = parseFloat(fxRate) || 0;
  const foreign    = parseFloat(foreignAmount) || 0;
  const gelPreview = isForeign ? foreign * rate : foreign;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (isForeign) {
      if (foreign <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
      if (rate <= 0)    { setErr("კურსი უნდა იყოს > 0"); return; }
    } else {
      if (foreign <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
    }

    const gelAmount = isForeign ? foreign * rate : foreign;

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
            initial_amount: gelAmount,
            initial_description: description || undefined,
            initial_date: date,
            currency,
            exchange_rate: isForeign ? rate : 1.0,
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
            amount: gelAmount,
            currency,
            original_amount: isForeign ? foreign : gelAmount,
            exchange_rate: isForeign ? rate : 1.0,
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

          {/* Currency selector */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ვალუტა</label>
              <select
                value={currency}
                onChange={(e) => { setCurrency(e.target.value); setFxRate(""); }}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="GEL">GEL ₾</option>
                <option value="USD">USD $</option>
                <option value="EUR">EUR €</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {isForeign ? `თანხა (${currency}) *` : "თანხა (₾) *"}
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={foreignAmount}
                onChange={(e) => setForeignAmount(e.target.value)}
                required
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {isForeign && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">კურსი ({currency}→₾) *</label>
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder="2.80"
                  required
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>

          {/* GEL preview when foreign currency */}
          {isForeign && gelPreview > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-sm">
              <span className="text-muted-foreground">GEL ექვივ.:</span>
              <span className="font-semibold text-blue-700">₾ {fmt(gelPreview)}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {fmt(foreign)} {currency} × {rate}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">თარიღი</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="col-span-2 space-y-1 sm:col-span-1">
              <label className="text-xs font-medium text-muted-foreground">აღწერა</label>
              <input
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="სურვილისამებრ"
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
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
  const isForeign      = (partner.primary_currency ?? "GEL") !== "GEL";
  const origRate       = partner.original_exchange_rate ?? 1.0;
  const partnerCcy     = partner.primary_currency ?? "GEL";

  const [foreignAmount, setForeignAmount] = useState("");
  const [paymentRate, setPaymentRate]     = useState(isForeign ? String(origRate) : "");
  const [note, setNote]                   = useState("");
  const [date, setDate]                   = useState(today());
  const [saving, setSaving]               = useState(false);
  const [err, setErr]                     = useState<string | null>(null);

  const foreign   = parseFloat(foreignAmount) || 0;
  const pRate     = parseFloat(paymentRate) || 0;
  const gelAmount = isForeign ? foreign * pRate : foreign;
  const fxDiff    = isForeign && pRate > 0 ? (pRate - origRate) * foreign : 0;
  const isLoss    = fxDiff > 0.005;
  const isGain    = fxDiff < -0.005;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (isForeign) {
      if (foreign <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
      if (pRate <= 0)   { setErr("კურსი უნდა იყოს > 0"); return; }
    } else {
      if (foreign <= 0) { setErr("სწორი თანხა შეიყვანეთ"); return; }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounting/partners/${partner.id}/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_type:               "credit",
          amount:                gelAmount,
          currency:              isForeign ? partnerCcy : "GEL",
          original_amount:       isForeign ? foreign : gelAmount,
          exchange_rate:         isForeign ? pRate : 1.0,
          payment_exchange_rate: isForeign ? pRate : undefined,
          description:           note || "გადახდა",
          tx_date:               date,
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
            {isForeign && (
              <p className="text-xs text-blue-600 font-medium mt-0.5">
                💱 ვალუტა: {partnerCcy} · საინვ. კურსი: {fmt(origRate)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {isForeign ? `თანხა (${partnerCcy}) *` : "თანხა (₾) *"}
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={foreignAmount}
                onChange={(e) => setForeignAmount(e.target.value)}
                placeholder={isForeign ? `${partnerCcy} თანხა` : `მაქს. ${fmt(partner.remaining)}`}
                required
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {isForeign ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  დღევ. კურსი ({partnerCcy}→₾) *
                </label>
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={paymentRate}
                  onChange={(e) => setPaymentRate(e.target.value)}
                  placeholder="2.85"
                  required
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">თარიღი</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>

          {/* FX breakdown — shown when foreign currency and amounts entered */}
          {isForeign && foreign > 0 && pRate > 0 && (
            <div className="rounded-lg border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>GEL ექვივ. ({fmt(foreign)} × {pRate})</span>
                <span className="font-medium text-foreground">₾ {fmt(gelAmount)}</span>
              </div>
              {(isLoss || isGain) && (
                <div className={cn(
                  "flex justify-between font-semibold rounded px-2 py-1",
                  isLoss ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700",
                )}>
                  <span>
                    {isLoss ? "⬆ სავალ. ზარალი" : "⬇ სავალ. მოგება"}
                    <span className="font-normal text-xs ml-1">
                      ({fmt(foreign)} × ({pRate} − {origRate}))
                    </span>
                  </span>
                  <span>₾ {fmt(Math.abs(fxDiff))}</span>
                </div>
              )}
              {!isLoss && !isGain && (
                <div className="text-xs text-muted-foreground text-center">სავალუტო სხვაობა არ არის</div>
              )}
            </div>
          )}

          {isForeign && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">თარიღი</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}

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
              გადახდის ჩაწერა{isForeign && gelAmount > 0 ? ` (₾ ${fmt(gelAmount)})` : ""}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>გაუქმება</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

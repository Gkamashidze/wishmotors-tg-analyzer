"use client";

import { useState, useEffect, useCallback } from "react";
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
  AlertCircle,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartOfAccount, AccountType } from "@/app/api/accounting/chart-of-accounts/route";
import type { TrialBalanceRow } from "@/app/api/accounting/trial-balance/route";
import type { ProfitLossResponse } from "@/app/api/accounting/profit-loss/route";

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
type Tab = "chart" | "trial" | "pl";

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
            <div className="flex gap-1 mt-4 p-1 bg-muted rounded-xl w-fit">
              {(
                [
                  { id: "chart", label: "ანგარიშთა გეგმა",  icon: BookOpen  },
                  { id: "trial", label: "ბრუნვითი უწყისი",  icon: Scale     },
                  { id: "pl",    label: "მოგება-ზარალი",    icon: TrendingUp },
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
        {tab === "chart" && <ChartOfAccountsTab />}
        {tab === "trial" && <TrialBalanceTab from={from} to={to} />}
        {tab === "pl"    && <ProfitLossTab    from={from} to={to} />}
      </main>
    </>
  );
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
                  {group.map((acc) => (
                    <tr
                      key={acc.id}
                      className={cn(
                        "border-t border-border hover:bg-muted/30 transition-colors",
                        !acc.is_active && "opacity-50",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-primary">{acc.code}</td>
                      <td className="px-4 py-2.5 font-medium">{acc.name}</td>
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
  onSave,
  onCancel,
}: {
  editAccount?: ChartOfAccount;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [code, setCode]           = useState(editAccount?.code ?? "");
  const [name, setName]           = useState(editAccount?.name ?? "");
  const [type, setType]           = useState<AccountType>(editAccount?.type ?? "asset");
  const [description, setDesc]    = useState(editAccount?.description ?? "");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

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
        body: JSON.stringify({ code, name, type, description }),
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
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              {ORDER.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
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
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
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

  const colHead = "px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide";
  const colCell = "px-3 py-2.5 text-right tabular-nums text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" />
          ბრუნვითი უწყისი
        </CardTitle>
        <CardDescription>
          {from} — {to} · ყველა ანგარიშზე დებეტ/კრედიტ ბრუნვები
        </CardDescription>
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
                {data.rows.map((row) => (
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
                ))}
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
  const [data, setData]       = useState<ProfitLossResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [expOpen, setExpOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/profit-loss?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("ჩატვირთვა ვერ მოხდა");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="შემოსავალი"
              value={`₾ ${fmt(data.revenue.total)}`}
              color="text-green-700"
              bgColor="bg-green-50"
            />
            <KpiCard
              label="მთლიანი მოგება"
              value={`₾ ${fmt(data.gross_profit)}`}
              sub={`მარჟა ${data.gross_margin_pct.toFixed(1)}%`}
              color={data.gross_profit >= 0 ? "text-blue-700" : "text-red-600"}
              bgColor={data.gross_profit >= 0 ? "bg-blue-50" : "bg-red-50"}
            />
            <KpiCard
              label="ჯამური ხარჯი"
              value={`₾ ${fmt(data.total_expenses)}`}
              color="text-orange-700"
              bgColor="bg-orange-50"
            />
            <KpiCard
              label="წმინდა მოგება"
              value={`₾ ${fmt(data.net_profit)}`}
              sub={`მარჟა ${data.net_margin_pct.toFixed(1)}%`}
              color={data.net_profit >= 0 ? "text-green-700" : "text-red-600"}
              bgColor={data.net_profit >= 0 ? "bg-green-50" : "bg-red-50"}
            />
          </div>

          {/* Detailed P&L report */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-5 w-5 text-primary" />
                მოგება-ზარალის ანგარიში
              </CardTitle>
              <CardDescription>{data.period.from} — {data.period.to}</CardDescription>
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

              {/* Expenses */}
              <PLSection
                label="საოპერაციო ხარჯები"
                accent="red"
                collapsible
                open={expOpen}
                onToggle={() => setExpOpen((v) => !v)}
              >
                {data.expenses.map((exp) => (
                  <PLRow key={exp.category} label={exp.category} value={exp.amount} negative />
                ))}
                {data.expenses.length === 0 && (
                  <div className="px-4 py-2 text-sm text-muted-foreground">ხარჯები არ არის</div>
                )}
                <PLTotalRow label="სულ ხარჯები" value={-data.total_expenses} />
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

"use client";

import { useState, useCallback, useEffect } from "react";
import { Settings2, Banknote, Building2, RefreshCw, FileText, TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { AccountBalance } from "@/app/api/account-balances/route";
import type { AccountStatement, StatementEntry } from "@/app/api/account-balances/[accountKey]/statement/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatAmount(amount: number, currency: string) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  return (
    new Intl.NumberFormat("ka-GE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + " ₾"
  );
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  return [
    d.getDate().toString().padStart(2, "0"),
    (d.getMonth() + 1).toString().padStart(2, "0"),
    d.getFullYear(),
  ].join(".");
}

function balanceTone(amount: number): string {
  if (amount > 0) return "text-success";
  if (amount < 0) return "text-destructive";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Balance card (single account) — clickable
// ---------------------------------------------------------------------------
function BalanceCard({
  item,
  onClick,
}: {
  item: AccountBalance;
  onClick: () => void;
}) {
  const isBank = item.account_key.startsWith("bank");
  const Icon = isBank ? Building2 : Banknote;
  const iconBg = isBank
    ? "bg-blue-500/10 text-blue-500 ring-blue-500/10"
    : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/10";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${item.account_name} ${item.currency} — ამონაწერის ნახვა`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={[
        "transition-all duration-150 cursor-pointer select-none",
        "hover:shadow-md hover:ring-2 hover:ring-primary/30",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      ].join(" ")}
    >
      <CardContent className="p-3 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">
              {item.account_name}
            </p>
            <p className="mt-0.5 text-[10px] sm:text-[11px] text-muted-foreground/60">
              {item.currency}
            </p>
            <p
              className={`mt-1.5 text-base sm:text-xl font-bold tabular-nums ${balanceTone(item.current_balance)}`}
            >
              {formatAmount(item.current_balance, item.currency)}
            </p>
            <p className="mt-1 text-[10px] sm:text-[11px] text-muted-foreground">
              საწყისი: {formatAmount(item.initial_balance, item.currency)}
            </p>
          </div>
          <div
            className={`h-8 w-8 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center ring-1 shrink-0 ${iconBg}`}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </div>
        </div>
        <div className="mt-2 sm:mt-3 hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <FileText className="h-3 w-3" />
          <span>ამონაწერის სანახავად დააჭირეთ</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Statement Modal
// ---------------------------------------------------------------------------
function StatementModal({
  accountKey,
  onClose,
}: {
  accountKey: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<AccountStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountKey) return;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/account-balances/${accountKey}/statement`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<AccountStatement>;
      })
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "შეცდომა"),
      )
      .finally(() => setLoading(false));
  }, [accountKey]);

  const lastEntry = data?.entries.at(-1);
  const currency = data?.currency ?? "GEL";

  return (
    <Dialog
      open={!!accountKey}
      onClose={onClose}
      title={
        data
          ? `ანგარიშის ამონაწერი — ${data.account_name} (${data.currency})`
          : "ანგარიშის ამონაწერი"
      }
      className="max-w-4xl"
    >
      {/* Summary strip */}
      {data && lastEntry && (
        <div className="flex flex-wrap gap-4 mb-5 p-3 rounded-lg bg-muted/40 border border-border">
          <SummaryStat
            label="მიმდინარე ნაშთი"
            value={formatAmount(lastEntry.balance, currency)}
            tone={balanceTone(lastEntry.balance)}
          />
          <SummaryStat
            label="სულ შემოსავალი"
            value={formatAmount(
              data.entries.slice(1).reduce((s, e) => s + e.credit, 0),
              currency,
            )}
            tone="text-success"
          />
          <SummaryStat
            label="სულ გასავალი"
            value={formatAmount(
              data.entries.slice(1).reduce((s, e) => s + e.debit, 0),
              currency,
            )}
            tone="text-destructive"
          />
          <SummaryStat
            label="ტრანზაქციები"
            value={String(data.entries.length - 1)}
            tone="text-foreground"
          />
        </div>
      )}

      {/* Loading / error states */}
      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>იტვირთება...</span>
        </div>
      )}

      {error && (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      )}

      {/* Table */}
      {data && !loading && (
        <div className="overflow-auto max-h-[55vh] rounded-lg border border-border">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
              <tr>
                <Th>თარიღი</Th>
                <Th grow>ოპერაცია / დანიშნულება</Th>
                <Th right>შემოსავალი (+)</Th>
                <Th right>გასავალი (−)</Th>
                <Th right>ნაშთი</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry, idx) => (
                <StatementRow
                  key={idx}
                  entry={entry}
                  currency={currency}
                  isInitial={idx === 0}
                />
              ))}
            </tbody>
          </table>

          {data.entries.length === 1 && (
            <p className="text-center text-xs text-muted-foreground py-8">
              ამ ანგარიშზე ჯერ არ არის ტრანზაქციები.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className={`text-sm font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function Th({
  children,
  grow,
  right,
}: {
  children: React.ReactNode;
  grow?: boolean;
  right?: boolean;
}) {
  return (
    <th
      className={[
        "px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border whitespace-nowrap",
        grow ? "w-full text-left" : right ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function StatementRow({
  entry,
  currency,
  isInitial,
}: {
  entry: StatementEntry;
  currency: string;
  isInitial: boolean;
}) {
  const balanceColor = balanceTone(entry.balance);

  return (
    <tr
      className={[
        "border-b border-border/50 transition-colors",
        isInitial
          ? "bg-muted/30 font-medium"
          : "hover:bg-muted/20",
      ].join(" ")}
    >
      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(entry.date)}
      </td>
      <td className="px-3 py-2.5 text-xs max-w-[280px]">
        <div className="flex items-center gap-1.5">
          {isInitial ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-medium">
              საწყისი
            </span>
          ) : entry.credit > 0 ? (
            <TrendingUp className="h-3 w-3 text-success shrink-0" />
          ) : (
            <TrendingDown className="h-3 w-3 text-destructive shrink-0" />
          )}
          <span className="truncate">{entry.description}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-right tabular-nums whitespace-nowrap">
        {entry.credit > 0 ? (
          <span className="text-success font-medium">
            +{formatAmount(entry.credit, currency)}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-right tabular-nums whitespace-nowrap">
        {entry.debit > 0 ? (
          <span className="text-destructive font-medium">
            −{formatAmount(entry.debit, currency)}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </td>
      <td
        className={`px-3 py-2.5 text-xs text-right tabular-nums font-semibold whitespace-nowrap ${balanceColor}`}
      >
        {formatAmount(entry.balance, currency)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Transfer modal
// ---------------------------------------------------------------------------
const ACCOUNT_OPTIONS = [
  { key: "cash_gel", label: "💵 სალარო (GEL)" },
  { key: "bank_gel", label: "🏦 ბანკი (GEL)" },
  { key: "cash_usd", label: "💵 სალარო (USD)" },
  { key: "bank_usd", label: "🏦 ბანკი (USD)" },
];

function TransferModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fromAccount, setFromAccount] = useState("cash_gel");
  const [toAccount, setToAccount] = useState("bank_gel");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setNote("");
    setError(null);
    setFromAccount("cash_gel");
    setToAccount("bank_gel");
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    const parsed = parseFloat(amount.replace(",", "."));
    if (!isFinite(parsed) || parsed <= 0) {
      setError("სწორი თანხა შეიყვანეთ (დადებითი რიცხვი)");
      return;
    }
    if (fromAccount === toAccount) {
      setError("გამგზავნი და მიმღები ანგარიშები სხვადასხვა უნდა იყოს");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_account: fromAccount,
          to_account: toAccount,
          amount: parsed,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "შეცდომა შენახვისას");
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა შენახვისას");
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "w-full h-9 rounded-lg border border-border bg-background px-3 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors";

  return (
    <Dialog open={open} onClose={onClose} title="🔄 ანგარიშებს შორის გადარიცხვა">
      <p className="text-sm text-muted-foreground mb-5">
        თანხა გადაიტანება ერთი ანგარიშიდან მეორეზე. ნაშთები ავტომატურად განახლდება.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">საიდან</label>
          <select
            value={fromAccount}
            onChange={(e) => setFromAccount(e.target.value)}
            className={selectClass}
          >
            {ACCOUNT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">სად</label>
          <select
            value={toAccount}
            onChange={(e) => setToAccount(e.target.value)}
            className={selectClass}
          >
            {ACCOUNT_OPTIONS.filter((o) => o.key !== fromAccount).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">თანხა</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={selectClass + " tabular-nums"}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            შენიშვნა
            <span className="ml-1.5 text-xs text-muted-foreground font-normal">(სურვილისამებრ)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="მაგ: ხელფასი, კომუნალური..."
            className={selectClass}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 mt-6">
        <button
          onClick={onClose}
          disabled={saving}
          className="h-9 px-4 rounded-lg border border-border text-sm font-medium
                     hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
        >
          გაუქმება
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !amount}
          className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                     hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50
                     inline-flex items-center gap-2"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
          {saving ? "ინახება..." : "გადარიცხვა"}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------
interface InitialValues {
  cash_gel: string;
  cash_usd: string;
  bank_gel: string;
  bank_usd: string;
}

function SettingsModal({
  open,
  onClose,
  balances,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  balances: AccountBalance[];
  onSaved: () => void;
}) {
  const [values, setValues] = useState<InitialValues>({
    cash_gel: "0",
    cash_usd: "0",
    bank_gel: "0",
    bank_usd: "0",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const map: Partial<InitialValues> = {};
    for (const b of balances) {
      map[b.account_key as keyof InitialValues] = String(b.initial_balance);
    }
    setValues((prev) => ({ ...prev, ...map }));
    setError(null);
  }, [open, balances]);

  const handleChange = (key: keyof InitialValues, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setError(null);
    const payload = (Object.keys(values) as (keyof InitialValues)[]).map(
      (key) => {
        const num = parseFloat(values[key].replace(",", "."));
        if (isNaN(num)) throw new Error(`${key}: არასწორი მნიშვნელობა`);
        return { account_key: key, initial_balance: num };
      },
    );

    setSaving(true);
    try {
      const res = await fetch("/api/account-balances", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "შეცდომა შენახვისას");
    } finally {
      setSaving(false);
    }
  };

  const fields: { key: keyof InitialValues; label: string; currency: string }[] =
    [
      { key: "cash_gel", label: "სალარო", currency: "GEL (₾)" },
      { key: "cash_usd", label: "სალარო", currency: "USD ($)" },
      { key: "bank_gel", label: "საქართველოს ბანკი", currency: "GEL (₾)" },
      { key: "bank_usd", label: "საქართველოს ბანკი", currency: "USD ($)" },
    ];

  return (
    <Dialog open={open} onClose={onClose} title="საწყისი ნაშთების რედაქტირება">
      <p className="text-sm text-muted-foreground mb-5">
        მიუთითეთ ოთხივე ანგარიშის საწყისი ნაშთი. მიმდინარე ბალანსი
        გამოითვლება ავტომატურად:
        <span className="font-medium">
          {" "}
          საწყისი ნაშთი + შემოსავლები − გასავლები
        </span>
        .
      </p>

      <div className="space-y-4">
        {fields.map(({ key, label, currency }) => (
          <div key={key}>
            <label className="block text-sm font-medium mb-1.5">
              {label}
              <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                {currency}
              </span>
            </label>
            <input
              type="number"
              step="0.01"
              value={values[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                         transition-colors tabular-nums"
              placeholder="0.00"
            />
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 mt-6">
        <button
          onClick={onClose}
          disabled={saving}
          className="h-9 px-4 rounded-lg border border-border text-sm font-medium
                     hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
        >
          გაუქმება
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium
                     hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "ინახება..." : "შენახვა"}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main section component
// ---------------------------------------------------------------------------
export function AccountBalancesSection() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [statementKey, setStatementKey] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account-balances");
      if (res.ok) setBalances(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">მიმდინარე ნაშთები</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                ოთხი ანგარიშის რეალური ბალანსი — დააჭირეთ ამონაწერის სანახავად
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {loading && (
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
              )}
              <button
                onClick={() => setTransferOpen(true)}
                title="ანგარიშებს შორის გადარიცხვა"
                aria-label="ანგარიშებს შორის გადარიცხვა"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-primary/40
                           text-xs font-medium text-primary hover:bg-primary/10
                           transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                გადარიცხვა
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                title="საწყისი ნაშთების შეცვლა"
                aria-label="საწყისი ნაშთების შეცვლა"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border
                           text-xs font-medium text-muted-foreground hover:text-foreground
                           hover:bg-accent transition-colors cursor-pointer"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                პარამეტრები
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div
            className={[
              "grid grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-200",
              loading ? "opacity-40 pointer-events-none" : "opacity-100",
            ].join(" ")}
          >
            {balances.length > 0
              ? balances.map((b) => (
                  <BalanceCard
                    key={b.account_key}
                    item={b}
                    onClick={() => setStatementKey(b.account_key)}
                  />
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-5 h-24" />
                  </Card>
                ))}
          </div>
        </CardContent>
      </Card>

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSaved={fetchBalances}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        balances={balances}
        onSaved={fetchBalances}
      />

      <StatementModal
        accountKey={statementKey}
        onClose={() => setStatementKey(null)}
      />
    </>
  );
}

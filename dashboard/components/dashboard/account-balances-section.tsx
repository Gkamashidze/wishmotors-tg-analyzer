"use client";

import { useState, useCallback, useEffect } from "react";
import { Settings2, Banknote, Building2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type { AccountBalance } from "@/app/api/account-balances/route";

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

function balanceTone(amount: number): string {
  if (amount > 0) return "text-success";
  if (amount < 0) return "text-destructive";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Balance card (single account)
// ---------------------------------------------------------------------------
function BalanceCard({ item }: { item: AccountBalance }) {
  const isBank = item.account_key.startsWith("bank");
  const Icon = isBank ? Building2 : Banknote;
  const iconBg = isBank
    ? "bg-blue-500/10 text-blue-500 ring-blue-500/10"
    : "bg-emerald-500/10 text-emerald-500 ring-emerald-500/10";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground truncate">
              {item.account_name}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              {item.currency}
            </p>
            <p className={`mt-2 text-xl font-bold tabular-nums ${balanceTone(item.current_balance)}`}>
              {formatAmount(item.current_balance, item.currency)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              საწყისი: {formatAmount(item.initial_balance, item.currency)}
            </p>
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ring-1 shrink-0 ${iconBg}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
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

  // Populate from current data when modal opens
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
    const payload = (Object.keys(values) as (keyof InitialValues)[]).map((key) => {
      const num = parseFloat(values[key].replace(",", "."));
      if (isNaN(num)) throw new Error(`${key}: არასწორი მნიშვნელობა`);
      return { account_key: key, initial_balance: num };
    });

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

  const fields: { key: keyof InitialValues; label: string; currency: string }[] = [
    { key: "cash_gel", label: "სალარო", currency: "GEL (₾)" },
    { key: "cash_usd", label: "სალარო", currency: "USD ($)" },
    { key: "bank_gel", label: "საქართველოს ბანკი", currency: "GEL (₾)" },
    { key: "bank_usd", label: "საქართველოს ბანკი", currency: "USD ($)" },
  ];

  return (
    <Dialog open={open} onClose={onClose} title="საწყისი ნაშთების რედაქტირება">
      <p className="text-sm text-muted-foreground mb-5">
        მიუთითეთ ოთხივე ანგარიშის საწყისი ნაშთი. მიმდინარე ბალანსი გამოითვლება ავტომატურად:
        <span className="font-medium"> საწყისი ნაშთი + შემოსავლები − გასავლები</span>.
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

      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}

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
  const [modalOpen, setModalOpen] = useState(false);

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
                ოთხი ანგარიშის რეალური ბალანსი
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {loading && (
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
              )}
              <button
                onClick={() => setModalOpen(true)}
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
              ? balances.map((b) => <BalanceCard key={b.account_key} item={b} />)
              : Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-5 h-24" />
                  </Card>
                ))}
          </div>
        </CardContent>
      </Card>

      <SettingsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        balances={balances}
        onSaved={fetchBalances}
      />
    </>
  );
}

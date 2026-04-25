"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CheckCircle, Loader2 } from "lucide-react";

type Props = {
  saleId: number;
  amount: number;
};

export function DebtorPayButton({ saleId, amount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<"cash" | "transfer">("cash");

  const fmt = (n: number) =>
    n.toLocaleString("ka-GE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  async function handlePay() {
    setLoading(true);
    try {
      const res = await fetch("/api/debtors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sale_id: saleId, payment_method: method }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`შეცდომა: ${(data as { error?: string }).error ?? "სერვერის შეცდომა"}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      alert("კავშირის შეცდომა. სცადეთ ხელახლა.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs gap-1 text-green-700 border-green-300 hover:bg-green-50"
        onClick={() => setOpen(true)}
      >
        <CheckCircle className="h-3 w-3" />
        თანხის მიღება
      </Button>

      <Dialog
        open={open}
        onClose={() => !loading && setOpen(false)}
        title={`თანხის მიღება — გაყიდვა #${saleId}`}
        className="max-w-sm"
      >
        <p className="text-sm text-muted-foreground mb-4">
          თანხა:{" "}
          <span className="font-semibold text-foreground text-base">{fmt(amount)} ₾</span>
        </p>

        <p className="text-sm font-medium mb-2">გადახდის მეთოდი:</p>
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMethod("cash")}
            className={`flex-1 h-9 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
              method === "cash"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-accent"
            }`}
          >
            ნაღდი
          </button>
          <button
            onClick={() => setMethod("transfer")}
            className={`flex-1 h-9 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
              method === "transfer"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:bg-accent"
            }`}
          >
            გადარიცხვა
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={loading}
            className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
          >
            გაუქმება
          </button>
          <button
            onClick={handlePay}
            disabled={loading}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            დადასტურება
          </button>
        </div>
      </Dialog>
    </>
  );
}

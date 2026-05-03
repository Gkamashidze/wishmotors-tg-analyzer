"use client";

import { useState, useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductRow } from "@/lib/queries";
import { formatGEL, formatNumber } from "@/lib/utils";

interface WriteoffDialogProps {
  writeoffRow: ProductRow | null;
  onClose: () => void;
  onDone: () => void;
}

export function WriteoffDialog({ writeoffRow, onClose, onDone }: WriteoffDialogProps) {
  const [writeoffQty, setWriteoffQty] = useState("1");
  const [writeoffReason, setWriteoffReason] = useState("");
  const [writeoffSaving, setWriteoffSaving] = useState(false);
  const [writeoffError, setWriteoffError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setWriteoffQty("1");
    setWriteoffReason("");
    setWriteoffError(null);
    onClose();
  }, [onClose]);

  const handleWriteoff = useCallback(async () => {
    if (!writeoffRow) return;
    const qty = parseInt(writeoffQty, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setWriteoffError("რაოდენობა უნდა იყოს დადებითი მთელი რიცხვი");
      return;
    }
    if (!writeoffReason.trim()) {
      setWriteoffError("მიზეზის მითითება სავალდებულოა");
      return;
    }
    setWriteoffSaving(true);
    setWriteoffError(null);
    try {
      const res = await fetch(`/api/products/${writeoffRow.id}/writeoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty, reason: writeoffReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setWriteoffError(body.error ?? "ჩამოწერა ვერ განხორციელდა. სცადეთ თავიდან.");
        return;
      }
      handleClose();
      onDone();
    } finally {
      setWriteoffSaving(false);
    }
  }, [writeoffRow, writeoffQty, writeoffReason, handleClose, onDone]);

  const qty = parseInt(writeoffQty, 10);
  const validQty = writeoffRow !== null && Number.isFinite(qty) && qty > 0;
  const totalLoss = validQty && writeoffRow ? qty * writeoffRow.unitPrice : 0;

  return (
    <Dialog open={!!writeoffRow} onClose={handleClose} title="ინვენტარის ჩამოწერა">
      {writeoffRow && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 space-y-1 text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">{writeoffRow.name}</p>
            {writeoffRow.oemCode && (
              <p className="font-mono text-xs text-amber-600 dark:text-amber-400">{writeoffRow.oemCode}</p>
            )}
            <p className="text-xs text-amber-700 dark:text-amber-400">
              მიმდინარე მარაგი:{" "}
              <span className="font-semibold">{formatNumber(writeoffRow.currentStock)} {writeoffRow.unit}</span>
            </p>
          </div>

          <Input
            id="writeoff-qty"
            label="ჩამოსაწერი რაოდენობა *"
            type="number"
            min="1"
            step="1"
            value={writeoffQty}
            onChange={(e) => { setWriteoffQty(e.target.value); setWriteoffError(null); }}
            autoFocus
          />

          <Input
            id="writeoff-reason"
            label="მიზეზი *"
            type="text"
            value={writeoffReason}
            onChange={(e) => { setWriteoffReason(e.target.value); setWriteoffError(null); }}
            placeholder="მაგ: დაზიანებული, ფიზიკური ნარჩენი, დაკარგული..."
          />

          {validQty && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 space-y-1.5 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                ფინანსური ზემოქმედება
              </p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ერთ. ღირებულება</span>
                <span className="tabular-nums">{formatGEL(writeoffRow.unitPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ჩამოსაწერი რ-ბა</span>
                <span className="tabular-nums">{qty} {writeoffRow.unit}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 mt-1.5">
                <span className="font-medium text-destructive">სულ ზარალი</span>
                <span className="font-semibold tabular-nums text-destructive">-{formatGEL(totalLoss)}</span>
              </div>
              <p className="text-xs text-muted-foreground pt-0.5">
                ჩამოწერა დაფიქსირდება P&amp;L-ში არანაღდ ხარჯად (ბალანსზე გავლენა: 0)
              </p>
            </div>
          )}

          {writeoffError && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              {writeoffError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose} disabled={writeoffSaving} className="cursor-pointer">
              გაუქმება
            </Button>
            <Button
              onClick={handleWriteoff}
              disabled={writeoffSaving}
              className="cursor-pointer bg-amber-600 hover:bg-amber-700 text-white"
            >
              {writeoffSaving ? "მიმდინარეობს..." : "ჩამოწერა"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

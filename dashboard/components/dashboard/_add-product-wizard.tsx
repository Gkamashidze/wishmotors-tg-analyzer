"use client";

import { useState, useCallback } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { WIZARD_STEPS, DEFAULT_ADD } from "./_utils";
import type { AddState, WizardStep } from "./_types";

interface AddProductWizardProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddProductWizard({ open, onClose, onAdded }: AddProductWizardProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [addState, setAddState] = useState<AddState>(DEFAULT_ADD);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const handleClose = useCallback(() => {
    setAddState(DEFAULT_ADD);
    setAddError(null);
    setWizardStep(1);
    onClose();
  }, [onClose]);

  const wizardNext = useCallback(() => {
    setAddError(null);
    if (wizardStep === 1 && !addState.name.trim()) {
      setAddError("დასახელება სავალდებულოა");
      return;
    }
    if (wizardStep === 2 && addState.oem_code.trim() && !/^[A-Za-z0-9]{4,}$/.test(addState.oem_code.trim())) {
      setAddError("OEM კოდი უნდა შეიცავდეს მინიმუმ 4 სიმბოლოს (ციფრებს ან/და ლათინურ ასოებს)");
      return;
    }
    if (wizardStep < 4) setWizardStep((s) => (s + 1) as WizardStep);
  }, [wizardStep, addState.name, addState.oem_code]);

  const wizardBack = useCallback(() => {
    setAddError(null);
    if (wizardStep > 1) setWizardStep((s) => (s - 1) as WizardStep);
  }, [wizardStep]);

  const setAdd = (key: keyof AddState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setAddState((prev) => ({ ...prev, [key]: e.target.value }));

  const handleAdd = useCallback(async () => {
    if (!addState.name.trim()) {
      setAddError("დასახელება სავალდებულოა");
      return;
    }
    if (addState.oem_code.trim() && !/^[A-Za-z0-9]{4,}$/.test(addState.oem_code.trim())) {
      setAddError("OEM კოდი უნდა შეიცავდეს მინიმუმ 4 სიმბოლოს (ციფრებს ან/და ლათინურ ასოებს)");
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addState.name.trim(),
          oem_code: addState.oem_code.trim() || null,
          unit: addState.unit.trim() || "ცალი",
          unit_price: Number(addState.unit_price) || 0,
          current_stock: Number(addState.current_stock) || 0,
          min_stock: Number(addState.min_stock) || 0,
        }),
      });
      if (res.status === 200) {
        setAddError("ამ სახელის პროდუქტი უკვე არსებობს");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setAddError(body.error ?? "შეცდომა. სცადეთ თავიდან.");
        return;
      }
      handleClose();
      onAdded();
    } finally {
      setAddSaving(false);
    }
  }, [addState, handleClose, onAdded]);

  return (
    <Dialog open={open} onClose={handleClose} title="ახალი პროდუქტის დამატება">
      <div className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            {([1, 2, 3, 4] as WizardStep[]).map((s) => (
              <span
                key={s}
                className={cn(
                  "font-medium transition-colors",
                  s === wizardStep ? "text-primary" :
                  s < wizardStep ? "text-[hsl(var(--success))]" : ""
                )}
              >
                {WIZARD_STEPS[s]}
              </span>
            ))}
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${(wizardStep / 4) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">
            ნაბიჯი {wizardStep} / 4
          </p>
        </div>

        {wizardStep === 1 && (
          <div className="space-y-2 min-h-[80px]">
            <p className="text-sm font-medium">პროდუქტის სახელი რა არის?</p>
            <Input
              id="add-name"
              label="დასახელება *"
              type="text"
              value={addState.name}
              onChange={setAdd("name")}
              placeholder="მაგ: ზეთის ფილტრი, მარჯვენა სარკე..."
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && wizardNext()}
            />
          </div>
        )}

        {wizardStep === 2 && (
          <div className="space-y-2 min-h-[80px]">
            <p className="text-sm font-medium">OEM კოდი გაქვთ? <span className="text-muted-foreground font-normal">(სურვილისამებრ)</span></p>
            <Input
              id="add-oem"
              label="OEM კოდი"
              type="text"
              value={addState.oem_code}
              onChange={setAdd("oem_code")}
              placeholder="მაგ: 8390132500 ან გამოტოვეთ"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && wizardNext()}
            />
          </div>
        )}

        {wizardStep === 3 && (
          <div className="space-y-2 min-h-[80px]">
            <p className="text-sm font-medium">ამჟამად რამდენია მარაგში?</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="add-stock"
                label="რაოდენობა"
                type="number"
                min="0"
                value={addState.current_stock}
                onChange={setAdd("current_stock")}
                autoFocus
              />
              <Input
                id="add-unit"
                label="ერთეული"
                type="text"
                value={addState.unit}
                onChange={setAdd("unit")}
                placeholder="ცალი"
              />
            </div>
          </div>
        )}

        {wizardStep === 4 && (
          <div className="space-y-3 min-h-[80px]">
            <p className="text-sm font-medium">ფასი და მინიმალური მარაგი</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="add-price"
                label="ერთ. ფასი (₾)"
                type="number"
                min="0"
                step="0.01"
                value={addState.unit_price}
                onChange={setAdd("unit_price")}
                autoFocus
              />
              <Input
                id="add-min"
                label="მინ. მარაგი"
                type="number"
                min="0"
                value={addState.min_stock}
                onChange={setAdd("min_stock")}
              />
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 space-y-1 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">შეჯამება</p>
              <div className="flex justify-between"><span className="text-muted-foreground">სახელი</span><span className="font-medium">{addState.name}</span></div>
              {addState.oem_code && <div className="flex justify-between"><span className="text-muted-foreground">OEM</span><span className="font-mono text-xs">{addState.oem_code}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">მარაგი</span><span>{addState.current_stock} {addState.unit}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ფასი</span><span>{Number(addState.unit_price).toFixed(2)}₾</span></div>
            </div>
          </div>
        )}

        {addError && (
          <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            {addError}
          </p>
        )}

        <div className="flex justify-between gap-2 pt-1">
          <Button
            variant="outline"
            onClick={wizardStep === 1 ? handleClose : wizardBack}
            disabled={addSaving}
            className="cursor-pointer"
          >
            {wizardStep === 1 ? "გაუქმება" : "← უკან"}
          </Button>
          {wizardStep < 4 ? (
            <Button onClick={wizardNext} className="cursor-pointer">
              შემდეგი →
            </Button>
          ) : (
            <Button onClick={handleAdd} disabled={addSaving} className="cursor-pointer">
              {addSaving ? "ემატება..." : "✓ დამატება"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

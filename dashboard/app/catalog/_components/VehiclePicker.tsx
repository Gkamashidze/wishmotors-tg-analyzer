"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { VehicleEngine, VehicleModel } from "@/lib/queries";

export function VehiclePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [models, setModels] = useState<VehicleModel[]>([]);
  const [engines, setEngines] = useState<VehicleEngine[]>([]);
  const [yearRange, setYearRange] = useState<{ min: number; max: number } | null>(null);

  const selectedModel = sp.get("model") ?? "";
  const selectedEngine = sp.get("engine") ?? "";
  const selectedYear = sp.get("year") ?? "";

  // Load models once on mount
  useEffect(() => {
    fetch("/api/public/catalog/models")
      .then((r) => r.json())
      .then((d: { models: VehicleModel[] }) => setModels(d.models ?? []))
      .catch(() => {});
  }, []);

  // Load engines + year range whenever model changes
  useEffect(() => {
    if (!selectedModel) {
      setEngines([]);
      setYearRange(null);
      return;
    }
    fetch(`/api/public/catalog/engines?model=${encodeURIComponent(selectedModel)}`)
      .then((r) => r.json())
      .then((d: { engines: VehicleEngine[]; yearRange: { min: number; max: number } | null }) => {
        setEngines(d.engines ?? []);
        setYearRange(d.yearRange ?? null);
      })
      .catch(() => {});
  }, [selectedModel]);

  function update(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key === "model") {
      params.delete("engine");
      params.delete("year");
    }
    params.delete("page");
    startTransition(() => router.push(`/catalog?${params.toString()}`));
  }

  function reset() {
    const params = new URLSearchParams(sp.toString());
    params.delete("model");
    params.delete("engine");
    params.delete("year");
    params.delete("page");
    startTransition(() => router.push(`/catalog?${params.toString()}`));
  }

  const hasFilter = Boolean(selectedModel || selectedEngine || selectedYear);

  const years = yearRange
    ? Array.from(
        { length: yearRange.max - yearRange.min + 1 },
        (_, i) => yearRange.max - i,
      )
    : [];

  const selectCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="rounded-xl border bg-card p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">🚗 აირჩიე შენი მანქანა</p>
        {hasFilter && (
          <button
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            გასუფთავება
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Model */}
        <select
          value={selectedModel}
          onChange={(e) => update("model", e.target.value)}
          className={selectCls}
          aria-label="მოდელი"
        >
          <option value="">— მოდელი —</option>
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model} ({m.productCount})
            </option>
          ))}
        </select>

        {/* Engine */}
        <select
          value={selectedEngine}
          onChange={(e) => update("engine", e.target.value)}
          disabled={!selectedModel || engines.length === 0}
          className={selectCls}
          aria-label="ძრავი"
        >
          <option value="">— ძრავი —</option>
          {engines.map((e) => (
            <option key={e.engine} value={e.engine}>
              {e.engine}
              {e.fuelType ? ` — ${e.fuelType}` : ""}
            </option>
          ))}
        </select>

        {/* Year */}
        <select
          value={selectedYear}
          onChange={(e) => update("year", e.target.value)}
          disabled={years.length === 0}
          className={selectCls}
          aria-label="წელი"
        >
          <option value="">— წელი —</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {isPending && (
        <p className="text-xs text-muted-foreground mt-2">იტვირთება…</p>
      )}
    </div>
  );
}

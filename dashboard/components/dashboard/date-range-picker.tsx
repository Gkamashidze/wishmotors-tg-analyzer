"use client";

import { useState, useCallback } from "react";
import {
  startOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  format,
} from "date-fns";
import { CalendarDays } from "lucide-react";

export type DateRange = { from: Date; to: Date };
type PresetKey = "week" | "month" | "lastMonth" | "year" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "week", label: "ეს კვირა" },
  { key: "month", label: "ეს თვე" },
  { key: "lastMonth", label: "გ. თვე" },
  { key: "year", label: "ეს წელი" },
  { key: "custom", label: "სხვა..." },
];

function getPresetRange(key: Exclude<PresetKey, "custom">): DateRange {
  const today = new Date();
  switch (key) {
    case "week":
      return { from: startOfWeek(today, { weekStartsOn: 1 }), to: today };
    case "month":
      return { from: startOfMonth(today), to: today };
    case "lastMonth": {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "year":
      return { from: startOfYear(today), to: today };
  }
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  defaultPreset?: PresetKey;
}

export function DateRangePicker({
  value,
  onChange,
  defaultPreset = "month",
}: DateRangePickerProps) {
  const [activePreset, setActivePreset] = useState<PresetKey>(defaultPreset);
  const [customFrom, setCustomFrom] = useState(format(value.from, "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(format(value.to, "yyyy-MM-dd"));

  const handlePreset = useCallback(
    (key: PresetKey) => {
      setActivePreset(key);
      if (key !== "custom") {
        onChange(getPresetRange(key));
      }
    },
    [onChange],
  );

  const applyCustom = useCallback(() => {
    const from = new Date(customFrom + "T00:00:00");
    const to = new Date(customTo + "T23:59:59");
    if (!isNaN(from.getTime()) && !isNaN(to.getTime()) && from <= to) {
      onChange({ from, to });
    }
  }, [customFrom, customTo, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarDays className="h-4 w-4 shrink-0" />
        <span className="text-xs font-medium">პერიოდი:</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={[
              "px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
              activePreset === p.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            ].join(" ")}
          >
            {p.label}
          </button>
        ))}
      </div>

      {activePreset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={applyCustom}
            className="px-3 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            გამოყენება
          </button>
        </div>
      )}
    </div>
  );
}

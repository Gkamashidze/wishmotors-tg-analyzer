import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const GEL = new Intl.NumberFormat("ka-GE", {
  style: "currency",
  currency: "GEL",
  maximumFractionDigits: 2,
});

export function formatGEL(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return GEL.format(n);
}

const NUM = new Intl.NumberFormat("ka-GE");

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "—";
  return NUM.format(n);
}

/**
 * Recommended selling price that bakes in a fixed 28% buffer (18% sales VAT +
 * 10% operational cushion) and then applies the gross-profit margin on top.
 *
 * Formula:  (landedCost × 1.28) / (1 − margin/100)
 *
 * Margin is clamped to [0, 99] to prevent division by zero.
 * Returns null when landedCost ≤ 0.
 */
export function calcRecommendedPrice(
  landedCost: number,
  marginPct: number,
): number | null {
  if (landedCost <= 0) return null;
  const clampedMargin = Math.min(Math.max(marginPct, 0), 99);
  const buffered = landedCost * 1.28;
  return buffered / (1 - clampedMargin / 100);
}

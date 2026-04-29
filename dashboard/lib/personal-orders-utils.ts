import type { PersonalOrderRow } from "./personal-orders-queries";

export function fmtGel(v: number | null | undefined): string {
  return v != null ? `₾${Number(v).toFixed(2)}` : "—";
}

export function fmtPrice(v: number | null | undefined, currency: string): string {
  if (v == null) return "—";
  return currency === "USD" ? `$${Number(v).toFixed(2)}` : `₾${Number(v).toFixed(2)}`;
}

export function fmtPriceRange(
  min: number | null | undefined,
  max: number,
  currency: string,
): string {
  if (min != null && Number(min) > 0) {
    return `${fmtPrice(Number(min), currency)} – ${fmtPrice(Number(max), currency)}`;
  }
  return fmtPrice(Number(max), currency);
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ka-GE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return v;
  }
}

export function calcProfit(order: PersonalOrderRow): number {
  return (
    Number(order.sale_price) -
    Number(order.cost_price ?? 0) -
    Number(order.transportation_cost ?? 0) -
    Number(order.vat_amount ?? 0)
  );
}

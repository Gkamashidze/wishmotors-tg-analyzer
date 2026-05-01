"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { CatalogSortOption } from "@/lib/queries";

const SORT_OPTIONS: { value: CatalogSortOption; label: string }[] = [
  { value: "name_asc",   label: "სახელი A–Z" },
  { value: "price_asc",  label: "ფასი: იაფი → ძვირი" },
  { value: "price_desc", label: "ფასი: ძვირი → იაფი" },
  { value: "newest",     label: "ახალი პირველი" },
];

export function SortBar({ currentSort }: { currentSort?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  function onChange(sort: string) {
    const params = new URLSearchParams(sp.toString());
    if (sort && sort !== "name_asc") {
      params.set("sort", sort);
    } else {
      params.delete("sort");
    }
    params.delete("page");
    startTransition(() => router.push(`/catalog?${params.toString()}`));
  }

  return (
    <select
      value={currentSort ?? "name_asc"}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      aria-label="სორტირება"
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

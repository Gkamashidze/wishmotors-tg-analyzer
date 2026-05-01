"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export default function SearchBar({
  defaultValue = "",
}: {
  defaultValue?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync input when the page re-renders with a new URL (browser back/forward).
  useEffect(() => {
    setValue(defaultValue ?? "");
  }, [defaultValue]);

  // Debounced push: only navigates when the typed value differs from the URL.
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const url = new URL(window.location.href);
      const current = url.searchParams.get("search") ?? "";
      if (value === current) return;
      if (value) {
        url.searchParams.set("search", value);
      } else {
        url.searchParams.delete("search");
      }
      url.searchParams.delete("page");
      router.push(url.pathname + url.search);
    }, 400);
    return () => clearTimeout(timerRef.current);
  }, [value, router]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="სახელი ან OEM კოდი..."
        className="w-full pl-9 pr-4 py-2 text-sm bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-foreground/40"
      />
    </div>
  );
}

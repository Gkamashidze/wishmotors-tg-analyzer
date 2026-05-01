"use client";
import { useEffect } from "react";

export type RecentItem = {
  slug: string;
  name: string;
  price: number;
  imageUrl: string | null;
  oemCode: string | null;
};

const STORAGE_KEY = "wishm_recent";
const MAX_ITEMS = 8;

export function TrackView(item: RecentItem) {
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing: RecentItem[] = raw ? (JSON.parse(raw) as RecentItem[]) : [];
      const filtered = existing.filter((r) => r.slug !== item.slug);
      const updated = [item, ...filtered].slice(0, MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // localStorage not available (SSR guard, private mode, etc.)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.slug]);

  return null;
}

"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { RecentItem } from "./TrackView";

const STORAGE_KEY = "wishm_recent";

function MiniCard({ item }: { item: RecentItem }) {
  const price = new Intl.NumberFormat("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(item.price);

  return (
    <Link
      href={`/catalog/${item.slug}`}
      className="shrink-0 w-36 rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow flex flex-col"
    >
      <div className="relative aspect-video bg-secondary overflow-hidden">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            unoptimized
            loading="lazy"
            className="object-cover"
            sizes="144px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="h-6 w-6 text-foreground/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-2 flex flex-col gap-0.5">
        <p className="text-xs font-medium leading-snug line-clamp-2">{item.name}</p>
        {item.oemCode && (
          <p className="text-[10px] text-foreground/40 font-mono truncate">{item.oemCode}</p>
        )}
        <p className="text-xs font-semibold mt-0.5">₾{price}</p>
      </div>
    </Link>
  );
}

export function RecentlyViewed({ currentSlug }: { currentSlug: string }) {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const all: RecentItem[] = raw ? (JSON.parse(raw) as RecentItem[]) : [];
      setItems(all.filter((r) => r.slug !== currentSlug));
    } catch {
      // localStorage unavailable
    }
  }, [currentSlug]);

  if (items.length === 0) return null;

  return (
    <section className="mt-14">
      <h2 className="text-base font-semibold mb-4">ახლახანს ნანახი</h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {items.map((item) => (
          <MiniCard key={item.slug} item={item} />
        ))}
      </div>
    </section>
  );
}

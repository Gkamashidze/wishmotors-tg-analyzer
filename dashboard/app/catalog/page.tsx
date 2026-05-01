import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  getPublicCatalog,
  getPublicCategories,
  type PublicProductItem,
} from "@/lib/queries";
import SearchBar from "./_components/SearchBar";
import { VehiclePicker } from "./_components/VehiclePicker";

// ─── Types ────────────────────────────────────────────────────────────────────

type PageProps = {
  searchParams: Promise<{
    category?: string;
    search?: string;
    model?: string;
    engine?: string;
    year?: string;
    page?: string;
  }>;
};

// ─── URL builder ──────────────────────────────────────────────────────────────

type CatalogFilters = {
  category?: string;
  search?: string;
  model?: string;
  engine?: string;
  year?: string;
  page?: number;
};

function catalogUrl(overrides: Partial<CatalogFilters>, base: Omit<CatalogFilters, "page"> = {}): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.category) params.set("category", merged.category);
  if (merged.search) params.set("search", merged.search);
  if (merged.model) params.set("model", merged.model);
  if (merged.engine) params.set("engine", merged.engine);
  if (merged.year) params.set("year", merged.year);
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  return `/catalog${qs ? `?${qs}` : ""}`;
}

// ─── Chip helper ─────────────────────────────────────────────────────────────

function chipCls(active: boolean): string {
  return [
    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card text-foreground/70 border-border hover:border-primary/50 hover:text-foreground",
  ].join(" ");
}

// ─── Smart stock badge ────────────────────────────────────────────────────────

function StockBadge({ stock }: { stock: number }) {
  if (stock >= 5)
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
        მარაგშია
      </span>
    );
  if (stock >= 1)
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
        ბოლო ცალები!
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-foreground/10 text-foreground/50 font-medium">
      შეკვეთით
    </span>
  );
}

// ─── Trust strip ──────────────────────────────────────────────────────────────

function TrustStrip() {
  const years = process.env.NEXT_PUBLIC_YEARS_IN_BUSINESS;

  const badges = [
    {
      label: "ორიგინალი ნაწილები",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      ),
    },
    {
      label: "მიწოდება მთელ საქართველოში",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      ),
    },
    {
      label: "უფასო კონსულტაცია",
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.29 6.29l1.28-1.29a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
        </svg>
      ),
    },
    ...(years
      ? [
          {
            label: `${years}+ წელი ბაზარზე`,
            icon: (
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 mb-5 scrollbar-thin">
      {badges.map((b) => (
        <div
          key={b.label}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full bg-secondary/50 text-foreground/70 border border-border/50 shrink-0"
        >
          {b.icon}
          <span>✓ {b.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Product card ─────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: PublicProductItem }) {
  const price = new Intl.NumberFormat("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(product.price);

  return (
    <article className="rounded-xl border bg-card shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* 16:9 image */}
      <div className="relative aspect-video bg-secondary overflow-hidden">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            unoptimized
            loading="lazy"
            className="object-cover"
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10 text-foreground/20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
        )}
      </div>

      {/* Text content */}
      <div className="p-3 flex flex-col flex-1 gap-1.5">
        <h3 className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </h3>

        {product.oemCode && (
          <p className="text-xs text-foreground/50 font-mono tracking-wide truncate">
            {product.oemCode}
          </p>
        )}

        <div className="flex items-center gap-2 mt-auto pt-1.5">
          <StockBadge stock={product.currentStock} />
          <span className="text-sm font-semibold ml-auto">₾{price}</span>
        </div>

        <Link
          href={`/catalog/${product.slug}`}
          className="mt-1.5 w-full py-2 text-sm font-medium text-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          ნახე →
        </Link>
      </div>
    </article>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ model, engine, year }: { model?: string; engine?: string; year?: string }) {
  const tgUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;

  const isVehicleSearch = Boolean(model);

  let waText = "გამარჯობა! მინდა ნაწილის შეკვეთა.";
  if (isVehicleSearch) {
    const parts = [model, engine, year ? `${year} წ.` : undefined].filter(Boolean);
    waText = `გამარჯობა! მინდა ნაწილი: SsangYong ${parts.join(", ")}`;
  }

  const waHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`
    : null;
  const tgHref = tgUsername ? `https://t.me/${tgUsername}` : null;

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
      <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center">
        <Search className="h-7 w-7 text-foreground/30" />
      </div>
      <div className="max-w-sm">
        {isVehicleSearch ? (
          <>
            <p className="text-lg font-medium">ამ მანქანისთვის ჯერ არაფერი გვაქვს</p>
            <p className="text-sm text-foreground/60 mt-1">
              მოგვწერეთ — ვცდილობთ მოვიტანოთ
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium">ვერ მოიძებნა</p>
            <p className="text-sm text-foreground/60 mt-1">
              სხვა საძიებო სიტყვა სცადეთ ან დაგვიკავშირდით
            </p>
          </>
        )}
      </div>
      {(waHref || tgHref) && (
        <div className="flex gap-3">
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#22c55e] transition-colors"
            >
              WhatsApp
            </a>
          )}
          {tgHref && (
            <a
              href={tgHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0088cc] text-white text-sm font-medium hover:bg-[#0077b3] transition-colors"
            >
              Telegram
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function getPagesToShow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (
    let p = Math.max(2, current - 1);
    p <= Math.min(total - 1, current + 1);
    p++
  ) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

function Pagination({
  currentPage,
  totalPages,
  category,
  search,
  model,
  engine,
  year,
}: {
  currentPage: number;
  totalPages: number;
  category?: string;
  search?: string;
  model?: string;
  engine?: string;
  year?: string;
}) {
  const base = { category, search, model, engine, year };
  const btnCls =
    "min-w-[2.25rem] px-2 py-2 text-sm text-center rounded-lg border transition-colors";

  return (
    <nav
      className="flex items-center justify-center gap-1 flex-wrap"
      aria-label="გვერდები"
    >
      {currentPage > 1 && (
        <Link
          href={catalogUrl({ page: currentPage - 1 }, base)}
          className={`${btnCls} hover:bg-secondary`}
          aria-label="წინა გვერდი"
        >
          ←
        </Link>
      )}

      {getPagesToShow(currentPage, totalPages).map((p, i) =>
        p === "..." ? (
          <span
            key={`ellipsis-${i}`}
            className="px-2 py-2 text-sm text-foreground/40 select-none"
          >
            …
          </span>
        ) : (
          <Link
            key={p}
            href={catalogUrl({ page: p }, base)}
            className={`${btnCls} ${
              p === currentPage
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-secondary"
            }`}
            aria-current={p === currentPage ? "page" : undefined}
          >
            {p}
          </Link>
        ),
      )}

      {currentPage < totalPages && (
        <Link
          href={catalogUrl({ page: currentPage + 1 }, base)}
          className={`${btnCls} hover:bg-secondary`}
          aria-label="შემდეგი გვერდი"
        >
          →
        </Link>
      )}
    </nav>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CatalogPage({ searchParams }: PageProps) {
  const {
    category: rawCategory,
    search: rawSearch,
    model: rawModel,
    engine: rawEngine,
    year: rawYear,
    page: rawPage,
  } = await searchParams;

  const currentCategory = rawCategory?.trim() || undefined;
  const currentSearch = rawSearch?.trim() || undefined;
  const currentModel = rawModel?.trim() || undefined;
  const currentEngine = rawEngine?.trim() || undefined;
  const currentYear = rawYear ? Number(rawYear) : undefined;
  const currentPage = Math.max(1, Number(rawPage ?? 1));

  const [catalog, categories] = await Promise.all([
    getPublicCatalog({
      category: currentCategory,
      search: currentSearch,
      model: currentModel,
      engine: currentEngine,
      year: currentYear,
      page: currentPage,
      limit: 24,
    }),
    getPublicCategories(),
  ]);

  return (
    <div className="min-h-full flex flex-col">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link
            href="/catalog"
            className="flex items-center gap-1.5 shrink-0 text-foreground hover:text-primary transition-colors"
            aria-label="WishMotors კატალოგი"
          >
            <span className="font-bold text-lg tracking-tight">WishMotors</span>
          </Link>
          <div className="flex-1 max-w-lg">
            <SearchBar defaultValue={currentSearch} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {/* ── Trust badges ── */}
        <TrustStrip />

        {/* ── Vehicle picker ── */}
        <VehiclePicker />

        {/* ── Active vehicle filter chip ── */}
        {currentModel && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs text-muted-foreground">ფილტრი:</span>
            <span className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {[currentModel, currentEngine, rawYear ? `${rawYear} წ.` : undefined]
                .filter(Boolean)
                .join(" • ")}
              <Link
                href={catalogUrl({ page: 1 }, { search: currentSearch, category: currentCategory })}
                className="ml-1 hover:text-primary/60"
                aria-label="ფილტრის გასუფთავება"
              >
                ×
              </Link>
            </span>
          </div>
        )}

        {/* ── Category filter chips ── */}
        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
            <Link
              href={catalogUrl({ page: 1 }, { search: currentSearch, model: currentModel, engine: currentEngine, year: rawYear })}
              className={chipCls(!currentCategory)}
            >
              ყველა
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={catalogUrl(
                  { category: cat, page: 1 },
                  { search: currentSearch, model: currentModel, engine: currentEngine, year: rawYear },
                )}
                className={chipCls(currentCategory === cat)}
              >
                {cat}
              </Link>
            ))}
          </div>
        )}

        {/* ── Results count ── */}
        {catalog.total > 0 && (
          <p className="text-sm text-foreground/50 mb-4">
            {catalog.total.toLocaleString("ka-GE")} პროდუქტი
          </p>
        )}

        {/* ── Product grid / Empty state ── */}
        {catalog.items.length === 0 ? (
          <EmptyState model={currentModel} engine={currentEngine} year={rawYear} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {catalog.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {catalog.totalPages > 1 && (
          <div className="mt-10">
            <Pagination
              currentPage={currentPage}
              totalPages={catalog.totalPages}
              category={currentCategory}
              search={currentSearch}
              model={currentModel}
              engine={currentEngine}
              year={rawYear}
            />
          </div>
        )}

      </main>
    </div>
  );
}

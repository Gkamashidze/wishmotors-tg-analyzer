import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  getPublicCatalog,
  getPublicCategories,
  type PublicProductItem,
} from "@/lib/queries";
import SearchBar from "./_components/SearchBar";

// ─── Types ────────────────────────────────────────────────────────────────────

type PageProps = {
  searchParams: Promise<{
    category?: string;
    search?: string;
    page?: string;
  }>;
};

// ─── URL builder ──────────────────────────────────────────────────────────────

function catalogUrl(
  overrides: Partial<{ category: string; search: string; page: number }>,
  base: { category?: string; search?: string } = {},
): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  if (merged.category) params.set("category", merged.category);
  if (merged.search) params.set("search", merged.search);
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
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            მარაგშია
          </span>
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center">
        <Search className="h-7 w-7 text-foreground/30" />
      </div>
      <div>
        <p className="text-lg font-medium">ვერ მოიძებნა</p>
        <p className="text-sm text-foreground/60 mt-1">
          სხვა საძიებო სიტყვა სცადეთ ან{" "}
          <a
            href="https://t.me/wishmotors"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            დაგვიკავშირდით
          </a>
        </p>
      </div>
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
}: {
  currentPage: number;
  totalPages: number;
  category?: string;
  search?: string;
}) {
  const base = { category, search };
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
  const { category: rawCategory, search: rawSearch, page: rawPage } =
    await searchParams;

  const currentCategory = rawCategory?.trim() || undefined;
  const currentSearch = rawSearch?.trim() || undefined;
  const currentPage = Math.max(1, Number(rawPage ?? 1));
  const base = { category: currentCategory, search: currentSearch };

  const [catalog, categories] = await Promise.all([
    getPublicCatalog({
      category: currentCategory,
      search: currentSearch,
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
        {/* ── Category filter chips ── */}
        {categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
            <Link
              href={catalogUrl({ page: 1 }, { search: currentSearch })}
              className={chipCls(!currentCategory)}
            >
              ყველა
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={catalogUrl(
                  { category: cat, page: 1 },
                  { search: currentSearch },
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
          <EmptyState />
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
            />
          </div>
        )}

        {/* ── Footer contact nudge ── */}
        <div className="mt-16 pb-8 text-center text-sm text-foreground/40 space-y-1">
          <p>ვერ პოულობთ სასურველ ნაწილს?</p>
          <p>
            <a
              href="https://t.me/wishmotors"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Telegram
            </a>{" "}
            ·{" "}
            <a
              href="https://wa.me/995000000000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              WhatsApp
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

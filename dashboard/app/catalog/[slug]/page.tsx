import { notFound } from "next/navigation";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import logo from "@/public/logo.jpg";
import type { Metadata } from "next";
import {
  getPublicProduct,
  getRelatedProducts,
  type PublicProductDetail,
  type PublicProductMini,
  type CompatibilityRow,
} from "@/lib/queries";
import { TrackView } from "../_components/TrackView";
import { RecentlyViewed } from "../_components/RecentlyViewed";
import { ShareButton } from "../_components/ShareButton";
import { ProductGallery } from "../_components/ProductGallery";

// Deduplicates the DB call between generateMetadata and page render
const fetchProduct = cache(getPublicProduct);

type Params = Promise<{ slug: string }>;

// ─── Metadata ─────────────────────────────────────────────────────────────────

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) return { title: "პროდუქტი ვერ მოიძებნა — WishMotors" };

  const title = `${product.name} — WishMotors`;
  const description =
    product.description ??
    `ყიდეთ ${product.name}${
      product.oemCode ? ` (OEM: ${product.oemCode})` : ""
    } WishMotors-ის კატალოგიდან.`;

  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/catalog/${slug}` },
    openGraph: {
      title,
      description,
      images: product.imageUrl ? [{ url: product.imageUrl }] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: product.imageUrl ? [product.imageUrl] : [],
    },
  };
}

// ─── JSON-LD (placed in body — valid for schema.org, read by all crawlers) ────

function ProductJsonLd({ product }: { product: PublicProductDetail }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.description && { description: product.description }),
    ...(product.imageUrl && { image: product.imageUrl }),
    ...(product.oemCode && { sku: product.oemCode }),
    offers: {
      "@type": "Offer",
      priceCurrency: "GEL",
      price: product.price,
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

// ─── Related products mini card ───────────────────────────────────────────────

function RelatedCard({ p }: { p: PublicProductMini }) {
  const price = new Intl.NumberFormat("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(p.price);
  return (
    <Link
      href={`/catalog/${p.slug}`}
      className="shrink-0 w-40 rounded-xl border bg-card overflow-hidden hover:shadow-md transition-shadow flex flex-col"
    >
      <div className="relative aspect-video bg-secondary overflow-hidden">
        {p.imageUrl ? (
          <Image src={p.imageUrl} alt={p.name} fill unoptimized loading="lazy" className="object-cover" sizes="160px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="h-7 w-7 text-foreground/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <p className="text-xs font-medium leading-snug line-clamp-2">{p.name}</p>
        {p.oemCode && <p className="text-[10px] text-foreground/40 font-mono truncate">{p.oemCode}</p>}
        <p className="text-sm font-semibold mt-0.5">₾{price}</p>
      </div>
    </Link>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return new Intl.NumberFormat("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function yearRange(e: CompatibilityRow): string {
  if (e.yearFrom && e.yearTo) return `${e.yearFrom}–${e.yearTo}`;
  if (e.yearFrom) return `${e.yearFrom}–`;
  if (e.yearTo) return `–${e.yearTo}`;
  return "—";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProductImage({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string;
}) {
  return (
    <div className="relative aspect-square rounded-2xl bg-secondary overflow-hidden shadow-sm">
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={name}
          fill
          unoptimized
          priority
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground/20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-24 w-24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span className="text-sm">სურათი არ არის</span>
        </div>
      )}
    </div>
  );
}

function CompatibilityTable({
  entries,
}: {
  entries: CompatibilityRow[];
}) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="compat-heading">
      <h2
        id="compat-heading"
        className="text-lg font-semibold mb-4"
      >
        თავსებადი მოდელები
      </h2>
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary/[0.06] text-foreground/60 text-left text-xs uppercase tracking-wide border-b border-primary/10">
              <th className="px-4 py-3 font-medium">მოდელი</th>
              <th className="px-4 py-3 font-medium hidden sm:table-cell">ძრავი</th>
              <th className="px-4 py-3 font-medium hidden md:table-cell">Drive</th>
              <th className="px-4 py-3 font-medium hidden md:table-cell">საწვავი</th>
              <th className="px-4 py-3 font-medium">წლები</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.map((e) => (
              e.model === "__ALL__" ? (
                <tr key={e.id} className="hover:bg-secondary/40 transition-colors">
                  <td className="px-4 py-3 font-medium" colSpan={5}>
                    🌐 ყველა მოდელი
                  </td>
                </tr>
              ) : (
                <tr
                  key={e.id}
                  className="hover:bg-secondary/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{e.model}</td>
                  <td className="px-4 py-3 text-foreground/70 hidden sm:table-cell">
                    {e.engine ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground/70 hidden md:table-cell">
                    {e.drive ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground/70 hidden md:table-cell">
                    {e.fuelType ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-foreground/70 whitespace-nowrap">
                    {yearRange(e)}
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CtaButtons({ product }: { product: PublicProductDetail }) {
  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "";
  const fbPage = process.env.NEXT_PUBLIC_FACEBOOK_PAGE ?? "wishmotorsgeo";
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "";
  const catalogBaseUrl =
    process.env.NEXT_PUBLIC_CATALOG_BASE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    "";

  const oem = product.oemCode ? ` (OEM: ${product.oemCode})` : "";
  const productUrl = catalogBaseUrl
    ? ` ${catalogBaseUrl}/catalog/${product.slug}`
    : "";
  const waText = encodeURIComponent(
    `გამარჯობა! მაინტერესებს ${product.name}${oem}. შეგიძლიათ ფასისა და მარაგის შესახებ?${productUrl}`,
  );

  const waHref = waPhone ? `https://wa.me/${waPhone}?text=${waText}` : null;
  const fbHref = `https://m.me/${fbPage}`;
  const telHref = contactPhone
    ? `tel:${contactPhone.replace(/\s/g, "")}`
    : null;

  const base =
    "flex items-center justify-center gap-2.5 rounded-xl py-4 px-5 font-semibold text-sm transition-all hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* WhatsApp */}
      <a
        href={waHref ?? "#"}
        target={waHref ? "_blank" : undefined}
        rel="noopener noreferrer"
        aria-label="WhatsApp-ით დაკავშირება"
        className={`${base} text-white`}
        style={{ backgroundColor: "#25D366" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-current shrink-0"
          aria-hidden="true"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.553 4.107 1.52 5.847L.057 23.994l6.302-1.651A11.932 11.932 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.795 9.795 0 01-4.99-1.369l-.358-.213-3.712.973.99-3.617-.234-.371A9.769 9.769 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
        </svg>
        WhatsApp
      </a>

      {/* Facebook Messenger */}
      <a
        href={fbHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Facebook Messenger-ით დაკავშირება"
        className={`${base} text-white`}
        style={{ backgroundColor: "#0866FF" }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-current shrink-0"
          aria-hidden="true"
        >
          <path d="M12 0C5.373 0 0 5.163 0 11.535c0 3.625 1.797 6.86 4.608 8.986V24l4.207-2.312A13.08 13.08 0 0012 22.07c6.627 0 12-5.163 12-11.535C24 5.163 18.627 0 12 0zm1.194 15.533-3.048-3.25-5.95 3.25 6.548-6.953 3.12 3.25 5.878-3.25-6.548 6.953z" />
        </svg>
        Messenger
      </a>

      {/* Phone */}
      <a
        href={telHref ?? "#"}
        aria-label={`დარეკვა — ${contactPhone}`}
        className={`${base} border-2 border-border hover:border-primary/50 hover:bg-secondary`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.29 6.29l1.28-1.29a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
        </svg>
        {contactPhone || "დარეკვა"}
      </a>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProductDetailPage({
  params,
}: {
  params: Params;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  if (!product) notFound();

  const models = product.compatibility.map((c) => c.model);
  const related = await getRelatedProducts(product.id, product.category, models);

  return (
    <>
      {/* JSON-LD in body — accepted by all major crawlers */}
      <ProductJsonLd product={product} />

      {/* Track this view in localStorage (client-only, invisible) */}
      <TrackView
        slug={product.slug}
        name={product.name}
        price={product.price}
        imageUrl={product.imageUrl}
        oemCode={product.oemCode}
      />

      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link
            href="/catalog"
            className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground transition-colors text-sm shrink-0"
            aria-label="კატალოგზე დაბრუნება"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4 fill-current"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">კატალოგი</span>
          </Link>

          <Link href="/catalog" className="shrink-0 flex items-center gap-2.5">
            <Image src={logo} alt="WishMotors" height={48} className="h-12 w-auto" unoptimized />
            <span className="font-bold text-base text-[#1b2b5e]">WishMotors</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 pb-20">
        {/* ── Two-column layout: image left, details right ── */}
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Left: product image */}
          <ProductGallery images={product.images} name={product.name} />

          {/* Right: product details */}
          <div className="flex flex-col gap-5">
            {/* Category chip */}
            {product.category && (
              <span className="inline-flex w-fit px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                {product.category}
              </span>
            )}

            {/* Name */}
            <h1 className="text-2xl sm:text-3xl font-bold leading-snug">
              {product.name}
            </h1>

            {/* OEM code */}
            {product.oemCode && (
              <p className="text-sm text-foreground/50">
                OEM:{" "}
                <span className="font-mono tracking-wide text-foreground/70">
                  {product.oemCode}
                </span>
              </p>
            )}

            {/* Price */}
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">₾{fmtPrice(product.price)}</span>
              <span className="text-sm text-foreground/50">{product.unit}</span>
            </div>

            {/* Stock indicator */}
            <div>
              {product.currentStock >= 5 && (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-success/10 text-success font-medium">
                  <span className="h-2 w-2 rounded-full bg-success inline-block" />
                  მარაგშია
                </span>
              )}
              {product.currentStock >= 1 && product.currentStock < 5 && (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                  <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
                  ⚡ ბოლო ცალები!
                </span>
              )}
              {product.currentStock <= 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-foreground/10 text-foreground/50 font-medium">
                  ⏳ შეკვეთით — 3-5 დღეში
                </span>
              )}
            </div>

            {/* Description */}
            {product.description && (
              <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            )}

          </div>
        </div>

        {/* ── CTAs + Share below both columns ── */}
        <div className="mt-10 space-y-3">
          <CtaButtons product={product} />
          <ShareButton
            name={product.name}
            url={`${process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? ""}/catalog/${product.slug}`}
          />
        </div>

        {/* ── Compatibility table ── */}
        {product.compatibility.length > 0 && (
          <div className="mt-14">
            <CompatibilityTable entries={product.compatibility} />
          </div>
        )}

        {/* ── Related products ── */}
        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="text-base font-semibold mb-4">მსგავსი პროდუქტები</h2>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
              {related.map((p) => (
                <RelatedCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        )}

        {/* ── Recently viewed (client-side localStorage) ── */}
        <RecentlyViewed currentSlug={product.slug} />

      </main>
    </>
  );
}

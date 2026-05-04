import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import logo from "@/public/logo.jpg";
import type { Metadata } from "next";
import {
  getCatalogModels,
  getPublicCatalog,
  type PublicProductItem,
} from "@/lib/queries";

type Params = Promise<{ model: string }>;

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export async function generateStaticParams() {
  try {
    const models = await getCatalogModels();
    return models.map((m) => ({ model: encodeURIComponent(m.model) }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { model } = await params;
  const decoded = decodeURIComponent(model);
  return {
    title: `SsangYong ${decoded} ნაწილები — WishMotors`,
    description: `SsangYong ${decoded}-ის სათადარიგო ნაწილები — ფილტრები, სამუხრუჭე, განათება და სხვა. wishmotors.ge`,
    alternates: { canonical: `${baseUrl}/catalog/model/${model}` },
    openGraph: {
      title: `SsangYong ${decoded} ნაწილები`,
      description: `სათადარიგო ნაწილები SsangYong ${decoded}-ისთვის — wishmotors.ge`,
    },
  };
}

function StockBadge({ stock }: { stock: number }) {
  if (stock >= 5)
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        მარაგშია
      </span>
    );
  if (stock >= 1)
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        ბოლო ცალები!
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-foreground/10 text-foreground/50 font-medium">
      შეკვეთით
    </span>
  );
}

function ProductCard({ product }: { product: PublicProductItem }) {
  const price = new Intl.NumberFormat("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(product.price);

  return (
    <article className="rounded-xl border bg-card shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      <div className="relative aspect-video bg-secondary overflow-hidden">
        {product.imageUrl ? (
          <Image src={product.imageUrl} alt={product.name} fill unoptimized loading="lazy" className="object-cover" sizes="(max-width: 768px) 50vw, 25vw" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="h-8 w-8 text-foreground/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col flex-1 gap-1.5">
        <h3 className="text-sm font-medium leading-snug line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
        {product.oemCode && <p className="text-xs text-foreground/50 font-mono truncate">{product.oemCode}</p>}
        <div className="flex items-center gap-2 mt-auto pt-1.5">
          <StockBadge stock={product.currentStock} />
          <span className="text-sm font-semibold ml-auto">₾{price}</span>
        </div>
        <Link href={`/catalog/${product.slug}`} className="mt-1.5 w-full py-2 text-sm font-medium text-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
          ნახე →
        </Link>
      </div>
    </article>
  );
}

export default async function ModelLandingPage({ params }: { params: Params }) {
  const { model } = await params;
  const decoded = decodeURIComponent(model);

  const catalog = await getPublicCatalog({ model: decoded, limit: 48 }).catch(() => null);
  if (!catalog || catalog.total === 0) notFound();

  return (
    <>
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href="/catalog" className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground text-sm shrink-0">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
            <span className="hidden sm:inline">კატალოგი</span>
          </Link>
          <Link href="/catalog" className="shrink-0 flex items-center gap-2.5">
            <Image src={logo} alt="WishMotors" height={48} className="h-12 w-auto" unoptimized />
            <span className="font-bold text-base text-[#1b2b5e]">WishMotors</span>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 pb-20">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            SsangYong {decoded} — სათადარიგო ნაწილები
          </h1>
          <p className="text-foreground/60 text-sm">
            {catalog.total} პროდუქტი ხელმისაწვდომია
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {catalog.items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href={`/catalog?model=${encodeURIComponent(decoded)}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            ძრავისა და წლის მიხედვით ფილტრი →
          </Link>
        </div>
      </main>
    </>
  );
}

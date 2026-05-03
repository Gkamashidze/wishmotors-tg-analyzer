import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductsTable } from "@/components/dashboard/products-table";
import { FixUnknownsPanel } from "@/components/dashboard/fix-unknowns-panel";
import { getProductsPaged, getPublishedProductCount } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; item_type?: string; published?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1));
  const search = params.search ?? "";
  const itemType = params.item_type ?? "";
  const publishedParam = params.published ?? "";
  const publishedFilter = publishedParam === "1" ? true : publishedParam === "0" ? false : undefined;
  const [{ rows: products, total }, publishedCount] = await Promise.all([
    getProductsPaged(page, undefined, search, itemType || undefined, publishedFilter),
    getPublishedProductCount(),
  ]);

  return (
    <>
      <TopBar title="პროდუქცია" />
      <main className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🔧 გასასწორებელი ჩანაწერები
            </CardTitle>
            <CardDescription>
              პროდუქტები &apos;უცნობი&apos; დასახელებით — დააჭირეთ Fix-ს, შეიყვანეთ
              რეალური OEM კოდი/დასახელება
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FixUnknownsPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>პროდუქციის კატალოგი</CardTitle>
                <CardDescription>
                  ყველა პროდუქტი — OEM კოდი, დასახელება, ნახვა, რედაქტირება
                </CardDescription>
              </div>
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground whitespace-nowrap">
                გამოქვეყნებული: {publishedCount.published} / {publishedCount.total}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ProductsTable rows={products} total={total} page={page} search={search} itemType={itemType} published={publishedParam} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductsTable } from "@/components/dashboard/products-table";
import { FixUnknownsPanel } from "@/components/dashboard/fix-unknowns-panel";
import { getProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <>
      <TopBar title="პროდუქცია" />
      <main className="p-6 space-y-6 animate-fade-in">
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
            <CardTitle>პროდუქციის კატალოგი</CardTitle>
            <CardDescription>
              ყველა პროდუქტი — OEM კოდი, დასახელება, ნახვა, რედაქტირება
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProductsTable rows={products} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

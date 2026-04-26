import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InventoryTable } from "@/components/dashboard/inventory-table";
import { getProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function InventoryPage() {
  const products = await getProducts();

  return (
    <>
      <TopBar title="მარაგი" />
      <main className="p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>საწყობის მარაგი</CardTitle>
            <CardDescription>
              ყველა პროდუქტი — მარაგის მდგომარეობა, ფასები, რედაქტირება
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InventoryTable rows={products} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

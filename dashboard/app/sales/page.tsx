import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SalesTable } from "@/components/dashboard/sales-table";
import { getSales, getProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage() {
  const [sales, products] = await Promise.all([getSales(500), getProducts()]);

  return (
    <>
      <TopBar title="გაყიდვები" />
      <main className="p-6 space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>გაყიდვების ჟურნალი</CardTitle>
            <CardDescription>
              ბოლო 500 გაყიდვა — რედაქტირება და წაშლა
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SalesTable rows={sales} products={products} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

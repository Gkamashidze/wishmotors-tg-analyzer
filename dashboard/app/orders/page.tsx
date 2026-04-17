import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrdersTable } from "@/components/dashboard/orders-table";
import { getOrders, getProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrdersPage() {
  const [orders, products] = await Promise.all([getOrders(500), getProducts()]);

  return (
    <>
      <TopBar title="შეკვეთები" />
      <main className="p-6 space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>მიმდინარე შეკვეთები</CardTitle>
            <CardDescription>
              პრიორიტეტებით, სტატუსებით და ძიებით გაფილტვრადი სია
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrdersTable rows={orders} products={products} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

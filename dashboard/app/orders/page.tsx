import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrdersTable } from "@/components/dashboard/orders-table";
import { getOrders, getProducts, type OrderRow, type ProductRow } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrdersPage() {
  let orders: OrderRow[] = [];
  let products: ProductRow[] = [];
  let fetchError: string | null = null;

  try {
    [orders, products] = await Promise.all([getOrders(), getProducts()]);
  } catch (err) {
    console.error("[OrdersPage] მონაცემების ჩატვირთვა ვერ მოხერხდა:", err);
    fetchError =
      err instanceof Error
        ? err.message
        : "შეკვეთების ჩატვირთვა ვერ მოხერხდა — სცადეთ გვერდის განახლება.";
  }

  return (
    <>
      <TopBar title="შეკვეთები" />
      <main className="p-6 space-y-6 animate-fade-in">
        {fetchError ? (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center space-y-2">
            <p className="text-destructive font-semibold text-base">
              ⚠️ მონაცემების ჩატვირთვა ვერ მოხერხდა
            </p>
            <p className="text-sm text-muted-foreground">
              {fetchError}
            </p>
            <p className="text-xs text-muted-foreground">
              თუ ეს შეცდომა განმეორდება, შეამოწმეთ მონაცემთა ბაზის კავშირი.
            </p>
          </div>
        ) : (
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
        )}
      </main>
    </>
  );
}

import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpensesTable } from "@/components/dashboard/expenses-table";
import { getExpenses } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExpensesPage() {
  const expenses = await getExpenses(500);

  return (
    <>
      <TopBar title="ხარჯები" />
      <main className="p-6 space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>ხარჯების ჟურნალი</CardTitle>
            <CardDescription>
              ბოლო 500 ხარჯი — რედაქტირება და წაშლა
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExpensesTable rows={expenses} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

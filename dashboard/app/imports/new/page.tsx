import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErpImportForm } from "@/components/dashboard/erp-import-form";
import { getProducts }   from "@/lib/queries";

export const dynamic  = "force-dynamic";
export const revalidate = 0;

export default async function NewImportPage() {
  const products = await getProducts();

  return (
    <>
      <TopBar title="ახალი იმპორტი" backHref="/imports" />
      <main className="p-6 space-y-6 animate-fade-in max-w-7xl">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>ახალი იმპორტის შეტანა</CardTitle>
            <CardDescription>
              შეავსე სათაურის ინფორმაცია და დაამატე პოზიციები. სისტემა ავტომატურად
              გამოთვლის ჩასვლის ღირებულებას თითოეული პოზიციისთვის.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErpImportForm products={products} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

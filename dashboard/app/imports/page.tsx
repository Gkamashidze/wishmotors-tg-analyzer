import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImportsTable } from "@/components/dashboard/imports-table";
import { ImportUpload } from "@/components/dashboard/import-upload";
import { getImportsHistory } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImportsPage() {
  const rows = await getImportsHistory(1000);

  return (
    <>
      <TopBar title="იმპორტი" />
      <main className="p-6 space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>Excel-ის ატვირთვა</CardTitle>
            <CardDescription>
              ატვირთე იმპორტის ფაილი 9 სვეტით — თარიღი, OEM, დასახელება,
              რაოდ., ერთ., ფასი$, კურსი, ტრანსპ.₾, სხვა₾
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportUpload />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>იმპორტის ისტორია</CardTitle>
            <CardDescription>
              ყველა შემოტანილი პროდუქტი — თვითღირებულება და სარეკომენდაციო ფასი
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ImportsTable rows={rows} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

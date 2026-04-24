import { TopBar } from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErpImportsHistoryTable } from "@/components/dashboard/erp-imports-history-table";

export const dynamic  = "force-dynamic";
export const revalidate = 0;

type ImportRow = {
  id:                 number;
  date:               string;
  supplier:           string;
  invoiceNumber:      string | null;
  declarationNumber:  string | null;
  exchangeRate:       number;
  totalTransportCost: number;
  totalTerminalCost:  number;
  totalAgencyCost:    number;
  totalVatCost:       number;
  documentName:       string | null;
  status:             string;
  createdAt:          string;
  updatedAt:          string;
  itemsCount:         number;
  totalValueGel:      number;
};

async function getImports(): Promise<ImportRow[]> {
  try {
    const { query } = await import("@/lib/db");
    const rows = await query<{
      id: number;
      date: Date;
      supplier: string;
      invoice_number: string | null;
      declaration_number: string | null;
      exchange_rate: string;
      total_transport_cost: string;
      total_terminal_cost: string;
      total_agency_cost: string;
      total_vat_cost: string;
      document_name: string | null;
      status: string;
      created_at: Date;
      updated_at: Date;
      items_count: string;
      total_value_gel: string;
    }>(
      `SELECT
         i.id, i.date, i.supplier, i.invoice_number, i.declaration_number, i.exchange_rate,
         i.total_transport_cost, i.total_terminal_cost,
         i.total_agency_cost, i.total_vat_cost,
         i.document_name, i.status, i.created_at, i.updated_at,
         COUNT(ii.id) AS items_count,
         COALESCE(SUM(ii.total_price_gel), 0) AS total_value_gel
       FROM imports i
       LEFT JOIN import_items ii ON ii.import_id = i.id
       GROUP BY i.id
       ORDER BY i.date DESC, i.created_at DESC
       LIMIT 300`,
    );
    return rows.map((r) => ({
      id:                 r.id,
      date:               (r.date instanceof Date ? r.date.toISOString() : String(r.date)).slice(0, 10),
      supplier:           r.supplier,
      invoiceNumber:      r.invoice_number,
      declarationNumber:  r.declaration_number,
      exchangeRate:       Number(r.exchange_rate),
      totalTransportCost: Number(r.total_transport_cost),
      totalTerminalCost:  Number(r.total_terminal_cost),
      totalAgencyCost:    Number(r.total_agency_cost),
      totalVatCost:       Number(r.total_vat_cost),
      documentName:       r.document_name,
      status:             r.status,
      createdAt:          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt:          r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      itemsCount:         Number(r.items_count),
      totalValueGel:      Number(r.total_value_gel),
    }));
  } catch {
    return [];
  }
}

export default async function ImportsPage() {
  const rows = await getImports();

  return (
    <>
      <TopBar title="იმპორტი" />
      <main className="p-6 space-y-6 animate-fade-in">
        <Card>
          <CardHeader>
            <CardTitle>იმპორტის ისტორია</CardTitle>
            <CardDescription>
              ყველა ERP იმპორტი — ჩასვლის ღირებულებით, სტოკის ბრუნვით და გაუქმებით
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErpImportsHistoryTable rows={rows} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

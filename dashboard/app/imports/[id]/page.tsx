import { notFound }   from "next/navigation";
import { TopBar }      from "@/components/top-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErpImportForm }   from "@/components/dashboard/erp-import-form";
import { getProducts }     from "@/lib/queries";
import { query, queryOne } from "@/lib/db";

export const dynamic  = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export default async function ImportDetailPage({ params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) notFound();

  const [products, imp] = await Promise.all([
    getProducts(),
    fetchImport(importId),
  ]);

  if (!imp) notFound();

  const isCompleted = imp.status === "completed";

  return (
    <>
      <TopBar
        title={isCompleted ? `იმპორტი #${importId}` : `Draft #${importId}`}
        backHref="/imports"
      />
      <main className="p-6 space-y-6 animate-fade-in max-w-7xl">
        {isCompleted && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
            ეს იმპორტი <strong>დასრულებულია</strong>. სტოკი განახლდა. გაუქმებისთვის
            გამოიყენე &ldquo;გაუქმება &amp; რედაქტირება&rdquo; ღილაკი ისტორიაში.
          </div>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              {isCompleted ? "იმპორტის დეტალები" : "Draft — გაგრძელება"}
            </CardTitle>
            <CardDescription>
              {isCompleted
                ? "ნახე ან გააუქმე ეს იმპორტი ისტორიის გვერდიდან."
                : "განაგრძე რედაქტირება. ავტო-შენახვა ყოველ 2 წუთში."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErpImportForm
              importId={importId}
              products={products}
              initialData={{
                date:               imp.date,
                supplier:           imp.supplier,
                invoiceNumber:      imp.invoiceNumber ?? "",
                declarationNumber:  imp.declarationNumber ?? "",
                exchangeRate:       String(imp.exchangeRate),
                totalTransportCost: String(imp.totalTransportCost),
                totalTerminalCost:  String(imp.totalTerminalCost),
                totalAgencyCost:    String(imp.totalAgencyCost),
                totalVatCost:       String(imp.totalVatCost),
                documentName:       imp.documentName ?? "",
                items: imp.items.map((it) => ({
                  productId:          it.productId,
                  quantity:           it.quantity,
                  unit:               it.unit,
                  unitPriceUsd:       it.unitPriceUsd,
                  weight:             it.weight,
                  itemType:           it.itemType,
                  inventorySubType:   it.inventorySubType,
                  accountingCategory: it.accountingCategory,
                })),
              }}
            />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

// ── Server-side data fetch ────────────────────────────────────────────────────

type DbImport = {
  id: number;
  date: string;
  supplier: string;
  invoiceNumber: string | null;
  declarationNumber: string | null;
  exchangeRate: number;
  totalTransportCost: number;
  totalTerminalCost: number;
  totalAgencyCost: number;
  totalVatCost: number;
  documentUrl: string | null;
  documentName: string | null;
  status: string;
  items: Array<{
    productId: number;
    quantity: number;
    unit: string;
    unitPriceUsd: number;
    weight: number;
    itemType?: string;
    inventorySubType?: string;
    accountingCategory?: string;
  }>;
};

async function fetchImport(importId: number): Promise<DbImport | null> {
  try {
    // Ensure columns exist (idempotent — safe to run every time)
    await query(`ALTER TABLE import_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'inventory'`);
    await query(`ALTER TABLE import_items ADD COLUMN IF NOT EXISTS inventory_sub_type TEXT NOT NULL DEFAULT 'regular'`);
    await query(`ALTER TABLE import_items ADD COLUMN IF NOT EXISTS accounting_category TEXT`);

    const imp = await queryOne<{
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
      document_url: string | null;
      document_name: string | null;
      status: string;
    }>(
      `SELECT id, date, supplier, invoice_number, declaration_number, exchange_rate,
              total_transport_cost, total_terminal_cost, total_agency_cost, total_vat_cost,
              document_url, document_name, status
       FROM imports WHERE id = $1`,
      [importId],
    );
    if (!imp) return null;

    const items = await query<{
      product_id: number;
      quantity: string;
      unit: string;
      unit_price_usd: string;
      weight: string;
      item_type: string;
      inventory_sub_type: string;
      accounting_category: string | null;
    }>(
      `SELECT product_id, quantity, unit, unit_price_usd, weight,
              COALESCE(item_type, 'inventory') AS item_type,
              COALESCE(inventory_sub_type, 'regular') AS inventory_sub_type,
              accounting_category
       FROM import_items WHERE import_id = $1 ORDER BY id`,
      [importId],
    );

    return {
      id:                 imp.id,
      date:               (imp.date instanceof Date ? imp.date.toISOString() : String(imp.date)).slice(0, 10),
      supplier:           imp.supplier,
      invoiceNumber:      imp.invoice_number,
      declarationNumber:  imp.declaration_number,
      exchangeRate:       Number(imp.exchange_rate),
      totalTransportCost: Number(imp.total_transport_cost),
      totalTerminalCost:  Number(imp.total_terminal_cost),
      totalAgencyCost:    Number(imp.total_agency_cost),
      totalVatCost:       Number(imp.total_vat_cost),
      documentUrl:        imp.document_url,
      documentName:       imp.document_name,
      status:             imp.status,
      items: items.map((it) => ({
        productId:          it.product_id,
        quantity:           Number(it.quantity),
        unit:               it.unit,
        unitPriceUsd:       Number(it.unit_price_usd),
        weight:             Number(it.weight),
        itemType:           it.item_type,
        inventorySubType:   it.inventory_sub_type,
        accountingCategory: it.accounting_category ?? "",
      })),
    };
  } catch {
    return null;
  }
}

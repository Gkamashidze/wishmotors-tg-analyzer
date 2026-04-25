import { TopBar } from "@/components/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { query } from "@/lib/db";
import { DebtorPayButton } from "@/components/dashboard/debtor-pay-button";

type DebtorSale = {
  id: number;
  product_name: string;
  oem_code: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  sold_at: string;
  client_name: string | null;
  customer_name: string | null;
  notes: string | null;
};

type DebtorGroup = {
  client_name: string;
  total_debt: number;
  sales: DebtorSale[];
};
import { Users, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getDebtors(): Promise<DebtorGroup[]> {
  const rows = await query<{
    id: number;
    product_name: string;
    oem_code: string | null;
    quantity: number;
    unit_price: string;
    total_amount: string;
    sold_at: string;
    client_name: string | null;
    customer_name: string | null;
    notes: string | null;
  }>(`
    SELECT
      s.id,
      COALESCE(p.name, s.notes, 'უცნობი პროდუქტი') AS product_name,
      p.oem_code,
      s.quantity,
      s.unit_price,
      ROUND(s.quantity * s.unit_price, 2)           AS total_amount,
      s.sold_at,
      s.client_name,
      s.customer_name,
      s.notes
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id
    WHERE s.payment_status = 'debt'
      AND s.status != 'returned'
    ORDER BY
      COALESCE(s.client_name, s.customer_name, ''),
      s.sold_at DESC
  `);

  const groupMap = new Map<string, DebtorGroup>();
  for (const row of rows) {
    const key = row.client_name || row.customer_name || "უცნობი კლიენტი";
    if (!groupMap.has(key)) {
      groupMap.set(key, { client_name: key, total_debt: 0, sales: [] });
    }
    const group = groupMap.get(key)!;
    const sale: DebtorSale = {
      id: row.id,
      product_name: row.product_name,
      oem_code: row.oem_code,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      total_amount: Number(row.total_amount),
      sold_at: row.sold_at,
      client_name: row.client_name,
      customer_name: row.customer_name,
      notes: row.notes,
    };
    group.sales.push(sale);
    group.total_debt = Number((group.total_debt + sale.total_amount).toFixed(2));
  }

  return Array.from(groupMap.values()).sort((a, b) => b.total_debt - a.total_debt);
}

function fmt(n: number) {
  return n.toLocaleString("ka-GE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("ka-GE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function DebtorsPage() {
  const groups = await getDebtors();
  const grandTotal = groups.reduce((s, g) => s + g.total_debt, 0);

  return (
    <>
      <TopBar title="ნისია" />
      <main className="p-6 space-y-6 animate-fade-in">

        {/* Summary banner */}
        <div className="flex items-center gap-4 flex-wrap">
          <Card className="flex-1 min-w-[200px]">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">კლიენტები</p>
                  <p className="text-2xl font-semibold">{groups.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[200px]">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">სულ ვალი</p>
                  <p className="text-2xl font-semibold text-destructive">{fmt(grandTotal)} ₾</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {groups.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              ვალი არ არის. ყველა გაყიდვა ანაზღაურებულია.
            </CardContent>
          </Card>
        )}

        {groups.map((group) => (
          <Card key={group.client_name}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{group.client_name}</CardTitle>
                <Badge variant="destructive" className="text-xs font-semibold">
                  სულ: {fmt(group.total_debt)} ₾
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {group.sales.length} გაყიდვა
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-t border-b bg-muted/40">
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">პროდუქტი</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">რ-ბა</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">ფასი</th>
                      <th className="px-4 py-2 text-right font-medium text-muted-foreground">ჯამი</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">თარიღი</th>
                      <th className="px-4 py-2 text-center font-medium text-muted-foreground">გადახდა</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.sales.map((sale, idx) => (
                      <tr
                        key={sale.id}
                        className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{sale.product_name}</div>
                          {sale.oem_code && (
                            <div className="text-xs text-muted-foreground">{sale.oem_code}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{sale.quantity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sale.unit_price)} ₾</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-destructive">
                          {fmt(sale.total_amount)} ₾
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {fmtDate(sale.sold_at)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <DebtorPayButton saleId={sale.id} amount={sale.total_amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </>
  );
}

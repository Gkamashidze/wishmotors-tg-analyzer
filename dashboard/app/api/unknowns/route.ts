import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const unknownProducts = await query<{
    id: number;
    name: string;
    oem_code: string | null;
    current_stock: number;
    min_stock: number;
    unit_price: string;
    unit: string;
    last_sale_at: Date | null;
    sale_count: string;
    total_qty: string;
    total_revenue: string;
  }>(
    `SELECT
       p.id, p.name, p.oem_code, p.current_stock, p.min_stock, p.unit_price, p.unit,
       MAX(s.sold_at) AS last_sale_at,
       COUNT(s.id) AS sale_count,
       COALESCE(SUM(s.quantity), 0) AS total_qty,
       COALESCE(SUM(s.quantity * s.unit_price), 0) AS total_revenue
     FROM products p
     LEFT JOIN sales s ON s.product_id = p.id AND s.status = 'active'
     WHERE p.name ILIKE '%უცნობი%' OR p.oem_code ILIKE '%უცნობი%'
     GROUP BY p.id, p.name, p.oem_code, p.current_stock, p.min_stock, p.unit_price, p.unit
     ORDER BY sale_count DESC, last_sale_at DESC NULLS LAST`,
  );

  const productIds = unknownProducts.map((p) => p.id);

  const recentSales =
    productIds.length > 0
      ? await query<{
          product_id: number;
          id: number;
          quantity: number;
          unit_price: string;
          sold_at: Date;
          payment_method: string;
          customer_name: string | null;
        }>(
          `SELECT product_id, id, quantity, unit_price, sold_at, payment_method, customer_name
           FROM sales
           WHERE product_id = ANY($1) AND status = 'active'
           ORDER BY sold_at DESC`,
          [productIds],
        )
      : [];

  return NextResponse.json({
    products: unknownProducts.map((p) => ({
      id: p.id,
      name: p.name,
      oemCode: p.oem_code,
      currentStock: p.current_stock,
      minStock: p.min_stock,
      unitPrice: Number(p.unit_price),
      unit: p.unit,
      lastSaleAt:
        p.last_sale_at instanceof Date
          ? p.last_sale_at.toISOString()
          : p.last_sale_at
            ? String(p.last_sale_at)
            : null,
      saleCount: Number(p.sale_count),
      totalQty: Number(p.total_qty),
      totalRevenue: Number(p.total_revenue),
    })),
    recentSales: recentSales.map((s) => ({
      productId: s.product_id,
      id: s.id,
      quantity: s.quantity,
      unitPrice: Number(s.unit_price),
      soldAt:
        s.sold_at instanceof Date ? s.sold_at.toISOString() : String(s.sold_at),
      paymentMethod: s.payment_method,
      customerName: s.customer_name,
    })),
  });
}

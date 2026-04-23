import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── GET: unknown products + orphaned sales (product_id IS NULL) ──────────────

export async function GET() {
  // 1. Products with 'უცნობი' in name or oem_code
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
       COUNT(s.id)    AS sale_count,
       COALESCE(SUM(s.quantity), 0)             AS total_qty,
       COALESCE(SUM(s.quantity * s.unit_price), 0) AS total_revenue
     FROM products p
     LEFT JOIN sales s ON s.product_id = p.id AND s.status = 'active'
     WHERE p.name ILIKE '%უცნობი%' OR p.oem_code ILIKE '%უცნობი%'
     GROUP BY p.id, p.name, p.oem_code, p.current_stock, p.min_stock, p.unit_price, p.unit
     ORDER BY sale_count DESC, last_sale_at DESC NULLS LAST`,
  );

  const productIds = unknownProducts.map((p) => p.id);
  const productSales =
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

  // 2. Orphaned sales: product_id IS NULL — group by notes text
  const orphanedGroups = await query<{
    notes_text: string | null;
    sale_ids: number[];
    sale_count: string;
    total_qty: string;
    total_revenue: string;
    avg_price: string;
    first_sale_at: Date;
    last_sale_at: Date;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(notes), ''), '(შენიშვნა არ არის)') AS notes_text,
       ARRAY_AGG(id ORDER BY sold_at DESC)  AS sale_ids,
       COUNT(*)                             AS sale_count,
       SUM(quantity)                        AS total_qty,
       SUM(quantity * unit_price)           AS total_revenue,
       AVG(unit_price)                      AS avg_price,
       MIN(sold_at)                         AS first_sale_at,
       MAX(sold_at)                         AS last_sale_at
     FROM sales
     WHERE product_id IS NULL AND status = 'active'
     GROUP BY COALESCE(NULLIF(TRIM(notes), ''), '(შენიშვნა არ არის)')
     ORDER BY sale_count DESC, last_sale_at DESC`,
  );

  // Recent individual sales for each orphaned group (for context display)
  const allOrphanedIds = orphanedGroups.flatMap((g) => g.sale_ids.slice(0, 5));
  const orphanedSalesContext =
    allOrphanedIds.length > 0
      ? await query<{
          id: number;
          quantity: number;
          unit_price: string;
          sold_at: Date;
          payment_method: string;
          customer_name: string | null;
          notes: string | null;
        }>(
          `SELECT id, quantity, unit_price, sold_at, payment_method, customer_name, notes
           FROM sales
           WHERE id = ANY($1)
           ORDER BY sold_at DESC`,
          [allOrphanedIds],
        )
      : [];

  const toIso = (d: Date | unknown) =>
    d instanceof Date ? d.toISOString() : String(d);

  return NextResponse.json({
    unknownProducts: unknownProducts.map((p) => ({
      id: p.id,
      name: p.name,
      oemCode: p.oem_code,
      currentStock: p.current_stock,
      minStock: p.min_stock,
      unitPrice: Number(p.unit_price),
      unit: p.unit,
      lastSaleAt: p.last_sale_at ? toIso(p.last_sale_at) : null,
      saleCount: Number(p.sale_count),
      totalQty: Number(p.total_qty),
      totalRevenue: Number(p.total_revenue),
    })),
    productSales: productSales.map((s) => ({
      productId: s.product_id,
      id: s.id,
      quantity: s.quantity,
      unitPrice: Number(s.unit_price),
      soldAt: toIso(s.sold_at),
      paymentMethod: s.payment_method,
      customerName: s.customer_name,
    })),
    orphanedGroups: orphanedGroups.map((g) => ({
      notesText: g.notes_text,
      saleIds: g.sale_ids,
      saleCount: Number(g.sale_count),
      totalQty: Number(g.total_qty),
      totalRevenue: Number(g.total_revenue),
      avgPrice: Number(g.avg_price),
      firstSaleAt: toIso(g.first_sale_at),
      lastSaleAt: toIso(g.last_sale_at),
    })),
    orphanedSalesContext: orphanedSalesContext.map((s) => ({
      id: s.id,
      quantity: s.quantity,
      unitPrice: Number(s.unit_price),
      soldAt: toIso(s.sold_at),
      paymentMethod: s.payment_method,
      customerName: s.customer_name,
      notes: s.notes,
    })),
  });
}

// ─── PATCH: link orphaned sales to a product ──────────────────────────────────

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const { sale_ids, product_id } = body;

  if (
    !Array.isArray(sale_ids) ||
    sale_ids.length === 0 ||
    !Number.isFinite(Number(product_id))
  ) {
    return NextResponse.json(
      { error: "sale_ids (array) and product_id (number) are required" },
      { status: 400 },
    );
  }

  const ids = (sale_ids as unknown[]).map(Number).filter(Number.isFinite);
  const pid = Number(product_id);

  // Verify product exists
  const productCheck = await query<{ id: number }>(
    "SELECT id FROM products WHERE id = $1",
    [pid],
  );
  if (productCheck.length === 0) {
    return NextResponse.json({ error: "პროდუქტი ვერ მოიძებნა" }, { status: 404 });
  }

  const result = await query<{ id: number }>(
    `UPDATE sales
     SET product_id = $1,
         notes      = NULL
     WHERE id = ANY($2) AND product_id IS NULL
     RETURNING id`,
    [pid, ids],
  );

  return NextResponse.json({ ok: true, updated: result.length });
}

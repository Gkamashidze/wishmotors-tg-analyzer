import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { upsertItems, type ImportItemPayload } from "@/lib/erp-imports";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ── GET /api/erp-imports/[id] ─────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
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
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, date, supplier, invoice_number, declaration_number, exchange_rate,
              total_transport_cost, total_terminal_cost, total_agency_cost, total_vat_cost,
              document_url, document_name, status, created_at, updated_at
       FROM imports WHERE id = $1`,
      [importId],
    );

    if (!imp) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const items = await query<{
      id: number;
      product_id: number;
      product_name: string;
      oem_code: string | null;
      quantity: string;
      unit: string;
      unit_price_usd: string;
      weight: string;
      total_price_usd: string;
      total_price_gel: string;
      allocated_transport_cost: string;
      allocated_terminal_cost: string;
      allocated_agency_cost: string;
      allocated_vat_cost: string;
      landed_cost_per_unit_gel: string;
      item_type: string;
    }>(
      `SELECT ii.id, ii.product_id, p.name AS product_name, p.oem_code,
              ii.quantity, ii.unit, ii.unit_price_usd, ii.weight,
              ii.total_price_usd, ii.total_price_gel,
              ii.allocated_transport_cost, ii.allocated_terminal_cost,
              ii.allocated_agency_cost, ii.allocated_vat_cost,
              ii.landed_cost_per_unit_gel,
              COALESCE(ii.item_type, 'inventory') AS item_type
       FROM import_items ii
       JOIN products p ON p.id = ii.product_id
       WHERE ii.import_id = $1
       ORDER BY ii.id`,
      [importId],
    );

    return NextResponse.json({
      id:                 imp.id,
      date:               toDateStr(imp.date),
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
      createdAt:          toIso(imp.created_at),
      updatedAt:          toIso(imp.updated_at),
      items: items.map((it) => ({
        id:                     it.id,
        productId:              it.product_id,
        productName:            it.product_name,
        oemCode:                it.oem_code,
        quantity:               Number(it.quantity),
        unit:                   it.unit,
        unitPriceUsd:           Number(it.unit_price_usd),
        weight:                 Number(it.weight),
        totalPriceUsd:          Number(it.total_price_usd),
        totalPriceGel:          Number(it.total_price_gel),
        allocatedTransportCost: Number(it.allocated_transport_cost),
        allocatedTerminalCost:  Number(it.allocated_terminal_cost),
        allocatedAgencyCost:    Number(it.allocated_agency_cost),
        allocatedVatCost:       Number(it.allocated_vat_cost),
        landedCostPerUnitGel:   Number(it.landed_cost_per_unit_gel),
        itemType:               it.item_type,
      })),
    });
  } catch (err) {
    console.error("[erp-imports/:id GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Allowed document MIME types ───────────────────────────────────────────────

const ALLOWED_DOC_PREFIXES = [
  "data:application/pdf;base64,",
  "data:image/jpeg;base64,",
  "data:image/png;base64,",
  "data:image/webp;base64,",
  "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,",
  "data:application/vnd.ms-excel;base64,",
  "data:text/csv;base64,",
] as const;

function isAllowedDocumentUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  return ALLOWED_DOC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// ── PATCH /api/erp-imports/[id] — update draft ────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = await req.json() as {
      date?: string;
      supplier?: string;
      invoiceNumber?: string | null;
      declarationNumber?: string | null;
      exchangeRate?: number;
      totalTransportCost?: number;
      totalTerminalCost?: number;
      totalAgencyCost?: number;
      totalVatCost?: number;
      documentUrl?: string | null;
      documentName?: string | null;
      items?: ImportItemPayload[];
    };

    if (!isAllowedDocumentUrl(body.documentUrl)) {
      return NextResponse.json({ error: "დაუშვებელი ფაილის ტიპი" }, { status: 400 });
    }

    await query(
      `UPDATE imports SET
         date                 = COALESCE($1::date,  date),
         supplier             = COALESCE($2,        supplier),
         invoice_number       = $3,
         declaration_number   = $4,
         exchange_rate        = COALESCE($5,        exchange_rate),
         total_transport_cost = COALESCE($6,        total_transport_cost),
         total_terminal_cost  = COALESCE($7,        total_terminal_cost),
         total_agency_cost    = COALESCE($8,        total_agency_cost),
         total_vat_cost       = COALESCE($9,        total_vat_cost),
         document_url         = COALESCE($10,       document_url),
         document_name        = COALESCE($11,       document_name),
         updated_at           = NOW()
       WHERE id = $12 AND status = 'draft'`,
      [
        body.date               ?? null,
        body.supplier           ?? null,
        body.invoiceNumber      ?? null,
        body.declarationNumber  ?? null,
        body.exchangeRate       ?? null,
        body.totalTransportCost ?? null,
        body.totalTerminalCost  ?? null,
        body.totalAgencyCost    ?? null,
        body.totalVatCost       ?? null,
        body.documentUrl        ?? null,
        body.documentName       ?? null,
        importId,
      ],
    );

    if (body.items !== undefined) await upsertItems(importId, body.items);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp-imports/:id PATCH]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── DELETE /api/erp-imports/[id] — remove draft ───────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const importId = Number(id);
  if (isNaN(importId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await query("DELETE FROM imports WHERE id = $1 AND status = 'draft'", [importId]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[erp-imports/:id DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(v: Date | string): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

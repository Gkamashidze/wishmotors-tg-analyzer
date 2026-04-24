import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { upsertItems, type ImportItemPayload } from "@/lib/erp-imports";

export const dynamic = "force-dynamic";

// ── GET /api/erp-imports ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  const status = searchParams.get("status");

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let   p = 1;

  if (search) {
    conditions.push(`(i.supplier ILIKE $${p} OR i.invoice_number ILIKE $${p})`);
    params.push(`%${search}%`);
    p++;
  }
  if (from) {
    conditions.push(`i.date >= $${p}::date`);
    params.push(from);
    p++;
  }
  if (to) {
    conditions.push(`i.date <= $${p}::date`);
    params.push(to);
    p++;
  }
  if (status) {
    conditions.push(`i.status = $${p}`);
    params.push(status);
    p++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const rows = await query<{
      id: number;
      date: Date;
      supplier: string;
      invoice_number: string | null;
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
         i.id, i.date, i.supplier, i.invoice_number, i.exchange_rate,
         i.total_transport_cost, i.total_terminal_cost,
         i.total_agency_cost, i.total_vat_cost,
         i.document_name, i.status, i.created_at, i.updated_at,
         COUNT(ii.id)                        AS items_count,
         COALESCE(SUM(ii.total_price_gel),0) AS total_value_gel
       FROM imports i
       LEFT JOIN import_items ii ON ii.import_id = i.id
       ${where}
       GROUP BY i.id
       ORDER BY i.date DESC, i.created_at DESC
       LIMIT 300`,
      params,
    );

    return NextResponse.json(
      rows.map((r) => ({
        id:                 r.id,
        date:               toDateStr(r.date),
        supplier:           r.supplier,
        invoiceNumber:      r.invoice_number,
        exchangeRate:       Number(r.exchange_rate),
        totalTransportCost: Number(r.total_transport_cost),
        totalTerminalCost:  Number(r.total_terminal_cost),
        totalAgencyCost:    Number(r.total_agency_cost),
        totalVatCost:       Number(r.total_vat_cost),
        documentName:       r.document_name,
        status:             r.status,
        createdAt:          toIso(r.created_at),
        updatedAt:          toIso(r.updated_at),
        itemsCount:         Number(r.items_count),
        totalValueGel:      Number(r.total_value_gel),
      })),
    );
  } catch (err) {
    console.error("[erp-imports GET]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Allowed document MIME types (base64 data URL prefix check) ───────────────

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

// ── POST /api/erp-imports — create new draft ──────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      date: string;
      supplier: string;
      invoiceNumber?: string;
      exchangeRate: number;
      totalTransportCost: number;
      totalTerminalCost: number;
      totalAgencyCost: number;
      totalVatCost: number;
      documentUrl?: string;
      documentName?: string;
      items: ImportItemPayload[];
    };

    if (!isAllowedDocumentUrl(body.documentUrl)) {
      return NextResponse.json({ error: "დაუშვებელი ფაილის ტიპი" }, { status: 400 });
    }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO imports
         (date, supplier, invoice_number, exchange_rate,
          total_transport_cost, total_terminal_cost, total_agency_cost, total_vat_cost,
          document_url, document_name, status)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')
       RETURNING id`,
      [
        body.date,
        body.supplier,
        body.invoiceNumber || null,
        body.exchangeRate,
        body.totalTransportCost,
        body.totalTerminalCost,
        body.totalAgencyCost,
        body.totalVatCost,
        body.documentUrl || null,
        body.documentName || null,
      ],
    );

    if (!row) throw new Error("Insert failed");

    if (body.items?.length) await upsertItems(row.id, body.items);

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    console.error("[erp-imports POST]", err);
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

import "server-only";
import { query, queryOne, withTransaction } from "./db";

export type PersonalOrderStatus =
  | "ordered"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "cancelled";

export interface PersonalOrderItem {
  id: number;
  part_name: string;
  oem_code: string | null;
}

export interface PersonalOrderRow {
  id: number;
  tracking_token: string;
  customer_name: string;
  customer_contact: string | null;
  part_name: string;
  oem_code: string | null;
  cost_price: number | null;
  transportation_cost: number | null;
  vat_amount: number | null;
  sale_price_min: number | null;
  sale_price: number;
  amount_paid: number;
  status: PersonalOrderStatus;
  estimated_arrival: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: PersonalOrderItem[];
}

export interface PublicPersonalOrderRow {
  id: number;
  tracking_token: string;
  customer_name: string;
  part_name: string;
  oem_code: string | null;
  sale_price_min: number | null;
  sale_price: number;
  amount_paid: number;
  status: PersonalOrderStatus;
  estimated_arrival: string | null;
  created_at: string;
  items: PersonalOrderItem[];
}

const ITEMS_SUBQUERY = `
  COALESCE(
    (SELECT json_agg(json_build_object(
               'id', i.id, 'part_name', i.part_name, 'oem_code', i.oem_code
             ) ORDER BY i.id)
     FROM personal_order_items i WHERE i.order_id = o.id),
    '[]'::json
  ) AS items
`;

export async function getPersonalOrders(limit = 100): Promise<PersonalOrderRow[]> {
  return query<PersonalOrderRow>(
    `SELECT o.id, o.tracking_token, o.customer_name, o.customer_contact,
            o.part_name, o.oem_code, o.cost_price, o.transportation_cost, o.vat_amount,
            o.sale_price_min, o.sale_price, o.amount_paid, o.status,
            o.estimated_arrival, o.notes, o.created_at, o.updated_at,
            ${ITEMS_SUBQUERY}
     FROM personal_orders o
     ORDER BY o.created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function getPersonalOrderById(id: number): Promise<PersonalOrderRow | null> {
  return queryOne<PersonalOrderRow>(
    `SELECT o.*, ${ITEMS_SUBQUERY} FROM personal_orders o WHERE o.id = $1`,
    [id],
  );
}

export async function getPersonalOrderByToken(token: string): Promise<PublicPersonalOrderRow | null> {
  return queryOne<PublicPersonalOrderRow>(
    `SELECT o.id, o.tracking_token, o.customer_name, o.part_name, o.oem_code,
            o.sale_price_min, o.sale_price, o.amount_paid,
            o.status, o.estimated_arrival, o.created_at,
            ${ITEMS_SUBQUERY}
     FROM personal_orders o
     WHERE o.tracking_token = $1`,
    [token],
  );
}

export async function createPersonalOrder(data: {
  customer_name: string;
  customer_contact?: string | null;
  items: { part_name: string; oem_code?: string | null }[];
  cost_price?: number | null;
  transportation_cost?: number | null;
  vat_amount?: number | null;
  sale_price_min?: number | null;
  sale_price: number;
  estimated_arrival?: string | null;
  notes?: string | null;
}): Promise<PersonalOrderRow> {
  const primaryItem = data.items[0] ?? { part_name: "", oem_code: null };
  return withTransaction(async (client) => {
    const result = await client.query<PersonalOrderRow>(
      `INSERT INTO personal_orders
         (customer_name, customer_contact, part_name, oem_code,
          cost_price, transportation_cost, vat_amount,
          sale_price_min, sale_price, estimated_arrival, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        data.customer_name,
        data.customer_contact ?? null,
        primaryItem.part_name,
        primaryItem.oem_code ?? null,
        data.cost_price ?? null,
        data.transportation_cost ?? null,
        data.vat_amount ?? null,
        data.sale_price_min ?? null,
        data.sale_price,
        data.estimated_arrival ?? null,
        data.notes ?? null,
      ],
    );
    const orderId = result.rows[0].id;
    for (const item of data.items) {
      await client.query(
        "INSERT INTO personal_order_items (order_id, part_name, oem_code) VALUES ($1,$2,$3)",
        [orderId, item.part_name, item.oem_code ?? null],
      );
    }
    const full = await client.query<PersonalOrderRow>(
      `SELECT o.*, ${ITEMS_SUBQUERY} FROM personal_orders o WHERE o.id = $1`,
      [orderId],
    );
    return full.rows[0];
  });
}

export async function updatePersonalOrder(
  id: number,
  data: Partial<Omit<PersonalOrderRow, "id" | "tracking_token" | "created_at" | "updated_at" | "items">>,
): Promise<void> {
  const allowed = [
    "customer_name", "customer_contact", "part_name", "oem_code",
    "cost_price", "transportation_cost", "vat_amount",
    "sale_price_min", "sale_price", "amount_paid", "status", "estimated_arrival", "notes",
  ] as const;
  const entries = Object.entries(data).filter(([k]) => allowed.includes(k as typeof allowed[number]));
  if (!entries.length) return;
  const setClauses = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const values = entries.map(([, v]) => v);
  await query(
    `UPDATE personal_orders SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
    [id, ...values],
  );
}

export async function deletePersonalOrder(id: number): Promise<void> {
  await query("DELETE FROM personal_orders WHERE id = $1", [id]);
}

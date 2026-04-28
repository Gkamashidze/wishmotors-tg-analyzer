import "server-only";
import { query, queryOne } from "./db";

export type PersonalOrderStatus =
  | "ordered"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "cancelled";

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
  sale_price: number;
  amount_paid: number;
  status: PersonalOrderStatus;
  estimated_arrival: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicPersonalOrderRow {
  id: number;
  tracking_token: string;
  customer_name: string;
  part_name: string;
  oem_code: string | null;
  sale_price: number;
  amount_paid: number;
  status: PersonalOrderStatus;
  estimated_arrival: string | null;
  created_at: string;
}

export async function getPersonalOrders(limit = 100): Promise<PersonalOrderRow[]> {
  return query<PersonalOrderRow>(
    `SELECT id, tracking_token, customer_name, customer_contact,
            part_name, oem_code, cost_price, transportation_cost, vat_amount,
            sale_price, amount_paid, status, estimated_arrival, notes,
            created_at, updated_at
     FROM personal_orders
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function getPersonalOrderById(id: number): Promise<PersonalOrderRow | null> {
  return queryOne<PersonalOrderRow>(
    "SELECT * FROM personal_orders WHERE id = $1",
    [id],
  );
}

export async function getPersonalOrderByToken(token: string): Promise<PublicPersonalOrderRow | null> {
  return queryOne<PublicPersonalOrderRow>(
    `SELECT id, tracking_token, customer_name, part_name, oem_code,
            sale_price, amount_paid, status, estimated_arrival, created_at
     FROM personal_orders
     WHERE tracking_token = $1`,
    [token],
  );
}

export async function createPersonalOrder(data: {
  customer_name: string;
  customer_contact?: string | null;
  part_name: string;
  oem_code?: string | null;
  cost_price?: number | null;
  transportation_cost?: number | null;
  vat_amount?: number | null;
  sale_price: number;
  estimated_arrival?: string | null;
  notes?: string | null;
}): Promise<PersonalOrderRow> {
  const rows = await query<PersonalOrderRow>(
    `INSERT INTO personal_orders
       (customer_name, customer_contact, part_name, oem_code,
        cost_price, transportation_cost, vat_amount,
        sale_price, estimated_arrival, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      data.customer_name,
      data.customer_contact ?? null,
      data.part_name,
      data.oem_code ?? null,
      data.cost_price ?? null,
      data.transportation_cost ?? null,
      data.vat_amount ?? null,
      data.sale_price,
      data.estimated_arrival ?? null,
      data.notes ?? null,
    ],
  );
  return rows[0];
}

export async function updatePersonalOrder(
  id: number,
  data: Partial<Omit<PersonalOrderRow, "id" | "tracking_token" | "created_at" | "updated_at">>,
): Promise<void> {
  const allowed = [
    "customer_name", "customer_contact", "part_name", "oem_code",
    "cost_price", "transportation_cost", "vat_amount",
    "sale_price", "amount_paid", "status", "estimated_arrival", "notes",
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

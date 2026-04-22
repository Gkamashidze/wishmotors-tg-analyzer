import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const [countRow] = await query<{ total: string; by_status: string; by_priority: string }>(
    `SELECT
       COUNT(*)::text                                                          AS total,
       json_agg(json_build_object('status', status, 'n', cnt) ORDER BY cnt DESC)::text AS by_status,
       json_agg(json_build_object('priority', priority, 'n', pcnt) ORDER BY pcnt DESC)::text AS by_priority
     FROM (
       SELECT 'x' AS x,
              (SELECT json_agg(r) FROM (SELECT COALESCE(status,'pending') AS status, COUNT(*)::int AS cnt FROM orders GROUP BY 1) r) AS status,
              (SELECT json_agg(r) FROM (SELECT COALESCE(priority,'low')   AS priority, COUNT(*)::int AS pcnt FROM orders GROUP BY 1) r) AS priority,
              (SELECT COUNT(*)::text FROM orders) AS total
     ) sub`,
  );

  const total = await query<{ total: bigint }>("SELECT COUNT(*) AS total FROM orders");
  const byStatus = await query<{ status: string; n: bigint }>(
    "SELECT COALESCE(status,'pending') AS status, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  const byPriority = await query<{ priority: string; n: bigint }>(
    "SELECT COALESCE(priority,'low') AS priority, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  const sample = await query<{ id: number; status: string; priority: string; created_at: unknown; part_name: string }>(
    "SELECT id, COALESCE(status,'pending') AS status, COALESCE(priority,'low') AS priority, created_at, COALESCE(part_name,'') AS part_name FROM orders ORDER BY id ASC LIMIT 10",
  );

  return NextResponse.json({
    total: Number(total[0]?.total ?? 0),
    byStatus: byStatus.map((r) => ({ status: r.status, n: Number(r.n) })),
    byPriority: byPriority.map((r) => ({ priority: r.priority, n: Number(r.n) })),
    oldest10: sample,
  });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const total = await query<{ total: bigint }>("SELECT COUNT(*) AS total FROM orders");
  const byStatus = await query<{ status: string; n: bigint }>(
    "SELECT status, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  const byPriority = await query<{ priority: string; n: bigint }>(
    "SELECT priority, COUNT(*) AS n FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  const sample = await query<{ id: number; status: string; priority: string; created_at: unknown; part_name: string }>(
    "SELECT id, status, priority, created_at, COALESCE(part_name,'') AS part_name FROM orders ORDER BY id ASC LIMIT 10",
  );

  return NextResponse.json({
    total: Number(total[0]?.total ?? 0),
    byStatus: byStatus.map((r) => ({ status: r.status, n: Number(r.n) })),
    byPriority: byPriority.map((r) => ({ priority: r.priority, n: Number(r.n) })),
    oldest10: sample,
  });
}

# Performance Fixes — Copy-Paste Ready

---

## Fix #1 — schema_versions table (one-time migrations)

```python
# database/db.py — add before MIGRATE_SQL execution

_SCHEMA_VERSIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_versions (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);
"""

_MIGRATIONS: list[tuple[int, str, str]] = [
    (1, "backfill orders priority", "UPDATE orders SET priority = 'low' WHERE priority IS NULL"),
    (2, "backfill sales seller_type", "UPDATE sales SET seller_type = 'llc' WHERE seller_type IS NULL"),
    # add future migrations here
]

async def _run_migrations(self, conn) -> None:
    await conn.execute(_SCHEMA_VERSIONS_DDL)
    applied = {r["version"] for r in await conn.fetch("SELECT version FROM schema_versions")}
    for version, description, sql in _MIGRATIONS:
        if version not in applied:
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO schema_versions(version, description) VALUES($1, $2)",
                version, description
            )
            logger.info(f"Migration {version} applied: {description}")
```

---

## Fix #2 — Dashboard AI endpoint rate limiting

```ts
// dashboard/lib/rate-limit.ts
import { Redis } from "@upstash/redis"  // or use ioredis if self-hosted

const redis = Redis.fromEnv()

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining: number }> {
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSec)
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) }
}

// In generate-description/route.ts:
const { allowed } = await checkRateLimit(
  `wishmotors:rate:gen-desc:${userId}`,
  10,   // 10 per hour
  3600
)
if (!allowed) {
  return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 })
}
```

"""
Data migration: clean up NULL values and legacy priority values in the orders table.

What this does:
  1. quantity_needed = NULL → 0
  2. oem_code        = NULL → '-'
  3. part_name       = NULL → 'ძველი ჩანაწერი'
  4. priority        = NULL or any non-'urgent' legacy value → 'low'
"""

import asyncio
import os
import sys
from pathlib import Path

# ── Load .env ──────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL not set")

STEPS = [
    (
        "quantity_needed NULL → 0",
        "UPDATE orders SET quantity_needed = 0 WHERE quantity_needed IS NULL",
    ),
    (
        "oem_code NULL → '-'",
        "UPDATE orders SET oem_code = '-' WHERE oem_code IS NULL",
    ),
    (
        "part_name NULL → 'ძველი ჩანაწერი'",
        "UPDATE orders SET part_name = 'ძველი ჩანაწერი' WHERE part_name IS NULL",
    ),
    (
        "priority NULL/legacy → 'low'",
        "UPDATE orders SET priority = 'low' WHERE priority IS NULL OR priority NOT IN ('urgent', 'low')",
    ),
]


async def run() -> None:
    import asyncpg  # type: ignore

    ssl_ctx: object = None
    if "railway" in DATABASE_URL or os.environ.get("PGSSL") == "true":
        import ssl

        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(DATABASE_URL, ssl=ssl_ctx)
    try:
        # Show current state before migration
        total = await conn.fetchval("SELECT COUNT(*) FROM orders")
        print(f"\n── orders table: {total} rows total ──\n")

        for label, sql in STEPS:
            result = await conn.execute(sql)
            # asyncpg returns e.g. "UPDATE 7"
            count = result.split()[-1] if result else "?"
            print(f"  ✓  {label}  →  {count} rows updated")

        # Verify final state
        print("\n── Verification ──")
        checks = [
            (
                "quantity_needed IS NULL",
                "SELECT COUNT(*) FROM orders WHERE quantity_needed IS NULL",
            ),
            ("oem_code IS NULL", "SELECT COUNT(*) FROM orders WHERE oem_code IS NULL"),
            (
                "part_name IS NULL",
                "SELECT COUNT(*) FROM orders WHERE part_name IS NULL",
            ),
            (
                "priority not in (urgent,low)",
                "SELECT COUNT(*) FROM orders WHERE priority NOT IN ('urgent','low')",
            ),
        ]
        all_ok = True
        for desc, sql in checks:
            n = await conn.fetchval(sql)
            status = "✓" if n == 0 else "✗ STILL HAS NULLS/LEGACY"
            if n != 0:
                all_ok = False
            print(f"  {status}  {desc}: {n}")

        print()
        if all_ok:
            print("Migration complete — all columns are clean.")
        else:
            print("WARNING: some rows were not updated — check above.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())

# Performance Issues — Audit 2026-05-03

---

## პრობლემა #1 — get_all_products() unbounded SELECT
- 📍 ფაილი: `database/db.py:164`
- 🟢 სიმძიმე: Medium
- ❌ პრობლემა: `SELECT * FROM products ORDER BY name` — no LIMIT. AI search module და bot handlers ამ method-ს იყენებენ. 10k+ products → memory spike.
- ✅ გამოსწორება: Paginated version + `get_all_products_for_search()` separate capped version.
- 💻 კოდის მაგალითი:
```python
# For AI search (capped):
async def get_all_products_for_search(self, limit: int = 500) -> list[dict]:
    async with self._pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, oem, category FROM products ORDER BY name LIMIT $1",
            limit
        )
    return [dict(r) for r in rows]
```
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #2 — expenses SELECT without LIMIT (5 occurrences)
- 📍 ფაილი: `database/db.py:2245, 2256, 2456, 2469, 2480`
- 🟢 სიმძიმე: Medium
- ❌ პრობლემა: All expense queries filtered by date range but no pagination. Fine at current scale, will hurt as rows accumulate.
- ✅ გამოსწორება: Add `LIMIT 1000` as safety cap + cursor-based pagination for reports.
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #3 — 73% "use client" — waterfall fetching in dashboard
- 📍 ფაილი: `dashboard/components/` (40/55 files)
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Every dashboard component fetches its own data after mount → waterfall. Main `page.tsx` is Server Component but passes into client trees that immediately re-fetch independently. DB load doubles.
- ✅ გამოსწორება: Data fetching → Server Components + props passing to Client Components for interactivity only.
- ⏱ სავარაუდო დრო: 1 კვირა (Phase 4)

---

## პრობლემა #4 — MIGRATE_SQL full-table UPDATEs on every startup
- 📍 ფაილი: `database/db.py:51`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `UPDATE orders SET priority = 'low' WHERE priority IS NULL` და სხვა back-fill UPDATEs run on every bot start (+ 5 Railway restart retries on failure). Full table scans on each retry.
- ✅ გამოსწორება: `schema_versions` table — one-time migrations.
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #5 — No rate limiting on AI endpoints (dashboard)
- 📍 ფაილი: `dashboard/app/api/ai-insights/route.ts`, `dashboard/app/api/products/[id]/generate-description/route.ts`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Authenticated user-ი loop-ში Anthropic API-ს hammer-ს აკეთებს — unlimited API credit burn.
- ✅ გამოსწორება: Per-user Redis rate limit (10/hour for generate-description, 5/hour for ai-insights).
- ⏱ სავარაუდო დრო: 2 სთ

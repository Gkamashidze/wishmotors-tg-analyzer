# Architecture Issues — Audit 2026-05-03

---

## პრობლემა #1 — In-process caches break multi-instance deployment
- 📍 ფაილი: `bot/handlers/barcode.py:49`, `bot/handlers/__init__.py:44`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `_bc_cache: dict[int, dict]` (barcode pending state, TTL 60s) და `_last_called: dict[str, float]` (rate limiter) in-process dict-ებია. Railway multi-replica deploy-ზე user-ის ორი consecutive message-ი სხვადასხვა instance-ს ხვდება — barcode photo instance A-ზე, confirmation instance B-ზე, `bc_consume()` None-ს აბრუნებს, barcode silently ignored.
- ✅ გამოსწორება: Redis-ზე გადატანა. Redis უკვე stack-შია.
- ⚠️ რეგრესიის რისკი: Redis down → graceful fallback საჭირო
- ⏱ სავარაუდო დრო: 3 სთ

---

## პრობლემა #2 — Untracked asyncio.create_task (audit data loss)
- 📍 ფაილი: `database/db.py:101`, `bot/search_ai/catalog_search.py:71`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `asyncio.get_running_loop().create_task(...)` without reference. CPython GC collects unreferenced Tasks before completion. Audit trail — compliance feature — has a silent write-loss vector on every operation.
- ✅ გამოსწორება: `_tasks: set[asyncio.Task]` + `task.add_done_callback(_tasks.discard)`
- ⚠️ რეგრესიის რისკი: task set-ი memory leak-ს ქმნის unbounded growth-ით — discard callback აუცილებელია
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #3 — God-Object Database class (3,375 lines, 113 methods)
- 📍 ფაილი: `database/db.py`
- 🔴 სიმძიმე: კრიტიკული (long-term)
- ❌ პრობლემა: ერთ კლასში: products, sales, returns, orders, expenses, inventory, audit, cash, clients, ledger, VAT, catalog, personal orders, transfers, parse failures — SRP violation. 10x scale-ზე unmaintainable.
- ✅ გამოსწორება: Domain repositories — `ProductRepository`, `SaleRepository`, `LedgerService` — Phase 4.
- ⚠️ რეგრესიის რისკი: ყველა handler import-ი გადასაწერია — 2+ კვირა minimum
- ⏱ სავარაუდო დრო: 2+ კვირა (Phase 4)

---

## პრობლემა #4 — wizard.py — 2,784 lines, 4 wizards in one file
- 📍 ფაილი: `bot/handlers/wizard.py`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Sales wizard, nisia wizard, expense wizard, edit flows for all three — ერთ ფაილში. Regression ერთ wizard-ში 2,784 ხაზის reading context-ს საჭიროებს.
- ✅ გამოსწორება: `wizard_sales.py`, `wizard_nisia.py`, `wizard_expense.py` — თითო Router.
- ⚠️ რეგრესიის რისკი: FSM states shared between wizards? შეამოწმე state namespace.
- ⏱ სავარაუდო დრო: 1 კვირა (Phase 4)

---

## პრობლემა #5 — search_catalog() full catalog per call, no caching
- 📍 ფაილი: `bot/search_ai/catalog_search.py:100-111`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `_build_catalog_text(products)` ყოველ search-ზე მთელ catalog-ს Claude-ს უგზავნის. 500+ SKU-ზე 10k+ token per search. Prompt caching (`cache_control`) absent. New `AsyncAnthropic` client per call.
- ✅ გამოსწორება: Module-level singleton + `cache_control: ephemeral` system prompt-ზე.
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #6 — New AsyncAnthropic client per invocation
- 📍 ფაილი: `bot/financial_ai/analyzer.py:111`, `bot/search_ai/catalog_search.py:103`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: ყოველ call-ზე ახალი `httpx.AsyncClient` connection pool იქმნება და discarded — resource waste.
- ✅ გამოსწორება: Module-level singleton.
- 💻 კოდის მაგალითი:
```python
# module level (bot/financial_ai/analyzer.py)
_client: AsyncAnthropic | None = None

def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client
```
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #7 — DB pool exhaustion at 10x scale
- 📍 ფაილი: `database/db.py:44`, `dashboard/lib/db.ts:19`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Bot pool (max=10) + Dashboard pool (max=5) = 15 connections. Railway PostgreSQL ~25 limit. 10x message volume exhausts pool — handlers hang indefinitely.
- ✅ გამოსწორება: `timeout=5.0` on `pool.acquire()` + `max_inactive_connection_lifetime=300`
- ⏱ სავარაუდო დრო: 30 წთ

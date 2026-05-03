# Audit Roadmap — 2026-05-03

---

## 🔴 Phase 1 — კრიტიკული (1-3 დღე)

Security + Data Integrity + Bot Stability

| # | ამოცანა | ფაილი | ⏱ |
|---|---------|-------|---|
| 1 | წაშლა: `/api/debug/drive-config` და `/api/debug/orders` | `dashboard/app/api/debug/` | 30 წთ |
| 2 | `timingSafeEqual` → `crypto.timingSafeEqual(Buffer)` | `dashboard/middleware.ts:65` | 30 წთ |
| 3 | `ssl="require"` asyncpg pool-ზე | `database/db.py:44` | 15 წთ |
| 4 | Global `@dp.errors()` handler aiogram-ში | `bot/main.py` | 1 სთ |
| 5 | `TelegramRetryAfter` universal handling (shared util) | `bot/handlers/` | 2 სთ |
| 6 | `_bc_cache` გადატანა Redis-ზე (TTL 60s) | `bot/handlers/barcode.py` | 2 სთ |
| 7 | `_last_called` rate limiter → Redis INCR/EXPIRE | `bot/handlers/__init__.py` | 1 სთ |
| 8 | `asyncio.create_task` audit — reference tracking | `database/db.py:101` | 30 წთ |

---

## 🟡 Phase 2 — მნიშვნელოვანი (1-2 კვირა)

Error Handling + Testing + Security Headers

| # | ამოცანა | ფაილი | ⏱ |
|---|---------|-------|---|
| 9  | Raw `err.message` → generic client error (15+ routes) | `dashboard/app/api/*/route.ts` | 2 სთ |
| 10 | Content-Security-Policy header დამატება | `dashboard/middleware.ts` | 1 სთ |
| 11 | `images.remotePatterns` → specific hostnames | `dashboard/next.config.ts:22` | 15 წთ |
| 12 | DDL endpoints remove/gate: migrate-erp, migrate-currency | `dashboard/app/api/migrate-*/` | 1 სთ |
| 13 | Anthropic typed exceptions: `RateLimitError`, `APITimeoutError` | `bot/financial_ai/analyzer.py`, `bot/search_ai/catalog_search.py` | 2 სთ |
| 14 | Token usage logging: `response.usage` ყოველ call-ზე | ზემოთ + დანარჩენი AI calls | 1 სთ |
| 15 | AsyncAnthropic module-level singleton | `bot/financial_ai/analyzer.py:111`, `bot/search_ai/catalog_search.py:103` | 30 წთ |
| 16 | Prompt caching: `catalog_search.py` system prompt | `bot/search_ai/catalog_search.py` | 1 სთ |
| 17 | `returns` table indexes: product_id, sale_id | `database/models.py` MIGRATE_SQL | 30 წთ |
| 18 | MIGRATE_SQL — schema_versions guard | `database/db.py:51` | 3 სთ |
| 19 | `test_sales_handler.py` — 8 code path | `tests/` | 4 სთ |
| 20 | `test_financial_ai.py` — mock Anthropic, cache, degradation | `tests/` | 3 სთ |
| 21 | `test_formatter.py` — pure functions, no mocking needed | `tests/` | 2 სთ |
| 22 | error.tsx + loading.tsx main dashboard routes | `dashboard/app/` | 2 სთ |
| 23 | Rate limiting on `/api/ai-insights`, `/api/generate-description` | `dashboard/app/api/` | 2 სთ |

---

## 🟢 Phase 3 — გაუმჯობესება (1 თვე)

Code Quality + Performance + Documentation

| # | ამოცანა | ფაილი | ⏱ |
|---|---------|-------|---|
| 24 | `test_import_excel_parser.py` — openpyxl in-memory fixtures | `tests/` | 3 სთ |
| 25 | `test_barcode.py` — Claude Vision mock, TTL logic | `tests/` | 2 სთ |
| 26 | Dashboard vitest tests — 5 API route handlers | `dashboard/__tests__/` | 4 სთ |
| 27 | `products-table.tsx` decomposition (1,921 → 5 files) | `dashboard/components/` | 8 სთ |
| 28 | `get_all_products()` → paginated | `database/db.py:164` | 2 სთ |
| 29 | SELECT expenses LIMIT + pagination | `database/db.py:2245+` | 2 სთ |
| 30 | `orders` table index on status | `database/models.py` | 30 წთ |
| 31 | ILIKE wildcard escaping (db.py:135,253) | `database/db.py` | 1 სთ |
| 32 | `datetime.utcnow()` → `datetime.now(timezone.utc)` | `database/db.py:871` | 15 წთ |
| 33 | `assert isinstance()` → explicit guards in wizard.py | `bot/handlers/wizard.py` | 1 სთ |
| 34 | `.env.example` — 4 missing vars | `.env.example` | 15 წთ |
| 35 | README — 11 handlers + full command list | `README.md` | 1 სთ |
| 36 | RAILWAY_ENVIRONMENT guard documentation | `README.md` | 30 წთ |
| 37 | Staging Railway service setup | Railway dashboard | 2 სთ |
| 38 | GitHub branch protection rules | GitHub settings | 30 წთ |
| 39 | Bot rate limiter Redis migration (თუ Phase 1-ში გაკეთდა) | done | — |

---

## ⚪ Phase 4 — სამომავლო

Long-term architectural improvements

| # | ამოცანა | ⏱ |
|---|---------|---|
| 40 | `database/db.py` split → domain repositories (ProductRepo, SaleRepo, etc.) | 2+ კვირა |
| 41 | `bot/handlers/wizard.py` split → wizard_sales.py, wizard_nisia.py, wizard_expense.py | 1 კვირა |
| 42 | Next.js Server Components migration (reduce "use client" 73% → <40%) | 1 კვირა |
| 43 | asyncpg-specific exception handling per query type | 3 სთ |
| 44 | Full Playwright e2e tests (dashboard critical flows) | 1 კვირა |
| 45 | API documentation (OpenAPI spec ან simple markdown table) | 2 სთ |

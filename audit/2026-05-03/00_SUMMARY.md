# Audit Report — 2026-05-03

## Overall Score: 6.3 / 10

| კატეგორია       | ქულა | წონა | Issues |
|-----------------|------|------|--------|
| Security        | 6.4  | 20%  | 🔴 2, 🟡 5 |
| Code Quality    | 7.2  | 15%  | 🔴 2, 🟡 3 |
| Testing         | 4.2  | 15%  | 🔴 5, coverage: ~20% Python / 0% dashboard |
| Architecture    | 6.8  | 10%  | 🔴 3, 🟡 5 |
| Error Handling  | 6.2  | 10%  | 🔴 2, 🟡 4 |
| Frontend        | 6.4  | 10%  | 🔴 3, 🟡 4 |
| CI/CD           | 6.5  |  5%  | 🟡 4 |
| Database        | 7.5  |  5%  | 🟡 2, 🟢 3 |
| Git             | 7.0  |  5%  | bus factor: 1 |
| Documentation   | 6.8  |  5%  | 🟡 3 |

**Formula:**
(6.4×0.20) + (7.2×0.15) + (4.2×0.15) + (6.8×0.10) + (6.2×0.10) + (6.4×0.10) + (6.5×0.05) + (7.5×0.05) + (7.0×0.05) + (6.8×0.05)
= 1.28 + 1.08 + 0.63 + 0.68 + 0.62 + 0.64 + 0.325 + 0.375 + 0.35 + 0.34
= **6.30 / 10**

---

## 🔴 Critical (immediate)

### SEC-C1 — Debug endpoint leaks Google OAuth secrets
`dashboard/app/api/debug/drive-config/route.ts`
Returns first 8 chars of `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` to any Basic-Auth user. Acts as an oracle for credential validity. Must be deleted or hard-gated to dev-only.

### SEC-C2 — `timingSafeEqual` timing oracle leaks password length
`dashboard/middleware.ts:65-72`
Early-exit on `a.length !== b.length` reveals the correct password length to a remote attacker. Use `Buffer.from` + `crypto.timingSafeEqual` instead.

### DB-C1 — No SSL on database connection
`database/db.py:44`
`asyncpg.create_pool()` has no `ssl="require"`. Railway's PostgreSQL is publicly accessible on port 5432 — traffic is plaintext. Fix: add `ssl="require"`.

### TEST-C1 — `bot/handlers/sales.py` has zero tests (core revenue path)
The primary money handler — single/batch/dual/return/barcode/Excel — has 0 test coverage. An undetected bug here silently drops Telegram updates with no alert.

### TEST-C2 — Entire Next.js dashboard has zero tests
`vitest` and `playwright` are installed and configured; zero test files exist. 57 API routes, 38 components, and all accounting logic are completely untested.

### ARCH-C1 — In-process caches break under multi-instance Railway deployment
- `bot/handlers/barcode.py:49` — `_bc_cache: dict` — barcode scan state
- `bot/handlers/__init__.py:44` — `_last_called: dict` — rate limiter
If Railway runs two replicas, the same user's barcode photo and confirmation text land on different instances → barcode silently ignored. Rate limiter also per-instance. Both must be moved to Redis (which is already in the stack).

### ARCH-C2 — Untracked `asyncio.create_task` audit writes — audit trail has silent data loss
`database/db.py:101` — tasks created without storing references. CPython GC can collect unreferenced Tasks before completion. The compliance audit trail can silently drop writes.

### ERR-C1 — No global `@dp.errors()` handler in aiogram
`bot/main.py` — any handler code path that raises an unhandled exception silently drops the Telegram update with no user message and no guaranteed log. All coverage relies on per-handler try/except.

### FRONT-C1 — `products-table.tsx` — 1,921-line god component
Contains 25+ `useState` hooks and manages product CRUD, sales, orders, compatibility, write-offs, gallery, AI descriptions — untestable and unmaintainable. Hard limit is 800 lines.

---

## 🟡 High (this sprint)

### Security
- **H1** — Raw `err.message` / `String(err)` returned to clients in 15+ API routes exposing PostgreSQL internals: `migrate-erp/route.ts:122,136`, `erp-imports/route.ts:105,183`, `erp-imports/[id]/route.ts:120,210,226`, `generate-description/route.ts:84`, etc.
- **H2** — Missing Content-Security-Policy header (`dashboard/middleware.ts` + `dashboard/next.config.ts`). Dashboard has public `/catalog` pages with no XSS second line of defense.
- **H3** — `images.remotePatterns: hostname: "**"` in `next.config.ts:22` — wildcard SSRF via Next.js image optimizer. Restrict to `drive.google.com` and `lh3.googleusercontent.com`.
- **H4** — `/api/debug/orders` exposes real production order rows unauthenticated in dev.
- **H5** — `/api/migrate-erp` and `/api/migrate-currency` run DDL (CREATE TABLE, ALTER TABLE) via HTTP POST — migrations should not exist as replayable HTTP endpoints.

### Error Handling
- **H6** — `TelegramRetryAfter` only handled in `bot/handlers/deeplink.py`. Every other handler catches it as a generic exception and logs it as a failure — the message is lost instead of retried.
- **H7** — Anthropic `RateLimitError`, `APITimeoutError`, `APIConnectionError` never caught specifically in `bot/financial_ai/analyzer.py:93,122` and `bot/search_ai/catalog_search.py:111`. All API failures look identical — no backoff, no retry differentiation.
- **H8** — Token usage (`response.usage`) never logged anywhere in the codebase — impossible to track Anthropic spend or detect cost spikes.

### Architecture
- **H9** — `wizard.py` is 2,784 lines combining sales wizard, nisia wizard, expense wizard, and all edit flows. Must be split into separate modules.
- **H10** — `search_catalog()` sends full catalog text to Claude on every search with no prompt caching (`cache_control` absent). At 500+ SKUs this becomes expensive and slow.
- **H11** — New `AsyncAnthropic` client instantiated on every `generate_weekly_advice()` and `search_catalog()` call. Should be module-level singleton.

### CI/CD
- **H12** — No staging environment. Every push to `main` auto-deploys to production Railway.
- **H13** — No rollback strategy. Bad deploy requires manual re-deploy via Railway dashboard. No health-check probe in `railway.toml`.

### Database
- **H14** — `returns` table missing indexes on `product_id` and `sale_id` (`database/models.py:37-46`). Every return-history report is a full sequential scan.
- **H15** — `MIGRATE_SQL` runs on every bot startup including Railway's restart-on-failure loop. Contains full-table `UPDATE` back-fills that scan entire `orders`, `sales` tables on each of 5 restart retries.

### Testing
- **H16** — `bot/financial_ai/analyzer.py` — zero tests. Weekly report generation, Anthropic API mocking, in-process LRU cache, and graceful degradation are all untested.
- **H17** — `bot/handlers/wizard.py` — zero tests. Primary UX flow for the bot owner.
- **H18** — `database/db.py` error paths untested: `UniqueViolationError` on duplicate OEM, `_consume_inventory_fifo` when stock is negative, transaction rollback mid-sale.

---

## 🟢 Medium/Low (later)

- **M1** — `database/db.py:871` — `datetime.utcnow()` deprecated since Python 3.12. Use `datetime.now(timezone.utc)`.
- **M2** — `bot/handlers/wizard.py` — ~15 `assert isinstance(...)` calls used as type guards; stripped by `python -O`. Replace with `if not isinstance(...): return`.
- **M3** — `db.py:_post_sale_ledger()` / `_reverse_sale_ledger()` — 45+ lines of near-duplicate VAT branch logic. Extract to `_post_ledger_pair(is_reversal: bool, ...)`.
- **M4** — `orders` table has no index on `status` column (`database/models.py:48-55`). Pending-orders queries do full-table scans.
- **M5** — `ILIKE` queries in `db.py:135,253` use f-strings to wrap user input with `%` — user-supplied `%` and `_` are not escaped, causing unexpectedly broad wildcard matches.
- **M6** — Bot rate limiter (`bot/handlers/__init__.py:40-47`) is in-memory — resets on every Railway redeploy.
- **M7** — Root `.env.example` missing `REDIS_URL`, `DASHBOARD_URL`, `AUDIT_CHANNEL_ID`, `FZ_ENTITY_ENABLED`.
- **M8** — Root README lists only 3 of 11 handler files; `/cash`, `/deposit`, `/transfer`, `/nisias`, `/orders` commands not documented.
- **M9** — `bot/main.py` hard-exits if `RAILWAY_ENVIRONMENT` not set — blocks all local development; not mentioned in README.
- **M10** — `db.py:_get_or_create_business_customer()` references `chart_of_accounts` table (lines 386–397) which may not exist in production if `CREATE_TABLES_SQL` doesn't include it — LLC buyer sales silently skip account hierarchy creation.
- **M11** — 61 `console.*` calls in production dashboard code — replace with structured logger.
- **M12** — No GitHub branch protection rules — broken push can deploy before CI completes.
- **M13** — Bus factor = 1 (332/344 commits by one person).

---

## Metrics

| Metric | Value |
|--------|-------|
| Estimated Python test coverage | ~20% |
| Dashboard test coverage | 0% |
| npm vulnerabilities | not run (no network in audit) |
| TypeScript `any` count | 0 |
| Python files > 400 lines | 3 (db.py, models.py, sales.py) |
| TS/TSX files > 400 lines | 5+ (products-table: 1,921, etc.) |
| `"use client"` ratio | 73% (40/55 components) |
| Largest Python file | database/db.py — 3,375 lines |
| Largest TS component | products-table.tsx — 1,921 lines |
| API routes (dashboard) | 57 |
| Handler files with 0 tests | 9/11 |
| Bus factor | 1 |

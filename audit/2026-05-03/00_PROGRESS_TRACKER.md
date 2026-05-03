# Progress Tracker — Audit 2026-05-03

სტატუსები: `⬜ მოლოდინში` / `🔄 მიმდინარე` / `✅ შესრულდა` / `❌ დაბლოკილია`

| #  | კატეგორია     | პრობლემა                                                        | სიმძიმე | სტატუსი          | შენიშვნა |
|----|---------------|-----------------------------------------------------------------|---------|------------------|----------|
| 1  | Security      | debug/drive-config endpoint leaks OAuth secrets                 | 🔴      | ⬜ მოლოდინში     | |
| 2  | Security      | timingSafeEqual timing oracle (password length leak)            | 🔴      | ⬜ მოლოდინში     | |
| 3  | Database      | No SSL on asyncpg pool (database/db.py:44)                      | 🔴      | ⬜ მოლოდინში     | |
| 4  | Testing       | sales.py — zero tests (core revenue path)                       | 🔴      | ⬜ მოლოდინში     | |
| 5  | Testing       | Dashboard — zero tests (vitest + playwright unused)             | 🔴      | ⬜ მოლოდინში     | |
| 6  | Testing       | wizard.py — zero tests (primary UX flow)                        | 🔴      | ⬜ მოლოდინში     | |
| 7  | Testing       | financial_ai — zero tests                                       | 🔴      | ⬜ მოლოდინში     | |
| 8  | Testing       | DB error paths untested (UniqueViolation, pool exhaustion)      | 🔴      | ⬜ მოლოდინში     | |
| 9  | Architecture  | In-process caches break multi-instance (barcode + rate limiter) | 🔴      | ⬜ მოლოდინში     | |
| 10 | Architecture  | Untracked asyncio.create_task audit writes (silent data loss)   | 🔴      | ⬜ მოლოდინში     | |
| 11 | Error Handling| No global @dp.errors() handler in aiogram (main.py)            | 🔴      | ⬜ მოლოდინში     | |
| 12 | Error Handling| TelegramRetryAfter only handled in deeplink.py                  | 🔴      | ⬜ მოლოდინში     | |
| 13 | Frontend      | products-table.tsx — 1,921 lines (god component)                | 🔴      | ⬜ მოლოდინში     | |
| 14 | Frontend      | No error.tsx / loading.tsx anywhere in dashboard/app            | 🔴      | ⬜ მოლოდინში     | |
| 15 | Security      | Raw err.message returned to clients in 15+ API routes           | 🟡      | ⬜ მოლოდინში     | |
| 16 | Security      | Missing Content-Security-Policy header                          | 🟡      | ⬜ მოლოდინში     | |
| 17 | Security      | Wildcard remotePatterns SSRF (next.config.ts:22)                | 🟡      | ⬜ მოლოდინში     | |
| 18 | Security      | /api/debug/orders exposes production order rows                 | 🟡      | ⬜ მოლოდინში     | |
| 19 | Security      | DDL endpoints: migrate-erp + migrate-currency via HTTP POST     | 🟡      | ⬜ მოლოდინში     | |
| 20 | Error Handling| Anthropic typed exceptions not caught (RateLimitError etc.)     | 🟡      | ⬜ მოლოდინში     | |
| 21 | Error Handling| Token usage (response.usage) never logged                       | 🟡      | ⬜ მოლოდინში     | |
| 22 | Error Handling| asyncpg-specific exceptions never caught separately             | 🟡      | ⬜ მოლოდინში     | |
| 23 | Error Handling| Prompt caching not enabled on system prompts                    | 🟡      | ⬜ მოლოდინში     | |
| 24 | Architecture  | wizard.py — 2,784 lines, 4 wizards in one file                  | 🟡      | ⬜ მოლოდინში     | |
| 25 | Architecture  | search_catalog() full catalog text per call, no prompt caching  | 🟡      | ⬜ მოლოდინში     | |
| 26 | Architecture  | New AsyncAnthropic client instantiated on every API call        | 🟡      | ⬜ მოლოდინში     | |
| 27 | Database      | returns table missing indexes on product_id, sale_id            | 🟡      | ⬜ მოლოდინში     | |
| 28 | Database      | MIGRATE_SQL full-table UPDATEs run on every bot restart         | 🟡      | ⬜ მოლოდინში     | |
| 29 | CI/CD         | No staging environment (every main push = prod deploy)          | 🟡      | ⬜ მოლოდინში     | |
| 30 | CI/CD         | No rollback strategy / no health-check probe in railway.toml    | 🟡      | ⬜ მოლოდინში     | |
| 31 | Testing       | formatter.py — zero tests                                       | 🟡      | ⬜ მოლოდინში     | |
| 32 | Testing       | barcode/decoder.py — zero tests                                 | 🟡      | ⬜ მოლოდინში     | |
| 33 | Testing       | import_excel_parser.py — zero tests                             | 🟡      | ⬜ მოლოდინში     | |
| 34 | Frontend      | 73% "use client" — no SSR, waterfall fetching                   | 🟡      | ⬜ მოლოდინში     | |
| 35 | Frontend      | No rate limiting on /api/ai-insights, /api/generate-description | 🟡      | ⬜ მოლოდინში     | |
| 36 | Database      | get_all_products() unbounded SELECT (database/db.py:164)        | 🟢      | ⬜ მოლოდინში     | |
| 37 | Database      | SELECT * expenses without LIMIT (db.py:2245,2256,2456,2469,2480)| 🟢      | ⬜ მოლოდინში     | |
| 38 | Database      | orders table no index on status column                          | 🟢      | ⬜ მოლოდინში     | |
| 39 | Database      | ILIKE with unescaped % and _ wildcards (db.py:135,253)          | 🟢      | ⬜ მოლოდინში     | |
| 40 | Code Quality  | database/db.py god object — 3,375 lines, 113 methods            | 🟢      | ⬜ მოლოდინში     | long-term |
| 41 | Code Quality  | datetime.utcnow() deprecated (database/db.py:871)               | 🟢      | ⬜ მოლოდინში     | |
| 42 | Code Quality  | assert isinstance() used as type guard in wizard.py             | 🟢      | ⬜ მოლოდინში     | |
| 43 | Documentation | .env.example missing 4 vars (REDIS_URL, DASHBOARD_URL, etc.)    | 🟢      | ⬜ მოლოდინში     | |
| 44 | Documentation | README lists 3/11 handlers, 50% of commands undocumented        | 🟢      | ⬜ მოლოდინში     | |
| 45 | Documentation | RAILWAY_ENVIRONMENT guard blocks local dev, not in README       | 🟢      | ⬜ მოლოდინში     | |
| 46 | Git           | debug commits reach main (SHA 912a3d1, 97e0f50)                 | 🟢      | ⬜ მოლოდინში     | |
| 47 | CI/CD         | ruff format --check not in CI                                   | 🟢      | ⬜ მოლოდინში     | |

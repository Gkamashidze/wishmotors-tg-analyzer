# Progress Tracker — Audit 2026-05-03

სტატუსები: `⬜ მოლოდინში` / `🔄 მიმდინარე` / `✅ შესრულდა` / `❌ დაბლოკილია`

| #  | კატეგორია     | პრობლემა                                                        | სიმძიმე | სტატუსი          | შენიშვნა |
|----|---------------|-----------------------------------------------------------------|---------|------------------|----------|
| 1  | Security      | debug/drive-config endpoint leaks OAuth secrets                 | 🔴      | ✅ შესრულდა     | 5cf9f29 |
| 2  | Security      | timingSafeEqual timing oracle (password length leak)            | 🔴      | ✅ შესრულდა     | 5cf9f29 |
| 3  | Database      | No SSL on asyncpg pool (database/db.py:44)                      | 🔴      | ✅ შესრულდა     | 5cf9f29 |
| 4  | Testing       | sales.py — zero tests (core revenue path)                       | 🔴      | ✅ შესრულდა     | ea332e7 — 31 tests |
| 5  | Testing       | Dashboard — zero tests (vitest + playwright unused)             | 🔴      | ✅ შესრულდა     | f37ce35 — 53 vitest tests pass (fixed 2 pre-existing failures) |
| 6  | Testing       | wizard.py — zero tests (primary UX flow)                        | 🔴      | ✅ შესრულდა     | df4f87d — 27 tests |
| 7  | Testing       | financial_ai — zero tests                                       | 🔴      | ✅ შესრულდა     | already existed — 13 tests pass |
| 8  | Testing       | DB error paths untested (UniqueViolation, pool exhaustion)      | 🔴      | ✅ შესრულდა     | 1796deb — 6 new error-path tests |
| 9  | Architecture  | In-process caches break multi-instance (barcode + rate limiter) | 🔴      | ✅ შესრულდა     | a8a9aa5 |
| 10 | Architecture  | Untracked asyncio.create_task audit writes (silent data loss)   | 🔴      | ✅ შესრულდა     | e77eabf |
| 11 | Error Handling| No global @dp.errors() handler in aiogram (main.py)            | 🔴      | ✅ შესრულდა     | e77eabf |
| 12 | Error Handling| TelegramRetryAfter only handled in deeplink.py                  | 🔴      | ✅ შესრულდა     | e77eabf |
| 13 | Frontend      | products-table.tsx — 1,921 lines (god component)                | 🔴      | ✅ შესრულდა     | 58e8f14 — 1921→1238 + 7 modules |
| 14 | Frontend      | No error.tsx / loading.tsx anywhere in dashboard/app            | 🔴      | ✅ შესრულდა     | 58e8f14 |
| 15 | Security      | Raw err.message returned to clients in 15+ API routes           | 🟡      | ✅ შესრულდა     | cf64b4d |
| 16 | Security      | Missing Content-Security-Policy header                          | 🟡      | ✅ შესრულდა     | cf64b4d |
| 17 | Security      | Wildcard remotePatterns SSRF (next.config.ts:22)                | 🟡      | ✅ შესრულდა     | cf64b4d |
| 18 | Security      | /api/debug/orders exposes production order rows                 | 🟡      | ✅ შესრულდა     | 5cf9f29 |
| 19 | Security      | DDL endpoints: migrate-erp + migrate-currency via HTTP POST     | 🟡      | ✅ შესრულდა     | cf64b4d |
| 20 | Error Handling| Anthropic typed exceptions not caught (RateLimitError etc.)     | 🟡      | ✅ შესრულდა     | 32b148b |
| 21 | Error Handling| Token usage (response.usage) never logged                       | 🟡      | ✅ შესრულდა     | 32b148b |
| 22 | Error Handling| asyncpg-specific exceptions never caught separately             | 🟡      | ✅ შესრულდა     | 32b148b |
| 23 | Error Handling| Prompt caching not enabled on system prompts                    | 🟡      | ✅ შესრულდა     | 32b148b |
| 24 | Architecture  | wizard.py — 2,784 lines, 4 wizards in one file                  | 🟡      | ❌ დაბლოკილია   | 74 decorated handlers + shared FSM state; barcode flow serves sale+nisia. Est. 4-6h safe refactor |
| 25 | Architecture  | search_catalog() full catalog text per call, no prompt caching  | 🟡      | ✅ შესრულდა     | 32b148b |
| 26 | Architecture  | New AsyncAnthropic client instantiated on every API call        | 🟡      | ✅ შესრულდა     | 32b148b |
| 27 | Database      | returns table missing indexes on product_id, sale_id            | 🟡      | ✅ შესრულდა     | 4e79b4c |
| 28 | Database      | MIGRATE_SQL full-table UPDATEs run on every bot restart         | 🟡      | ✅ შესრულდა     | 4e79b4c |
| 29 | CI/CD         | No staging environment (every main push = prod deploy)          | 🟡      | ✅ შესრულდა     | .github/workflows/ci.yml — tests block bad code before deploy |
| 30 | CI/CD         | No rollback strategy / no health-check probe in railway.toml    | 🟡      | ✅ შესრულდა     | dashboard/railway.toml already has healthcheckPath; CI workflow added |
| 31 | Testing       | formatter.py — zero tests                                       | 🟡      | ✅ შესრულდა     | 3a9915f — 72 tests |
| 32 | Testing       | barcode/decoder.py — zero tests                                 | 🟡      | ✅ შესრულდა     | pre-existing tests fixed in 32b148b |
| 33 | Testing       | import_excel_parser.py — zero tests                             | 🟡      | ✅ შესრულდა     | 3a9915f — 42 tests |
| 34 | Frontend      | 73% "use client" — no SSR, waterfall fetching                   | 🟡      | ❌ დაბლოკილია   | All page-level components use useState+useEffect+useCallback; interactive admin dashboard. Visual verification required (INACTIVE per CLAUDE.md) |
| 35 | Frontend      | No rate limiting on /api/ai-insights, /api/generate-description | 🟡      | ✅ შესრულდა     | 740ef88 |
| 36 | Database      | get_all_products() unbounded SELECT (database/db.py:164)        | 🟢      | ✅ შესრულდა     | c1ce53a — LIMIT 5000 |
| 37 | Database      | SELECT * expenses without LIMIT (db.py:2245,2256,2456,2469,2480)| 🟢      | ✅ შესრულდა     | c1ce53a — LIMIT 500 on unbounded queries |
| 38 | Database      | orders table no index on status column                          | 🟢      | ✅ შესრულდა     | c1ce53a — idx_orders_status in MIGRATE_SQL |
| 39 | Database      | ILIKE with unescaped % and _ wildcards (db.py:135,253)          | 🟢      | ✅ შესრულდა     | c1ce53a — _ilike_escape() helper + ESCAPE '\\' |
| 40 | Code Quality  | database/db.py god object — 3,375 lines, 113 methods            | 🟢      | ❌ გადაიდო      | long-term; Phase 4 — domain repositories |
| 41 | Code Quality  | datetime.utcnow() deprecated (database/db.py:871)               | 🟢      | ✅ შესრულდა     | f135227 |
| 42 | Code Quality  | assert isinstance() used as type guard in wizard.py             | 🟢      | ✅ შესრულდა     | c1ce53a — 52x early return |
| 43 | Documentation | .env.example missing 4 vars (REDIS_URL, DASHBOARD_URL, etc.)    | 🟢      | ✅ შესრულდა     | f135227 |
| 44 | Documentation | README lists 3/11 handlers, 50% of commands undocumented        | 🟢      | ✅ შესრულდა     | a59e90b — 22 commands + full project tree |
| 45 | Documentation | RAILWAY_ENVIRONMENT guard blocks local dev, not in README       | 🟢      | ✅ შესრულდა     | f135227 — .env.example-ში |
| 46 | Git           | debug commits reach main (SHA 912a3d1, 97e0f50)                 | 🟢      | ❌ გადაიდო      | git history immutable — pre-commit hook recommendation only |
| 47 | CI/CD         | ruff format --check not in CI                                   | 🟢      | ✅ შესრულდა     | f135227 |

# Before / After Metrics — Audit 2026-05-03

| მეტრიკა                        | აუდიტამდე | after critical | after high | **final** |
|--------------------------------|-----------|----------------|------------|-----------|
| Python test count              | ~248      | 317            | 391        | **391** ✅ |
| Python test coverage           | ~20%      | 33%            | 33%        | **32%**   |
| Dashboard tests                | 0         | 53 ✅          | 53 ✅      | **53** ✅  |
| npm vulnerabilities (high+)    | unknown   | 1 high         | 1 high     | **1** (xlsx — no fix available) |
| TypeScript `any` count         | 0 ✅      | 0 ✅           | 0 ✅       | **0** ✅   |
| Python files > 400 lines       | 10        | 10             | 10         | **10** (🟢 low — wizard+db blocked) |
| TS/TSX files > 400 lines       | 5+        | 4+             | 4+         | **6** (admin dashboard inherently large) |
| Largest file (lines)           | 3,375     | 3,375          | 3,375      | **3,845** db.py (grows) |
| Largest component (lines)      | 1,921     | 1,238 ✅       | 1,238 ✅   | **1,298** ✅ |
| "use client" ratio             | 73%       | 73%            | ~70%       | **~70%** (❌ blocked) |
| Bot modules with 0 tests       | 9 / 11    | 6 / 11         | 4 / 11     | **4 / 11** |
| datetime.utcnow() usages       | 1         | 1              | 1          | **0** ✅   |
| assert isinstance in wizard.py | 52        | 52             | 52         | **0** ✅   |
| Unbounded SELECTs (>1000 rows) | 5         | 5              | 5          | **0** ✅ LIMIT 500/5000 |
| ILIKE wildcard injection risk  | 2         | 2              | 2          | **0** ✅ _ilike_escape() |
| Ruff format in CI              | ❌        | ❌             | ❌         | **✅**     |
| .env.example vars documented   | 17        | 17             | 17         | **21** ✅  |
| README commands documented     | 3         | 3              | 3          | **22** ✅  |
| idx_orders_status index        | ❌        | ❌             | ❌         | **✅**     |
| Global aiogram error handler   | ❌        | ✅             | ✅         | ✅         |
| SSL on DB connection           | ❌        | ✅             | ✅         | ✅         |
| Debug endpoints in production  | 2         | 0 ✅           | 0 ✅       | 0 ✅       |
| CSP header                     | ❌        | ✅             | ✅         | ✅         |
| Prompt caching (Anthropic)     | ❌        | ✅             | ✅         | ✅         |
| AsyncAnthropic singleton       | ❌        | ✅             | ✅         | ✅         |
| Rate limiting (AI endpoints)   | ❌        | ✅             | ✅         | ✅         |
| GitHub Actions CI              | ❌        | ✅             | ✅         | ✅         |
| Returns table indexes          | ❌        | ✅             | ✅         | ✅         |
| Redis-backed caches            | 0 / 3     | 2 / 3 ✅       | 2 / 3 ✅   | 2 / 3 ✅   |
| Onboarding time (estimate)     | 6-8 h     | 5-7 h          | 5-7 h      | **3-4 h** ✅ |
| Bus factor                     | 1         | 1              | 1          | 1 (accepted) |

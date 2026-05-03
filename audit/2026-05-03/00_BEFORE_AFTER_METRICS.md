# Before / After Metrics — Audit 2026-05-03

| მეტრიკა                        | აუდიტამდე | ამჟამად | მიზანი       |
|--------------------------------|-----------|---------|--------------|
| Python test coverage           | ~20%      | —       | 70%          |
| Dashboard test coverage        | 0%        | —       | 60%          |
| npm vulnerabilities (high+)    | unknown   | —       | 0            |
| TypeScript `any` count         | 0         | —       | 0 ✅         |
| Python files > 400 lines       | 3         | —       | 0            |
| TS/TSX files > 400 lines       | 5+        | —       | 0            |
| Largest file (lines)           | 3,375     | —       | < 800        |
| "use client" ratio             | 73%       | —       | < 40%        |
| Dashboard API routes           | 57        | —       | 57 (documented) |
| Handler files with 0 tests     | 9 / 11    | —       | 2 / 11       |
| Global aiogram error handler   | ❌        | —       | ✅           |
| SSL on DB connection           | ❌        | —       | ✅           |
| Debug endpoints in production  | 2         | —       | 0            |
| CSP header                     | ❌        | —       | ✅           |
| Prompt caching (Anthropic)     | ❌        | —       | ✅           |
| AsyncAnthropic singleton       | ❌        | —       | ✅           |
| Redis-backed caches            | 0 / 3     | —       | 3 / 3        |
| Onboarding time (estimate)     | 6-8 h     | —       | 3-4 h        |
| Bus factor                     | 1         | —       | 1 (accepted) |

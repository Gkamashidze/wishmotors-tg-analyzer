# Before / After Metrics — Audit 2026-05-03

| მეტრიკა                        | აუდიტამდე | ამჟამად | მიზანი       |
|--------------------------------|-----------|---------|--------------|
| Python test coverage           | ~20%      | 33% (391 tests) | 70%     |
| Dashboard test coverage        | 0%        | 53 tests pass ✅ | 60%    |
| npm vulnerabilities (high+)    | unknown   | 1 high (xlsx — no fix available) | 0 |
| TypeScript `any` count         | 0         | 0 ✅    | 0 ✅         |
| Python files > 400 lines       | 3         | 3       | 0            |
| TS/TSX files > 400 lines       | 5+        | 4+      | 0            |
| Largest file (lines)           | 3,375     | 3,375   | < 800        |
| "use client" ratio             | 73%       | ~70%    | < 40%        |
| Dashboard API routes           | 57        | 57      | 57 (documented) |
| Bot modules with 0 tests       | 9 / 11    | 4 / 11  | 2 / 11       |
| Global aiogram error handler   | ❌        | ✅      | ✅           |
| SSL on DB connection           | ❌        | ✅      | ✅           |
| Debug endpoints in production  | 2         | 0 ✅    | 0            |
| CSP header                     | ❌        | ✅      | ✅           |
| Prompt caching (Anthropic)     | ❌        | ✅      | ✅           |
| AsyncAnthropic singleton       | ❌        | ✅      | ✅           |
| Rate limiting (AI endpoints)   | ❌        | ✅      | ✅           |
| GitHub Actions CI              | ❌        | ✅      | ✅           |
| Returns table indexes          | ❌        | ✅      | ✅           |
| Redis-backed caches            | 0 / 3     | 2 / 3 ✅ | 3 / 3      |
| Onboarding time (estimate)     | 6-8 h     | 5-7 h   | 3-4 h        |
| Bus factor                     | 1         | 1       | 1 (accepted) |

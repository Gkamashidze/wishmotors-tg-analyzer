# Decisions Log — Audit 2026-05-03

---

## ADR-001: In-process caches → Redis (არ გატანა framework FSM storage-ზე)
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `_bc_cache` (barcode) და `_last_called` (rate limiter) dict-ებია — Railway multi-replica-ზე state-ი instances-ს შორის არ იზიარება. Redis უკვე in-stack-ია (aiogram FSM storage).
- ✅ გადაწყვეტილება: Redis-ზე გადავიტანოთ `_bc_cache` (TTL 60s) და rate limiter (INCR/EXPIRE). aiogram FSM-ის შეცვლა არ ხდება.
- 🔄 ალტერნატივები: (a) Railway single-replica lock — ამცირებს scalability-ს; (b) Sticky sessions Telegram-ის webhook-ზე — Telegram არ მხარდაჭერს
- 📊 მოსალოდნელი შედეგი: barcode flow კორექტულია multi-replica-ზე; rate limiter global-ია

## ADR-002: Debug endpoints — წაშლა, არა feature-flag
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `/api/debug/drive-config` და `/api/debug/orders` production-ში sensitive data-ს leak-ს. `NODE_ENV` guard საკმარისი არ არის (Railway ყოველთვის "production"-ია, მაგრამ გამონაკლისი შეიძლება შეიქმნას).
- ✅ გადაწყვეტილება: folder-ი მთლიანად წავიდეს. OAuth debugging → `get-refresh-token.mjs` script (local only, no server).
- 🔄 ალტერნატივები: (a) `if (process.env.NODE_ENV !== "production")` guard — bypass-სარგებელი; (b) admin-only endpoint — auth bypass risk
- 📊 მოსალოდნელი შედეგი: credential disclosure vector სრულად ამოიღება

## ADR-003: timingSafeEqual — Buffer-ზე გადასვლა
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `dashboard/middleware.ts:65` early-exit on length mismatch — timing oracle. Node.js-ს აქვს native `crypto.timingSafeEqual(Buffer, Buffer)`.
- ✅ გადაწყვეტილება: `Buffer.from(a).equals(Buffer.from(b))` → `crypto.timingSafeEqual(Buffer.from(a.padEnd(b.length)), Buffer.from(b.padEnd(a.length)))`. ან უფრო clean: equal-length padding პირველ.
- 🔄 ალტერნატივები: bcrypt compare — overkill Basic Auth-ისთვის
- 📊 მოსალოდნელი შედეგი: timing oracle eliminated

## ADR-004: `database/db.py` God Object — არ ვყოფთ ახლა
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: 3,375-ხაზიანი ფაილი, 113 method. SRP violation. თუმცა split-ი მაღალი regression risk-ია — ყველა handler import-ს `db` middleware-დან.
- ✅ გადაწყვეტილება: ამ audit cycle-ში არ ვყოფთ. Phase 4 (long-term) — domain repositories pattern.
- 🔄 ალტერნატივები: (a) ახლა split — 2+ კვირა, ყველა test-ი გასადრი; (b) module-level wrappers ზემოთ — კომპლექსობა ყოველ commit-ზე
- 📊 მოსალოდნელი შედეგი: stability > architectural purity ამ ეტაპზე

## ADR-006: wizard.py split — ❌ Blocked (High phase)
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: wizard.py — 2,784 ხაზი, 4 wizard flow. 74 `@wizard_router` decorator + shared barcode FSM handlers (sale + nisia ორივე იყენებს `_handle_wizard_oem_input`). Integration tests არ არის — split-ი safe regression coverage-ის გარეშე შეუძლებელია.
- ✅ გადაწყვეტილება: ახლა არ ვყოფთ. Est. 4-6h safe refactor — dedicated session + integration tests.
- 🔄 ალტერნატივები: (a) ახლა split — risk wizard flow-ის broken states; (b) module-level imports — კომპლექსობა FSM state-ის sharing-ზე
- 📊 მოსალოდნელი შედეგი: სტაბილობა > refactor ამ ციკლში

## ADR-007: "use client" SSR reduction — ❌ Blocked (High phase)
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: 73% pages use "use client". accounting/vat/personal-orders გვერდები useState+useEffect+useCallback — interactive admin dashboard. Visual verification INACTIVE per CLAUDE.md (non-web project).
- ✅ გადაწყვეტილება: skip. Admin dashboards are inherently interactive — "use client" ratio is not a real problem here.
- 🔄 ალტერნატივები: RSC + React Query — requires full page rewrite, browser testing
- 📊 მოსალოდნელი შედეგი: current UX unchanged; metric accepted as expected for this type of app

## ADR-008: In-process rate limiter for dashboard (არ Redis)
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `/api/ai-insights` და `/api/generate-description` — no rate limiting. Dashboard Railway single-instance deploy.
- ✅ გადაწყვეტილება: In-process Map-based rate limiter (10 req/60s per IP). Single-instance admin dashboard — Redis overhead არ ამართლებს.
- 🔄 ალტერნატივები: Upstash Redis — persistent across deploys, კი საჭიროა თუ multi-replica; middleware-level rate limit — კომპლექსია Next.js App Router-ში
- 📊 მოსალოდნელი შედეგი: AI endpoints protected from abuse; resets on redeploy (acceptable for admin tool)

## ADR-005: Anthropic prompt caching — ჩაირთოს search_ai-ში
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `catalog_search.py` system prompt გაიგზავნება ყოველ call-ზე `cache_control` გარეშე. `financial_ai/analyzer.py`-ში system prompt ~800 char — 1024 token threshold-ი არ ჯდება, caching-ი ineffective.
- ✅ გადაწყვეტილება: `catalog_search.py`-ში system prompt-ზე `cache_control: ephemeral` ჩაირთოს. `analyzer.py` — გაიზარდოს prompt-ი 1024+ token-მდე ან skip.
- 🔄 ალტერნატივები: skip both — cost impact მცირეა small catalog-ზე
- 📊 მოსალოდნელი შედეგი: 60-80% cost reduction per search call on cache hits

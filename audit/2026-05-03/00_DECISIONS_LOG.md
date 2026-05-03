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

## ADR-005: Anthropic prompt caching — ჩაირთოს search_ai-ში
- 📅 თარიღი: 2026-05-03
- 🔍 კონტექსტი: `catalog_search.py` system prompt გაიგზავნება ყოველ call-ზე `cache_control` გარეშე. `financial_ai/analyzer.py`-ში system prompt ~800 char — 1024 token threshold-ი არ ჯდება, caching-ი ineffective.
- ✅ გადაწყვეტილება: `catalog_search.py`-ში system prompt-ზე `cache_control: ephemeral` ჩაირთოს. `analyzer.py` — გაიზარდოს prompt-ი 1024+ token-მდე ან skip.
- 🔄 ალტერნატივები: skip both — cost impact მცირეა small catalog-ზე
- 📊 მოსალოდნელი შედეგი: 60-80% cost reduction per search call on cache hits

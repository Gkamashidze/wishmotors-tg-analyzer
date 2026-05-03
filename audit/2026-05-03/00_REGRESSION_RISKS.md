# Regression Risks — Audit 2026-05-03

---

## რისკი #1 — SSL-ის ჩართვა DB-ზე
- 🔧 ცვლილება: `database/db.py:44` — `ssl="require"` asyncpg pool-ზე
- ⚠️ რისკი: Railway dev/test სერვისებს სხვა SSL კონფიგი შეიძლება ჰქონდეთ; `DATABASE_URL` ლოკალური PostgreSQL-ი SLL-ის გარეშე შეიძლება იყოს
- 🛡 დაცვა: გაუშვი `python -m pytest tests/test_db_layer.py` ცვლილების შემდეგ; Railway logs-ში შეამოწმე connection error-ები
- 📍 კრიტიკული ფაილები: `database/db.py`

## რისკი #2 — `_bc_cache` გადატანა Redis-ზე
- 🔧 ცვლილება: `bot/handlers/barcode.py:49` — `_bc_cache` dict-ი Redis key-ებით ჩანაცვლება
- ⚠️ რისკი: Redis down-ი barcode flow-ს ახლა ქრობს; ადრე in-process dict იყო რეზილიენტური
- 🛡 დაცვა: `except redis.RedisError` — fallback-ი in-memory dict-ზე გამართლებულია ამ შემთხვევაში
- 📍 კრიტიკული ფაილები: `bot/handlers/barcode.py`, `bot/main.py` (redis init)

## რისკი #3 — Rate limiter გადატანა Redis-ზე
- 🔧 ცვლილება: `bot/handlers/__init__.py:40-47` — `is_rate_limited()` Redis INCR/EXPIRE
- ⚠️ რისკი: Redis latency ამატებს მცირე overhead-ს ყოველ message-ზე; ლოკალური Redis-ის გარეშე ტესტები ჩაიშლება
- 🛡 დაცვა: `tests/test_handlers.py`-ში `redis_client` mock; ლოგი Redis hit/miss-ზე

## რისკი #4 — `@dp.errors()` global handler
- 🔧 ცვლილება: `bot/main.py` — global error handler registration
- ⚠️ რისკი: ახლა ყოველ exception-ზე handler-ი გაეშვება; თუ handler-ი TelegramBadRequest-ს raise-ს გააკეთებს (ex. message deleted), შეიძლება მოხდეს double-handling
- 🛡 დაცვა: handler-ში შეამოწმე exception type; re-raise გარეშე დაბრუნდი

## რისკი #5 — audit task tracking (`asyncio.create_task` reference)
- 🔧 ცვლილება: `database/db.py:101` — task reference შენახვა
- ⚠️ რისკი: task set-ის grow-ი დიდ traffic-ზე; cleanup callback საჭირო
- 🛡 დაცვა: `task.add_done_callback(_tasks.discard)` pattern; test concurrent audit writes

## რისკი #6 — Debug endpoints წაშლა
- 🔧 ცვლილება: `dashboard/app/api/debug/` folder წაშლა
- ⚠️ რისკი: ეს endpoints-ები ადევს develop-ში Google OAuth debugging-ს; `get-refresh-token.mjs` script მათზეა დამოკიდებული
- 🛡 დაცვა: `get-refresh-token.mjs` გადაასწოროს direct OAuth flow-ზე გარე endpoint-ის გარეშე

## რისკი #7 — MIGRATE_SQL startup guard
- 🔧 ცვლილება: `database/db.py` — MIGRATE_SQL conditional execution
- ⚠️ რისკი: schema_versions table-ს არარსებობისას first-run-ი migration-ს გამოტოვებს
- 🛡 დაცვა: `schema_versions` table-ი create first, შემდეგ check; fallback-ი always-run-ზე dev-ში

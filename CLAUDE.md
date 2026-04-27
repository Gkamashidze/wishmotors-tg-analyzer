# wishmotors-tg-analyzer — Claude Instructions

## Project Overview

Georgian-language Telegram bot for auto parts sales tracking (wishmotors).
Monitors a Telegram Supergroup with Forum Topics — parses messages and records sales, returns,
expenses, orders, and inventory. Includes AI-powered financial analysis and product search.

## Tech Stack

- **Bot:** Python 3.x + aiogram 3.7
- **Database:** PostgreSQL via asyncpg (raw SQL, connection pool — no ORM)
- **Scheduler:** APScheduler (scheduled reports)
- **AI:** Anthropic API (financial_ai, search_ai modules)
- **Files:** openpyxl (Excel), Pillow + zxing-cpp (barcode/image)
- **Cache:** Redis
- **Deployment:** Railway (auto-deploy from `main`)
- **Linting:** ruff, **Types:** mypy

## Project Type: Non-Web (Telegram Bot)

The following global rules are **INACTIVE** for this project:
- `11-ui-verification.md` (Playwright/browser screenshots)
- `04-visual-verification.md` (browser visual checks)

## Bot Structure

```
bot/
  handlers/     — aiogram Router handlers (sales, orders, expenses, wizard, etc.)
  parsers/      — Georgian text parsing logic
  reports/      — report generation
  financial_ai/ — Anthropic-powered financial analysis
  search_ai/    — AI product search
  barcode/      — zxing barcode detection
  main.py       — Application entry point
database/
  models.py     — dataclasses + raw SQL CREATE_TABLES_SQL
  db.py         — Database class with asyncpg pool
  audit_log.py  — audit trail
config.py       — env var loading (fail-fast on missing vars)
```

## Topic Routing

Messages are routed by Telegram Forum Topic ID:
- `SALES_TOPIC_ID` → sales & returns (text parsing)
- `ORDERS_TOPIC_ID` → re-order notes
- `EXPENSES_TOPIC_ID` → expense logging
- `STOCK_TOPIC_ID` → stock management
- `NISIAS_TOPIC_ID` → credit/debit records
- `INVENTORY_TOPIC_ID` → bulk inventory uploads (optional)

---

## How Claude Should Work With the User

### Autonomous Execution

Act autonomously without asking for permission for ANY of the following:
- Reading files, exploring directories, searching code
- Editing or creating files (any number)
- Installing or removing packages/dependencies
- Running tests, linters, formatters, type checkers
- Making commits and pushing to GitHub (`main` branch directly)
- Running external API calls or shell commands
- Refactoring, architectural changes, configuration changes

**The ONE exception — always ask before:**
- Deleting files, directories, database records, or any data permanently

Report what was done after the fact. Never ask "should I go ahead?" for anything except deletion.

### Overrides of Global Rules

- `02-scope-control.md` → **ignored**: no file count limits or confirmation steps
- `17-development-workflow.md` → **branch**: commit and push directly to `main`
- `01-auto-checkpoint.md` → checkpoint before commits, no need to ask permission first

---

## Pre-Commit Checklist (ALWAYS run before every commit)

```bash
ruff check . --fix
mypy bot/ database/ config.py --ignore-missing-imports --no-strict-optional
```

Both must pass with **zero errors**. Fix all issues before committing.
After a successful commit → push to `main` automatically.

---

## aiogram 3.7 Standards

### Architecture

- Use `Router()` for each handler module — register routers in `main.py`
- Filter by topic: `F.message_thread_id == config.SALES_TOPIC_ID`
- Use FSM (`StatesGroup`) for multi-step flows — never track state manually
- All handlers are `async def` — never block the event loop

### Error Handling

Always handle these aiogram/Telegram exceptions:
```python
from aiogram.exceptions import TelegramNetworkError, TelegramRetryAfter, TelegramBadRequest

# TelegramRetryAfter: sleep exactly error.retry_after seconds, then retry
# TelegramNetworkError / TelegramBadRequest: log and handle gracefully
```

An unhandled exception in a handler silently swallows the update — always wrap with try/except.

### Message Design

- Always use `parse_mode="HTML"` (not Markdown — breaks on Georgian special chars)
- Escape user-provided text: `html.escape(user_text)` before inserting into messages
- Telegram message limit: 4096 chars — truncate gracefully, never crash
- Inline keyboards preferred over reply keyboards
- Callback data ≤ 64 bytes — keep structured and short

### Rate Limits

- Global: max 30 messages/second
- Per-chat: max 1 message/second
- Bulk sends: `await asyncio.sleep(0.05)` between messages
- On `TelegramRetryAfter`: `await asyncio.sleep(e.retry_after)`

---

## PostgreSQL / asyncpg Standards

### Connection Pool

```python
# Always acquire from pool — never create bare connections
async with db._pool.acquire() as conn:
    rows = await conn.fetch("SELECT ...", param1, param2)
```

- The `Database` class in `database/db.py` manages the pool — use its methods
- All query methods are async — always `await` them

### Query Patterns

- Parameterized queries only: `$1, $2, $3` placeholders (PostgreSQL style)
- NEVER string-interpolate user input into SQL
- Use `conn.fetch()` for SELECT (list), `conn.fetchrow()` for single row, `conn.fetchval()` for scalar
- Use `conn.execute()` for INSERT/UPDATE/DELETE
- For transactions: `async with conn.transaction():`

### Schema Changes

- Schema defined in `database/models.py` (`CREATE_TABLES_SQL`, `MIGRATE_SQL`)
- Add new columns/tables to `MIGRATE_SQL` (idempotent `ALTER TABLE IF NOT EXISTS`)
- Test migrations on a local copy before pushing

---

## Georgian Text / Encoding

- All files: UTF-8 (Python 3 default — always explicit in file headers if needed)
- Georgian Unicode: U+10D0–U+10FF (Mkhedruli) + U+2D00–U+2D2F (supplement)
- Always use `str` in the app layer — never operate on raw bytes for Georgian text
- Truncate by character count: `text[:n]` — never by byte count
- Escape before HTML rendering: `html.escape(georgian_text)`
- Key return/refund keywords detected: `დაბრუნება`, `გაცვლა`

---

## Railway Deployment

- All secrets (BOT_TOKEN, DATABASE_URL, etc.) set in Railway dashboard — never in code
- Push to `main` → automatic redeploy
- Check logs: Railway dashboard → Deployments → Logs (or `railway logs` CLI)
- `config.py` validates all required env vars at startup — a missing var raises `RuntimeError` immediately

---

## Observability

- Python `logging` to stdout (Railway captures it)
- Log format: `%(asctime)s %(levelname)s %(name)s: %(message)s`
- Log all unhandled exceptions with full traceback before re-raising
- For production issues: Railway logs are the first place to check

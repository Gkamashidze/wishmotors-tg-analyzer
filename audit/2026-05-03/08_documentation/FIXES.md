# Documentation Fixes — Copy-Paste Ready

---

## Fix #1 — .env.example additions

```bash
# შემდეგი ხაზები დაამატე .env.example-ის ბოლოს:

# ── Optional Features ──────────────────────────────────────────────────────────

# Redis: FSM persistence (recommended for multi-instance / production)
# REDIS_URL=redis://localhost:6379

# Dashboard URL: personal order tracking deeplinks
# DASHBOARD_URL=https://dashboard.up.railway.app

# Audit Channel: forward audit log entries to a Telegram channel
# AUDIT_CHANNEL_ID=-1001234567890

# LLC mode: restrict seller_type to 'llc' only
# FZ_ENTITY_ENABLED=false
```

---

## Fix #2 — README bot structure section (replacement)

```markdown
## Bot Structure

```
bot/
  handlers/
    sales.py              — sales & returns (text + Excel)
    wizard.py             — DM wizard: sales, nisia, expenses
    commands.py           — /report, /cash, /deposit, /transfer, /stock, /import
    orders.py             — re-order notes (/orders)
    addorder.py           — order creation wizard
    personal_orders_handler.py — personal order tracking
    deeplink.py           — personal order deeplinks
    barcode.py            — barcode scan + pending state
    search.py             — AI-powered product search
    topic_messages.py     — topic routing guards
    period_report.py      — custom period reports
  parsers/
    message_parser.py     — Georgian text → sale/return/expense data
    import_excel_parser.py — Excel import parser
  financial_ai/           — Anthropic weekly report generation
  search_ai/              — AI product catalog search
  barcode/                — zxing + Claude Vision barcode decoding
  reports/                — Telegram HTML report formatting
  calendar_widget.py      — inline date picker widget
  main.py                 — entry point, router registration, scheduler
database/
  db.py                   — all SQL queries (asyncpg pool)
  models.py               — schema DDL + TypedDicts
  audit_log.py            — SHA-256 audit trail
config.py                 — env var loading with fail-fast validation
```

## Bot Commands

| Command | Description |
|---------|-------------|
| `/report` | Weekly financial report |
| `/report_period` | Custom period report (calendar picker) |
| `/cash` | Cash register balance |
| `/deposit` | Add cash deposit |
| `/transfer` | Fund transfer between accounts |
| `/orders` | Pending orders list |
| `/nisias` | Nisia (credit) records |
| `/stock` | Stock management |
| `/addproduct` | Add new product |
| `/editproduct` | Edit existing product |
| `/import` | Bulk import via Excel |
| `/help` | Help message |
```

---

## Fix #3 — Local dev section for README

```markdown
## Local Development

**Important:** The bot requires `RAILWAY_ENVIRONMENT` to be set, otherwise it exits immediately.

Add to your `.env`:
```bash
RAILWAY_ENVIRONMENT=local
```

Then run:
```bash
python -m bot.main
```
```

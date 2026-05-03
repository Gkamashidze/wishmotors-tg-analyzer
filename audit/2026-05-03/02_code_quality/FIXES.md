# Code Quality Fixes — Copy-Paste Ready

---

## Fix #1 — datetime.utcnow() → timezone-aware (database/db.py:871)

```python
# Top of file — update import:
from datetime import datetime, timezone

# Every occurrence of datetime.utcnow():
# Before:
ts = datetime.utcnow()

# After:
ts = datetime.now(timezone.utc)
```

---

## Fix #2 — assert isinstance() → explicit guard (wizard.py pattern)

```python
# Before (~15 occurrences):
assert isinstance(callback.message, Message)
text = callback.message.text

# After:
if not isinstance(callback.message, Message):
    return
text = callback.message.text
```

---

## Fix #3 — Extract shared stock reconciliation logic (sales.py)

```python
# bot/handlers/sales.py — new helper

from dataclasses import dataclass
from typing import Any

@dataclass
class ReconciliationResult:
    shortages: list[dict]
    overages: list[dict]
    matched: list[dict]
    errors: list[str]


def _process_stock_reconciliation(
    ws, column_map: dict[str, int]
) -> ReconciliationResult:
    shortages, overages, matched, errors = [], [], [], []
    for row in ws.iter_rows(min_row=2, values_only=True):
        oem = str(row[column_map["oem"]] or "").strip()
        expected = int(row[column_map["qty"]] or 0)
        # ... shared logic here ...
    return ReconciliationResult(shortages, overages, matched, errors)


# handle_inventory_upload uses:
#   result = _process_stock_reconciliation(ws, {"oem": 0, "qty": 1})
# handle_stock_adjustment uses:
#   result = _process_stock_reconciliation(ws, {"oem": 2, "qty": 4})
```

---

## Fix #4 — chart_of_accounts table definition (database/models.py)

```sql
-- Add to MIGRATE_SQL:
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id          SERIAL PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    account_type TEXT NOT NULL,  -- 'asset', 'liability', 'equity', 'revenue', 'expense'
    parent_code TEXT REFERENCES chart_of_accounts(code),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code ON chart_of_accounts(code);
```

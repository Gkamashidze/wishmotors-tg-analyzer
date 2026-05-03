# Code Quality Issues — Audit 2026-05-03

---

## პრობლემა #1 — database/db.py — 3,375 lines, 113 methods
- 📍 ფაილი: `database/db.py` (მთლიანი ფაილი)
- 🔴 სიმძიმე: კრიტიკული (long-term)
- ❌ პრობლემა: SRP violation — ყველა domain (products, sales, returns, orders, cash, ledger, VAT, catalog, personal orders...) ერთ class-ში. Phase 4.
- ✅ გამოსწორება: Domain repositories. ADR-004 იხ.
- ⏱ სავარაუდო დრო: 2+ კვირა

---

## პრობლემა #2 — sales.py DRY violation
- 📍 ფაილი: `bot/handlers/sales.py:546-885`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `handle_inventory_upload` (~130 ხ.) და `handle_stock_adjustment` (~130 ხ.) — identical logic: Excel parsing loop, shortage/overage, summary builder. Only difference: column positions + header message.
- ✅ გამოსწორება: extract `_process_stock_reconciliation(ws, column_map) -> ReconciliationResult`.
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #3 — datetime.utcnow() deprecated
- 📍 ფაილი: `database/db.py:871`
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: `datetime.utcnow()` deprecated Python 3.12+. WarningMessage future versions-ში.
- ✅ გამოსწორება: `datetime.now(timezone.utc)`
- 💻 კოდის მაგალითი:
```python
# Before:
from datetime import datetime
ts = datetime.utcnow()

# After:
from datetime import datetime, timezone
ts = datetime.now(timezone.utc)
```
- ⏱ სავარაუდო დრო: 15 წთ

---

## პრობლემა #4 — assert isinstance() as type guard in wizard.py
- 📍 ფაილი: `bot/handlers/wizard.py` (~15 location)
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: `assert isinstance(callback.message, Message)` — `python -O` flag-ი assert-ებს strip-ს — type guard-ი silent-ად disappears.
- ✅ გამოსწორება: explicit guard.
- 💻 კოდის მაგალითი:
```python
# Before:
assert isinstance(callback.message, Message)

# After:
if not isinstance(callback.message, Message):
    return
```
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #5 — chart_of_accounts reference without table definition
- 📍 ფაილი: `database/db.py:386-397`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `INSERT INTO chart_of_accounts ... ON CONFLICT DO NOTHING` — table referenced but not in `CREATE_TABLES_SQL` nor `MIGRATE_SQL`. LLC buyer sale silently skips account hierarchy. No error thrown.
- ✅ გამოსწორება: `chart_of_accounts` table-ი `MIGRATE_SQL`-ში დამატება.
- ⏱ სავარაუდო დრო: 30 წთ

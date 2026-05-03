# Testing Issues — Audit 2026-05-03

---

## პრობლემა #1 — sales.py — zero tests (core revenue path)
- 📍 ფაილი: `bot/handlers/sales.py`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: ძირითადი revenue handler — single sale, batch sale, dual sale, return, barcode injection, freeform, Excel import — 0% coverage. aiogram design: unhandled exception silently drops the update — bug-ი production-ში invisible-ია.
- ✅ გამოსწორება: `tests/test_sales_handler.py` — AsyncMock bot + db, 8 code path.
- ⚠️ რეგრესიის რისკი: ტესტი წერამდე regression baseline-ი არ გვაქვს
- ⏱ სავარაუდო დრო: 4 სთ

---

## პრობლემა #2 — Dashboard — zero tests
- 📍 ფაილი: `dashboard/` (მთლიანი)
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `vitest` + `playwright` installed + configured, 0 test files. 57 API routes, 38 components — untested.
- ✅ გამოსწორება: minimum — 5 API route unit tests + products-table component test.
- ⚠️ რეგრესიის რისკი: N/A (ახლა ნებისმიერი ცვლილება undetected regression-ია)
- ⏱ სავარაუდო დრო: 4 სთ

---

## პრობლემა #3 — wizard.py — zero tests
- 📍 ფაილი: `bot/handlers/wizard.py`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: bot owner-ის primary UX — sales wizard, nisia wizard, expense wizard, edit flows. FSM state transitions, inline keyboard logic — untested. 2,784 ხაზი.
- ✅ გამოსწორება: `tests/test_wizard.py` — FSM transitions mock, state machine paths.
- ⚠️ რეგრესიის რისკი: FSM mock-ი aiogram 3.7 pattern-ის ზუსტ გათვალისწინებას საჭიროებს
- ⏱ სავარაუდო დრო: 4 სთ

---

## პრობლემა #4 — financial_ai — zero tests
- 📍 ფაილი: `bot/financial_ai/analyzer.py`, `bot/financial_ai/data_access.py`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: Weekly report generation, Anthropic API mock, in-process LRU cache, graceful degradation — untested. Scheduler silently generates empty reports.
- ✅ გამოსწორება: `tests/test_financial_ai.py` — mock `AsyncAnthropic`, test cache hit/miss, test empty snapshot degradation.
- ⚠️ რეგრესიის რისკი: `ANTHROPIC_API_KEY` must be absent or mocked in CI
- ⏱ სავარაუდო დრო: 3 სთ

---

## პრობლემა #5 — DB error paths untested
- 📍 ფაილი: `database/db.py`, `tests/test_db_layer.py`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: Happy-path only. Missing: `UniqueViolationError` on duplicate OEM, `_consume_inventory_fifo` negative stock, transaction rollback mid-sale, pool exhaustion behavior.
- ✅ გამოსწორება: `test_db_layer.py`-ში error-case tests — `asyncpg.UniqueViolationError` mock.
- ⚠️ რეგრესიის რისკი: asyncpg mock-ი raise-ის სწორ exception type-ს საჭიროებს
- ⏱ სავარაუდო დრო: 3 სთ

---

## პრობლემა #6 — formatter.py — zero tests
- 📍 ფაილი: `bot/reports/formatter.py`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: ყველა Telegram HTML output ამ ფაილიდან მოდის. `_truncate` (4096 char limit), `format_sale_confirmation`, `format_weekly_report` — untested. Formatting bug = broken messages.
- ✅ გამოსწორება: pure function tests, no mocking needed.
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #7 — import_excel_parser.py — zero tests
- 📍 ფაილი: `bot/parsers/import_excel_parser.py`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: 9-13 column Excel parser, 4 date formats, USD→GEL calculation, `_MAX_IMPORT_ROWS = 2000` — edge cases untested. Missing column → unknown behavior.
- ✅ გამოსწორება: `openpyxl` in-memory workbook fixtures.
- ⏱ სავარაუდო დრო: 3 სთ

---

## პრობლემა #8 — barcode/decoder.py — zero tests
- 📍 ფაილი: `bot/barcode/decoder.py`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: zxingcpp fail → Claude Vision fallback path untested. `extract_from_label()` — Claude API mock absent.
- ✅ გამოსწორება: `test_barcode.py` — PIL image mock, zxingcpp mock, AsyncAnthropic mock.
- ⏱ სავარაუდო დრო: 2 სთ

# Automated Checks Issues — Audit 2026-05-03

---

## პრობლემა #1 — Error Handling: TelegramRetryAfter only in deeplink.py
- 📍 ფაილი: `bot/handlers/deeplink.py:121` (handled), ყველა სხვა handler
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `TelegramRetryAfter` ყველა სხვა handler-ში `except Exception` აჭერს და logger.warning-ს იძახებს — message lost, no retry. Telegram rate limits silently discard messages.
- ✅ გამოსწორება: shared util function + extraction before generic catch.
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #2 — No global @dp.errors() handler
- 📍 ფაილი: `bot/main.py`
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: aiogram silently drops update on unhandled exception. Any handler code path without try/except → silent update loss.
- ✅ გამოსწორება: register `@dp.errors()` global handler.
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #3 — Anthropic errors not typed
- 📍 ფაილი: `bot/financial_ai/analyzer.py:93,122`, `bot/search_ai/catalog_search.py:111`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `except Exception` catches everything — `RateLimitError`, `APITimeoutError`, `APIConnectionError` indistinguishable. No backoff, no retry, no spend monitoring.
- ✅ გამოსწორება: typed exception handling + token usage logging.
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #4 — Token usage never logged
- 📍 ფაილი: ყველა Anthropic call
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `response.usage` (input_tokens, output_tokens, cache_read_input_tokens) ნებისმიერ Anthropic call-ზე არ ილოგება. API spend invisible.
- ✅ გამოსწორება: after every Anthropic call — `logger.info(f"claude: in={response.usage.input_tokens} out={response.usage.output_tokens}")`.
- ⏱ სავარაუდო დრო: 1 სთ

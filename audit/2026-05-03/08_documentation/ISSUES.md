# Documentation Issues — Audit 2026-05-03

---

## პრობლემა #1 — .env.example missing 4 vars
- 📍 ფაილი: `.env.example`
- 🟢 სიმძიმე: Medium
- ❌ პრობლემა: `config.py` კითხულობს: `REDIS_URL` (optional), `DASHBOARD_URL` (optional), `AUDIT_CHANNEL_ID` (optional), `FZ_ENTITY_ENABLED` (optional) — `.env.example`-ში არ არის. Developer-ი ამ vars-ს source code-ში ეძებს.
- ✅ გამოსწორება: `.env.example`-ში დამატება + კომენტარი.
- 💻 კოდის მაგალითი:
```bash
# Optional: Redis for FSM persistence (recommended for production)
# REDIS_URL=redis://localhost:6379

# Optional: Dashboard URL for personal order deeplinks
# DASHBOARD_URL=https://your-dashboard.up.railway.app

# Optional: Telegram channel ID for audit log forwarding
# AUDIT_CHANNEL_ID=-1001234567890

# Optional: Enable LLC-only entity mode (true/false)
# FZ_ENTITY_ENABLED=false
```
- ⏱ სავარაუდო დრო: 15 წთ

---

## პრობლემა #2 — README stale (3/11 handlers, 50% commands)
- 📍 ფაილი: `README.md`
- 🟢 სიმძიმე: Medium
- ❌ პრობლემა: Bot structure lists 3 handlers (`sales.py`, `orders.py`, `commands.py`). Actual: 11. Commands section: `/report`, `/stock`, `/addproduct`, `/help` — missing: `/cash`, `/deposit`, `/transfer`, `/orders`, `/nisias`.
- ✅ გამოსწორება: README-ში bot structure + command list update.
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #3 — RAILWAY_ENVIRONMENT guard undocumented
- 📍 ფაილი: `bot/main.py:10-13`, `README.md`
- 🟢 სიმძიმე: Medium
- ❌ პრობლემა: Bot-ი exits with Georgian message if `RAILWAY_ENVIRONMENT` not set. Developer following README's run instructions hits silent exit.
- ✅ გამოსწორება: README-ში local dev section + workaround.
- 💻 კოდის მაგალითი:
```bash
# Local development — add to .env:
RAILWAY_ENVIRONMENT=local

# Then run:
python -m bot.main
```
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #4 — 57 API routes without documentation
- 📍 ფაილი: `dashboard/app/api/`
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: No endpoint documentation — method, params, response schema, auth required. New developer reads 57 implementation files to understand the API surface.
- ✅ გამოსწორება: `dashboard/API.md` — simple markdown table.
- ⏱ სავარაუდო დრო: 2 სთ

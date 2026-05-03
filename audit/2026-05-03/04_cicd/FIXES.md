# CI/CD Fixes — Copy-Paste Ready

---

## Fix #1 — Add ruff format check to CI (.github/workflows/ci.yml)

```yaml
# Add after the existing ruff check step:
- name: Check formatting
  run: ruff format --check .
```

---

## Fix #2 — Add missing env vars to CI

```yaml
# In the test job env section, add:
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  BOT_TOKEN: "test:placeholder"
  ANTHROPIC_API_KEY: "test-placeholder"
  REDIS_URL: "redis://localhost:6379"
  NISIAS_TOPIC_ID: "999999"
  SALES_TOPIC_ID: "111111"
  ORDERS_TOPIC_ID: "222222"
  EXPENSES_TOPIC_ID: "333333"
  STOCK_TOPIC_ID: "444444"
```

---

## Fix #3 — Health-check endpoint (bot/main.py or separate)

```python
# bot/main.py — add minimal health endpoint via aiohttp
from aiohttp import web

async def healthz(request):
    return web.Response(text="ok")

async def start_healthcheck():
    app = web.Application()
    app.router.add_get("/healthz", healthz)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
```

---

## Fix #4 — railway.toml healthcheck

```toml
[deploy]
startCommand = "python -m bot.main"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
healthcheckPath = "/healthz"
healthcheckTimeout = 30
```

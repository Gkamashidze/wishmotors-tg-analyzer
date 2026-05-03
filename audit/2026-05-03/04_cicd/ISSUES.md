# CI/CD Issues — Audit 2026-05-03

---

## პრობლემა #1 — No staging environment
- 📍 ფაილი: `.github/workflows/ci.yml`, `railway.toml`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: ყოველი push to `main` → production Railway deploy. CI-ში `develop` branch ტრიგერია, მაგრამ Railway staging service არ არის. Broken feature production-ში მყისიერად ხვდება.
- ✅ გამოსწორება: Railway-ში staging service + `develop` branch → staging, `main` → production.
- ⏱ სავარაუდო დრო: 2 სთ (Railway dashboard)

---

## პრობლემა #2 — No rollback / no health-check
- 📍 ფაილი: `railway.toml`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Bad deploy → manual re-deploy only. `restartPolicyType = "on_failure"` 5 retry-ს აკეთებს startup crash-ზე — no automated rollback.
- ✅ გამოსწორება: Railway health-check endpoint + rollback via GitHub Action on failure.
- 💻 კოდის მაგალითი:
```toml
# railway.toml addition:
[deploy]
healthcheckPath = "/healthz"
healthcheckTimeout = 30
```
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #3 — ruff format --check absent from CI
- 📍 ფაილი: `.github/workflows/ci.yml`
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: CI runs `ruff check` (linting) but not `ruff format --check` (formatting). Code style drift undetected.
- ✅ გამოსწორება: CI-ში `ruff format --check .` step დამატება.
- ⏱ სავარაუდო დრო: 15 წთ

---

## პრობლემა #4 — Missing env vars in CI
- 📍 ფაილი: `.github/workflows/ci.yml`
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: `ANTHROPIC_API_KEY`, `REDIS_URL`, `NISIAS_TOPIC_ID` absent from CI env block. Code paths importing these fail at startup or silently skip.
- ✅ გამოსწორება: placeholder values CI env-ში.
- 💻 კოდის მაგალითი:
```yaml
env:
  ANTHROPIC_API_KEY: "test-key-placeholder"
  REDIS_URL: "redis://localhost:6379"
  NISIAS_TOPIC_ID: "999999"
```
- ⏱ სავარაუდო დრო: 15 წთ

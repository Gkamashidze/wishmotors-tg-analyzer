# Security Fixes — Copy-Paste Ready

---

## Fix #1 — Delete debug folder (terminal)

```bash
rm -rf dashboard/app/api/debug
# შემდეგ შეამოწმე get-refresh-token.mjs და dashboard/get-refresh-token.mjs
```

---

## Fix #2 — timingSafeEqual (dashboard/middleware.ts)

```ts
// Replace the existing timingSafeEqual function at line ~65

import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto"

function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  const bufA = Buffer.from(a.padEnd(maxLen, "\0"), "utf8")
  const bufB = Buffer.from(b.padEnd(maxLen, "\0"), "utf8")
  return cryptoTimingSafeEqual(bufA, bufB)
}
```

---

## Fix #3 — SSL on asyncpg pool (database/db.py:44)

```python
# Before:
self._pool = await asyncpg.create_pool(
    dsn=database_url,
    min_size=2,
    max_size=10,
)

# After:
import ssl as ssl_module

_ssl_ctx = ssl_module.create_default_context()
self._pool = await asyncpg.create_pool(
    dsn=database_url,
    min_size=2,
    max_size=10,
    ssl=_ssl_ctx,
)
```

> **შენიშვნა:** ლოკალური PostgreSQL-ისთვის `ssl="require"` მაგ `_ssl_ctx`-ის ნაცვლად. Railway-ისთვის full context.

---

## Fix #4 — Generic error responses (dashboard API routes)

```ts
// Replace in every catch block across all API routes:

// ❌ Before:
} catch (err) {
  return NextResponse.json({ error: String(err) }, { status: 500 })
}

// ✅ After:
} catch (err) {
  console.error("[api/route-name] error:", err)
  return NextResponse.json({ error: "internal error" }, { status: 500 })
}
```

---

## Fix #5 — Content-Security-Policy (dashboard/middleware.ts)

```ts
// In the section where other security headers are set, add:

response.headers.set(
  "Content-Security-Policy",
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://drive.google.com https://lh3.googleusercontent.com",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
)
```

---

## Fix #6 — Fix image remotePatterns (dashboard/next.config.ts)

```ts
// Before:
images: {
  remotePatterns: [{ protocol: "https", hostname: "**" }],
},

// After:
images: {
  remotePatterns: [
    { protocol: "https", hostname: "drive.google.com" },
    { protocol: "https", hostname: "lh3.googleusercontent.com" },
  ],
},
```

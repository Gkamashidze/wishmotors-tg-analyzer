# Security Issues — Audit 2026-05-03

---

## პრობლემა #1 — Debug endpoint leaks OAuth secrets
- 📍 ფაილი: `dashboard/app/api/debug/drive-config/route.ts`, ხაზი: 1-40
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `GET /api/debug/drive-config` აბრუნებს `GOOGLE_CLIENT_SECRET`-ის პირველ 8 სიმბოლოს, `GOOGLE_REFRESH_TOKEN`-ს და token refresh-ის შედეგს ნებისმიერ Basic Auth user-ს. ეს credential validity oracle-ია — attacker-ს შეუძლია token-ის სტატუსი შეამოწმოს.
- ✅ გამოსწორება: folder მთლიანად წაიშალოს. OAuth debugging ლოკალურ script-ზე (`get-refresh-token.mjs`).
- ⚠️ რეგრესიის რისკი: `get-refresh-token.mjs`-ი შეიძლება ამ endpoint-ზე იყოს დამოკიდებული — შეამოწმე.
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #2 — timingSafeEqual timing oracle
- 📍 ფაილი: `dashboard/middleware.ts`, ხაზი: 65-72
- 🔴 სიმძიმე: კრიტიკული
- ❌ პრობლემა: `if (a.length !== b.length) return false` — length mismatch-ზე ადრე გამოსვლა timing oracle-ია. Attacker-ს შეუძლია სწორი პაროლის სიგრძე დაადგინოს response time-ის მიხედვით.
- ✅ გამოსწორება: `crypto.timingSafeEqual` with Buffer padding.
- 💻 კოდის მაგალითი:
```ts
// ❌ before
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  // ...
}

// ✅ after
import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto"

function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  const bufA = Buffer.from(a.padEnd(maxLen, "\0"))
  const bufB = Buffer.from(b.padEnd(maxLen, "\0"))
  return cryptoTimingSafeEqual(bufA, bufB)
}
```
- ⚠️ რეგრესიის რისკი: დაბალი — მხოლოდ Basic Auth logic
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #3 — Raw exception messages to clients
- 📍 ფაილი: `dashboard/app/api/migrate-erp/route.ts:122,136`, `dashboard/app/api/erp-imports/route.ts:105,183`, `dashboard/app/api/erp-imports/[id]/route.ts:120,210,226`, `dashboard/app/api/products/[id]/generate-description/route.ts:84` + 11 more
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `return NextResponse.json({ error: String(err) })` — PostgreSQL error messages (column names, table names, query fragments) HTTP response-ში ბრუნდება. Information disclosure სკანერ-ებისთვის.
- ✅ გამოსწორება: generic client error + server-side log.
- 💻 კოდის მაგალითი:
```ts
// ❌ before
} catch (err) {
  return NextResponse.json({ error: String(err) }, { status: 500 })
}

// ✅ after
} catch (err) {
  console.error("[api/migrate-erp] unexpected error:", err)
  return NextResponse.json({ error: "internal error" }, { status: 500 })
}
```
- ⚠️ რეგრესიის რისკი: frontend-ი შეიძლება ამ error message-ს აჩვენებდეს user-ს — შეამოწმე UI error states
- ⏱ სავარაუდო დრო: 2 სთ

---

## პრობლემა #4 — Missing Content-Security-Policy
- 📍 ფაილი: `dashboard/middleware.ts`, `dashboard/next.config.ts`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: 5 security header-ი დაყენებულია, CSP არ არის. Public `/catalog` pages-ი XSS-ის წინააღმდეგ secondary defense-ს მოკლებულია.
- ✅ გამოსწორება: `middleware.ts`-ში CSP header დამატება.
- 💻 კოდის მაგალითი:
```ts
// middleware.ts — response.headers-ში
response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://drive.google.com https://lh3.googleusercontent.com; connect-src 'self'; frame-ancestors 'none';"
)
```
- ⚠️ რეგრესიის რისკი: inline styles არსებობს — `'unsafe-inline'` ჯერჯერობით ჩავუტოვოთ
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #5 — Wildcard image remotePatterns SSRF
- 📍 ფაილი: `dashboard/next.config.ts`, ხაზი: 22
- 🟡 სიმძიმე: High
- ❌ პრობლემა: `hostname: "**"` — Next.js image optimizer-ი ნებისმიერი HTTPS URL-ის proxy-ა. SSRF vector.
- ✅ გამოსწორება: specific hostnames.
- 💻 კოდის მაგალითი:
```ts
// ❌ before
remotePatterns: [{ protocol: "https", hostname: "**" }]

// ✅ after
remotePatterns: [
  { protocol: "https", hostname: "drive.google.com" },
  { protocol: "https", hostname: "lh3.googleusercontent.com" },
]
```
- ⚠️ რეგრესიის რისკი: სხვა image source-ები შეიძლება გამტყდეს — შეამოწმე gallery-ს image URLs
- ⏱ სავარაუდო დრო: 15 წთ

---

## პრობლემა #6 — DDL endpoints via HTTP POST
- 📍 ფაილი: `dashboard/app/api/migrate-erp/route.ts`, `dashboard/app/api/migrate-currency/route.ts`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: HTTP POST endpoint-ები `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`-ს უშვებენ. Replayable — accidentally/maliciously re-run.
- ✅ გამოსწორება: ერთჯერადი startup script ან `db.py` MIGRATE_SQL-ში გადატანა.
- ⚠️ რეგრესიის რისკი: ERP migration UI ამ route-ებს იყენებს — dashboard flow-ი შეიძლება მოიშალოს
- ⏱ სავარაუდო დრო: 1 სთ

---

## პრობლემა #7 — /api/debug/orders production data
- 📍 ფაილი: `dashboard/app/api/debug/orders/route.ts`
- 🟡 სიმძიმე: High
- ❌ პრობლემა: Real production order rows (part_name, status, priority) HTTP response-ში ბრუნდება. dev-ში unauthenticated.
- ✅ გამოსწორება: ფაილი წაიშალოს (debug/ folder-თან ერთად — #1)
- ⚠️ რეგრესიის რისკი: არ არის
- ⏱ სავარაუდო დრო: #1-ში შედის

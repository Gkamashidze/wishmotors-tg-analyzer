# WishMotors — Dashboard

თანამედროვე ვებ-პანელი gayidvebis, xarjebis da shekvetebis samartavad.

## ტექნოლოგიები

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** — დიზაინ-სისტემა
- **Recharts** — ფინანსური გრაფიკები
- **node-postgres (pg)** — PostgreSQL-ის პირდაპირი კავშირი

## არქიტექტურა

```
dashboard/
├── app/
│   ├── page.tsx         ← მთავარი დაფა (stats + charts)
│   ├── orders/page.tsx  ← შეკვეთების გვერდი ფილტრებით
│   └── layout.tsx       ← Sidebar layout
├── components/
│   ├── ui/              ← shadcn/ui primitives (Card, Button, Badge, Table)
│   ├── dashboard/       ← domain კომპონენტები (charts, stats, tables)
│   ├── sidebar.tsx
│   └── top-bar.tsx
├── lib/
│   ├── db.ts            ← PG pool (server-only)
│   ├── queries.ts       ← ტიპიზირებული SQL queries
│   └── utils.ts
└── middleware.ts        ← Optional Basic Auth
```

**უსაფრთხოების ბოჭკო:**

- `DATABASE_URL` მხოლოდ სერვერზე წაიკითხება (`lib/db.ts`-ში `import "server-only"`).
- მონაცემთა ყველა query Server Component-ში ხდება — ბრაუზერში არასდროს გადადის ბაზის credentials ან SQL.
- SSL ავტომატურად ირთვება Railway-სთვის (`rejectUnauthorized: false`).
- `DASHBOARD_BASIC_AUTH` env var-ით მარტივი HTTP Basic Auth ჩაირთვება middleware-ში.
- `.env.local` .gitignore-ში — არასდროს commit.

## ლოკალური გაშვება (ნაბიჯ-ნაბიჯ)

### 1. Dependencies-ის დაყენება

```bash
cd dashboard
npm install
```

### 2. Environment ცვლადები

```bash
cp .env.local.example .env.local
```

გახსენი `.env.local` და ჩასვი იგივე `DATABASE_URL`, რაც პროექტის ძირეულ `.env`-ში გაქვს:

```
DATABASE_URL=postgresql://postgres:...@metro.proxy.rlwy.net:11282/railway
PGSSL=true
```

**სურვილისამებრ** — დაამატე მარტივი პაროლი:

```
DASHBOARD_BASIC_AUTH=admin:SuperSecret123
```

თუ ეს ცვლადი დაყენებულია, ყოველი ღილაკი მოითხოვს მომხმარებელს/პაროლს.

### 3. Dev სერვერის გაშვება

```bash
npm run dev
```

გახსენი ბრაუზერში: **http://localhost:3000**

ნახავ:
- `/` — მთავარი დაფა (ჯამური გაყიდვები, ხარჯები, მოგება + 30-დღიანი გრაფიკი)
- `/orders` — ცხრილი, სადაც ფილტრავ:
  - პრიორიტეტით: 🚨 სასწრაფო / 🟢 ჩვეულებრივი / დაბალი
  - სტატუსით: მოლოდინში / შეკვეთილი / მიღებული / გაუქმებული
  - ტექსტით (პროდუქტი, OEM, შენიშვნა)

### 4. Production build (არასავალდებულო)

```bash
npm run build
npm start
```

### 5. ტიპების შემოწმება

```bash
npm run typecheck
```

## Troubleshooting

| პრობლემა | გამოსავალი |
|----------|-----------|
| `DATABASE_URL is not set` | შეავსე `.env.local` |
| `self-signed certificate` | დარწმუნდი, რომ `PGSSL=true` |
| `ECONNREFUSED` | შეამოწმე Railway-ის DATABASE_URL ჯერ კიდევ აქტიურია |
| ცარიელი გრაფიკი | ნორმალურია, თუ ბოლო 30 დღეში გაყიდვები არ არის |

## Deployment — Railway (რეკომენდებული)

Dashboard-ი მზადაა Railway-ზე ცალკე web service-ად, იმავე პროექტში სადაც ბოტი
და Postgres უკვე მუშაობს. `railway.toml` ფაილი უკვე კონფიგურაციასთან ერთად
ჩართულია.

### ნაბიჯები

1. **ახალი service-ის დამატება:**
   - შედი Railway-ის პროექტში, სადაც უკვე დგას ბოტი და Postgres.
   - ღილაკი: **New → Deploy from GitHub → wishmotors-tg-analyzer**.
   - **Root Directory:** `dashboard` ← ეს ძალიან მნიშვნელოვანია.
   - Railway ავტომატურად გამოიყენებს `dashboard/railway.toml`-ს.

2. **Environment Variables (აუცილებლად):**

   | ცვლადი | მნიშვნელობა |
   |--------|-------------|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres service-დან reference) |
   | `PGSSL` | `true` |
   | `DASHBOARD_BASIC_AUTH` | `admin:LONG_RANDOM_PASSWORD` ← **აუცილებელია!** |
   | `NODE_ENV` | `production` (Railway ავტომატურად აყენებს) |

   **უსაფრთხოება:** თუ `DASHBOARD_BASIC_AUTH` დაყენებული არ არის,
   Dashboard უარს ამბობს აამუშაოს საიტი — 503 კოდით. ეს დაცვაა
   შემთხვევითი გასაჯაროებისგან.

3. **Generate Domain:**
   - Service Settings → **Networking → Generate Domain**.
   - მიიღებ მისამართს: `your-dashboard.up.railway.app`.
   - საიტი მოითხოვს მომხმარებელ/პაროლს (Basic Auth pop-up).

4. **Custom Domain (სურვილისამებრ):**
   - Networking → Custom Domains → დაამატე `dashboard.wishmotors.ge`.

### Healthcheck

`/healthz` endpoint ღიაა ავტორიზაციის გარეშე — Railway იყენებს მას
service-ის ჯანმრთელობის შესამოწმებლად.

### Security Headers

middleware ავტომატურად ამატებს `X-Frame-Options`, `X-Content-Type-Options`,
`Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.

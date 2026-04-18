# WishMotors TG Analyzer

Telegram bot for tracking auto parts sales, orders, expenses, and inventory — built for a Georgian-language supergroup with Forum Topics.

---

## ქართული სახელმძღვანელო

### მოთხოვნები
- Python 3.11+
- Telegram ბოტი (@BotFather-ით შექმნილი)
- Supergroup Forum Topics-ით ჩართული

### დაყენება

**1. პროექტის ჩამოტვირთვა**
```bash
git clone <repo-url>
cd wishmotors-tg-analyzer
```

**2. ვირტუალური გარემოს შექმნა**
```bash
python -m venv venv
source venv/bin/activate        # macOS / Linux
venv\Scripts\activate           # Windows
```

**3. დამოკიდებულებების დაყენება**
```bash
pip install -r requirements.txt
```

**4. `.env` ფაილის მომზადება**
```bash
cp .env.example .env
```
გახსენით `.env` და შეავსეთ ყველა ველი:

| ველი | რა არის |
|------|---------|
| `BOT_TOKEN` | @BotFather-ისგან მიღებული ტოკენი |
| `GROUP_ID` | Supergroup-ის ID (უარყოფითი რიცხვი) |
| `SALES_TOPIC_ID` | Sales topic-ის thread ID |
| `ORDERS_TOPIC_ID` | Orders topic-ის thread ID |
| `EXPENSES_TOPIC_ID` | Expenses topic-ის thread ID |
| `STOCK_TOPIC_ID` | Stock topic-ის thread ID |

**Topic ID-ის პოვნა:** Topic-ში შეტყობინებაზე დააჭირეთ Copy Link. ბმულის ბოლო ნომერია topic ID.

**5. ბოტის გაშვება**
```bash
python -m bot.main
```

### გამოყენება

**Sales topic-ში დაწერეთ:**
```
მარჭვენა რეფლექტორი 1ც 30₾ ხელზე
8390132500 2ც 45₾ გადარიცხვა
კოდი: 8390132500, 1ც, 35₾
```

**დაბრუნება:**
```
დაბრუნება: 8390132500 1ც 45₾
```

**Orders topic-ში:**
```
8390132500 5ც
```

**Expenses topic-ში:**
```
50₾ ბენზინი
ბენზინი 50₾
```

**Stock topic-ში:** Excel (.xlsx) ფაილი სვეტებით: `სახელი | OEM | მარაგი | ფასი | თარიღი | ერთეული`

| სვეტი | სახელი | სავალდებულო | მაგალითი |
|-------|--------|-------------|---------|
| 1 | სახელი | ✅ | `ზეთის ფილტრი` |
| 2 | OEM | ✅ | `HU7009Z` |
| 3 | მარაგი | ✅ | `50` |
| 4 | ფასი | ✅ | `12.50` |
| 5 | თარიღი | ❌ | `2026-02-15` |
| 6 | ერთეული | ❌ | `ცალი`, `ლიტრი`, `კომპლექტი` |

> სვეტი **თარიღი** (მე-5) — სავალდებულო არ არის. თუ მითითებულია, სისტემა ჩანაწერს ამ თარიღით შეინახავს (backdate). მხარდაჭერილი ფორმატები: `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`.
>
> სვეტი **ერთეული** (მე-6) — სავალდებულო არ არის. თუ ცარიელია, ნაგულისხმევი მნიშვნელობა არის `ცალი`.

**ბრძანებები:**
- `/report` — კვირის ანგარიში
- `/stock` — საწყობის მდგომარეობა
- `/addproduct სახელი OEM მარაგი ფასი` — პროდუქტის დამატება
- `/help` — დახმარება

---

## English Guide

### Requirements
- Python 3.11+
- A Telegram bot (created via @BotFather)
- A Supergroup with Forum Topics enabled

### Setup

**1. Clone the project**
```bash
git clone <repo-url>
cd wishmotors-tg-analyzer
```

**2. Create a virtual environment**
```bash
python -m venv venv
source venv/bin/activate        # macOS / Linux
venv\Scripts\activate           # Windows
```

**3. Install dependencies**
```bash
pip install -r requirements.txt
```

**4. Configure environment**
```bash
cp .env.example .env
```
Open `.env` and fill in all values:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Token from @BotFather |
| `GROUP_ID` | Supergroup ID (negative integer) |
| `SALES_TOPIC_ID` | Thread ID of the Sales topic |
| `ORDERS_TOPIC_ID` | Thread ID of the Orders topic |
| `EXPENSES_TOPIC_ID` | Thread ID of the Expenses topic |
| `STOCK_TOPIC_ID` | Thread ID of the Stock/Inventory topic |

**Finding a Topic ID:** Right-click any message inside the topic → Copy Link. The last number in the URL is the topic ID.

**5. Run the bot**
```bash
python -m bot.main
```

### Bot permissions
Add the bot to the supergroup and grant it **Read Messages** permission. The bot must be able to see all topic messages.

### How it works

| Topic | What to write | What the bot does |
|-------|--------------|-------------------|
| Sales | `Product 1ც 30₾ payment` | Records the sale, updates stock, warns if low |
| Orders | `Product 5ც` | Logs a re-order note |
| Expenses | `50₾ description` | Logs a business expense |
| Capital | Upload `.xlsx` file | Bulk-updates inventory |

**Automatic weekly report:** Every Sunday at 22:00 Tbilisi time the bot posts a full summary to the group.

### Database
The bot uses **PostgreSQL** (via `asyncpg`). A local PostgreSQL instance or a hosted
service (e.g. Railway Postgres) is required.

Tables: `products`, `sales`, `returns`, `orders`, `expenses`, `parse_failures`

Schema and indexes are created automatically on first run.

### Railway Deployment

1. Create a new Railway project and add a **PostgreSQL** plugin.
2. In your service's **Variables** tab, add all required env vars (see `.env.example`).
3. For `DATABASE_URL`, use Railway's auto-generated variable reference:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```
4. Push to the `main` branch — Railway builds and deploys automatically.
5. The bot guard (`RAILWAY_ENVIRONMENT`) prevents accidental local runs against the
   production database.

---

## Project Structure

```
wishmotors-tg-analyzer/
├── bot/
│   ├── handlers/
│   │   ├── __init__.py       # InTopic filter
│   │   ├── sales.py          # Sales + stock topic handlers
│   │   ├── orders.py         # Orders + expenses topic handlers
│   │   └── commands.py       # /report /stock /addproduct /help
│   ├── parsers/
│   │   └── message_parser.py # Georgian text → structured data
│   ├── reports/
│   │   └── formatter.py      # HTML report builders
│   └── main.py               # Bot entry point + scheduler
├── database/
│   ├── models.py             # SQL schema + dataclasses
│   └── db.py                 # Async database layer
├── config.py                 # Environment variable loader
├── requirements.txt
├── .env.example
└── .gitignore
```

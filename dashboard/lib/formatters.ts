/**
 * Telegram HTML message formatters for Dashboard → Telegram sync.
 * Mirrors the compact topic-post formatters in bot/reports/formatter.py:
 *   format_topic_sale, format_topic_expense, format_topic_nisia.
 *
 * All output uses Telegram HTML parse mode (not MarkdownV2).
 */

function esc(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "ხელზე 💵",
  transfer: "დარიცხა 🏦",
  credit: "ნისია 📋",
};

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "⛽ საწვავი",
  customs: "🛃 საბაჟო",
  delivery: "🚚 მიტანა",
  maintenance: "🔧 სერვისი",
  marketing: "📣 რეკლამა",
  office: "🖊 ოფისი",
  utilities: "💡 კომუნალი",
  salary: "👷 ხელფასი",
  insurance: "🛡 სადაზღვევო",
  transport: "🚗 ტრანსპორტი",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "⏳ მოლოდინშია",
  fulfilled: "✅ შესრულდა",
  cancelled: "❌ გაუქმდა",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "🔴 სასწრაფო",
  normal: "🟡 ჩვეულებრივი",
  low: "🟢 დაბალი",
};

export interface TopicSaleOpts {
  productName: string;
  qty: number;
  price: number;
  paymentMethod: string;
  saleId: number;
  customerName?: string | null;
  oemCode?: string | null;
}

export function formatTopicSale(opts: TopicSaleOpts): string {
  const total = opts.qty * opts.price;
  const pay = PAYMENT_LABELS[opts.paymentMethod] ?? opts.paymentMethod;
  const cust = opts.customerName ? ` | 👤 ${esc(opts.customerName)}` : "";
  const oem = opts.oemCode ? ` <code>${esc(opts.oemCode)}</code>` : "";

  if (opts.paymentMethod === "credit" && opts.customerName) {
    return (
      `📋 <b>ნისია</b> | 👤 ${esc(opts.customerName)}\n` +
      `📦 ${esc(opts.productName)}${oem} — ${opts.qty}ც × ${opts.price.toFixed(2)}₾ = <b>${total.toFixed(2)}₾</b> | <code>#${opts.saleId}</code>`
    );
  }
  return (
    `📦 <b>${esc(opts.productName)}</b>${oem} — ${opts.qty}ც × ${opts.price.toFixed(2)}₾ = ` +
    `<b>${total.toFixed(2)}₾</b> | ${pay}${cust} | <code>#${opts.saleId}</code>`
  );
}

export interface TopicExpenseOpts {
  amount: number;
  category?: string | null;
  description?: string | null;
  expenseId: number;
}

export function formatTopicExpense(opts: TopicExpenseOpts): string {
  const cat = CATEGORY_LABELS[opts.category ?? ""] ?? "📝 სხვა";
  const desc = opts.description ? ` — ${esc(opts.description)}` : "";
  return `🧾 ${cat}${desc}: <b>${opts.amount.toFixed(2)}₾</b> | <code>#${opts.expenseId}</code>`;
}

export interface TopicOrderOpts {
  productName: string;
  qty: number;
  status: string;
  priority: string;
  orderId: number;
  notes?: string | null;
}

export function formatTopicOrder(opts: TopicOrderOpts): string {
  const st = STATUS_LABELS[opts.status] ?? opts.status;
  const pr = PRIORITY_LABELS[opts.priority] ?? opts.priority;
  const notes = opts.notes ? `\n📝 ${esc(opts.notes)}` : "";
  return (
    `📋 <b>${esc(opts.productName)}</b> — ${opts.qty}ც | ${st} | ${pr}${notes} | ` +
    `<code>#${opts.orderId}</code>`
  );
}

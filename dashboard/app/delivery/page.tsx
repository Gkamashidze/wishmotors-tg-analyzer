import Link from "next/link";

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function IconTruck() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconQuestion() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <h2 className="font-semibold text-base">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-foreground/70">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function PayBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border bg-secondary/50 text-foreground/80 font-medium">
      <IconCheck />
      {label}
    </span>
  );
}

// ─── FAQ item ─────────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="py-4 border-b border-border/50 last:border-0">
      <p className="text-sm font-medium mb-1.5">{q}</p>
      <p className="text-sm text-foreground/60">{a}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const address = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS;
  const hours = process.env.NEXT_PUBLIC_BUSINESS_HOURS;
  const mapsUrl = process.env.NEXT_PUBLIC_GOOGLE_MAPS_URL;
  const phone = process.env.NEXT_PUBLIC_CONTACT_PHONE;
  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
  const tgUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  const waHref = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent("გამარჯობა! მაქვს კითხვა მიწოდებასთან დაკავშირებით.")}` : null;
  const tgHref = tgUsername ? `https://t.me/${tgUsername}` : null;
  const telHref = phone ? `tel:${phone.replace(/\s/g, "")}` : null;

  return (
    <>
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link
            href="/catalog"
            className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground transition-colors text-sm shrink-0"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
            <span className="hidden sm:inline">კატალოგი</span>
          </Link>
          <Link href="/catalog" className="font-bold text-lg tracking-tight text-foreground hover:text-primary transition-colors">
            WishMotors
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 pb-20 space-y-6">

        <div className="mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1">მიწოდება და გადახდა</h1>
          <p className="text-foreground/60 text-sm">ყველაფერი რაც უნდა იცოდე შეკვეთის შესახებ</p>
        </div>

        {/* ── Delivery ── */}
        <Section icon={<IconTruck />} title="მიწოდება">
          <div>
            <Row label="თბილისი" value="კურიერი — 1-2 სამუშაო დღეში" />
            <Row label="სხვა ქალაქები" value="სწრაფი ამანათი — 2-4 სამუშაო დღეში" />
            <Row label="საწყობიდან წაღება" value="უფასო — სამუშაო საათებში" />
            <Row label="შეკვეთილი პროდუქტი" value="3-5 სამუშაო დღეში" />
          </div>
        </Section>

        {/* ── Payment ── */}
        <Section icon={<IconCard />} title="გადახდის მეთოდები">
          <div className="flex flex-wrap gap-2">
            <PayBadge label="ნაღდი ფული" />
            <PayBadge label="საბანკო გადარიცხვა" />
            <PayBadge label="Bog Pay" />
            <PayBadge label="TBC Pay" />
            <PayBadge label="ნისია — შეთანხმებით" />
          </div>
        </Section>

        {/* ── Address ── */}
        {(address || hours) && (
          <Section icon={<IconPin />} title="მისამართი და საათები">
            <div>
              {address && <Row label="მისამართი" value={address} />}
              {hours && <Row label="სამუშაო საათები" value={hours} />}
            </div>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-sm text-primary hover:underline"
              >
                გახსენი Google Maps →
              </a>
            )}
          </Section>
        )}

        {/* ── FAQ ── */}
        <Section icon={<IconQuestion />} title="ხშირად დასმული კითხვები">
          <div>
            <FaqItem
              q="პროდუქტი არ არის მარაგში — მოიტანთ?"
              a="კი. შეკვეთის შემდეგ 3-5 სამუშაო დღეში მოვიტანთ. დაგვიკავშირდით და შევაკვეთოთ."
            />
            <FaqItem
              q="ნივთის დაბრუნება შეიძლება?"
              a="კი, 7 დღის განმავლობაში — თუ ნაწილი არ ჯდება ან ქარხნული დეფექტია. გთხოვთ, შეინახოთ შეფუთვა."
            />
            <FaqItem
              q="ინვოისი / ჩეკი გამოგზავნით?"
              a="კი. შპს-სა და ფ.პ-ს ორივეს ვუგზავნით ჩეკს. გთხოვთ, შეკვეთისას აღნიშნოთ."
            />
          </div>
        </Section>

        {/* ── CTA ── */}
        {(waHref || tgHref || telHref) && (
          <div className="rounded-xl border bg-primary/5 p-6 text-center">
            <p className="font-semibold mb-1">კითხვა გაქვს?</p>
            <p className="text-sm text-foreground/60 mb-4">დაგვიკავშირდი — სიამოვნებით დაგეხმარებით</p>
            <div className="flex flex-wrap gap-3 justify-center">
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:opacity-90 transition-opacity">
                  WhatsApp
                </a>
              )}
              {tgHref && (
                <a href={tgHref} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0088cc] text-white text-sm font-medium hover:opacity-90 transition-opacity">
                  Telegram
                </a>
              )}
              {telHref && (
                <a href={telHref}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border bg-background text-sm font-medium hover:bg-secondary transition-colors">
                  {phone}
                </a>
              )}
            </div>
          </div>
        )}

      </main>
    </>
  );
}

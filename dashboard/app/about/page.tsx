import Link from "next/link";
import { getPublicProductsInStockCount } from "@/lib/queries";

export default async function AboutPage() {
  const phone = process.env.NEXT_PUBLIC_CONTACT_PHONE;
  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
  const tgUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const yearsInBusiness = process.env.NEXT_PUBLIC_YEARS_IN_BUSINESS ?? "1";
  const happyCustomers = process.env.NEXT_PUBLIC_HAPPY_CUSTOMERS ?? "500+";
  const mapsEmbed = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED;

  const productsInStock = await getPublicProductsInStockCount().catch(() => 0);

  const waHref = waPhone ? `https://wa.me/${waPhone}` : null;
  const tgHref = tgUsername ? `https://t.me/${tgUsername}` : null;
  const telHref = phone ? `tel:${phone.replace(/\s/g, "")}` : null;

  const btnBase =
    "flex items-center justify-center gap-2.5 rounded-xl py-4 px-5 font-semibold text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

  return (
    <>
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link
            href="/catalog"
            className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground transition-colors text-sm shrink-0"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">კატალოგი</span>
          </Link>
          <Link
            href="/catalog"
            className="font-bold text-lg tracking-tight text-foreground hover:text-primary transition-colors"
          >
            WishMotors
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12 pb-20">

        {/* ── Hero ── */}
        <section className="text-center mb-14">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight mb-4">
            WishMotors — ხარისხიანი ნაწილები<br className="hidden sm:block" /> ხარისხიანი მანქანებისთვის
          </h1>
          <p className="text-foreground/60 text-lg max-w-xl mx-auto">
            SsangYong-ის სათადარიგო ნაწილების სპეციალისტი
          </p>
        </section>

        {/* ── Stats ── */}
        <section className="grid grid-cols-3 gap-4 mb-14">
          <div className="rounded-2xl border bg-secondary/30 p-6 text-center">
            <p className="text-3xl font-bold">{yearsInBusiness}+</p>
            <p className="text-sm text-foreground/60 mt-1">წელი ბაზარზე</p>
          </div>
          <div className="rounded-2xl border bg-secondary/30 p-6 text-center">
            <p className="text-3xl font-bold">{happyCustomers}</p>
            <p className="text-sm text-foreground/60 mt-1">კმაყოფილი კლიენტი</p>
          </div>
          <div className="rounded-2xl border bg-secondary/30 p-6 text-center">
            <p className="text-3xl font-bold">{productsInStock}+</p>
            <p className="text-sm text-foreground/60 mt-1">ნაწილი მარაგში</p>
          </div>
        </section>

        {/* ── Story ── */}
        <section className="mb-14 space-y-5 text-foreground/80 leading-relaxed">
          <h2 className="text-xl font-semibold text-foreground">ჩვენს შესახებ</h2>
          <p>
            WishMotors დაარსდა SsangYong-ის მოყვარულთა მიერ, ვისაც ჰქონდა ერთი მარტივი
            მიზანი — გაუადვილოს ქართველ მძღოლებს ხარისხიანი სათადარიგო ნაწილების პოვნა.
            ჩვენ ვამარაგებთ ორიგინალ და მაღალი ხარისხის ანალოგ ნაწილებს SsangYong-ის
            ყველა პოპულარული მოდელისთვის.
          </p>
          <p>
            ჩვენი გუნდი ყოველდღიურად მუშაობს იმისთვის, რომ კატალოგი განახლებული და
            ზუსტი იყოს. ყოველ ნაწილზე ვამოწმებთ თავსებადობას, ვპასუხობთ
            ყველა შეკითხვაზე და ვცდილობთ მიწოდება სწრაფი იყოს.
          </p>
          <p>
            თუ ვერ პოულობთ სასურველ ნაწილს კატალოგში — დაგვიკავშირდით პირდაპირ.
            ვეძებთ ყველაფერს, რაც SsangYong-ს სჭირდება.
          </p>
        </section>

        {/* ── CTA buttons ── */}
        <section className="mb-14">
          <h2 className="text-xl font-semibold text-foreground mb-5">დაგვიკავშირდით</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* WhatsApp */}
            <a
              href={waHref ?? "#"}
              target={waHref ? "_blank" : undefined}
              rel="noopener noreferrer"
              aria-label="WhatsApp-ით დაკავშირება"
              className={`${btnBase} text-white`}
              style={{ backgroundColor: "#25D366" }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current shrink-0" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.553 4.107 1.52 5.847L.057 23.994l6.302-1.651A11.932 11.932 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.795 9.795 0 01-4.99-1.369l-.358-.213-3.712.973.99-3.617-.234-.371A9.769 9.769 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
              </svg>
              WhatsApp
            </a>

            {/* Telegram */}
            <a
              href={tgHref ?? "#"}
              target={tgHref ? "_blank" : undefined}
              rel="noopener noreferrer"
              aria-label="Telegram-ით დაკავშირება"
              className={`${btnBase} text-white`}
              style={{ backgroundColor: "#229ED9" }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current shrink-0" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
              </svg>
              Telegram
            </a>

            {/* Phone */}
            <a
              href={telHref ?? "#"}
              aria-label={phone ? `დარეკვა — ${phone}` : "დარეკვა"}
              className={`${btnBase} border-2 border-border hover:border-primary/50 hover:bg-secondary`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.81a19.79 19.79 0 01-3.07-8.7A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.29 6.29l1.28-1.29a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              {phone || "დარეკვა"}
            </a>

          </div>
        </section>

        {/* ── Google Maps embed ── */}
        {mapsEmbed && (
          <section className="mb-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">მდებარეობა</h2>
            <div className="rounded-2xl overflow-hidden border aspect-video">
              <iframe
                src={mapsEmbed}
                width="100%"
                height="100%"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="WishMotors-ის მდებარეობა Google Maps-ზე"
                className="w-full h-full"
              />
            </div>
          </section>
        )}

      </main>
    </>
  );
}

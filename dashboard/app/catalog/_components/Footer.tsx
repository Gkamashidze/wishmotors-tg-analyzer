import Link from "next/link";

export default function Footer() {
  const phone = process.env.NEXT_PUBLIC_CONTACT_PHONE;
  const waPhone = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
  const tgUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const address = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS;
  const hours = process.env.NEXT_PUBLIC_BUSINESS_HOURS;
  const mapsUrl = process.env.NEXT_PUBLIC_GOOGLE_MAPS_URL;
  const fbUrl = process.env.NEXT_PUBLIC_FACEBOOK_URL;
  const igUrl = process.env.NEXT_PUBLIC_INSTAGRAM_URL;

  const waHref = waPhone ? `https://wa.me/${waPhone}` : null;
  const tgHref = tgUsername ? `https://t.me/${tgUsername}` : null;
  const telHref = phone ? `tel:${phone.replace(/\s/g, "")}` : null;

  const hasContact = !!(phone || waHref || tgHref || email);
  const hasAddress = !!(address || hours || mapsUrl);
  const hasSocial = !!(fbUrl || igUrl);

  return (
    <footer className="mt-auto" style={{ backgroundColor: "#1b2b5e" }}>
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">

          {/* Column A — Contact */}
          {hasContact && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-white/90">დაგვიკავშირდით</h3>
              <div className="space-y-2 text-sm text-white/55">
                {telHref && (
                  <p>
                    <a href={telHref} className="hover:text-[#29abe2] transition-colors">
                      {phone}
                    </a>
                  </p>
                )}
                {waHref && (
                  <p>
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[#29abe2] transition-colors"
                    >
                      WhatsApp
                    </a>
                  </p>
                )}
                {tgHref && (
                  <p>
                    <a
                      href={tgHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[#29abe2] transition-colors"
                    >
                      Telegram
                    </a>
                  </p>
                )}
                {email && (
                  <p>
                    <a
                      href={`mailto:${email}`}
                      className="hover:text-[#29abe2] transition-colors"
                    >
                      {email}
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Column B — Address & hours */}
          {hasAddress && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-white/90">მისამართი</h3>
              <div className="space-y-2 text-sm text-white/55">
                {address && <p>{address}</p>}
                {hours && <p>{hours}</p>}
                {mapsUrl && (
                  <p>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-[#29abe2] transition-colors"
                    >
                      Google Maps-ზე ნახვა →
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Column C — Quick links */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-white/90">სწრაფი ბმულები</h3>
            <div className="space-y-2 text-sm text-white/55">
              <p>
                <Link href="/catalog" className="hover:text-[#29abe2] transition-colors">
                  კატალოგი
                </Link>
              </p>
              <p>
                <Link href="/about" className="hover:text-[#29abe2] transition-colors">
                  ჩვენ შესახებ
                </Link>
              </p>
              <p>
                <Link href="/delivery" className="hover:text-[#29abe2] transition-colors">
                  მიწოდება და გადახდა
                </Link>
              </p>
              {hasSocial && (
                <>
                  {fbUrl && (
                    <p>
                      <a
                        href={fbUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#29abe2] transition-colors"
                      >
                        Facebook
                      </a>
                    </p>
                  )}
                  {igUrl && (
                    <p>
                      <a
                        href={igUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#29abe2] transition-colors"
                      >
                        Instagram
                      </a>
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

        </div>

        {/* Bottom strip */}
        <div className="mt-8 pt-6 border-t border-white/10 text-xs text-white/30 text-center">
          © {new Date().getFullYear()} WishMotors. ყველა უფლება დაცულია.
        </div>
      </div>
    </footer>
  );
}

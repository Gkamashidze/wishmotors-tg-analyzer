import Link from "next/link";
import type { ReactNode } from "react";

// ── Inline SVG brand icons (no extra packages) ─────────────────────

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.89a8.18 8.18 0 0 0 4.84 1.54V7a4.85 4.85 0 0 1-1.07-.31z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

// ── Social pill button ────────────────────────────────────────────

type SocialPillProps = {
  href: string;
  label: string;
  sublabel?: string;
  icon: ReactNode;
};

function SocialPill({ href, label, sublabel, icon }: SocialPillProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="group inline-flex items-center gap-3 rounded-2xl border border-white/[0.10] bg-white/[0.04] px-5 py-3 transition-all duration-200 hover:border-[#29abe2]/40 hover:bg-[#29abe2]/[0.07] hover:shadow-[0_0_16px_rgba(41,171,226,0.12)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] group-hover:bg-white/[0.10] transition-colors duration-200">
        {icon}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-medium text-white group-hover:text-white transition-colors duration-200">
          {label}
        </span>
        {sublabel && (
          <span className="text-[11px] text-white/60 group-hover:text-white/80 transition-colors duration-200">
            {sublabel}
          </span>
        )}
      </span>
    </a>
  );
}

// ── Main footer component ─────────────────────────────────────────

export default function Footer() {
  const phone      = process.env.NEXT_PUBLIC_CONTACT_PHONE;
  const waPhone    = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
  const tgUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const email      = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const address    = process.env.NEXT_PUBLIC_BUSINESS_ADDRESS;
  const hours      = process.env.NEXT_PUBLIC_BUSINESS_HOURS;
  const mapsUrl    = process.env.NEXT_PUBLIC_GOOGLE_MAPS_URL;

  // Social
  const fbUrl      = process.env.NEXT_PUBLIC_FACEBOOK_URL;
  const fbGroupUrl = process.env.NEXT_PUBLIC_FACEBOOK_GROUP_URL;
  const tiktokUrl  = process.env.NEXT_PUBLIC_TIKTOK_URL;
  const igUrl      = process.env.NEXT_PUBLIC_INSTAGRAM_URL;

  const waHref  = waPhone    ? `https://wa.me/${waPhone}` : null;
  const tgHref  = tgUsername ? `https://t.me/${tgUsername}` : null;
  const telHref = phone      ? `tel:${phone.replace(/\s/g, "")}` : null;

  const hasContact = !!(phone || waHref || tgHref || email);
  const hasAddress = !!(address || hours || mapsUrl);

  const socialLinks: SocialPillProps[] = [
    ...(fbUrl ? [{
      href: fbUrl,
      label: "Facebook",
      sublabel: "გვერდი",
      icon: <FacebookIcon className="h-4 w-4 text-[#1877F2]" />,
    }] : []),
    ...(fbGroupUrl ? [{
      href: fbGroupUrl,
      label: "Facebook",
      sublabel: "ჯგუფი",
      icon: <FacebookIcon className="h-4 w-4 text-[#1877F2]" />,
    }] : []),
    ...(tiktokUrl ? [{
      href: tiktokUrl,
      label: "TikTok",
      sublabel: "კანალი",
      icon: <TikTokIcon className="h-4 w-4 text-white/90" />,
    }] : []),
    ...(igUrl ? [{
      href: igUrl,
      label: "Instagram",
      sublabel: "გვერდი",
      icon: <InstagramIcon className="h-4 w-4 text-[#E1306C]" />,
    }] : []),
  ];

  const hasSocial = socialLinks.length > 0;

  return (
    <footer className="mt-auto" style={{ backgroundColor: "#1b2b5e" }}>
      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* ── Main 3-column info grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">

          {hasContact && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-white/90">დაგვიკავშირდით</h3>
              <div className="space-y-2 text-sm text-white/75">
                {telHref && (
                  <p>
                    <a href={telHref} className="hover:text-[#29abe2] transition-colors">
                      {phone}
                    </a>
                  </p>
                )}
                {waHref && (
                  <p>
                    <a href={waHref} target="_blank" rel="noopener noreferrer" className="hover:text-[#29abe2] transition-colors">
                      WhatsApp
                    </a>
                  </p>
                )}
                {tgHref && (
                  <p>
                    <a href={tgHref} target="_blank" rel="noopener noreferrer" className="hover:text-[#29abe2] transition-colors">
                      Telegram
                    </a>
                  </p>
                )}
                {email && (
                  <p>
                    <a href={`mailto:${email}`} className="hover:text-[#29abe2] transition-colors">
                      {email}
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          {hasAddress && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-white/90">მისამართი</h3>
              <div className="space-y-2 text-sm text-white/75">
                {address && <p>{address}</p>}
                {hours   && <p>{hours}</p>}
                {mapsUrl && (
                  <p>
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[#29abe2] transition-colors">
                      Google Maps-ზე ნახვა →
                    </a>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-white/90">სწრაფი ბმულები</h3>
            <div className="space-y-2 text-sm text-white/75">
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
            </div>
          </div>
        </div>

        {/* ── Social media section ── */}
        {hasSocial && (
          <div className="mt-10">
            {/* Glowing gradient divider */}
            <div
              className="h-px w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(41,171,226,0.30) 40%, rgba(41,171,226,0.30) 60%, transparent 100%)",
              }}
            />

            <div className="mt-8 flex flex-col items-center gap-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/50">
                გამოგვყევი სოც. ქსელებში
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {socialLinks.map((link) => (
                  <SocialPill key={`${link.href}-${link.sublabel}`} {...link} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Copyright strip ── */}
        <div className="mt-8 pt-6 border-t border-white/[0.07] text-xs text-white/50 text-center">
          © {new Date().getFullYear()} WishMotors. ყველა უფლება დაცულია.
        </div>
      </div>
    </footer>
  );
}

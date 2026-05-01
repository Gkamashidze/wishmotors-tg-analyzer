import type { Metadata } from "next";
import Footer from "./_components/Footer";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export const metadata: Metadata = {
  title: "WishMotors — SsangYong სათადარიგო ნაწილები",
  description:
    "ორიგინალი და ანალოგი ნაწილები SsangYong-ისთვის. დააკავშირდით პირდაპირ Telegram-ში ან WhatsApp-ზე.",
  alternates: { canonical: `${baseUrl}/catalog` },
};

export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fixed overlay covers the admin sidebar — catalog is a standalone public surface.
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto font-sans">
      {children}
      <Footer />
    </div>
  );
}

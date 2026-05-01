import type { Metadata, Viewport } from "next";
import Footer from "./_components/Footer";
import { InstallPrompt } from "./_components/InstallPrompt";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export const metadata: Metadata = {
  title: "WishMotors — SsangYong სათადარიგო ნაწილები",
  description:
    "ორიგინალი და ანალოგი ნაწილები SsangYong-ისთვის. დააკავშირდით პირდაპირ Telegram-ში ან WhatsApp-ზე.",
  alternates: { canonical: `${baseUrl}/catalog` },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WishMotors",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
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
      <InstallPrompt />
    </div>
  );
}

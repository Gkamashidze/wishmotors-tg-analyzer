import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WishMotors — SsangYong სათადარიგო ნაწილები",
  description:
    "ორიგინალი და ანალოგი ნაწილები SsangYong-ისთვის. დააკავშირდით პირდაპირ Telegram-ში ან WhatsApp-ზე.",
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
    </div>
  );
}

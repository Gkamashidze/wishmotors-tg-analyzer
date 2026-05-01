import type { Metadata } from "next";
import Footer from "../catalog/_components/Footer";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export const metadata: Metadata = {
  title: "ჩვენ შესახებ — WishMotors",
  description:
    "WishMotors — ხარისხიანი SsangYong სათადარიგო ნაწილები. გაიგეთ ჩვენს კომპანიაზე, ჩვენს ღირებულებებზე და დაგვიკავშირდით.",
  alternates: { canonical: `${baseUrl}/about` },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto font-sans">
      {children}
      <Footer />
    </div>
  );
}

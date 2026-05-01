import type { Metadata } from "next";
import Footer from "../catalog/_components/Footer";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export const metadata: Metadata = {
  title: "მიწოდება და გადახდა — WishMotors",
  description:
    "მიწოდების პირობები, გადახდის მეთოდები, მისამართი და სამუშაო საათები — wishmotors.ge",
  alternates: { canonical: `${baseUrl}/delivery` },
};

export default function DeliveryLayout({
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

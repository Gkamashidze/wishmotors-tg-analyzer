import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/catalog", "/catalog/*"],
      disallow: [
        "/api/",
        "/orders",
        "/sales",
        "/expenses",
        "/accounting",
        "/vat",
        "/debtors",
        "/imports",
        "/inventory",
        "/products",
        "/personal-orders",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

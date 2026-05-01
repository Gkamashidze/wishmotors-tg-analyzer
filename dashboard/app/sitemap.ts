import type { MetadataRoute } from "next";
import { query } from "@/lib/db";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await query<{ slug: string; created_at: Date }>(
    "SELECT slug, created_at FROM products WHERE is_published = TRUE AND slug IS NOT NULL",
  );

  const productEntries: MetadataRoute.Sitemap = rows.map((row) => ({
    url: `${baseUrl}/catalog/${row.slug}`,
    lastModified: row.created_at,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [
    {
      url: `${baseUrl}/catalog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...productEntries,
  ];
}

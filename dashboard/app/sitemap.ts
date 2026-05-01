import type { MetadataRoute } from "next";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

const baseUrl = process.env.NEXT_PUBLIC_CATALOG_BASE_URL ?? "";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productRows, modelRows] = await Promise.all([
    query<{ slug: string; created_at: Date }>(
      "SELECT slug, created_at FROM products WHERE is_published = TRUE AND slug IS NOT NULL",
    ),
    query<{ model: string }>(
      `SELECT DISTINCT pc.model FROM product_compatibility pc
       INNER JOIN products p ON p.id = pc.product_id
       WHERE p.is_published = TRUE AND pc.model IS NOT NULL AND TRIM(pc.model) <> ''`,
    ).catch(() => [] as { model: string }[]),
  ]);

  const productEntries: MetadataRoute.Sitemap = productRows.map((row) => ({
    url: `${baseUrl}/catalog/${row.slug}`,
    lastModified: row.created_at,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const modelEntries: MetadataRoute.Sitemap = modelRows.map((row) => ({
    url: `${baseUrl}/catalog/model/${encodeURIComponent(row.model)}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.75,
  }));

  return [
    {
      url: `${baseUrl}/catalog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/delivery`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...modelEntries,
    ...productEntries,
  ];
}

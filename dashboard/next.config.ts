import type { NextConfig } from "next";

// Server Action allow-list.
// Railway exposes the public domain via RAILWAY_PUBLIC_DOMAIN. We also accept
// comma-separated DASHBOARD_ALLOWED_ORIGINS for custom domains.
const allowedOrigins: string[] = [
  "localhost:3000",
  process.env.RAILWAY_PUBLIC_DOMAIN,
  ...(process.env.DASHBOARD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
].filter((origin): origin is string => Boolean(origin));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  experimental: {
    serverActions: { allowedOrigins },
  },
};

export default nextConfig;

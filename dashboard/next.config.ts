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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "drive.google.com" },
    ],
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://lh3.googleusercontent.com https://drive.google.com",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        source: "/catalog/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "index, follow" },
          { key: "X-WM-Build", value: "v5" },
        ],
      },
    ];
  },
};

export default nextConfig;

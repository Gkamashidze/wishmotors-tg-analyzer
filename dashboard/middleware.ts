import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

// Middleware only runs on paths that need auth protection.
// Public paths (catalog, about, delivery, etc.) AND all static assets are
// EXCLUDED from the matcher so this function is never called for them.
export const config = {
  matcher: [
    "/((?!catalog|about|delivery|track|manifest\\.webmanifest|sitemap\\.xml|robots\\.txt|icons|api/public|_next/static|_next/image|favicon\\.ico|healthz|.*\\.(?:jpg|jpeg|png|webp|svg|gif|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function applySecurityHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export function middleware(req: NextRequest) {
  const expected = process.env.DASHBOARD_BASIC_AUTH;
  const isProd = process.env.NODE_ENV === "production";

  // Production without a password configured is a misconfiguration.
  if (isProd && !expected) {
    return new NextResponse(
      "Dashboard is misconfigured: DASHBOARD_BASIC_AUTH is not set.",
      { status: 503 },
    );
  }

  if (!expected) return applySecurityHeaders(NextResponse.next());

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      let decoded = "";
      try {
        decoded = Buffer.from(encoded, "base64").toString("utf8");
      } catch {
        decoded = "";
      }
      if (decoded && timingSafeEqual(decoded, expected)) {
        return applySecurityHeaders(NextResponse.next());
      }
    }
  }

  return applySecurityHeaders(
    new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="wishmotors-dashboard"' },
    }),
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.from(a.padEnd(maxLen, "\0"), "utf8");
  const bufB = Buffer.from(b.padEnd(maxLen, "\0"), "utf8");
  return cryptoTimingSafeEqual(bufA, bufB);
}

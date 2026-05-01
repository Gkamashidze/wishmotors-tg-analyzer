import { NextResponse, type NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|healthz).*)"],
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
  // Public routes — no auth required
  const path = req.nextUrl.pathname;
  if (
    path.startsWith("/track/") ||
    path.startsWith("/api/public/") ||
    path === "/catalog" ||
    path.startsWith("/catalog/") ||
    path === "/about" ||
    path === "/sitemap.xml" ||
    path === "/robots.txt"
  ) {
    return applySecurityHeaders(NextResponse.next());
  }

  const expected = process.env.DASHBOARD_BASIC_AUTH;
  const isProd = process.env.NODE_ENV === "production";

  // Production without a password is unsafe — refuse to serve.
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
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

import { NextResponse, type NextRequest } from "next/server";

// Middleware only runs on paths that need auth protection.
// Public paths (catalog, about, delivery, etc.) AND all static assets are
// EXCLUDED from the matcher so this function is never called for them.
export const config = {
  matcher: [
    "/((?!catalog|about|delivery|track|manifest\\.webmanifest|sitemap\\.xml|robots\\.txt|icons|api/public|_next/static|_next/image|favicon\\.ico|healthz|.*\\.(?:jpg|jpeg|png|webp|svg|gif|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
  ],
};

const ADMIN_HOST = process.env.ADMIN_HOST || "admin.wishmotors.ge";

function isPublicDomain(hostname: string): boolean {
  if (!ADMIN_HOST) return false;
  const bare = hostname.split(":")[0];
  return bare !== ADMIN_HOST.split(":")[0] && bare !== "localhost";
}

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
  const hostname =
    req.headers.get("x-forwarded-host")?.split(":")[0] ??
    req.nextUrl.hostname;

  if (isPublicDomain(hostname)) {
    if (req.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/catalog", req.url), { status: 308 });
    }
    return applySecurityHeaders(new NextResponse(null, { status: 404 }));
  }

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

  const res401 = new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="wishmotors-dashboard"' },
  });
  res401.headers.set("X-Debug-Hostname", hostname);
  res401.headers.set("X-Debug-AdminHost", ADMIN_HOST || "EMPTY");
  return applySecurityHeaders(res401);
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const maxLen = Math.max(a.length, b.length);
  const bufA = encoder.encode(a.padEnd(maxLen, "\0"));
  const bufB = encoder.encode(b.padEnd(maxLen, "\0"));
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

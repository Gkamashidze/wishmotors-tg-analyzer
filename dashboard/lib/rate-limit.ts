/**
 * Simple in-process rate limiter — fixed window, per IP.
 * Suitable for single-instance dashboards; not distributed.
 */

interface Window {
  count: number;
  windowStart: number;
}

const _store = new Map<string, Window>();

/**
 * Check if the key is within the allowed rate.
 *
 * @returns null when the request is allowed, or a { status, retryAfter } object to send a 429.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: false; retryAfterSeconds: number } | { allowed: true } {
  const now = Date.now();
  const entry = _store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    _store.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  entry.count += 1;
  return { allowed: true };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

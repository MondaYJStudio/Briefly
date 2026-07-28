export const AUTH_RATE_LIMITS = {
  initialization: { attempts: 5, windowSeconds: 15 * 60 },
  signIn: { attempts: 10, windowSeconds: 15 * 60 },
} as const;

export type AuthenticationRateLimit = keyof typeof AUTH_RATE_LIMITS;

export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

async function clientFingerprint(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function checkAuthenticationRateLimit(
  database: D1Database,
  request: Request,
  operation: AuthenticationRateLimit,
): Promise<RateLimitResult> {
  const policy = AUTH_RATE_LIMITS[operation];
  const now = Date.now();
  const windowMilliseconds = policy.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMilliseconds) * windowMilliseconds;
  const resetAt = windowStart + windowMilliseconds;
  const fingerprint = await clientFingerprint(request);
  const key = `${operation}:${fingerprint}:${windowStart}`;

  await database
    .prepare("DELETE FROM auth_rate_limit WHERE reset_at <= ?")
    .bind(now)
    .run();
  const row = await database
    .prepare(
      `INSERT INTO auth_rate_limit (key, attempts, reset_at)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1
       RETURNING attempts`,
    )
    .bind(key, resetAt)
    .first<{ attempts: number }>();

  if (row && row.attempts <= policy.attempts) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

import crypto from 'node:crypto';

/**
 * Browser sessions: the session token lives in an HttpOnly cookie that page scripts cannot
 * read, and every state-changing request must echo the CSRF cookie in `X-CSRF-Token`
 * (double submit). API clients keep using `Authorization: Bearer`, which needs no CSRF.
 */
export const SESSION_COOKIE = 'on_session';
export const CSRF_COOKIE = 'on_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const needsCsrf = (method: string) => !SAFE_METHODS.has(method.toUpperCase());

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const cookie = (name: string, value: string, attrs: string[]) =>
  [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', ...attrs].join('; ');

/** Set-Cookie values for a new session: the HttpOnly token and the readable CSRF token. */
export function sessionCookies(token: string, secure: boolean): string[] {
  const maxAge = `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
  const extra = secure ? ['Secure'] : [];
  return [
    cookie(SESSION_COOKIE, token, ['HttpOnly', maxAge, ...extra]),
    cookie(CSRF_COOKIE, crypto.randomBytes(24).toString('base64url'), [maxAge, ...extra]),
  ];
}

export function clearedCookies(secure: boolean): string[] {
  const extra = secure ? ['Secure'] : [];
  return [
    cookie(SESSION_COOKIE, '', ['HttpOnly', 'Max-Age=0', ...extra]),
    cookie(CSRF_COOKIE, '', ['Max-Age=0', ...extra]),
  ];
}

/** The header must carry exactly the value of the CSRF cookie. */
export function csrfMatches(cookieValue: string | undefined, headerValue: string | undefined) {
  if (!cookieValue || !headerValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(headerValue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

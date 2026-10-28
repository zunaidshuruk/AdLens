import type { NextFunction, Request, Response } from 'express';

/**
 * Browser security headers (security audit, 27 Oct 2026).
 * - nosniff, no framing (clickjacking), strict referrer, no camera/microphone/location, HTTPS-only for a year (production).
 * - The Content-Security-Policy is sent in REPORT-ONLY mode first: the browser console lists anything it would have blocked,
 *   so it can be tightened and switched to enforcing after a look at a real signed-in session (sign-in pop-up, charts, fonts).
 * On Vercel the page itself is served by Vercel, so the same headers are also in vercel.json.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export const HSTS = 'max-age=15552000';

export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.googleusercontent.com https://*.fbcdn.net",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', HSTS);
  res.setHeader('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY);
  next();
}

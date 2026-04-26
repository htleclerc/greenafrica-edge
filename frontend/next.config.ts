import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import withSerwistInit from '@serwist/next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const withSerwist = withSerwistInit({
    swSrc: 'src/app/sw.ts',
    swDest: 'public/sw.js',
    disable: process.env.NODE_ENV === 'development',
});

// Allow the configured Supabase origin (+ its ws variant) in connect-src so
// local Supabase (http://127.0.0.1:54321) works in dev without weakening the
// prod CSP. In prod NEXT_PUBLIC_SUPABASE_URL is https://<project>.supabase.co
// which is already covered by the https://*.supabase.co wildcard.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseWs = supabaseUrl
  .replace(/^https:\/\//, 'wss://')
  .replace(/^http:\/\//, 'ws://');
const localSupabaseAllow = supabaseUrl && !supabaseUrl.includes('.supabase.co')
  ? ` ${supabaseUrl} ${supabaseWs}`
  : '';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co${localSupabaseAllow}`,
      "font-src 'self' data:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co${localSupabaseAllow}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withSerwist(withNextIntl(nextConfig));

import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs/config"

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://clerk.pixelarch.dev https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com https://clerk.pixelarch.dev https://cdn.sanity.io",
  "font-src 'self'",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk.pixelarch.dev https://*.sanity.io https://api.resend.com https://*.sentry.io",
  "worker-src 'self' blob:",
  "frame-src 'self' https://*.clerk.accounts.dev https://clerk.pixelarch.dev https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ")
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.sanity.io",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/servicios",
        destination: "/productos",
        permanent: true,
      },
      {
        source: "/servicios/:slug",
        destination: "/productos/:slug",
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      // T-19: el token de baja viaja en la URL y el header HTTP de
      // `Referrer-Policy` tiene precedencia sobre `<meta name="referrer">`.
      // El header global de arriba es `strict-origin-when-cross-origin`, que en
      // navegaciones cross-origin enviaria el origen; aca se fuerza
      // `no-referrer`. Next aplica las entradas de `headers()` en orden y la
      // ultima que matchea pisa el mismo header (`resHeaders[key] = value` en
      // resolve-routes), por eso estas entradas van despues de `/(.*)`.
      // `X-Robots-Tag`/`Cache-Control` se repiten como defensa en profundidad
      // aunque el middleware tambien los aplica.
      {
        source: "/propuestas/baja/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/api/opt-out",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "pixelarch",
  project: process.env.SENTRY_PROJECT ?? "pixelarch",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,

  // 100% en desarrollo, 10% en produccion
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Adjunta valores de variables locales a los stack frames
  includeLocalVariables: true,
})

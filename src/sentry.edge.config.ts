import * as Sentry from "@sentry/nextjs"
import { redactSentryEvent } from "./lib/paypal/redact"

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,

  // 100% en desarrollo, 10% en produccion
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // No adjuntar variables locales a los stack frames: pueden contener PII
  // (email/nombre del pagador) o credenciales de PayPal.
  includeLocalVariables: false,

  // Misma redaccion que el runtime server (extras, request, message,
  // transaction, sdkProcessingMetadata, etc.).
  beforeSend(event) {
    return redactSentryEvent(event)
  },
})

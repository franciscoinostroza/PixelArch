import * as Sentry from "@sentry/nextjs"
import { redactSentryEventPropuestas } from "./lib/propuestas/redact"

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
  // transaction, sdkProcessingMetadata, etc.), incluidos los tokens de baja y
  // opt-out del portal de propuestas.
  beforeSend(event) {
    return redactSentryEventPropuestas(event)
  },
})

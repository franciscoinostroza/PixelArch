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

  // Redacta claves sensibles en extras, contextos, breadcrumbs, request data,
  // user/tags/exception, message, transaction y sdkProcessingMetadata sin
  // descartar informacion util no sensible (ids, montos, estado, etc.).
  // Compone PayPal + portal de propuestas: tambien oculta el token de
  // `/propuestas/baja/<token>` y el `token` de `/api/opt-out`.
  beforeSend(event) {
    return redactSentryEventPropuestas(event)
  },
})

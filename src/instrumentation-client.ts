import * as Sentry from "@sentry/nextjs"
import { redactSentryEventPropuestas } from "./lib/propuestas/redact"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,

  // 100% en desarrollo, 10% en produccion
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay: 10% de las sesiones, 100% de las que tienen errores (texto enmascarado por defecto)
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [Sentry.replayIntegration()],

  // El cliente tambien redacta: el portal y la baja publica pueden generar
  // errores con email, cuerpo o token de baja en la URL. Compone el redactor
  // de PayPal con el del portal de propuestas.
  beforeSend(event) {
    return redactSentryEventPropuestas(event)
  },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

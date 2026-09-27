"use client"

import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="es">
      <body style={{ background: "#07060c", color: "#e8e6f0", fontFamily: "system-ui, sans-serif" }}>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}

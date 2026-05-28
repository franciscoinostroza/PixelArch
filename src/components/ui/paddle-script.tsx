"use client"

import Script from "next/script"
import { useCallback, useRef } from "react"

export function PaddleScript() {
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  if (!clientToken) return null

  const initRef = useRef(false)

  const initPaddle = useCallback(() => {
    if (initRef.current) return
    const Paddle = (window as any).Paddle
    if (!Paddle) return
    initRef.current = true
    if (process.env.NODE_ENV !== "production") {
      Paddle.Environment.set("sandbox")
    }
    Paddle.Initialize({ token: clientToken })
  }, [clientToken])

  return (
    <Script
      src="https://cdn.paddle.com/paddle/v2/paddle.js"
      strategy="afterInteractive"
      onLoad={initPaddle}
    />
  )
}

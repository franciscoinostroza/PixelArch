"use client"

import { initializePaddle } from "@paddle/paddle-js"

const clientToken = typeof window !== "undefined"
  ? process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
  : ""

export const paddleReady: Promise<any> = clientToken
  ? initializePaddle({
      environment: process.env.NODE_ENV === "production" ? "production" : "sandbox",
      token: clientToken,
    })
  : Promise.resolve(null)

export function PaddleScript() {
  paddleReady.catch((err) => console.error("Paddle init error:", err))
  return null
}

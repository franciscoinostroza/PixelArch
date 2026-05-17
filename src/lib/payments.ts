import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk"

let _paddle: Paddle | null = null

function getPaddle() {
  if (!process.env.PADDLE_API_KEY) {
    throw new Error("PADDLE_API_KEY no configurada")
  }
  if (!_paddle) {
    _paddle = new Paddle(process.env.PADDLE_API_KEY, {
      environment: process.env.NODE_ENV === "production"
        ? Environment.production
        : Environment.sandbox,
      logLevel: LogLevel.verbose,
    })
  }
  return _paddle
}

export { getPaddle as paddle }

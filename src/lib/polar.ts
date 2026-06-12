import { Polar as PolarSDK } from "@polar-sh/sdk"

let _polar: PolarSDK | null = null

export function polar() {
  const accessToken = process.env.POLAR_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error("POLAR_ACCESS_TOKEN no configurada")
  }
  if (!_polar) {
    _polar = new PolarSDK({
      accessToken,
      server: process.env.NODE_ENV === "production" ? "production" : "sandbox",
    })
  }
  return _polar
}

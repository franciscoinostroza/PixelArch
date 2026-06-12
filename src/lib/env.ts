type Env = {
  DATABASE_URL: string
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string
  CLERK_SECRET_KEY: string
  POLAR_ACCESS_TOKEN: string
  POLAR_WEBHOOK_SECRET: string
  RESEND_API_KEY: string
  NEXT_PUBLIC_URL: string
}

export function validateEnv(): Env {
  const required = [
    "DATABASE_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "NEXT_PUBLIC_URL",
  ] as const

  const missing: string[] = []

  for (const key of required) {
    if (!process.env[key] || process.env[key] === "") {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno requeridas:\n  ${missing.join("\n  ")}\n\nRevisa .env.local o Railway.`
    )
  }

  return required.reduce((acc, key) => {
    acc[key as keyof Env] = process.env[key]!
    return acc
  }, {} as Env)
}

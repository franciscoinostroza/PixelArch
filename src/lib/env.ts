type Env = {
  DATABASE_URL: string
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string
  CLERK_SECRET_KEY: string
  PADDLE_API_KEY: string
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: string
  RESEND_API_KEY: string
  NEXT_PUBLIC_URL: string
}

export function validateEnv(): Env {
  const required = [
    "DATABASE_URL",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "PADDLE_API_KEY",
    "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
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

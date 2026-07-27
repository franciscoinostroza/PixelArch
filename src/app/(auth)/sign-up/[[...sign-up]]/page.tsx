import type { Metadata } from "next"
import { SignUp } from "@clerk/nextjs"

export const metadata: Metadata = {
  title: "Crear Cuenta — PixelArch",
  robots: { index: false },
  alternates: { canonical: "/sign-up" },
}

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text font-display">
            Registro no disponible
          </h1>
          <p className="mt-2 text-text-dim font-mono">
            Las claves de Clerk no estan configuradas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <SignUp />
    </div>
  )
}

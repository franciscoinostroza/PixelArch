import { SignIn } from "@clerk/nextjs"

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text font-display">
            Autenticacion no disponible
          </h1>
          <p className="mt-2 text-muted font-mono">
            Las claves de Clerk no estan configuradas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <SignIn />
    </div>
  )
}

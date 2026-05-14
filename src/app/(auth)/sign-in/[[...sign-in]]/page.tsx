import { SignIn } from "@clerk/nextjs"

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#7f5af0",
            colorBackground: "#0a0a0f",
            colorText: "#fffffe",
            colorInputBackground: "#111118",
            borderRadius: "8px",
          },
        }}
      />
    </div>
  )
}

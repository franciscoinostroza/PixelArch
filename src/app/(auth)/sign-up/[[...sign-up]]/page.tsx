import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <SignUp
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

import { UserProfile } from "@clerk/nextjs"

export default function CuentaPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <UserProfile routing="path" path="/portal/cuenta" />
    </div>
  )
}

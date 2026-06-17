import { UserProfile } from "@clerk/nextjs"

export default function CuentaPage() {
  return <UserProfile routing="path" path="/portal/cuenta" />
}

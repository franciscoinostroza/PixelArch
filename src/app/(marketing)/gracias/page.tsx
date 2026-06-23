import type { Metadata } from "next"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CheckCircle } from "lucide-react"

export const metadata: Metadata = {
  title: "Gracias por contactarnos — PixelArch",
  description: "Hemos recibido tu mensaje. Te responderemos en las próximas 24 horas.",
  robots: { index: false },
  alternates: { canonical: "/gracias" },
}

export default function GraciasPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-32 text-center">
      <CheckCircle className="h-16 w-16 text-accent2" />
      <h1 className="mt-6 text-3xl font-bold text-text font-display md:text-4xl">
        Gracias por contactarnos
      </h1>
      <p className="mt-4 text-muted font-mono">
        Hemos recibido tu mensaje. Te responderemos en las próximas 24 horas.
      </p>
      <Link href="/" className={cn(buttonVariants(), "mt-8")}>
        Volver al inicio
      </Link>
    </div>
  )
}

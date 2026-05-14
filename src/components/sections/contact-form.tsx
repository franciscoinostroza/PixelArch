"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { SectionLabel } from "@/components/ui/section-label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { contactSchema, type ContactFormValues } from "@/lib/validations"
import { useState } from "react"
import { CheckCircle, Loader2 } from "lucide-react"

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
  })

  async function onSubmit(data: ContactFormValues) {
    setStatus("loading")
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error()
      setStatus("success")
      reset()
    } catch {
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <section id="contacto" className="mx-auto max-w-xl px-6 py-24 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-accent2" />
        <h2 className="mt-4 text-2xl font-bold text-text font-display">
          Mensaje enviado
        </h2>
        <p className="mt-2 text-muted font-mono">
          Te responderemos en las próximas 24 horas.
        </p>
      </section>
    )
  }

  return (
    <section id="contacto" className="mx-auto max-w-xl px-6 py-24">
      <div className="text-center">
        <SectionLabel>Contacto</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
          Hablemos de tu proyecto
        </h2>
        <p className="mt-4 text-muted font-mono">
          Completá el formulario y te responderemos pronto.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-12 space-y-5">
        <div>
          <Input
            placeholder="Tu nombre"
            {...register("nombre")}
            className={errors.nombre ? "border-red-500/50" : ""}
          />
          {errors.nombre && (
            <p className="mt-1 text-xs text-red-400 font-mono">
              {errors.nombre.message}
            </p>
          )}
        </div>

        <div>
          <Input
            type="email"
            placeholder="tu@email.com"
            {...register("email")}
            className={errors.email ? "border-red-500/50" : ""}
          />
          {errors.email && (
            <p className="mt-1 text-xs text-red-400 font-mono">
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <Textarea
            placeholder="Contanos sobre tu proyecto..."
            rows={5}
            {...register("mensaje")}
            className={errors.mensaje ? "border-red-500/50" : ""}
          />
          {errors.mensaje && (
            <p className="mt-1 text-xs text-red-400 font-mono">
              {errors.mensaje.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={status === "loading"}>
          {status === "loading" && <Loader2 className="animate-spin" />}
          Enviar mensaje
        </Button>

        {status === "error" && (
          <p className="text-center text-sm text-red-400 font-mono">
            Error al enviar. Intentalo de nuevo.
          </p>
        )}
      </form>
    </section>
  )
}

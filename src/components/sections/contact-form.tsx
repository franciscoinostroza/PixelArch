"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { contactSchema, type ContactFormValues } from "@/lib/validations"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/toast"

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "loading">("idle")
  const { toast } = useToast()

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
      toast("success", "Mensaje enviado. Te responderemos pronto.")
      reset()
    } catch {
      toast("error", "Error al enviar. Intentalo de nuevo.")
    } finally {
      setStatus("idle")
    }
  }

  return (
    <section className="contacto" id="contacto">
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-110px", bottom: "0%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Contacto</p>
          <h2>Hablemos de tu proyecto</h2>
          <p>Completá el formulario y te respondemos a la brevedad.</p>
        </div>

        <div className="contact-grid">
          <div className="contact-info">
            <p>Contanos qué necesitás y en qué etapa está tu proyecto. Si ya tenés infraestructura corriendo, también podemos auditarla.</p>
            <div className="contact-item">
              <span>Email</span>
              <a href="mailto:hola@pixelarch.dev">hola@pixelarch.dev</a>
            </div>
            <div className="contact-item">
              <span>Presencia</span>
              <div className="presence-chip">
                <span>Chile</span><span>Argentina</span><span>México</span><span>Perú</span><span>Colombia</span><span>Brasil</span><span>España</span>
              </div>
            </div>
          </div>

          <form className="contact-form" onSubmit={handleSubmit(onSubmit)}>
            <div className="form-field">
              <label htmlFor="nombre">Tu nombre</label>
              <input id="nombre" type="text" placeholder="Nombre y apellido" {...register("nombre")} />
              {errors.nombre && <p className="form-error">{errors.nombre.message}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" placeholder="tu@email.com" {...register("email")} />
              {errors.email && <p className="form-error">{errors.email.message}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="mensaje">Proyecto</label>
              <textarea id="mensaje" placeholder="Contanos sobre tu proyecto..." {...register("mensaje")} />
              {errors.mensaje && <p className="form-error">{errors.mensaje.message}</p>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={status === "loading"}>
              {status === "loading" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>Enviar mensaje <span className="btn-arrow" aria-hidden="true">→</span></>
              )}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .contacto {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(12,10,21,0.88);
          backdrop-filter: blur(3px);
        }
        .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 64px }
        .contact-info p { color: var(--color-text-dim); margin-bottom: 28px; max-width: 44ch }
        .contact-item { margin-bottom: 22px }
        .contact-item span { display: block; font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-text-faint); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px }
        .contact-item a, .contact-item p.value { font-family: var(--font-display); font-size: 1rem; font-weight: 500 }
        .presence-chip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px }
        .presence-chip span { font-family: var(--font-mono); font-size: 0.74rem; color: var(--color-text-dim); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 5px 12px }

        .form-field { margin-bottom: 18px }
        .form-field label { display: block; font-family: var(--font-display); font-size: 0.8rem; color: var(--color-text-dim); margin-bottom: 8px; font-weight: 500 }
        .form-field input, .form-field textarea {
          width: 100%;
          background: var(--color-panel);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 14px 16px;
          color: var(--color-text);
          font-family: var(--font-body);
          font-size: 0.95rem;
          transition: border-color 0.25s;
          outline: none;
        }
        .form-field input:focus, .form-field textarea:focus { border-color: #8b5cf6 }
        .form-field textarea { resize: vertical; min-height: 120px }
        .form-error { color: #ef4444; font-size: 0.75rem; margin-top: 4px; font-family: var(--font-mono) }
        .contact-form .btn { width: 100%; margin-top: 6px }

        @media (max-width: 980px) { .contact-grid { grid-template-columns: 1fr; gap: 44px } }
      `}</style>
    </section>
  )
}

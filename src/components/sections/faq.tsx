"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { SectionLabel } from "@/components/ui/section-label"
import { ChevronDown } from "lucide-react"

const faqs = [
  {
    q: "¿Necesito saber programar para tener un sitio web?",
    a: "No, para eso estamos nosotros. Vos nos contás qué necesitas y nosotros lo desarrollamos. Después te damos un panel sencillo donde podés solicitar cambios o actualizaciones, sin tocar una línea de código.",
  },
  {
    q: "¿Cuánto tiempo toma desarrollar un proyecto?",
    a: "Depende del proyecto. Una landing page puede estar lista en 1-2 semanas. Un desarrollo web más complejo o un chatbot pueden llevar 3-4 semanas. Siempre te damos un timeline estimado antes de empezar.",
  },
  {
    q: "¿Qué pasa si no pago un mes?",
    a: "Tenés 7 días de gracia después del vencimiento. Si no regularizás el pago, el servicio se pausa temporalmente. A los 30 días sin pago, se cancela definitivamente. Siempre te avisamos por email antes de cada paso.",
  },
  {
    q: "¿Puedo cancelar mi suscripción cuando quiera?",
    a: "Sí, podés cancelar desde tu portal en cualquier momento. Si cancelás, el servicio sigue activo hasta el final del período facturado. No hay cargos por cancelación anticipada.",
  },
  {
    q: "¿El dominio y el hosting están incluidos?",
    a: "El hosting está incluido en los planes Básico y Mantenimiento. El dominio no, pero podemos ayudarte a comprarlo y configurarlo. Sin un plan mensual, el servicio no incluye hosting.",
  },
  {
    q: "¿Puedo actualizar el contenido yo mismo?",
    a: "Depende del plan. En el plan Básico, los cambios los gestionamos nosotros cuando los solicites. En el plan Mantenimiento, tenés un número de cambios incluidos por mes. Si querés un panel para editar vos mismo, lo podemos conversar.",
  },
  {
    q: "¿Qué métodos de pago aceptan?",
    a: "Aceptamos pagos con tarjeta de crédito y débito a través de Polar.sh, nuestro procesador de pagos. Los pagos son seguros y no almacenamos datos de tarjetas.",
  },
]

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="mx-auto max-w-3xl px-6 py-24">
      <div className="text-center">
        <SectionLabel>FAQ</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold text-text font-display md:text-5xl">
          Preguntas frecuentes
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted font-mono">
          Todo lo que necesitás saber antes de contratar.
        </p>
      </div>

      <div className="mt-12 space-y-3">
        {faqs.map((faq, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-bg2/50 overflow-hidden transition-colors hover:border-border/80"
          >
            <button
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
              className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-text font-mono transition-colors hover:bg-card-bg"
            >
              {faq.q}
              <ChevronDown
                size={16}
                className={`shrink-0 ml-4 transition-transform duration-200 ${
                  openIndex === i ? "rotate-180" : ""
                } text-muted`}
              />
            </button>
            <AnimatePresence>
              {openIndex === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border/30 px-5 py-4 text-sm text-muted font-mono leading-relaxed">
                    {faq.a}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  )
}

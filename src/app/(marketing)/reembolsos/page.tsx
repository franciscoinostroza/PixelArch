import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Reembolsos | PixelArch",
  description: "Política de reembolsos y cancelaciones de PixelArch",
  alternates: { canonical: "/reembolsos" },
}

export default function ReembolsosPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Reembolsos" }]} />
      <h1 className="text-3xl font-bold text-text font-display md:text-4xl">Política de Reembolsos</h1>
      <p className="mt-2 text-xs text-muted">Última actualización: Junio 2026</p>

      <div className="mt-10 space-y-6 text-sm text-text/80 leading-relaxed">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">1. Servicios de Pago Único</h2>
          <p>Para los servicios de pago único (desarrollo web, chatbots, agentes de IA, landing pages, automatizaciones e integraciones), ofrecemos un reembolso completo si el proyecto no ha sido iniciado y se solicita dentro de los 14 días posteriores a la compra.</p>
          <p className="mt-2">Una vez que el trabajo ha comenzado, no se realizan reembolsos. Si el proyecto no cumple con los requisitos acordados, trabajaremos con usted para resolver cualquier problema sin costo adicional.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">2. Planes Mensuales (Básico y Mantenimiento)</h2>
          <p>Las suscripciones mensuales pueden cancelarse en cualquier momento. Al cancelar:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li>El servicio continúa activo hasta el final del período facturado</li>
            <li>No se realizan reembolsos parciales por tiempo no utilizado</li>
            <li>No se realizan cargos adicionales después de la cancelación</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">3. Cómo Solicitar un Reembolso</h2>
          <p>Para solicitar un reembolso, contáctenos a través de nuestro formulario de contacto o enviando un correo a contacto@pixelarch.dev con el asunto "Solicitud de Reembolso" e incluyendo su número de transacción.</p>
          <p className="mt-2">Procesaremos su solicitud dentro de los 5 días hábiles posteriores a su recepción.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">4. Excepciones</h2>
          <p>No se realizan reembolsos en los siguientes casos:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li>Servicios ya entregados y aprobados por el cliente</li>
            <li>Suscripciones mensuales con más de 14 días desde el último pago</li>
            <li>Violación de los Términos del Servicio por parte del cliente</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">5. Pagos No Autorizados</h2>
          <p>Si detecta un cargo no autorizado, contáctenos inmediatamente. Investigaremos y, de ser procedente, emitiremos un reembolso completo dentro de los 10 días hábiles.</p>
        </section>
      </div>
    </div>
  )
}

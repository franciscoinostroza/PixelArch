import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Términos del Servicio | PixelArch",
  description: "Términos y condiciones del servicio de PixelArch",
}

export default function TerminosPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-bold text-text font-display md:text-4xl">Términos del Servicio</h1>
      <p className="mt-2 text-xs text-muted">Última actualización: Junio 2026</p>

      <div className="mt-10 space-y-6 text-sm text-text/80 leading-relaxed">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">1. Aceptación de los Términos</h2>
          <p>Al acceder y utilizar los servicios de PixelArch, usted acepta estar sujeto a estos Términos del Servicio. Si no está de acuerdo con alguna parte, no debe utilizar nuestros servicios.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">2. Descripción del Servicio</h2>
          <p>PixelArch ofrece servicios de desarrollo web, chatbots inteligentes, agentes de IA, landing pages, automatizaciones e integraciones. Los servicios se prestan de acuerdo con el plan contratado y las especificaciones acordadas al momento de la compra.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">3. Facturación y Pagos</h2>
          <p>Los precios se especifican en cada plan y pueden ser de pago único o recurrente mensual. Los pagos recurrentes se facturarán al inicio de cada período. El cliente es responsable de mantener actualizada su información de pago.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">4. Cancelaciones y Reembolsos</h2>
          <p>Las cancelaciones de suscripciones mensuales se procesan de inmediato y el servicio continúa hasta el final del período facturado. No se realizan reembolsos parciales por tiempo no utilizado, excepto cuando corresponda según nuestra Política de Reembolsos.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">5. Responsabilidades del Cliente</h2>
          <p>El cliente se compromete a proporcionar información precisa y actualizada, cumplir con todas las leyes aplicables, y no utilizar los servicios para actividades ilegales o no autorizadas.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">6. Propiedad Intelectual</h2>
          <p>El código y los activos desarrollados por PixelArch para proyectos de pago único se transfieren al cliente. PixelArch conserva el derecho de mostrar el trabajo en su portafolio, salvo acuerdo en contrario.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">7. Limitación de Responsabilidad</h2>
          <p>PixelArch no será responsable por daños indirectos, incidentales o consecuentes derivados del uso o la imposibilidad de usar los servicios. La responsabilidad total se limita al monto pagado por el servicio en los últimos 12 meses.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">8. Modificaciones</h2>
          <p>Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios serán notificados a través de nuestro sitio web. El uso continuado de los servicios después de las modificaciones constituye la aceptación de los nuevos términos.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">9. Contacto</h2>
          <p>Para consultas sobre estos términos, puede contactarnos a través de nuestro formulario de contacto o enviando un correo a contacto@pixelarch.dev.</p>
        </section>
      </div>
    </div>
  )
}

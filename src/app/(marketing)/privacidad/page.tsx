import { Breadcrumbs } from "@/components/ui/breadcrumbs"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de Privacidad | PixelArch",
  description: "Política de privacidad de PixelArch",
  alternates: { canonical: "/privacidad" },
}

export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <Breadcrumbs items={[{ name: "Inicio", href: "/" }, { name: "Política de Privacidad" }]} />
      <h1 className="text-3xl font-bold text-text font-display md:text-4xl">Política de Privacidad</h1>
      <p className="mt-2 text-xs text-text-dim">Última actualización: Junio 2026</p>

      <div className="mt-10 space-y-6 text-sm text-text/80 leading-relaxed">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">1. Información que Recopilamos</h2>
          <p>Recopilamos la información que nos proporciona directamente, como nombre, correo electrónico, empresa y teléfono al registrarse o contactarnos. También recopilamos información de pago a través de nuestro procesador Polar.sh, quien almacena de forma segura los datos de facturación.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">2. Uso de la Información</h2>
          <p>Utilizamos su información para proporcionar y mantener nuestros servicios, procesar pagos, enviar comunicaciones relacionadas con el servicio, y mejorar nuestra plataforma. No vendemos su información personal a terceros.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">3. Servicios de Terceros</h2>
          <p>Utilizamos los siguientes servicios de terceros que pueden procesar su información:</p>
          <ul className="mt-2 list-disc pl-6 space-y-1">
            <li><strong>Polar.sh</strong> — Procesamiento de pagos y suscripciones</li>
            <li><strong>Clerk</strong> — Autenticación y gestión de usuarios</li>
            <li><strong>Resend</strong> — Envío de correos electrónicos transaccionales</li>
            <li><strong>Sanity</strong> — CMS para contenido del sitio</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">4. Seguridad de los Datos</h2>
          <p>Implementamos medidas de seguridad técnicas y organizativas para proteger su información personal contra acceso no autorizado, alteración, divulgación o destrucción.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">5. Sus Derechos</h2>
          <p>Usted tiene derecho a acceder, corregir o eliminar su información personal. Puede ejercer estos derechos contactándonos a través de nuestro formulario de contacto o enviando un correo a contacto@pixelarch.dev.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">6. Retención de Datos</h2>
          <p>Conservamos su información personal mientras mantenga una cuenta activa o según sea necesario para proporcionarle nuestros servicios. Cuando cancele su cuenta, eliminaremos su información personal en un plazo de 30 días, excepto cuando debamos retenerla por obligaciones legales.</p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-text font-display">7. Cambios a esta Política</h2>
          <p>Podemos actualizar esta política de privacidad periódicamente. Los cambios serán publicados en esta página con la fecha de actualización correspondiente.</p>
        </section>
      </div>
    </div>
  )
}

import type { Metadata } from "next"
import { unstable_noStore as noStore } from "next/cache"
import { BajaConfirmar } from "@/components/propuestas/baja-confirmar"
import { configPropuestas } from "@/lib/propuestas/config"
import { verificarTokenBaja } from "@/lib/propuestas/supresion"

/**
 * T-19 (AC-33, AC-34, AC-35; RF-51, RF-52, RF-56): pagina publica de baja.
 *
 * - Server component sin guard admin: se puede abrir sin sesion.
 * - Verifica el token con `verificarTokenBaja` para no procesar un token
 *   manipulado, pero **no** cambia la UI segun el resultado: token valido,
 *   invalido o ya usado muestran exactamente la misma pagina generica.
 * - No consulta la base ni muestra email, nombre, prospecto o estado: la
 *   confirmacion real ocurre por POST en `/api/opt-out`.
 * - No muta nada por GET y no ofrece auto-POST: el boton es explicito.
 */

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Baja de propuestas — PixelArch",
  description: "Confirmá la baja de propuestas de PixelArch.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

export default async function BajaPropuestasPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  noStore()

  const { token } = await params

  // La verificacion server-side no altera la respuesta: si el token no es
  // valido, la pagina y el POST siguen siendo genericos (sin enumeracion).
  verificarTokenBaja(token, configPropuestas().secreto ?? "")

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16 sm:py-24">
      <section
        aria-labelledby="baja-titulo"
        className="rounded-2xl border border-border bg-panel p-6 sm:p-8"
      >
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          PixelArch
        </p>
        <h1
          id="baja-titulo"
          className="mt-3 font-display text-3xl font-semibold text-text"
        >
          Baja de propuestas
        </h1>
        <p className="mt-3 max-w-[65ch] text-sm leading-6 text-text-dim">
          Si recibiste una propuesta de servicios de PixelArch y no querés
          recibir más mensajes, podés confirmar la baja acá. No necesitás cuenta
          ni iniciar sesión.
        </p>

        <div
          role="note"
          className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6 text-text"
        >
          <p>
            La baja es <strong>inmediata y global</strong> para la dirección
            asociada a este enlace: bloquea futuros envíos de propuestas a esa
            dirección. No hay período de espera.
          </p>
        </div>

        <p className="mt-4 text-xs leading-5 text-text-dim">
          Si este enlace ya fue usado, confirmar de nuevo no duplica nada. Si no
          es válido, no se modifica ningún dato.
        </p>

        <div className="mt-6">
          <BajaConfirmar token={token} />
        </div>
      </section>

      <p className="mt-6 text-center text-xs leading-5 text-text-faint">
        PixelArch · Desarrollo full-stack e infraestructura
      </p>
    </main>
  )
}

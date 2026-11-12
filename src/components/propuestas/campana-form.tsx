"use client"

/**
 * T-12 (AC-7; RF-9, RF-12): formulario de alta de campaña.
 *
 * - La `idempotencyKey` se genera una sola vez por montaje; un doble submit o
 *   un reintento de red reutilizan la misma campaña en el servidor.
 * - Mientras se envia, el boton queda deshabilitado y un guard con ref evita
 *   disparar dos POST aunque el navegador alcance a procesar dos clicks.
 * - Los errores de campo se asocian con `aria-describedby`; el resultado y los
 *   errores generales viven en regiones `status`/`alert` accesibles.
 * - No muestra ni envia secretos, PII ni datos de proveedores.
 */

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  CAMPANA_LIMITE_DEFAULT,
  CAMPANA_LIMITE_MAX,
  CAMPANA_LIMITE_MIN,
  campanaFormSchema,
  type CampanaFormValues,
} from "@/lib/propuestas/validation"

export interface PlantillaOpcion {
  id: string
  nombre: string
  version: number
}

interface CampanaFormProps {
  plantillas: PlantillaOpcion[]
}

interface CampanaCreada {
  id: string
  estado: string
  reutilizada: boolean
}

interface RespuestaApi {
  id?: unknown
  estado?: unknown
  reutilizada?: unknown
  codigo?: unknown
  error?: unknown
}

const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_ERROR = "mt-1 font-mono text-xs text-red-400"
const CLASE_TEXTAREA =
  "flex min-h-[110px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_SELECT =
  "flex h-10 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"

const VALORES_INICIALES: CampanaFormValues = {
  nombre: "",
  consulta: "",
  zona: "",
  rubro: "",
  limiteCorrida: CAMPANA_LIMITE_DEFAULT,
  plantillaId: "",
}

/**
 * Guard sincronico por clave de idempotencia: un segundo submit antes de que
 * React re-renderice no dispara otro POST. La clave es unica por montaje y se
 * libera al terminar; el servidor igual deduplica reintentos de red.
 */
const enviosEnCurso = new Set<string>()

/**
 * UUID v4 para la clave de idempotencia. Usa `crypto.randomUUID()` cuando
 * existe y cae a `crypto.getRandomValues()`/Math.random en entornos viejos.
 * Nunca se renderiza en el DOM, por lo que no puede causar mismatch de
 * hidratacion.
 */
function crearIdempotencyKey(): string {
  const cripto = globalThis.crypto

  if (cripto && typeof cripto.randomUUID === "function") {
    try {
      return cripto.randomUUID()
    } catch {
      // Se usa el fallback de abajo.
    }
  }

  const bytes = new Uint8Array(16)
  if (cripto && typeof cripto.getRandomValues === "function") {
    cripto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function mensajeDeError(codigo: string | undefined): string {
  switch (codigo) {
    case "VALIDACION":
      return "Los datos no son válidos. Revisá los campos e intentá de nuevo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para crear campañas."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo crear la campaña. Intentá de nuevo."
  }
}

export function CampanaForm({ plantillas }: CampanaFormProps) {
  const [idempotencyKey] = useState(crearIdempotencyKey)
  const [resultado, setResultado] = useState<CampanaCreada | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CampanaFormValues>({
    resolver: zodResolver(campanaFormSchema),
    defaultValues: VALORES_INICIALES,
  })

  async function onSubmit(datos: CampanaFormValues) {
    if (enviosEnCurso.has(idempotencyKey)) return
    enviosEnCurso.add(idempotencyKey)
    setEnviando(true)
    setErrorGeneral(null)

    const payload = {
      ...datos,
      zona: datos.zona?.trim() ? datos.zona.trim() : undefined,
      rubro: datos.rubro?.trim() ? datos.rubro.trim() : undefined,
      plantillaId: datos.plantillaId?.trim()
        ? datos.plantillaId.trim()
        : undefined,
      idempotencyKey,
    }

    try {
      const res = await fetch("/api/propuestas/campanas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      let respuesta: RespuestaApi | null = null
      try {
        respuesta = (await res.json()) as RespuestaApi
      } catch {
        respuesta = null
      }

      if (!res.ok) {
        const codigo =
          typeof respuesta?.codigo === "string" ? respuesta.codigo : undefined
        setErrorGeneral(mensajeDeError(codigo))
        return
      }

      if (
        !respuesta ||
        typeof respuesta.id !== "string" ||
        typeof respuesta.estado !== "string"
      ) {
        setErrorGeneral("La respuesta del servidor no es válida.")
        return
      }

      setResultado({
        id: respuesta.id,
        estado: respuesta.estado,
        reutilizada: respuesta.reutilizada === true,
      })
    } catch {
      setErrorGeneral(
        "Error de red. Revisá la conexión e intentá de nuevo.",
      )
    } finally {
      enviosEnCurso.delete(idempotencyKey)
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <section
        role="status"
        aria-live="polite"
        aria-label="Resultado de la creación de campaña"
        className="max-w-[70ch] rounded-xl border border-border bg-panel p-6"
      >
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          {resultado.reutilizada ? "Campaña existente" : "Campaña creada"}
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-text">
          {resultado.reutilizada
            ? "No se creó un duplicado"
            : "La campaña quedó en borrador"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          {resultado.reutilizada
            ? "Ya existía una campaña con esta clave de idempotencia. Se reutiliza la existente y no se creó otra."
            : "Se guardó la configuración de la búsqueda. Todavía no se buscó en Google Places ni se envió ningún email."}
        </p>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-bg/40 p-3">
            <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
              ID
            </dt>
            <dd className="mt-1 break-all font-mono text-xs text-text">
              {resultado.id}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-bg/40 p-3">
            <dt className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint">
              Estado
            </dt>
            <dd className="mt-1 font-mono text-xs text-text">
              {resultado.estado}
            </dd>
          </div>
        </dl>

        {/* T-13 agregara el enlace directo a /propuestas/campanas/[id]. */}
        <Link
          href="/propuestas"
          className="mt-6 inline-flex rounded-lg border border-border px-4 py-2 text-sm text-text-dim transition-colors hover:bg-white/5 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
        >
          Volver al panel
        </Link>
      </section>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-busy={enviando}
      className="max-w-[70ch] rounded-xl border border-border bg-panel p-6"
    >
      {errorGeneral && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {errorGeneral}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label
            htmlFor="campana-nombre"
            className="block text-sm font-medium text-text"
          >
            Nombre de la campaña
          </label>
          <Input
            id="campana-nombre"
            className="mt-1"
            autoComplete="off"
            placeholder="Ej.: Estudio contable Palermo"
            aria-invalid={errors.nombre ? true : undefined}
            aria-describedby={
              errors.nombre ? "campana-nombre-error" : undefined
            }
            {...register("nombre")}
          />
          {errors.nombre && (
            <p id="campana-nombre-error" className={CLASE_ERROR}>
              {errors.nombre.message}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="campana-consulta"
            className="block text-sm font-medium text-text"
          >
            Consulta de búsqueda
          </label>
          <textarea
            id="campana-consulta"
            rows={4}
            className={`mt-1 ${CLASE_TEXTAREA}`}
            placeholder="Ej.: estudios contables en Palermo, CABA"
            aria-invalid={errors.consulta ? true : undefined}
            aria-describedby={
              errors.consulta
                ? "campana-consulta-error"
                : "campana-consulta-ayuda"
            }
            {...register("consulta")}
          />
          {errors.consulta ? (
            <p id="campana-consulta-error" className={CLASE_ERROR}>
              {errors.consulta.message}
            </p>
          ) : (
            <p id="campana-consulta-ayuda" className={CLASE_AYUDA}>
              Qué querés encontrar. La búsqueda real se ejecuta en otro paso,
              siempre desde este portal.
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campana-zona"
              className="block text-sm font-medium text-text"
            >
              Zona <span className="text-text-faint">(opcional)</span>
            </label>
            <Input
              id="campana-zona"
              className="mt-1"
              autoComplete="off"
              placeholder="Ej.: Palermo, CABA"
              aria-invalid={errors.zona ? true : undefined}
              aria-describedby={
                errors.zona ? "campana-zona-error" : undefined
              }
              {...register("zona")}
            />
            {errors.zona && (
              <p id="campana-zona-error" className={CLASE_ERROR}>
                {errors.zona.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="campana-rubro"
              className="block text-sm font-medium text-text"
            >
              Rubro <span className="text-text-faint">(opcional)</span>
            </label>
            <Input
              id="campana-rubro"
              className="mt-1"
              autoComplete="off"
              placeholder="Ej.: Contabilidad"
              aria-invalid={errors.rubro ? true : undefined}
              aria-describedby={
                errors.rubro ? "campana-rubro-error" : undefined
              }
              {...register("rubro")}
            />
            {errors.rubro && (
              <p id="campana-rubro-error" className={CLASE_ERROR}>
                {errors.rubro.message}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campana-limite"
              className="block text-sm font-medium text-text"
            >
              Límite por corrida
            </label>
            <Input
              id="campana-limite"
              type="number"
              inputMode="numeric"
              min={CAMPANA_LIMITE_MIN}
              max={CAMPANA_LIMITE_MAX}
              step={1}
              className="mt-1"
              aria-invalid={errors.limiteCorrida ? true : undefined}
              aria-describedby={
                errors.limiteCorrida
                  ? "campana-limite-error"
                  : "campana-limite-ayuda"
              }
              {...register("limiteCorrida", { valueAsNumber: true })}
            />
            {errors.limiteCorrida ? (
              <p id="campana-limite-error" className={CLASE_ERROR}>
                {errors.limiteCorrida.message}
              </p>
            ) : (
              <p id="campana-limite-ayuda" className={CLASE_AYUDA}>
                Entre {CAMPANA_LIMITE_MIN} y {CAMPANA_LIMITE_MAX} resultados.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="campana-plantilla"
              className="block text-sm font-medium text-text"
            >
              Plantilla <span className="text-text-faint">(opcional)</span>
            </label>
            <select
              id="campana-plantilla"
              className={`mt-1 ${CLASE_SELECT}`}
              aria-invalid={errors.plantillaId ? true : undefined}
              aria-describedby={
                errors.plantillaId ? "campana-plantilla-error" : undefined
              }
              {...register("plantillaId")}
            >
              <option value="">Sin plantilla por ahora</option>
              {plantillas.map((plantilla) => (
                <option key={plantilla.id} value={plantilla.id}>
                  {plantilla.nombre} (v{plantilla.version})
                </option>
              ))}
            </select>
            {errors.plantillaId && (
              <p id="campana-plantilla-error" className={CLASE_ERROR}>
                {errors.plantillaId.message}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <Button type="submit" disabled={enviando || isSubmitting}>
          {enviando && (
            <Loader2 aria-hidden="true" className="animate-spin" />
          )}
          {enviando ? "Creando campaña…" : "Crear campaña"}
        </Button>
        <Link
          href="/propuestas"
          className="text-sm text-text-dim underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
        >
          Cancelar
        </Link>
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 text-xs text-text-dim"
        >
          {enviando ? "Guardando la campaña, no se busca ni se envía nada." : ""}
        </p>
      </div>
    </form>
  )
}

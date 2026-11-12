"use client"

/**
 * T-16 (AC-22; RF-34, RF-37): alta y versionado de plantillas deterministas.
 *
 * - Alta: `POST /api/propuestas/plantillas` crea la versión 1.
 * - Edición: `PATCH /api/propuestas/plantillas/[id]` crea una versión nueva y
 *   desactiva la anterior; el nombre no cambia.
 * - `variablesPermitidas` solo declara el subconjunto usado: el servidor
 *   valida la lista blanca y guarda la lista canónica. La UI muestra las
 *   variables globales permitidas.
 * - Errores de campo con `aria-describedby`/`aria-invalid`; resultado en una
 *   región `status` y error general en `alert`.
 * - No envía emails, no llama a un LLM y no muestra datos de prospectos.
 */

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  VARIABLES_PLANTILLA,
  type VariablePlantilla,
} from "@/lib/propuestas/plantillas"
import {
  PLANTILLA_ASUNTO_MAX,
  PLANTILLA_CUERPO_MAX,
  PLANTILLA_IDIOMAS,
  PLANTILLA_NOMBRE_MAX,
  plantillaFormSchema,
  type PlantillaFormValues,
} from "@/lib/propuestas/validation"

export interface PlantillaEditable {
  id: string
  nombre: string
  idioma: string
  asunto: string
  cuerpo: string
  variablesPermitidas: string[]
  version: number
}

interface PlantillaFormProps {
  plantilla?: PlantillaEditable
}

interface Resultado {
  id: string
  version: number
  edicion: boolean
}

interface RespuestaApi {
  id?: unknown
  version?: unknown
  codigo?: unknown
}

const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_ERROR = "mt-1 font-mono text-xs text-red-400"
const CLASE_TEXTAREA =
  "flex min-h-[180px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_SELECT =
  "flex h-10 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"

function variablesIniciales(plantilla?: PlantillaEditable): string[] {
  if (!plantilla) return [...VARIABLES_PLANTILLA]

  const validas = new Set<string>(VARIABLES_PLANTILLA)
  const declaradas = plantilla.variablesPermitidas.filter((variable) =>
    validas.has(variable),
  )

  return declaradas.length > 0 ? declaradas : [...VARIABLES_PLANTILLA]
}

function mensajeDeError(codigo: string | undefined, edicion: boolean): string {
  switch (codigo) {
    case "VALIDACION":
      return "La plantilla no es válida. Revisá el asunto (máximo 120 caracteres), el cuerpo y las variables."
    case "ESTADO":
      return edicion
        ? "No se pudo crear la versión nueva: otra persona pudo haberla editado. Recargá la página e intentá de nuevo."
        : "Ya existe una plantilla con ese nombre. Probá otro nombre."
    case "NO_ENCONTRADO":
      return "La plantilla no existe o fue eliminada."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para editar plantillas."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo guardar la plantilla. Intentá de nuevo."
  }
}

export function PlantillaForm({ plantilla }: PlantillaFormProps) {
  const router = useRouter()
  const edicion = plantilla !== undefined
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlantillaFormValues>({
    resolver: zodResolver(plantillaFormSchema),
    defaultValues: {
      nombre: plantilla?.nombre ?? "",
      idioma:
        plantilla?.idioma === "en"
          ? "en"
          : ("es" as PlantillaFormValues["idioma"]),
      asunto: plantilla?.asunto ?? "",
      cuerpo: plantilla?.cuerpo ?? "",
      variablesPermitidas: variablesIniciales(plantilla),
    },
  })

  async function onSubmit(datos: PlantillaFormValues) {
    if (enviando) return

    setEnviando(true)
    setErrorGeneral(null)

    const payload = edicion
      ? {
          idioma: datos.idioma,
          asunto: datos.asunto,
          cuerpo: datos.cuerpo,
          variablesPermitidas: datos.variablesPermitidas,
        }
      : {
          nombre: datos.nombre,
          idioma: datos.idioma,
          asunto: datos.asunto,
          cuerpo: datos.cuerpo,
          variablesPermitidas: datos.variablesPermitidas,
        }

    try {
      const res = await fetch(
        edicion
          ? `/api/propuestas/plantillas/${encodeURIComponent(plantilla.id)}`
          : "/api/propuestas/plantillas",
        {
          method: edicion ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )

      let respuesta: RespuestaApi | null = null
      try {
        respuesta = (await res.json()) as RespuestaApi
      } catch {
        respuesta = null
      }

      if (!res.ok) {
        const codigo =
          typeof respuesta?.codigo === "string" ? respuesta.codigo : undefined
        setErrorGeneral(mensajeDeError(codigo, edicion))
        return
      }

      if (
        !respuesta ||
        typeof respuesta.id !== "string" ||
        typeof respuesta.version !== "number"
      ) {
        setErrorGeneral("La respuesta del servidor no es válida.")
        return
      }

      setResultado({
        id: respuesta.id,
        version: respuesta.version,
        edicion,
      })
      router?.refresh()
    } catch {
      setErrorGeneral("Error de red. Revisá la conexión e intentá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <section
        role="status"
        aria-live="polite"
        aria-label="Resultado del guardado de la plantilla"
        className="max-w-[70ch] rounded-xl border border-border bg-panel p-6"
      >
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          {resultado.edicion ? "Versión nueva" : "Plantilla creada"}
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-text">
          {resultado.edicion
            ? `Se creó la versión ${resultado.version}`
            : "La plantilla quedó activa"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-dim">
          {resultado.edicion
            ? "La versión anterior quedó desactivada. Los borradores y envíos ya creados conservan su snapshot y no cambian."
            : "La versión 1 quedó activa y disponible para generar borradores. No se envió ningún email."}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/propuestas/plantillas/${encodeURIComponent(resultado.id)}`}
            className="inline-flex rounded-lg bg-violet px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
          >
            Ver la versión
          </Link>
          <Link
            href="/propuestas/plantillas"
            className="inline-flex rounded-lg border border-border px-4 py-2 text-sm text-text-dim transition-colors hover:bg-white/5 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
          >
            Volver a plantillas
          </Link>
        </div>
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

      {edicion && (
        <div
          role="note"
          aria-label="Aviso de versionado"
          className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          Guardar crea la versión {plantilla.version + 1} y desactiva la
          versión {plantilla.version}. El historial y los borradores ya creados
          no se modifican.
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label
            htmlFor="plantilla-nombre"
            className="block text-sm font-medium text-text"
          >
            Nombre de la plantilla
          </label>
          {edicion ? (
            <>
              <p
                id="plantilla-nombre"
                className="mt-1 rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm text-text"
              >
                {plantilla.nombre}
              </p>
              <p className={CLASE_AYUDA}>
                El nombre no cambia al crear una versión nueva.
              </p>
            </>
          ) : (
            <>
              <Input
                id="plantilla-nombre"
                className="mt-1"
                autoComplete="off"
                maxLength={PLANTILLA_NOMBRE_MAX}
                placeholder="Ej.: Propuesta inicial — auditoría web"
                aria-invalid={errors.nombre ? true : undefined}
                aria-describedby={
                  errors.nombre ? "plantilla-nombre-error" : undefined
                }
                {...register("nombre")}
              />
              {errors.nombre && (
                <p id="plantilla-nombre-error" className={CLASE_ERROR}>
                  {errors.nombre.message}
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="plantilla-idioma"
              className="block text-sm font-medium text-text"
            >
              Idioma
            </label>
            <select
              id="plantilla-idioma"
              className={`mt-1 ${CLASE_SELECT}`}
              aria-invalid={errors.idioma ? true : undefined}
              aria-describedby={
                errors.idioma ? "plantilla-idioma-error" : "plantilla-idioma-ayuda"
              }
              {...register("idioma")}
            >
              <option value="es">Español</option>
              <option value="en">Inglés</option>
            </select>
            {errors.idioma ? (
              <p id="plantilla-idioma-error" className={CLASE_ERROR}>
                {errors.idioma.message}
              </p>
            ) : (
              <p id="plantilla-idioma-ayuda" className={CLASE_AYUDA}>
                Valores admitidos: {PLANTILLA_IDIOMAS.join(", ")}.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="plantilla-asunto"
              className="block text-sm font-medium text-text"
            >
              Asunto
            </label>
            <Input
              id="plantilla-asunto"
              className="mt-1"
              autoComplete="off"
              maxLength={PLANTILLA_ASUNTO_MAX}
              placeholder="Ej.: Una idea para {{nombreNegocio}}"
              aria-invalid={errors.asunto ? true : undefined}
              aria-describedby={
                errors.asunto
                  ? "plantilla-asunto-error"
                  : "plantilla-asunto-ayuda"
              }
              {...register("asunto")}
            />
            {errors.asunto ? (
              <p id="plantilla-asunto-error" className={CLASE_ERROR}>
                {errors.asunto.message}
              </p>
            ) : (
              <p id="plantilla-asunto-ayuda" className={CLASE_AYUDA}>
                Sin saltos de línea ni prefijos falsos como «Re:». Máximo 120
                caracteres después de limpiar.
              </p>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="plantilla-cuerpo"
            className="block text-sm font-medium text-text"
          >
            Cuerpo (texto plano)
          </label>
          <textarea
            id="plantilla-cuerpo"
            rows={10}
            className={`mt-1 ${CLASE_TEXTAREA}`}
            maxLength={PLANTILLA_CUERPO_MAX}
            placeholder={
              "Hola {{contactoNombre}},\n\nVi {{sitioWeb}} y quería comentarte algo concreto sobre {{hallazgoPrincipal}}."
            }
            aria-invalid={errors.cuerpo ? true : undefined}
            aria-describedby={
              errors.cuerpo
                ? "plantilla-cuerpo-error"
                : "plantilla-cuerpo-ayuda"
            }
            {...register("cuerpo")}
          />
          {errors.cuerpo ? (
            <p id="plantilla-cuerpo-error" className={CLASE_ERROR}>
              {errors.cuerpo.message}
            </p>
          ) : (
            <p id="plantilla-cuerpo-ayuda" className={CLASE_AYUDA}>
              Se guarda como texto: el HTML se genera escapado. Un doble salto
              crea un párrafo; un salto simple, una línea nueva.
            </p>
          )}
        </div>

        <fieldset
          aria-describedby="plantilla-variables-ayuda"
          className="rounded-lg border border-border bg-bg/40 p-4"
        >
          <legend className="px-1 text-sm font-medium text-text">
            Variables permitidas
          </legend>
          <p id="plantilla-variables-ayuda" className={CLASE_AYUDA}>
            Lista blanca global. Desmarcá las que no uses; el servidor guarda
            solo las variables realmente usadas y rechaza cualquier otra.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {VARIABLES_PLANTILLA.map((variable: VariablePlantilla) => (
              <label
                key={variable}
                className="flex items-center gap-2 text-sm text-text-dim"
              >
                <input
                  type="checkbox"
                  value={variable}
                  className="h-4 w-4 rounded border-border bg-panel"
                  {...register("variablesPermitidas")}
                />
                <code className="font-mono text-xs">{`{{${variable}}}`}</code>
              </label>
            ))}
          </div>
          {errors.variablesPermitidas && (
            <p role="alert" className={CLASE_ERROR}>
              {errors.variablesPermitidas.message ??
                "Revisá las variables permitidas."}
            </p>
          )}
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <Button type="submit" disabled={enviando || isSubmitting}>
          {enviando && <Loader2 aria-hidden="true" className="animate-spin" />}
          {enviando
            ? "Guardando…"
            : edicion
              ? "Crear versión nueva"
              : "Crear plantilla"}
        </Button>
        <Link
          href="/propuestas/plantillas"
          className="text-sm text-text-dim underline-offset-4 hover:text-text hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
        >
          Cancelar
        </Link>
        <p
          role="status"
          aria-live="polite"
          className="min-h-5 text-xs text-text-dim"
        >
          {enviando
            ? "Guardando la plantilla. No se envía ningún email."
            : ""}
        </p>
      </div>
    </form>
  )
}

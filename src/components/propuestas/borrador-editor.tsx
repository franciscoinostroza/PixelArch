"use client"

/**
 * T-16 (AC-22, AC-23, AC-24; RF-34, RF-38): generación y edición de
 * borradores desde la ficha del prospecto.
 *
 * - `GenerarBorrador` hace un único POST determinista con la plantilla activa
 *   elegida. Nunca envía emails ni usa LLM. Si el prospecto no tiene email o
 *   no hay plantillas activas, explica el motivo y no habilita la acción.
 * - `BorradorEditor` edita asunto/cuerpo. En BORRADOR actualiza en sitio; en
 *   APROBADO avisa que guardar crea una versión nueva, cancela la aprobación
 *   anterior y no envía nada.
 * - Todo se refresca con `router.refresh()`; no hay auto-refresh ni envío.
 * - Los errores se muestran saneados por código y el foco va al mensaje.
 *
 * T-18 (AC-31; RF-50): un prospecto `ENVIADO` puede iniciar un follow-up
 * **manual**. El servidor acepta `ENVIADO -> BORRADOR` y valida el máximo de
 * mensajes; acá solo se habilita el generador con un aviso de que exige un
 * borrador nuevo y una aprobación nueva. Nunca hay follow-up automático.
 */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FileText, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ENVIO_ASUNTO_MAX,
  ENVIO_CUERPO_MAX,
} from "@/lib/propuestas/validation"

export interface PlantillaOpcionBorrador {
  id: string
  nombre: string
  version: number
}

interface GenerarBorradorProps {
  prospectoId: string
  plantillas: PlantillaOpcionBorrador[]
  plantillaPorDefectoId: string | null
  tieneEmail: boolean
  estadoProspecto: string
  /** Hay un envío en curso: no se ofrece otro borrador hasta resolverlo. */
  hayEnvioAbierto?: boolean
}

interface BorradorEditorProps {
  envioId: string
  prospectoId: string
  estado: string
  version: number
  secuencia: number
  asunto: string
  cuerpoTexto: string
}

interface Mensaje {
  tono: "ok" | "aviso" | "error"
  texto: string
}

interface RespuestaBorrador {
  envioId?: unknown
  secuencia?: unknown
  version?: unknown
  codigo?: unknown
}

const CLASE_MENSAJE =
  "mt-4 rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
const CLASE_AYUDA = "mt-1 text-xs leading-5 text-text-faint"
const CLASE_TEXTAREA =
  "flex min-h-[220px] w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono placeholder:text-text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"
const CLASE_SELECT =
  "flex h-10 w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-text font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Estados del prospecto desde los que se puede iniciar un borrador nuevo.
 * `ENVIADO` habilita el follow-up manual (el servidor valida la transición y
 * el máximo de mensajes); `BORRADOR` cubre un borrador previo cancelado.
 */
const ESTADOS_GENERAR_BORRADOR = new Set<string>([
  "PUNTUADO",
  "BORRADOR",
  "ENVIADO",
])

function textoDe(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

function numeroDe(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor)
    ? valor
    : null
}

function mensajeError(codigo: string | undefined, edicion: boolean): string {
  switch (codigo) {
    case "SIN_EMAIL":
      return "El prospecto no tiene email de contacto. Completalo con fuente y analizá el sitio antes de redactar."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se genera ni se envía nada."
    case "BORRADOR_ABIERTO":
      return "Ya hay un borrador abierto para este prospecto. Editalo o descartalo antes de generar otro."
    case "MAX_MENSAJES":
      return "Se alcanzó el máximo de mensajes configurado para este prospecto. No se creó otro borrador."
    case "ESTADO":
      return edicion
        ? "El envío cambió de estado. Recargá la página y revisá el borrador actual."
        : "El prospecto no está en un estado que permita crear un borrador. Analizalo y puntualo primero."
    case "NO_ENCONTRADO":
      return "El recurso no existe o fue eliminado."
    case "NO_CONFIGURADO":
      return "La redacción por LLM no está configurada. Usá una plantilla determinista; no se escribió nada."
    case "VALIDACION":
      return "Los datos no son válidos. Revisá el asunto y el cuerpo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para redactar propuestas."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo completar la acción. Intentá de nuevo."
  }
}

async function leerJson(res: Response): Promise<RespuestaBorrador | null> {
  try {
    return (await res.json()) as RespuestaBorrador
  } catch {
    return null
  }
}

export function GenerarBorrador({
  prospectoId,
  plantillas,
  plantillaPorDefectoId,
  tieneEmail,
  estadoProspecto,
  hayEnvioAbierto = false,
}: GenerarBorradorProps) {
  const router = useRouter()
  const [plantillaId, setPlantillaId] = useState(() => {
    if (
      plantillaPorDefectoId &&
      plantillas.some((plantilla) => plantilla.id === plantillaPorDefectoId)
    ) {
      return plantillaPorDefectoId
    }
    return plantillas[0]?.id ?? ""
  })
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  const estadoPermitido = ESTADOS_GENERAR_BORRADOR.has(estadoProspecto)
  const esFollowUp = estadoProspecto === "ENVIADO"
  const plantillaEfectiva = plantillas.some(
    (plantilla) => plantilla.id === plantillaId,
  )
    ? plantillaId
    : (plantillas[0]?.id ?? "")
  const puedeRedactar =
    tieneEmail &&
    plantillas.length > 0 &&
    estadoPermitido &&
    !hayEnvioAbierto &&
    plantillaEfectiva.length > 0 &&
    !enviando

  async function generar(): Promise<void> {
    if (enCurso.current || !puedeRedactar) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/prospectos/${encodeURIComponent(prospectoId)}/borrador`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modo: "PLANTILLA",
            plantillaId: plantillaEfectiva,
          }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo), false),
        })
        return
      }

      const version = numeroDe(data?.version)
      const secuencia = numeroDe(data?.secuencia)
      if (version === null || secuencia === null) {
        setMensaje({
          tono: "error",
          texto: "La respuesta del servidor no es válida.",
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto: `Borrador creado (secuencia ${secuencia}, versión ${version}). No se envió ningún email: revisalo y editalo antes de aprobar.`,
      })
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. El borrador puede haberse guardado; refrescá la ficha para verificarlo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[60ch]">
          <p className="text-sm leading-6 text-text-dim">
            Redacción determinista con plantilla, datos verificados y hallazgos
            de auditoría. No inventa métricas, no usa LLM y no envía el email.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void generar()}
          disabled={!puedeRedactar}
          aria-busy={enviando}
        >
          {enviando ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          {enviando ? "Generando…" : "Generar borrador"}
        </Button>
      </div>

      {plantillas.length === 0 && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          No hay plantillas activas.{" "}
          <Link
            href="/propuestas/plantillas"
            className="underline underline-offset-4 hover:text-text"
          >
            Creá una plantilla
          </Link>{" "}
          para poder redactar.
        </p>
      )}

      {plantillas.length > 0 && !tieneEmail && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          El prospecto no tiene email de contacto. Completalo con fuente y
          analizá el sitio: sin email no se puede aprobar ni enviar.
        </p>
      )}

      {hayEnvioAbierto && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          Ya hay un envío abierto o pendiente para este prospecto. Resolvelo
          (editá el borrador o esperá el resultado del envío) antes de generar
          otro mensaje.
        </p>
      )}

      {plantillas.length > 0 && estadoPermitido && esFollowUp && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-violet/30 bg-violet-soft p-3 text-sm leading-6 text-text"
        >
          Este prospecto ya recibió un mensaje. Un follow-up es{" "}
          <strong>manual</strong>: requiere un borrador nuevo y una aprobación
          nueva, y respeta el máximo de mensajes configurado. No hay follow-up
          automático ni envío programado.
        </p>
      )}

      {plantillas.length > 0 && tieneEmail && !estadoPermitido && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          El prospecto está en estado{" "}
          <span className="font-mono text-xs">{estadoProspecto}</span>. Se
          necesita un prospecto puntuado (o con un borrador previo cancelado)
          para iniciar un mensaje nuevo.
        </p>
      )}

      {plantillas.length > 0 && (
        <div className="mt-4 max-w-[70ch]">
          <label
            htmlFor="borrador-plantilla"
            className="block text-sm font-medium text-text"
          >
            Plantilla
          </label>
          <select
            id="borrador-plantilla"
            className={`mt-1 ${CLASE_SELECT}`}
            value={plantillaEfectiva}
            onChange={(evento) => setPlantillaId(evento.target.value)}
            disabled={enviando}
          >
            {plantillas.map((plantilla) => (
              <option key={plantilla.id} value={plantilla.id}>
                {plantilla.nombre} (v{plantilla.version})
              </option>
            ))}
          </select>
          <p className={CLASE_AYUDA}>
            La plantilla activa se aplica con los datos verificados del
            prospecto. Cambiarla después crea otra versión de envío.
          </p>
        </div>
      )}

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "error" ? "alert" : "status"}
          className={`${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : mensaje.tono === "aviso"
                ? "border-amber-500/30 bg-amber-500/5 text-text"
                : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}
    </div>
  )
}

export function BorradorEditor({
  envioId,
  prospectoId,
  estado,
  version,
  secuencia,
  asunto,
  cuerpoTexto,
}: BorradorEditorProps) {
  const router = useRouter()
  const [asuntoActual, setAsuntoActual] = useState(asunto)
  const [cuerpoActual, setCuerpoActual] = useState(cuerpoTexto)
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  const aprobado = estado === "APROBADO"
  const valido =
    asuntoActual.trim().length > 0 && cuerpoActual.trim().length > 0

  async function guardar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    if (enCurso.current || !valido) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/envios/${encodeURIComponent(envioId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asunto: asuntoActual,
            cuerpoTexto: cuerpoActual,
          }),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo), true),
        })
        return
      }

      const nuevaVersion = numeroDe(data?.version)
      if (nuevaVersion === null) {
        setMensaje({
          tono: "error",
          texto: "La respuesta del servidor no es válida.",
        })
        return
      }

      setMensaje({
        tono: "ok",
        texto:
          res.status === 201
            ? `Se creó la versión ${nuevaVersion} y la aprobación anterior quedó cancelada. No se envió ningún email: aprobá de nuevo cuando esté listo.`
            : `Borrador actualizado (versión ${nuevaVersion}). No se envió ningún email.`,
      })
      setAsuntoActual(asuntoActual.trim())
      setCuerpoActual(cuerpoActual.trim())
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. El cambio puede haberse guardado; refrescá la ficha para verificarlo.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      router?.refresh()
    }
  }

  return (
    <form
      onSubmit={(evento) => void guardar(evento)}
      aria-busy={enviando}
      className="mt-4"
    >
      {aprobado && (
        <div
          role="note"
          aria-label="Aviso de edición de un envío aprobado"
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-6 text-text"
        >
          Este envío está aprobado (versión {version}, secuencia {secuencia}).
          Guardar crea una versión nueva en borrador, cancela la aprobación
          anterior y no envía nada: habrá que aprobar de nuevo.
        </div>
      )}

      <div>
        <label
          htmlFor="borrador-asunto"
          className="block text-sm font-medium text-text"
        >
          Asunto
        </label>
        <Input
          id="borrador-asunto"
          className="mt-1"
          autoComplete="off"
          required
          maxLength={ENVIO_ASUNTO_MAX}
          value={asuntoActual}
          onChange={(evento) => setAsuntoActual(evento.target.value)}
          disabled={enviando}
          aria-describedby="borrador-asunto-ayuda"
        />
        <p id="borrador-asunto-ayuda" className={CLASE_AYUDA}>
          Sin saltos de línea ni prefijos falsos. Máximo 120 caracteres
          después de limpiar.
        </p>
      </div>

      <div className="mt-4">
        <label
          htmlFor="borrador-cuerpo"
          className="block text-sm font-medium text-text"
        >
          Cuerpo (texto plano)
        </label>
        <textarea
          id="borrador-cuerpo"
          rows={12}
          className={`mt-1 ${CLASE_TEXTAREA}`}
          required
          maxLength={ENVIO_CUERPO_MAX}
          value={cuerpoActual}
          onChange={(evento) => setCuerpoActual(evento.target.value)}
          disabled={enviando}
          aria-describedby="borrador-cuerpo-ayuda"
        />
        <p id="borrador-cuerpo-ayuda" className={CLASE_AYUDA}>
          El HTML se genera escapado. No se permiten variables pendientes ni
          HTML arbitrario; el footer legal y el enlace de baja se agregan al
          aprobar.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={enviando || !valido}>
          {enviando ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {enviando
            ? "Guardando…"
            : aprobado
              ? "Guardar como versión nueva"
              : "Guardar borrador"}
        </Button>
        <p className="text-xs text-text-dim">
          Versión {version} · secuencia {secuencia} · prospecto{" "}
          <Link
            href={`/propuestas/prospectos/${encodeURIComponent(prospectoId)}`}
            className="underline underline-offset-4 hover:text-text"
          >
            ver ficha
          </Link>
        </p>
      </div>

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "error" ? "alert" : "status"}
          className={`${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : mensaje.tono === "aviso"
                ? "border-amber-500/30 bg-amber-500/5 text-text"
                : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}
    </form>
  )
}

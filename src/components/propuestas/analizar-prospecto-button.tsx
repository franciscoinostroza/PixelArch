"use client"

/**
 * T-15 (AC-19, AC-20, AC-21): boton "Analizar" de una ficha de prospecto.
 *
 * - Hace un unico POST a `/api/propuestas/prospectos/[id]/analizar`; el id es
 *   interno y no hay PII en la URL.
 * - Muestra pending, el estado resultante, si se encontro email, el estado de
 *   la auditoria y el score; los errores se muestran saneados por codigo.
 * - Refresca el server component al terminar para ver la ficha actualizada.
 *   No hay auto-refresh ni temporizadores, y nunca se envia un email.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AnalizarProspectoProps {
  prospectoId: string
}

interface RespuestaApi {
  estado?: unknown
  emailEncontrado?: unknown
  tieneEmail?: unknown
  auditoriaEstado?: unknown
  score?: unknown
  codigo?: unknown
}

interface Mensaje {
  tono: "ok" | "aviso" | "error"
  texto: string
}

const CLASE_MENSAJE =
  "mt-4 rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function textoDe(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

function numeroDe(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor)
    ? Math.round(valor)
    : null
}

function mensajeError(codigo: string | undefined): string {
  switch (codigo) {
    case "NO_ENCONTRADO":
      return "El prospecto no existe o fue eliminado."
    case "SUPRIMIDO":
      return "El contacto está suprimido. No se asigna el email ni se envía nada."
    case "ESTADO":
      return "El prospecto está descartado, suprimido o en un estado que ya no se puede reanalizar."
    case "CUPO":
      return "Se alcanzó el cupo diario de fetches o auditorías. No se encola: volvé a intentar cuando se renueve el cupo."
    case "LIMITE":
      return "Se alcanzó un límite de cupo o presupuesto del proveedor. La acción quedó bloqueada."
    case "CONFIGURACION":
    case "NO_CONFIGURADO":
      return "La configuración de cupos o de supresión no está completa. Avisá al responsable técnico; no se guardó nada."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para analizar prospectos."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    default:
      return "No se pudo analizar el prospecto. Intentá de nuevo."
  }
}

function mensajeExito(data: RespuestaApi): Mensaje {
  const estado = textoDe(data.estado) ?? "PUNTUADO"

  if (estado === "SUPRIMIDO") {
    return {
      tono: "aviso",
      texto:
        "El prospecto quedó SUPRIMIDO: no se asigna un email nuevo ni se envía nada. Revisá la supresión antes de continuar.",
    }
  }

  const partes = [`Análisis completado. Estado: ${estado}.`]

  if (data.emailEncontrado === true) {
    partes.push("Se encontró un email profesional publicado y quedó con su fuente.")
  } else if (data.tieneEmail === true) {
    partes.push(
      "El prospecto ya tenía un email registrado; se conservó sin cambios.",
    )
  } else if (estado === "SIN_ENRIQUECER") {
    partes.push(
      "No se pudo completar el análisis del sitio; no se asignó un email nuevo.",
    )
  } else {
    partes.push(
      "No se encontró un email público; el prospecto sigue sin contacto y no se puede aprobar.",
    )
  }

  const auditoria = textoDe(data.auditoriaEstado)
  partes.push(
    auditoria
      ? `Auditoría: ${auditoria}.`
      : "Auditoría: sin datos (no se pudo completar).",
  )

  const score = numeroDe(data.score)
  partes.push(
    score === null ? "Score: sin datos." : `Score: ${score}/100.`,
  )

  if (estado === "SIN_ENRIQUECER") {
    return {
      tono: "aviso",
      texto: partes.join(" "),
    }
  }

  return { tono: "ok", texto: partes.join(" ") }
}

async function leerJson(res: Response): Promise<RespuestaApi | null> {
  try {
    return (await res.json()) as RespuestaApi
  } catch {
    return null
  }
}

export function AnalizarProspecto({ prospectoId }: AnalizarProspectoProps) {
  const router = useRouter()
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const enCurso = useRef(false)
  const mensajeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  async function analizar(): Promise<void> {
    if (enCurso.current) return

    enCurso.current = true
    setEnviando(true)
    setMensaje(null)

    try {
      const res = await fetch(
        `/api/propuestas/prospectos/${encodeURIComponent(prospectoId)}/analizar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      )
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo)),
        })
        return
      }

      if (textoDe(data?.estado) === undefined) {
        setMensaje({
          tono: "error",
          texto: "La respuesta del servidor no es válida.",
        })
        return
      }

      setMensaje(mensajeExito(data ?? {}))
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Revisá la conexión; el análisis puede haberse guardado y se actualizará al refrescar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(false)
      // Guard defensivo para tests o entornos sin router montado.
      router?.refresh()
    }
  }

  return (
    <section
      aria-label="Analizar prospecto"
      aria-busy={enviando}
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[65ch]">
          <h2 className="font-display text-xl font-semibold text-text">
            Analizar la web del prospecto
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-dim">
            Visita solo el sitio público del negocio (SSRF, robots, timeout y
            tamaño acotados), extrae el contacto publicado y audita el home con
            la lógica interna. No se envía ningún email ni se toca el CRM.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void analizar()}
          disabled={enviando}
          aria-busy={enviando}
        >
          {enviando ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Search aria-hidden="true" />
          )}
          {enviando ? "Analizando…" : "Analizar"}
        </Button>
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
    </section>
  )
}

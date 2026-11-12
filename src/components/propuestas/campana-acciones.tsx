"use client"

/**
 * T-13 (AC-8, AC-11, AC-12; RF-12, RF-16, RF-17): acciones de una campana.
 *
 * - "Ejecutar búsqueda" solo aparece en `BORRADOR`; "Cancelar" en `BORRADOR` o
 *   `EN_CURSO`.
 * - Ambas acciones piden una confirmación explícita en pantalla (sin
 *   `window.confirm`) y muestran la consecuencia antes de llamar a la API.
 * - Un guard con ref y los botones deshabilitados evitan el doble clic.
 * - La respuesta se anuncia con `role=status` (éxito) o `role=alert` (error) y
 *   el foco se mueve al mensaje. Tras cualquier respuesta se refresca el
 *   server component para reflejar el estado real de la base.
 * - No muestra ni envía secretos, consultas ni PII.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type Accion = "EJECUTAR" | "CANCELAR"

interface Mensaje {
  tono: "ok" | "error"
  texto: string
}

interface CampanaAccionesProps {
  campanaId: string
  estado: string
}

interface RespuestaApi {
  estado?: unknown
  creados?: unknown
  reutilizados?: unknown
  duplicados?: unknown
  omitidos?: unknown
  codigo?: unknown
  error?: unknown
}

const CLASE_MENSAJE =
  "mt-4 rounded-lg border p-3 text-sm leading-6 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"

function textoDe(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined
}

function numeroDe(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0
    ? valor
    : null
}

function mensajeError(codigo: string | undefined, accion: Accion): string {
  switch (codigo) {
    case "ESTADO":
      return "La campaña ya no está en un estado que permita esta acción (pudo ejecutarse o cancelarse antes). Se actualizó la página."
    case "NO_ENCONTRADO":
      return "La campaña no existe o fue eliminada."
    case "CUPO":
      return "Se alcanzó el cupo diario de Google Places. No se encola: volvé a intentar cuando se renueve el cupo."
    case "LIMITE":
      return "Se alcanzó un límite de cupo o presupuesto del proveedor. La acción quedó bloqueada."
    case "CUOTA":
      return "Google Places rechazó la solicitud por cuota. La corrida se cortó sin reintentos."
    case "NO_CONFIGURADO":
      return "Google Places no está configurado. Avisá al responsable técnico; la campaña no consumió cupo."
    case "PROVEEDOR":
    case "TIMEOUT":
    case "RED":
      return "La búsqueda falló del lado de Google Places. La campaña quedó fallida y conserva lo que ya estaba guardado."
    case "CREDENCIALES":
    case "CONFIGURACION":
      return "Google Places rechazó la configuración de la solicitud. Avisá al responsable técnico."
    case "RATE_LIMIT":
      return "Demasiadas solicitudes. Esperá un minuto y volvé a intentar."
    case "ORIGEN_INVALIDO":
      return "La solicitud no proviene del portal. Recargá la página e intentá de nuevo."
    case "NO_AUTORIZADO":
      return "Tu sesión venció. Volvé a ingresar al portal."
    case "PROHIBIDO":
      return "No tenés permisos para operar sobre campañas."
    case "ESQUEMA_NO_APLICADO":
      return "El esquema del portal no está aplicado. Avisá al responsable técnico."
    case "VALIDACION":
      return "La confirmación no es válida. Recargá la página e intentá de nuevo."
    default:
      return accion === "EJECUTAR"
        ? "No se pudo ejecutar la búsqueda. Intentá de nuevo."
        : "No se pudo cancelar la campaña. Intentá de nuevo."
  }
}

function mensajeEjecucion(data: RespuestaApi, estado: string): string {
  const creados = numeroDe(data.creados)
  const reutilizados = numeroDe(data.reutilizados)
  const duplicados = numeroDe(data.duplicados)
  const omitidos = numeroDe(data.omitidos)

  if (
    creados === null ||
    reutilizados === null ||
    duplicados === null ||
    omitidos === null
  ) {
    return `Búsqueda ejecutada. La campaña quedó en ${estado}.`
  }

  const detalle = [
    `${creados} ${creados === 1 ? "creado" : "creados"}`,
    `${duplicados} ${duplicados === 1 ? "posible duplicado" : "posibles duplicados"}`,
    `${reutilizados} ${reutilizados === 1 ? "reutilizado" : "reutilizados"}`,
    `${omitidos} ${omitidos === 1 ? "omitido" : "omitidos"}`,
  ].join(", ")

  const cierre =
    estado === "COMPLETADA"
      ? "La campaña quedó completada."
      : estado === "PARCIAL"
        ? "La campaña quedó parcial: revisá los omitidos y el último error."
        : estado === "CANCELADA"
          ? "La campaña fue cancelada durante la corrida y se respetó ese estado."
          : "La campaña quedó fallida; revisá el último error."

  return `Búsqueda ejecutada: ${detalle}. ${cierre}`
}

async function leerJson(res: Response): Promise<RespuestaApi | null> {
  try {
    return (await res.json()) as RespuestaApi
  } catch {
    return null
  }
}

export function CampanaAcciones({
  campanaId,
  estado: estadoInicial,
}: CampanaAccionesProps) {
  const router = useRouter()
  const [estadoEjecutado, setEstadoEjecutado] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<Accion | null>(null)
  const [enviando, setEnviando] = useState<Accion | null>(null)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)

  const enCurso = useRef(false)
  const confirmarRef = useRef<HTMLButtonElement>(null)
  const mensajeRef = useRef<HTMLDivElement>(null)

  // El estado mostrado es el del server component salvo que la propia accion
  // ya haya recibido un estado final; `router.refresh()` actualiza el prop.
  const estado = estadoEjecutado ?? estadoInicial

  useEffect(() => {
    if (confirmando !== null) confirmarRef.current?.focus()
  }, [confirmando])

  useEffect(() => {
    if (mensaje !== null) mensajeRef.current?.focus()
  }, [mensaje])

  const ocupado = enviando !== null
  const enBorrador = estado === "BORRADOR"
  const puedeCancelar = estado === "BORRADOR" || estado === "EN_CURSO"

  async function enviar(accion: Accion): Promise<void> {
    if (enCurso.current) return
    enCurso.current = true
    setEnviando(accion)
    setMensaje(null)

    const ruta =
      accion === "EJECUTAR"
        ? `/api/propuestas/campanas/${encodeURIComponent(campanaId)}/ejecutar`
        : `/api/propuestas/campanas/${encodeURIComponent(campanaId)}/cancelar`

    try {
      const res = await fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmado: true }),
      })
      const data = await leerJson(res)

      if (!res.ok) {
        setMensaje({
          tono: "error",
          texto: mensajeError(textoDe(data?.codigo), accion),
        })
        return
      }

      if (accion === "CANCELAR") {
        setEstadoEjecutado("CANCELADA")
        setMensaje({
          tono: "ok",
          texto:
            "La campaña quedó cancelada. No se harán nuevas llamadas ni se enviará nada.",
        })
        return
      }

      const nuevoEstado = textoDe(data?.estado) ?? "COMPLETADA"
      setEstadoEjecutado(nuevoEstado)
      setMensaje({
        tono: "ok",
        texto: mensajeEjecucion(data ?? {}, nuevoEstado),
      })
    } catch {
      setMensaje({
        tono: "error",
        texto:
          "Error de red. Revisá la conexión; la campaña puede haber cambiado de estado y se actualizará al refrescar.",
      })
    } finally {
      enCurso.current = false
      setEnviando(null)
      setConfirmando(null)
      // Guard defensivo: en tests o entornos sin router montado no debe romper
      // el anuncio del resultado.
      router?.refresh()
    }
  }

  return (
    <section
      aria-label="Acciones de la campaña"
      aria-busy={ocupado}
      className="rounded-xl border border-border bg-panel p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        {enBorrador && confirmando !== "EJECUTAR" && (
          <Button
            type="button"
            onClick={() => {
              setMensaje(null)
              setConfirmando("EJECUTAR")
            }}
            disabled={ocupado}
          >
            {enviando === "EJECUTAR" && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {enviando === "EJECUTAR"
              ? "Ejecutando búsqueda…"
              : "Ejecutar búsqueda"}
          </Button>
        )}

        {puedeCancelar && confirmando !== "CANCELAR" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMensaje(null)
              setConfirmando("CANCELAR")
            }}
            disabled={ocupado}
          >
            {enviando === "CANCELAR" && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {enviando === "CANCELAR"
              ? "Cancelando campaña…"
              : "Cancelar campaña"}
          </Button>
        )}

        {!enBorrador && !puedeCancelar && (
          <p className="text-sm leading-6 text-text-dim">
            La campaña está en estado{" "}
            <span className="font-mono text-xs text-text">{estado}</span>. No
            hay acciones disponibles; para reintentar una búsqueda, creá otra
            campaña.
          </p>
        )}
      </div>

      {confirmando === "EJECUTAR" && (
        <div
          role="group"
          aria-label="Confirmar ejecución de la búsqueda"
          className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <p className="text-sm leading-6 text-text">
            Se va a consultar Google Places una sola vez (1 request acotado al
            límite de la campaña). No se envía ningún email ni se toca el CRM.
            La campaña pasa a <span className="font-mono text-xs">EN_CURSO</span>{" "}
            y no se puede repetir sobre la misma campaña.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              ref={confirmarRef}
              type="button"
              onClick={() => void enviar("EJECUTAR")}
              disabled={ocupado}
            >
              Confirmar búsqueda
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmando(null)}
              disabled={ocupado}
            >
              Volver
            </Button>
          </div>
        </div>
      )}

      {confirmando === "CANCELAR" && (
        <div
          role="group"
          aria-label="Confirmar cancelación de la campaña"
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-4"
        >
          <p className="text-sm leading-6 text-text">
            Cancelar detiene nuevas llamadas y deja la campaña en{" "}
            <span className="font-mono text-xs">CANCELADA</span>. Es un estado
            terminal: para volver a buscar hay que crear otra campaña.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              ref={confirmarRef}
              type="button"
              onClick={() => void enviar("CANCELAR")}
              disabled={ocupado}
            >
              Sí, cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmando(null)}
              disabled={ocupado}
            >
              Volver
            </Button>
          </div>
        </div>
      )}

      {mensaje && (
        <div
          ref={mensajeRef}
          tabIndex={-1}
          role={mensaje.tono === "ok" ? "status" : "alert"}
          className={`${CLASE_MENSAJE} ${
            mensaje.tono === "ok"
              ? "border-mint/30 bg-mint/5 text-text"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {mensaje.texto}
        </div>
      )}
    </section>
  )
}

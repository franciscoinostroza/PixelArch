import Link from "next/link"

import {
  AjustePaypalButton,
  type AjustePaypalPago,
} from "@/components/ui/ajuste-paypal-button"
import {
  RevisionPaypalButton,
  type RevisionPaypalPago,
} from "@/components/ui/revision-paypal-button"
import { formatearMonto } from "@/lib/pagos"
import {
  ESTADO_REVISION_LABEL,
  type PagoHistorial,
} from "@/lib/paypal/view"
import { cn } from "@/lib/utils"

/**
 * Tabla del historial de pagos (`/admin/pagos`, T-23).
 *
 * Recibe filas ya normalizadas con `mapearPagoHistorial` (T-19) y solo se
 * encarga de la presentacion:
 * - distingue PayPal / Mercado Pago / Manual;
 * - muestra concepto, fecha, referencia, desglose, moneda, estado y revision;
 * - expone los ajustes (reembolsos/contracargos) y los eventos que requieren
 *   accion (reembolsos, contracargos, disputas y duplicados);
 * - enlaza el recibo interno solo cuando `evaluarElegibilidadRecibo` lo permite.
 *
 * No consulta la base, no lee datos del pagador y no incluye email/telefono del
 * cliente. El nombre del cliente es el unico dato del CRM que muestra la tabla.
 */

const FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
})

/** Mismo formato que la fila del detalle del cliente (`pago-paypal-row`). */
function fechaCorta(valor: Date | string | null | undefined): string | null {
  if (!valor) return null
  const fecha = valor instanceof Date ? valor : new Date(valor)
  return Number.isFinite(fecha.getTime()) ? FECHA.format(fecha) : null
}

export interface AjustePagoVista {
  id: string
  tipo: string
  monto: number
  decision?: string | null
  motivo?: string | null
  creadoEn?: Date | string | null
}

export interface EventoPagoVista {
  id: string
  tipo: string
  resultado?: string | null
  motivo?: string | null
  monto?: number | null
  moneda?: string | null
  creadoEn?: Date | string | null
}

export interface PagoTablaFila {
  id: string
  historial: PagoHistorial
  /** Nombre del cliente del CRM; nunca email ni telefono. */
  clienteNombre?: string | null
  /** Etiqueta del metodo historico (`Pago.metodo`), si existe. */
  metodoEtiqueta?: string | null
  ajustes?: readonly AjustePagoVista[]
  eventos?: readonly EventoPagoVista[]
  /** Datos para el ajuste manual (T-26); `null` si no aplica. */
  ajuste?: AjustePaypalPago | null
  /** Datos para resolver una diferencia (T-27); `null` si no aplica. */
  revision?: RevisionPaypalPago | null
}

const PILL_POR_TONO: Record<PagoHistorial["estado"]["tono"], string> = {
  mint: "a-pill mint",
  yellow: "a-pill yellow",
  red: "a-pill red",
  gray: "a-pill gray",
}

const TIPO_AJUSTE_LABEL: Record<string, string> = {
  REEMBOLSO: "Reembolso",
  CONTRACARGO: "Contracargo",
}

const DECISION_AJUSTE_LABEL: Record<string, string> = {
  NINGUNA: "sin cambio",
  REVERTIR_HITO: "hito revertido",
  DESCONTAR_MESES: "meses descontados",
}

function etiquetaAjuste(ajuste: AjustePagoVista): string {
  return TIPO_AJUSTE_LABEL[ajuste.tipo] ?? ajuste.tipo
}

function etiquetaEvento(evento: EventoPagoVista): string {
  const tipo = evento.tipo.toUpperCase()
  const resultado = (evento.resultado ?? "").toUpperCase()

  if (tipo.includes("REFUND") || resultado === "REEMBOLSO") return "Reembolso"
  if (
    tipo.includes("REVERSED") ||
    tipo.includes("CHARGEBACK") ||
    resultado === "CONTRACARGO"
  ) {
    return "Contracargo"
  }
  if (tipo.includes("DUPLIC") || resultado === "DUPLICADO") return "Duplicado"
  if (tipo.includes("DISPUTE") || resultado === "DISPUTA") return "Disputa"
  return evento.tipo
}

function descripcionAjustes(fila: PagoTablaFila): string | null {
  const ajustes = fila.ajustes ?? []
  if (ajustes.length === 0) return null

  return ajustes
    .map((ajuste) => {
      const monto = formatearMonto(
        ajuste.monto,
        fila.historial.desglose.moneda
      )
      const decision = ajuste.decision
        ? DECISION_AJUSTE_LABEL[ajuste.decision] ?? ajuste.decision
        : null
      return `${etiquetaAjuste(ajuste)} ${monto}${decision ? ` · ${decision}` : ""}`
    })
    .join(" · ")
}

function descripcionEventos(fila: PagoTablaFila): string | null {
  const eventos = fila.eventos ?? []
  if (eventos.length === 0) return null

  const etiquetas = Array.from(
    new Set(eventos.map((evento) => etiquetaEvento(evento)))
  )
  return etiquetas.join(", ")
}

/**
 * Etiquetas de la fila (pasarela, origen, metodo y cliente) sin repetir el
 * mismo texto. Evita filas como "PayPal · Automático · PayPal" cuando el
 * metodo coincide con la pasarela.
 */
function etiquetasMeta(fila: PagoTablaFila): string[] {
  const etiquetas = [
    fila.historial.pasarelaEtiqueta,
    fila.historial.origenEtiqueta,
    fila.metodoEtiqueta,
    fila.clienteNombre,
  ].filter((etiqueta): etiqueta is string => Boolean(etiqueta?.trim()))

  return Array.from(new Set(etiquetas))
}

function CeldaReferencia({ fila }: { fila: PagoTablaFila }) {
  const referencias = fila.historial.referencias.todas
  if (referencias.length === 0) {
    return <span className="a-faint">—</span>
  }

  const [principal, ...resto] = referencias

  return (
    <div>
      <div className="a-mono">{principal.etiqueta}</div>
      {resto.length > 0 && (
        <div className="a-date" style={{ color: "var(--color-text-dim)" }}>
          {resto.map((referencia) => referencia.etiqueta).join(" · ")}
        </div>
      )}
    </div>
  )
}

function CeldaDesglose({ fila }: { fila: PagoTablaFila }) {
  const { desglose } = fila.historial
  const total = desglose.formateado.monto ?? "—"

  return (
    <div>
      <div className="a-mono">{total}</div>
      {desglose.tieneDiferencia && (
        <div className="a-date" style={{ color: "#fbbf24" }}>
          Esperado {desglose.formateado.montoEsperado ?? "—"} · diferencia{" "}
          {desglose.formateado.diferencia ?? "—"}
        </div>
      )}
    </div>
  )
}

function CeldaRevision({ fila }: { fila: PagoTablaFila }) {
  const revision = fila.historial.estado.revisionEstado
  const ajustes = descripcionAjustes(fila)
  const eventos = descripcionEventos(fila)

  if (!revision && !ajustes && !eventos) {
    return <span className="a-faint">—</span>
  }

  return (
    <div className="space-y-1">
      {revision && (
        <div className="a-date">
          Revisión: {ESTADO_REVISION_LABEL[revision]}
        </div>
      )}
      {ajustes && <div className="a-date">{ajustes}</div>}
      {eventos && (
        <div className="a-date" style={{ color: "#fbbf24" }}>
          Requiere acción: {eventos}
        </div>
      )}
    </div>
  )
}

function CeldaRecibo({ fila }: { fila: PagoTablaFila }) {
  const recibo = fila.historial.recibo
  if (!recibo.disponible || !recibo.href) {
    return <span className="a-faint">—</span>
  }

  return (
    <Link
      href={recibo.href}
      className="a-btn ghost"
      aria-label={`Ver recibo ${recibo.reciboId ?? ""}`.trim()}
    >
      Ver recibo
    </Link>
  )
}

export function PagosTabla({
  filas,
  puedeAjustar = false,
  puedeResolverRevision = false,
}: {
  filas: readonly PagoTablaFila[]
  /** Solo admin: agrega la columna de reembolso/contracargo (T-26). */
  puedeAjustar?: boolean
  /** Solo admin: agrega la accion de resolver diferencias (T-27). */
  puedeResolverRevision?: boolean
}) {
  if (filas.length === 0) {
    return <p className="a-empty">No hay pagos registrados</p>
  }

  const muestraAcciones = puedeAjustar || puedeResolverRevision

  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <caption className="sr-only">
          Historial de pagos por pasarela con desglose y estado de revisión
        </caption>
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Fecha</th>
            <th>Referencia</th>
            <th>Monto acordado</th>
            <th>Comisión</th>
            <th>Total</th>
            <th>Moneda</th>
            <th>Estado</th>
            <th>Revisión / ajustes</th>
            <th>Recibo</th>
            {muestraAcciones && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const { historial } = fila
            const estado = historial.estado
            const fecha = fechaCorta(historial.creadoEn ?? historial.creadoEnIso)
            const meta = etiquetasMeta(fila)

            return (
              <tr key={fila.id} data-testid={`pago-${fila.id}`}>
                <td>
                  <div className="a-name">{historial.concepto.titulo}</div>
                  {historial.concepto.descripcion &&
                    historial.concepto.descripcion !==
                      historial.concepto.titulo && (
                      <div className="a-date">
                        {historial.concepto.descripcion}
                      </div>
                    )}
                  {meta.length > 0 && (
                    <div
                      className="a-date"
                      style={{ color: "var(--color-text-dim)" }}
                    >
                      {meta.join(" · ")}
                    </div>
                  )}
                </td>
                <td className="a-faint">{fecha ?? "—"}</td>
                <td>
                  <CeldaReferencia fila={fila} />
                </td>
                <td className="a-mono">
                  {historial.desglose.formateado.montoAcordado ?? "—"}
                </td>
                <td className="a-mono">
                  {historial.desglose.formateado.comision ?? "—"}
                </td>
                <td>
                  <CeldaDesglose fila={fila} />
                </td>
                <td className="a-mono">{historial.desglose.monedaEtiqueta}</td>
                <td>
                  <span className={cn(PILL_POR_TONO[estado.tono])}>
                    <i />
                    {estado.etiqueta}
                  </span>
                  {estado.requiereAccion && (
                    <div
                      className="a-date"
                      style={{ color: "#fbbf24", marginTop: 4 }}
                    >
                      Requiere acción
                    </div>
                  )}
                </td>
                <td>
                  <CeldaRevision fila={fila} />
                </td>
                <td>
                  <CeldaRecibo fila={fila} />
                </td>
                {muestraAcciones && (
                  <td>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {puedeResolverRevision && fila.revision && (
                        <RevisionPaypalButton
                          pago={fila.revision}
                          puedeResolverRevision
                          ariaLabel={`Resolver revisión — ${historial.concepto.titulo}`}
                        />
                      )}
                      {puedeAjustar && fila.ajuste && (
                        <AjustePaypalButton
                          pago={fila.ajuste}
                          puedeRegistrarAjuste
                          ariaLabel={`Ajuste — ${historial.concepto.titulo}`}
                        />
                      )}
                      {!(puedeResolverRevision && fila.revision) &&
                        !(puedeAjustar && fila.ajuste) && (
                          <span className="a-faint">—</span>
                        )}
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

import Link from "next/link"
import type { ReactNode } from "react"

import {
  ESTADO_REVISION_LABEL,
  type PagoHistorial,
} from "@/lib/paypal/view"
import { formatearMonto } from "@/lib/pagos"
import { cn } from "@/lib/utils"
import type {
  AjustePagoVista,
  EventoPagoVista,
} from "@/components/ui/pagos-tabla"

/**
 * Fila del historial de pagos del detalle del cliente (T-24).
 *
 * Usa la fila normalizada por `mapearPagoHistorial` (T-19) y muestra:
 * - concepto, pasarela, fecha y desglose (acordado / comision / total);
 * - quien genero el link y fecha/canal/idioma del envio;
 * - estado de revision, ajustes y eventos que requieren accion;
 * - acceso al recibo interno cuando corresponde.
 *
 * Privacidad: solo recibe datos del pago y de staff (`generadoPorNombre` /
 * `registradoPor`). No acepta ni renderiza email, telefono ni datos del
 * pagador. La asistente ve la misma fila y el recibo (T-02).
 */

const FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
})

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

function fechaCorta(valor: Date | null): string | null {
  return valor ? FECHA.format(valor) : null
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

function ResumenAjustes({
  ajustes,
  moneda,
}: {
  ajustes: readonly AjustePagoVista[]
  moneda: PagoHistorial["desglose"]["moneda"]
}) {
  if (ajustes.length === 0) return null

  return (
    <div className="a-date" style={{ color: "#fbbf24" }}>
      {ajustes.map((ajuste) => {
        const tipo = TIPO_AJUSTE_LABEL[ajuste.tipo] ?? ajuste.tipo
        const decision = ajuste.decision
          ? DECISION_AJUSTE_LABEL[ajuste.decision] ?? ajuste.decision
          : null
        return (
          <div key={ajuste.id}>
            {tipo} {formatearMonto(ajuste.monto, moneda)}
            {decision ? ` · ${decision}` : ""}
          </div>
        )
      })}
    </div>
  )
}

export interface PagoPaypalRowProps {
  pago: PagoHistorial
  ajustes?: readonly AjustePagoVista[]
  eventos?: readonly EventoPagoVista[]
  /**
   * Accion admin-only de la fila (T-26). El detalle decide si muestra la
   * columna; cuando es `undefined` no se renderiza la celda para no romper el
   * encabezado de la asistente.
   */
  accion?: ReactNode
}

export function PagoPaypalRow({
  pago,
  ajustes = [],
  eventos = [],
  accion,
}: PagoPaypalRowProps) {
  const estado = pago.estado
  const revision = estado.revisionEstado
    ? ESTADO_REVISION_LABEL[estado.revisionEstado]
    : null
  const fecha = fechaCorta(pago.creadoEn)
  const envioFecha = fechaCorta(pago.envio.enviadoEn)
  const envio = pago.envio.enviado
    ? [envioFecha, pago.envio.canalEtiqueta].filter(Boolean).join(" · ")
    : null
  const autorEtiqueta =
    pago.autor.fuente === "ENLACE" ? "Generó" : "Registró"

  return (
    <tr data-testid={`pago-${pago.id}`}>
      <td>
        <div className="a-name">{pago.concepto.titulo}</div>
        {pago.concepto.descripcion &&
          pago.concepto.descripcion !== pago.concepto.titulo && (
            <div className="a-date">{pago.concepto.descripcion}</div>
          )}
      </td>
      <td>
        <div className="a-date">{pago.pasarelaEtiqueta}</div>
        {pago.origenEtiqueta && (
          <div className="a-date" style={{ color: "var(--color-text-dim)" }}>
            {pago.origenEtiqueta}
          </div>
        )}
      </td>
      <td className="a-faint">{fecha ?? "—"}</td>
      <td>
        <div className="a-date">
          Acordado: {pago.desglose.formateado.montoAcordado ?? "—"}
        </div>
        <div className="a-date">
          Comisión: {pago.desglose.formateado.comision ?? "—"}
        </div>
        <div className="a-mono">
          Total: {pago.desglose.formateado.monto ?? "—"}
        </div>
        <div
          className="a-date"
          style={{ color: "var(--color-text-dim)" }}
        >
          {pago.desglose.monedaEtiqueta}
          {pago.desglose.tieneDiferencia
            ? ` · esperado ${pago.desglose.formateado.montoEsperado ?? "—"}`
            : ""}
        </div>
        {pago.desglose.tieneDiferencia && (
          <div className="a-date" style={{ color: "#fbbf24" }}>
            Diferencia: {pago.desglose.formateado.diferencia ?? "—"}
          </div>
        )}
      </td>
      <td>
        <div className="a-date">
          {autorEtiqueta}: {pago.autor.nombre ?? "—"}
        </div>
        <div className="a-date">
          Envío: {envio ?? "sin registro"}
        </div>
        {pago.envio.idiomaEtiqueta && (
          <div className="a-date" style={{ color: "var(--color-text-dim)" }}>
            Idioma: {pago.envio.idiomaEtiqueta}
          </div>
        )}
      </td>
      <td>
        <span className={cn(PILL_POR_TONO[estado.tono])}>
          <i />
          {estado.etiqueta}
        </span>
        {revision && (
          <div className="a-date" style={{ marginTop: 4 }}>
            Revisión: {revision}
          </div>
        )}
        <ResumenAjustes ajustes={ajustes} moneda={pago.desglose.moneda} />
        {eventos.length > 0 && (
          <div className="a-date" style={{ color: "#fbbf24" }}>
            Requiere acción:{" "}
            {Array.from(new Set(eventos.map(etiquetaEvento))).join(", ")}
          </div>
        )}
      </td>
      <td>
        {pago.recibo.disponible && pago.recibo.href ? (
          <Link
            href={pago.recibo.href}
            className="a-btn ghost"
            aria-label={`Ver recibo ${pago.recibo.reciboId ?? ""}`.trim()}
          >
            Ver recibo
          </Link>
        ) : (
          <span className="a-faint">—</span>
        )}
      </td>
      {accion !== undefined && <td>{accion}</td>}
    </tr>
  )
}

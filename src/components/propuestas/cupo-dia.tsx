import Link from "next/link"
import {
  Gauge,
  Globe,
  Mail,
  MapPin,
  PenLine,
  type LucideIcon,
} from "lucide-react"

import { formatearMonto } from "@/lib/pagos"
import type { ProveedorConsumoCupo } from "@/lib/propuestas/consumo"
import { formatearFechaPortal } from "@/lib/propuestas/fechas"
import { StatusPill, type StatusTone } from "@/components/propuestas/ui/status-pill"

/**
 * T-21 (AC-38, AC-39; RF-57, RF-58): medidor de cupos y consumo del dia.
 *
 * Componente presentacional de solo lectura. Recibe el agregado ya calculado
 * por `estadoCupos`, `estadoConsumoCampana` o `estadoConsumoProspecto` y no
 * consulta Prisma, env, red ni APIs. Muestra por proveedor usado/cap,
 * restante, costo estimado y estado (80% aviso, 100% bloqueo); el presupuesto
 * mensual es siempre el global. Si una pieza no esta configurada (Places,
 * Resend, secreto o cap <= 0) muestra "No configurado" sin inventar numeros.
 *
 * No hay cola: el texto y el enlace a supresiones lo recuerdan.
 *
 * FASE 2 "PixelArch Console": panel, filas con icono y barra de progreso
 * (`p-progress`). Conserva roles, atributos ARIA, `data-estado` y textos.
 */

export interface FilaCupoDia {
  proveedor: ProveedorConsumoCupo
  usado: number
  cap: number
  restante: number
  alerta: boolean
  costoCentavos: number
  /** Si el agregado lo trae, se usa; si no, se deriva de usado >= cap. */
  bloqueado?: boolean
}

export interface EstadoCupoDia {
  fecha: Date
  proveedores: readonly FilaCupoDia[]
  totalCostoCentavos: number
  presupuestoMensualCentavos: number
  gastadoMesCentavos: number | null
  restanteMesCentavos: number | null
  alertaPresupuesto: boolean
  presupuestoBloqueado?: boolean
}

export interface DisponibilidadCupoDia {
  places: boolean
  resend: boolean
  secreto: boolean
}

interface CupoDiaProps {
  estado: EstadoCupoDia
  titulo?: string
  variante?: "completo" | "compacto"
  disponibilidad?: DisponibilidadCupoDia
  /** Proveedores que no se repiten porque ya tienen su propia seccion. */
  excluir?: readonly ProveedorConsumoCupo[]
  /** Default true; en la variante acotada se puede dejar el budget al global. */
  mostrarPresupuesto?: boolean
  /** Default true; el enlace a supresiones se muestra una vez por pagina. */
  mostrarPie?: boolean
}

const ETIQUETAS: Record<ProveedorConsumoCupo, string> = {
  GOOGLE_PLACES: "Google Places",
  WEB_FETCH: "Fetch web",
  AUDITORIA: "Auditoría",
  REDACTOR: "Redactor",
  RESEND: "Resend",
}

const UNIDADES: Record<ProveedorConsumoCupo, string> = {
  GOOGLE_PLACES: "búsquedas",
  WEB_FETCH: "páginas",
  AUDITORIA: "auditorías",
  REDACTOR: "borradores",
  RESEND: "envíos",
}

const ICONOS: Record<ProveedorConsumoCupo, LucideIcon> = {
  GOOGLE_PLACES: MapPin,
  WEB_FETCH: Globe,
  AUDITORIA: Gauge,
  REDACTOR: PenLine,
  RESEND: Mail,
}

function motivoNoConfigurado(
  proveedor: ProveedorConsumoCupo,
  cap: number,
  disponibilidad: DisponibilidadCupoDia | undefined,
): string | null {
  if (proveedor === "GOOGLE_PLACES" && disponibilidad && !disponibilidad.places) {
    return "No configurado: falta PROPUESTAS_PLACES_API_KEY."
  }
  if (proveedor === "RESEND" && disponibilidad && !disponibilidad.resend) {
    return "No configurado: falta RESEND_API_KEY."
  }
  if (cap <= 0) {
    return "No configurado: el cupo diario es 0 o invalido."
  }
  return null
}

function tonoBarra(bloqueado: boolean, alerta: boolean): string {
  if (bloqueado) return "bloqueado"
  if (alerta) return "alerta"
  return "ok"
}

function BarraCupo({
  etiqueta,
  usado,
  cap,
  bloqueado,
  alerta,
}: {
  etiqueta: string
  usado: number
  cap: number
  bloqueado: boolean
  alerta: boolean
}) {
  const porcentaje =
    cap > 0 ? Math.min(100, Math.max(0, Math.round((usado / cap) * 100))) : 0
  const tono = tonoBarra(bloqueado, alerta)

  return (
    <div
      role="progressbar"
      aria-label={`Uso de ${etiqueta}`}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(usado, cap)}
      aria-valuetext={`${usado} de ${cap} usados`}
      className="p-progress"
    >
      <div
        className={`p-progress-fill p-progress-fill--${tono}`}
        style={{ width: `${porcentaje}%` }}
      />
    </div>
  )
}

function FilaCupoDia({
  fila,
  disponibilidad,
}: {
  fila: FilaCupoDia
  disponibilidad?: DisponibilidadCupoDia
}) {
  const etiqueta = ETIQUETAS[fila.proveedor]
  const unidad = UNIDADES[fila.proveedor]
  const Icono = ICONOS[fila.proveedor]
  const motivo = motivoNoConfigurado(fila.proveedor, fila.cap, disponibilidad)

  if (motivo !== null) {
    return (
      <li
        data-estado="NO_CONFIGURADO"
        aria-label={`${etiqueta}: no configurado`}
        className="p-quota-row"
      >
        <span className="p-quota-icon" aria-hidden="true">
          <Icono size={16} />
        </span>
        <div className="p-quota-main">
          <div className="p-quota-head">
            <p className="p-quota-label">{etiqueta}</p>
            <StatusPill tone="amber">No configurado</StatusPill>
          </div>
          <p className="p-quota-note">{motivo}</p>
        </div>
      </li>
    )
  }

  const bloqueado =
    fila.bloqueado ?? (fila.cap > 0 && fila.usado >= fila.cap)
  const estado = bloqueado ? "BLOQUEADO" : fila.alerta ? "ALERTA" : "OK"
  const textoEstado = bloqueado
    ? "Bloqueado al 100%"
    : fila.alerta
      ? "Aviso 80%"
      : "Dentro del cupo"
  const tono: StatusTone = bloqueado ? "red" : fila.alerta ? "amber" : "mint"

  return (
    <li
      data-estado={estado}
      aria-label={`${etiqueta}: ${fila.usado} de ${fila.cap} ${unidad}`}
      className="p-quota-row"
    >
      <span className="p-quota-icon" aria-hidden="true">
        <Icono size={16} />
      </span>

      <div className="p-quota-main">
        <div className="p-quota-head">
          <p className="p-quota-label">{etiqueta}</p>
          <StatusPill tone={tono}>{textoEstado}</StatusPill>
        </div>

        <dl className="p-quota-stats">
          <div className="p-quota-stat">
            <dt>Usado hoy</dt>
            <dd>
              {fila.usado} / {fila.cap}
            </dd>
          </div>
          <div className="p-quota-stat">
            <dt>Restante</dt>
            <dd>{fila.restante}</dd>
          </div>
          <div className="p-quota-stat">
            <dt>{unidad}</dt>
            <dd>del día</dd>
          </div>
        </dl>

        <BarraCupo
          etiqueta={etiqueta}
          usado={fila.usado}
          cap={fila.cap}
          bloqueado={bloqueado}
          alerta={fila.alerta}
        />

        <p className="p-quota-cost">
          Costo estimado:{" "}
          <span className="p-quota-cost-value">
            {fila.costoCentavos > 0
              ? formatearMonto(fila.costoCentavos, "usd")
              : "sin costo estimado"}
          </span>
        </p>
      </div>
    </li>
  )
}

function PresupuestoMensual({ estado }: { estado: EstadoCupoDia }) {
  if (estado.presupuestoMensualCentavos <= 0) {
    return (
      <p className="p-quota-note p-quota-budget-empty">
        Sin presupuesto mensual configurado. El tope duro por proveedor/día
        sigue aplicando.
      </p>
    )
  }

  if (estado.gastadoMesCentavos === null) {
    return (
      <p className="p-quota-note p-quota-budget-empty">
        Presupuesto mensual global configurado; no hay dato de gasto del mes.
      </p>
    )
  }

  const gastado = estado.gastadoMesCentavos
  const presupuesto = estado.presupuestoMensualCentavos
  const restante =
    estado.restanteMesCentavos ?? Math.max(0, presupuesto - gastado)
  const bloqueado =
    estado.presupuestoBloqueado ?? (restante === 0 && presupuesto > 0)
  const alerta = estado.alertaPresupuesto
  const estadoTexto = bloqueado
    ? "BLOQUEADO"
    : alerta
      ? "ALERTA"
      : "OK"
  const textoEstado = bloqueado
    ? "Bloqueado al 100%"
    : alerta
      ? "Aviso 80%"
      : "Dentro del presupuesto"
  const tono: StatusTone = bloqueado ? "red" : alerta ? "amber" : "mint"

  return (
    <div
      data-estado={estadoTexto}
      aria-label="Presupuesto mensual global"
      className="p-quota-budget"
    >
      <div className="p-quota-head">
        <p className="p-quota-label">Presupuesto mensual global</p>
        <StatusPill tone={tono}>{textoEstado}</StatusPill>
      </div>
      <p className="p-quota-note">
        Gastado {formatearMonto(gastado, "usd")} de{" "}
        {formatearMonto(presupuesto, "usd")} · restante{" "}
        {formatearMonto(restante, "usd")}
      </p>
      <BarraCupo
        etiqueta="presupuesto mensual"
        usado={gastado}
        cap={presupuesto}
        bloqueado={bloqueado}
        alerta={alerta}
      />
    </div>
  )
}

export function CupoDia({
  estado,
  titulo = "Cupos del día",
  variante = "completo",
  disponibilidad,
  excluir = [],
  mostrarPresupuesto = true,
  mostrarPie = true,
}: CupoDiaProps) {
  const excluidos = new Set<ProveedorConsumoCupo>(excluir)
  const filas = estado.proveedores.filter(
    (fila) => !excluidos.has(fila.proveedor),
  )

  const faltantes: string[] = []
  if (disponibilidad && !disponibilidad.places) {
    faltantes.push("Google Places: falta PROPUESTAS_PLACES_API_KEY.")
  }
  if (disponibilidad && !disponibilidad.resend) {
    faltantes.push("Resend: falta RESEND_API_KEY.")
  }
  if (disponibilidad && !disponibilidad.secreto) {
    faltantes.push("Supresión: falta PROPUESTAS_SECRETO.")
  }

  const compacto = variante === "compacto"
  const Titulo = compacto ? "h3" : "h2"

  return (
    <section
      aria-label={titulo}
      data-variante={variante}
      className="p-panel"
    >
      <div className="p-panel-head">
        <div className="p-panel-heading">
          <Titulo className="p-panel-title">{titulo}</Titulo>
          <p className="p-panel-description">
            Solo lectura ·{" "}
            <time dateTime={estado.fecha.toISOString()}>
              {formatearFechaPortal(estado.fecha)}
            </time>{" "}
            · total estimado:{" "}
            <span className="p-quota-total">
              {estado.totalCostoCentavos > 0
                ? formatearMonto(estado.totalCostoCentavos, "usd")
                : "sin costo estimado"}
            </span>
          </p>
        </div>
      </div>

      <div className="p-panel-body">
        {faltantes.length > 0 && (
          <div
            role="status"
            aria-label="Configuración de cupos"
            data-estado="NO_CONFIGURADO"
            className="p-banner p-banner--warn p-quota-alert"
          >
            <div className="p-banner-body">
              <p className="p-banner-title">
                Estado operativo: no configurado
              </p>
              <p className="p-quota-note">
                Faltan piezas para operar con cupos completos:
              </p>
              <ul className="p-quota-missing">
                {faltantes.map((motivo) => (
                  <li key={motivo}>{motivo}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {filas.length === 0 ? (
          <p role="status" className="p-quota-note">
            No hay proveedores para mostrar en este ámbito.
          </p>
        ) : (
          <ul className="p-quota-list">
            {filas.map((fila) => (
              <FilaCupoDia
                key={fila.proveedor}
                fila={fila}
                disponibilidad={disponibilidad}
              />
            ))}
          </ul>
        )}

        {mostrarPresupuesto && <PresupuestoMensual estado={estado} />}

        {mostrarPie && (
          <p className="p-quota-foot">
            No hay cola automática ni sobreconsumo: al 100% la acción se
            bloquea.{" "}
            <Link href="/propuestas/supresiones" className="p-quota-link">
              Ver supresiones
            </Link>
            .
          </p>
        )}
      </div>
    </section>
  )
}

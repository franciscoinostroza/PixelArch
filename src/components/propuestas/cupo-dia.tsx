import Link from "next/link"

import { formatearMonto } from "@/lib/pagos"
import type { ProveedorConsumoCupo } from "@/lib/propuestas/consumo"
import { formatearFechaPortal } from "@/lib/propuestas/fechas"

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

const CLASE_DEFINICION =
  "font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-faint"
const CLASE_TARJETA = "rounded-lg border border-border bg-bg/40 p-3"

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

function colorBarra(bloqueado: boolean, alerta: boolean): string {
  if (bloqueado) return "bg-red-400"
  if (alerta) return "bg-amber-400"
  return "bg-cyan"
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

  return (
    <div
      role="progressbar"
      aria-label={`Uso de ${etiqueta}`}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(usado, cap)}
      aria-valuetext={`${usado} de ${cap} usados`}
      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-bg/60"
    >
      <div
        className={`h-full rounded-full transition-[width] ${colorBarra(
          bloqueado,
          alerta,
        )}`}
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
  const motivo = motivoNoConfigurado(fila.proveedor, fila.cap, disponibilidad)

  if (motivo !== null) {
    return (
      <li
        data-estado="NO_CONFIGURADO"
        aria-label={`${etiqueta}: no configurado`}
        className={CLASE_TARJETA}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-text">{etiqueta}</p>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-amber-300">
            No configurado
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-text-dim">{motivo}</p>
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
  const claseEstado = bloqueado
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : fila.alerta
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : "border-mint/30 bg-mint/5 text-mint"

  return (
    <li
      data-estado={estado}
      aria-label={`${etiqueta}: ${fila.usado} de ${fila.cap} ${unidad}`}
      className={CLASE_TARJETA}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text">{etiqueta}</p>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] ${claseEstado}`}
        >
          {textoEstado}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className={CLASE_DEFINICION}>Usado hoy</dt>
          <dd className="mt-0.5 text-sm font-semibold text-text">
            {fila.usado} / {fila.cap}
          </dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>Restante</dt>
          <dd className="mt-0.5 text-sm text-text">{fila.restante}</dd>
        </div>
        <div>
          <dt className={CLASE_DEFINICION}>{unidad}</dt>
          <dd className="mt-0.5 text-sm text-text-dim">del día</dd>
        </div>
      </dl>

      <BarraCupo
        etiqueta={etiqueta}
        usado={fila.usado}
        cap={fila.cap}
        bloqueado={bloqueado}
        alerta={fila.alerta}
      />

      <p className="mt-2 text-xs leading-5 text-text-dim">
        Costo estimado:{" "}
        <span className="text-text">
          {fila.costoCentavos > 0
            ? formatearMonto(fila.costoCentavos, "usd")
            : "sin costo estimado"}
        </span>
      </p>
    </li>
  )
}

function PresupuestoMensual({ estado }: { estado: EstadoCupoDia }) {
  if (estado.presupuestoMensualCentavos <= 0) {
    return (
      <p className="mt-4 text-xs leading-5 text-text-dim">
        Sin presupuesto mensual configurado. El tope duro por proveedor/día
        sigue aplicando.
      </p>
    )
  }

  if (estado.gastadoMesCentavos === null) {
    return (
      <p className="mt-4 text-xs leading-5 text-text-dim">
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
  const claseEstado = bloqueado
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : alerta
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : "border-mint/30 bg-mint/5 text-mint"

  return (
    <div
      data-estado={estadoTexto}
      aria-label="Presupuesto mensual global"
      className={`mt-4 ${CLASE_TARJETA}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-text">
          Presupuesto mensual global
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] ${claseEstado}`}
        >
          {textoEstado}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-dim">
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
      className={
        compacto
          ? "rounded-xl border border-border bg-panel p-4"
          : "rounded-xl border border-border bg-panel p-5"
      }
    >
      <header>
        <Titulo className="font-display text-xl font-semibold text-text">
          {titulo}
        </Titulo>
        <p className="mt-1 text-xs leading-5 text-text-dim">
          Solo lectura ·{" "}
          <time dateTime={estado.fecha.toISOString()}>
            {formatearFechaPortal(estado.fecha)}
          </time>{" "}
          · total estimado:{" "}
          <span className="text-text">
            {estado.totalCostoCentavos > 0
              ? formatearMonto(estado.totalCostoCentavos, "usd")
              : "sin costo estimado"}
          </span>
        </p>
      </header>

      {faltantes.length > 0 && (
        <div
          role="status"
          aria-label="Configuración de cupos"
          data-estado="NO_CONFIGURADO"
          className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
        >
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-amber-300">
            Estado operativo: no configurado
          </p>
          <p className="mt-1 text-xs leading-5 text-text-dim">
            Faltan piezas para operar con cupos completos:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-text-dim">
            {faltantes.map((motivo) => (
              <li key={motivo}>{motivo}</li>
            ))}
          </ul>
        </div>
      )}

      {filas.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-dim">
          No hay proveedores para mostrar en este ámbito.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
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
        <p className="mt-4 text-xs leading-5 text-text-dim">
          No hay cola automática ni sobreconsumo: al 100% la acción se bloquea.{" "}
          <Link
            href="/propuestas/supresiones"
            className="underline underline-offset-4 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet"
          >
            Ver supresiones
          </Link>
          .
        </p>
      )}
    </section>
  )
}

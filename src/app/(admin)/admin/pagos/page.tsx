import { Pagination } from "@/components/ui/pagination"
import { PagosTabla, type PagoTablaFila } from "@/components/ui/pagos-tabla"
import type { AjustePaypalPago } from "@/components/ui/ajuste-paypal-button"
import type { RevisionPaypalPago } from "@/components/ui/revision-paypal-button"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { METODO_LABEL } from "@/lib/pagos"
import {
  esPagoAjustablePaypal,
  montoDisponibleAjuste,
} from "@/lib/paypal/ajuste-view"
import { esPagoRevisablePaypal } from "@/lib/paypal/revision-view"
import {
  ESTADOS_PAGO_HISTORIAL,
  PASARELAS_HISTORIAL,
  PASARELA_LABEL,
  mapearEstadoPagoVisible,
  mapearPagoHistorial,
  normalizarPasarela,
} from "@/lib/paypal/view"

const PER_PAGE = 20

const ESTADOS_FILTRO = ESTADOS_PAGO_HISTORIAL

/** `page` invalida, cero, negativa o no entera cae en la primera pagina. */
function numeroDePagina(valor: string | undefined): number {
  if (!valor) return 1
  const numero = Number(valor)
  return Number.isFinite(numero) && Number.isInteger(numero) && numero >= 1
    ? numero
    : 1
}

/** Ignora fechas invalidas para no enviar `Invalid Date` a Prisma. */
function fechaDeFiltro(
  valor: string | undefined,
  finDelDia = false
): Date | null {
  if (!valor) return null
  const fecha = new Date(finDelDia ? `${valor}T23:59:59` : valor)
  return Number.isFinite(fecha.getTime()) ? fecha : null
}

function pasarelaDesdeMetodo(
  metodo: string | null | undefined
): "PAYPAL" | "MERCADOPAGO" | null {
  if (metodo === "PAYPAL") return "PAYPAL"
  if (metodo === "MERCADOPAGO") return "MERCADOPAGO"
  return null
}

/**
 * `Pago.pasarela` manda; para datos historicos previos al backfill se usa el
 * metodo como respaldo, de modo que un pago PayPal viejo no se muestre como
 * manual. Nunca se inventa una pasarela para pagos sin metodo.
 */
function pasarelaDePago(pago: {
  pasarela?: string | null
  metodo?: string | null
}): string | null {
  if (pago.pasarela && pago.pasarela !== "MANUAL") return pago.pasarela
  return pasarelaDesdeMetodo(pago.metodo) ?? pago.pasarela ?? "MANUAL"
}

/** Une los eventos del pago y los de su link sin duplicar por id. */
function eventosRequiereAccion<T extends { id: string }>(pago: {
  eventos?: readonly T[] | null
  enlacePago?: { eventos?: readonly T[] | null } | null
}): T[] {
  const todos = [
    ...(pago.eventos ?? []),
    ...(pago.enlacePago?.eventos ?? []),
  ]
  return todos.filter(
    (evento, indice) =>
      todos.findIndex((otro) => otro.id === evento.id) === indice
  )
}

export default async function AdminPagos({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    estado?: string
    pasarela?: string
    desde?: string
    hasta?: string
  }>
}) {
  const staff = await requireStaff()
  if (!staff) redirect("/admin")

  const { page, estado, pasarela, desde, hasta } = await searchParams
  const currentPage = numeroDePagina(page)

  const where: Record<string, unknown> = {}
  if (
    estado &&
    (ESTADOS_FILTRO as readonly string[]).includes(estado)
  ) {
    where.estadoPago = estado
  }

  const pasarelaFiltro = normalizarPasarela(pasarela)
  if (pasarelaFiltro) where.pasarela = pasarelaFiltro

  const creadoDesde = fechaDeFiltro(desde)
  const creadoHasta = fechaDeFiltro(hasta, true)
  if (creadoDesde || creadoHasta) {
    where.creadoEn = {
      ...(creadoDesde ? { gte: creadoDesde } : {}),
      ...(creadoHasta ? { lte: creadoHasta } : {}),
    }
  }

  const [pagos, total] = await Promise.all([
    prisma.pago.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { creadoEn: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        cliente: { select: { nombre: true } },
        hito: {
          select: {
            titulo: true,
            proyecto: { select: { titulo: true } },
          },
        },
        suscripcion: { select: { servicio: { select: { nombre: true } } } },
        enlacePago: {
          select: {
            concepto: true,
            descripcion: true,
            externalId: true,
            generadoPorNombre: true,
            enviadoPor: true,
            enviadoEn: true,
            canalEnvio: true,
            idioma: true,
            eventos: {
              where: { requiereAccion: true },
              orderBy: { creadoEn: "desc" },
              select: {
                id: true,
                tipo: true,
                resultado: true,
                motivo: true,
                monto: true,
                moneda: true,
                creadoEn: true,
              },
            },
          },
        },
        ajustes: {
          orderBy: { creadoEn: "desc" },
          select: {
            id: true,
            tipo: true,
            monto: true,
            decision: true,
            motivo: true,
            creadoEn: true,
          },
        },
        eventos: {
          where: { requiereAccion: true },
          orderBy: { creadoEn: "desc" },
          select: {
            id: true,
            tipo: true,
            resultado: true,
            motivo: true,
            monto: true,
            moneda: true,
            creadoEn: true,
          },
        },
      },
    }),
    prisma.pago.count({ where: Object.keys(where).length ? where : undefined }),
  ])

  const totalPages = Math.ceil(total / PER_PAGE)

  const filas: PagoTablaFila[] = pagos.map((pago) => {
    const pasarela = pasarelaDePago(pago)
    const historial = mapearPagoHistorial({ ...pago, pasarela })
    const pagoAjuste: AjustePaypalPago = {
      id: pago.id,
      monto: pago.monto,
      moneda: pago.moneda,
      montoAjustado: (pago.ajustes ?? []).reduce(
        (total, ajuste) => total + ajuste.monto,
        0
      ),
      tieneHito: Boolean(pago.hitoId),
      tieneSoporte: Boolean(pago.suscripcionId),
      estadoPago: pago.estadoPago,
      revisionEstado: pago.revisionEstado,
      concepto: historial.concepto.titulo,
      referencia: historial.referencias.principal?.etiqueta ?? null,
      pasarela,
    }

    const pagoRevision: RevisionPaypalPago | null = esPagoRevisablePaypal({
      ...pago,
      pasarela,
    })
      ? {
          id: pago.id,
          monto: pago.monto,
          montoEsperado: pago.montoEsperado,
          montoAcordado: pago.montoAcordado,
          comision: pago.comision,
          moneda: pago.moneda,
          revisionNota: pago.revisionNota,
          revisionEstado: pago.revisionEstado,
          estadoPago: pago.estadoPago,
          pasarela,
          concepto: historial.concepto.titulo,
          referencia: historial.referencias.principal?.etiqueta ?? null,
          externalId: pago.externalId,
          paypalOrderId: pago.paypalOrderId,
          tieneHito: Boolean(pago.hitoId),
          tieneSoporte: Boolean(pago.suscripcionId),
          meses: pago.meses,
        }
      : null

    return {
      id: pago.id,
      historial,
      clienteNombre: pago.cliente?.nombre ?? null,
      metodoEtiqueta: pago.metodo
        ? METODO_LABEL[pago.metodo] ?? pago.metodo
        : null,
      ajustes: pago.ajustes,
      eventos: eventosRequiereAccion(pago),
      ajuste:
        esPagoAjustablePaypal(pagoAjuste) &&
        montoDisponibleAjuste(pagoAjuste) > 0
          ? pagoAjuste
          : null,
      revision: pagoRevision,
    }
  })

  const queryString = (pageNum: number) => {
    const params = new URLSearchParams()
    params.set("page", String(pageNum))
    if (estado) params.set("estado", estado)
    if (pasarelaFiltro) params.set("pasarela", pasarelaFiltro)
    if (desde) params.set("desde", desde)
    if (hasta) params.set("hasta", hasta)
    return params.toString()
  }

  return (
    <div>
      <div className="a-greet">
        <h1>Pagos</h1>
        <p>Historial completo de transacciones por pasarela.</p>
      </div>

      <div className="a-filters">
        <form style={{ display: "contents" }}>
          <select
            name="pasarela"
            defaultValue={pasarelaFiltro ?? ""}
            className="a-field"
            aria-label="Pasarela"
          >
            <option value="">Todas las pasarelas</option>
            {PASARELAS_HISTORIAL.map((valor) => (
              <option key={valor} value={valor}>
                {PASARELA_LABEL[valor]}
              </option>
            ))}
          </select>
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="a-field"
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            {ESTADOS_FILTRO.map((valor) => (
              <option key={valor} value={valor}>
                {mapearEstadoPagoVisible(valor).etiqueta}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="desde"
            defaultValue={desde ?? ""}
            className="a-field"
            title="Desde"
          />
          <input
            type="date"
            name="hasta"
            defaultValue={hasta ?? ""}
            className="a-field"
            title="Hasta"
          />
          <button type="submit" className="a-btn solid">
            Filtrar
          </button>
          {(estado || pasarelaFiltro || desde || hasta) && (
            <Link href="/admin/pagos" className="a-btn ghost">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      <div className="a-panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Transacciones</h3>
          <span className="a-faint">{total} resultados</span>
        </div>
        <PagosTabla
          filas={filas}
          puedeAjustar={staff.esAdmin}
          puedeResolverRevision={staff.esAdmin}
        />
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildHref={(p) => `/admin/pagos?${queryString(p)}`}
      />
    </div>
  )
}

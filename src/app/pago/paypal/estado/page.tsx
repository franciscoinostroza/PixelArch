import type { Metadata } from "next"
import Link from "next/link"
import { unstable_noStore as noStore } from "next/cache"
import { AlertTriangle, CheckCircle2, Clock3, XCircle } from "lucide-react"
import type { EstadoEnlace } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { formatearMonto } from "@/lib/pagos"
import {
  resolverEstadoPublicoEnlace,
  type EstadoPublicoPaypal,
} from "@/lib/paypal/utils"

/**
 * Pagina publica de estado de un link PayPal (T-14, parte A).
 *
 * Muestra solo el estado, el concepto y el monto USD del link. No consulta ni
 * renderiza datos del cliente/pagador. Tanto el token como el estado llegan
 * por query string; el token es opaco y no se registra en logs.
 */

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Estado del pago — PixelArch",
  description: "Estado de tu link de pago de PayPal.",
  robots: { index: false, follow: false, nocache: true },
  // La pagina lleva el token opaco en el query string: no debe filtrarse por
  // Referer hacia terceros.
  referrer: "no-referrer",
}

type EstadoPublico = EstadoPublicoPaypal

/** `revision` nunca se acepta por query: solo lo determina la base. */
type EstadoQuery = Exclude<EstadoPublico, "revision">

const ESTADOS_QUERY: readonly EstadoQuery[] = [
  "pendiente",
  "pagado",
  "vencido",
  "invalidado",
  "error",
]

const ESTADOS = {
  pendiente: {
    titulo: "Pago pendiente",
    detalle: "El link es valido. Completa el pago desde el checkout de PayPal.",
    Icono: Clock3,
    color: "text-violet-300",
  },
  pagado: {
    titulo: "Pago acreditado",
    detalle: "Recibimos tu pago. No es necesario volver a pagar.",
    Icono: CheckCircle2,
    color: "text-emerald-400",
  },
  revision: {
    titulo: "Pago en revision",
    detalle: "Estamos revisando el pago. No es necesario volver a pagar.",
    Icono: Clock3,
    color: "text-amber-300",
  },
  vencido: {
    titulo: "Link vencido",
    detalle: "Este link de pago ya vencio. Pedi uno nuevo a PixelArch.",
    Icono: Clock3,
    color: "text-amber-300",
  },
  invalidado: {
    titulo: "Link no valido",
    detalle: "El link no existe o fue invalidado. Pedi uno nuevo a PixelArch.",
    Icono: XCircle,
    color: "text-red-400",
  },
  error: {
    titulo: "No pudimos procesar el pago",
    detalle:
      "PayPal no esta disponible en este momento. Intenta de nuevo mas tarde o escribinos.",
    Icono: AlertTriangle,
    color: "text-amber-300",
  },
} satisfies Record<
  EstadoPublico,
  { titulo: string; detalle: string; Icono: typeof Clock3; color: string }
>

interface EnlacePublico {
  pasarela: string
  concepto: string
  total: number
  moneda: string
  estado: EstadoEnlace
  expiraEn: Date
  hitoId: string | null
  suscripcionId: string | null
  hito: { estado: string } | null
  suscripcion: { estado: string; plan: string } | null
  pagos: { estadoPago: string }[]
}

function esEstadoQuery(valor: unknown): valor is EstadoQuery {
  return (
    typeof valor === "string" &&
    (ESTADOS_QUERY as readonly string[]).includes(valor)
  )
}

function estadoDeEnlace(enlace: EnlacePublico): EstadoPublico {
  // Misma regla que `[token]`: no alcanza con el estado del link. Un hito ya
  // pagado o un soporte no elegible no deben mostrarse como pendientes; un
  // pago en revision siempre gana sobre un link PAGADO.
  return resolverEstadoPublicoEnlace(enlace, {
    pagoEnRevision: enlace.pagos.length > 0,
  })
}

function tokenValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(token)
}

export default async function EstadoPagoPaypalPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; estado?: string }>
}) {
  noStore()

  const { token: tokenRaw, estado: estadoRaw } = await searchParams
  const token = typeof tokenRaw === "string" ? tokenRaw.trim() : ""
  const estadoQuery = esEstadoQuery(estadoRaw) ? estadoRaw : null

  let enlace: EnlacePublico | null = null
  let huboError = false

  if (token.length > 0 && tokenValido(token)) {
    try {
      enlace = await prisma.enlacePago.findUnique({
        where: { token },
        select: {
          pasarela: true,
          concepto: true,
          total: true,
          moneda: true,
          estado: true,
          expiraEn: true,
          hitoId: true,
          suscripcionId: true,
          hito: { select: { estado: true } },
          suscripcion: { select: { estado: true, plan: true } },
          pagos: {
            where: { estadoPago: "REVISION" },
            select: { estadoPago: true },
            take: 1,
          },
        },
      })
    } catch {
      huboError = true
    }
  }

  let estado: EstadoPublico
  if (huboError) {
    estado = "error"
  } else if (enlace && enlace.pasarela === "PAYPAL") {
    estado = estadoDeEnlace(enlace)
    // El redirect del link puede informar un fallo de configuracion/orden que
    // la base todavia no refleja.
    if (estadoQuery === "error") estado = "error"
  } else {
    estado = estadoQuery === "error" ? "error" : "invalidado"
  }

  const datos = ESTADOS[estado]
  const enlaceVisible = enlace && enlace.pasarela === "PAYPAL" ? enlace : null
  const montoVisible =
    enlaceVisible && enlaceVisible.moneda.toLowerCase() === "usd"
  const { Icono } = datos

  return (
    <section
      style={{
        position: "relative",
        zIndex: 1,
        overflow: "hidden",
        padding: "clamp(88px, 10vw, 132px) 0",
      }}
    >
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="mx-auto max-w-xl px-6">
        <div className="rounded-xl border border-border bg-panel p-10 text-center">
          <div className="flex items-center justify-center">
            <Icono
              className={`h-16 w-16 ${datos.color}`}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>

          <h1 className="mt-6 text-3xl font-bold text-text font-display md:text-4xl">
            {datos.titulo}
          </h1>

          <p className="mt-4 text-text-dim font-mono" role="status" aria-live="polite">
            {datos.detalle}
          </p>

          {enlaceVisible ? (
            <dl className="mt-8 space-y-3 rounded-lg border border-border bg-bg-soft/60 p-5 text-left">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-sm text-text-dim font-mono">Concepto</dt>
                <dd className="text-sm font-medium text-text text-right">
                  {enlaceVisible.concepto}
                </dd>
              </div>
              {montoVisible ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-text-dim font-mono">Total</dt>
                  <dd className="text-lg font-bold text-text">
                    {formatearMonto(enlaceVisible.total, "usd")}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <Link
            href="/"
            className="mt-8 inline-flex items-center justify-center rounded-lg border border-border px-5 py-3 text-sm font-medium text-text transition-colors hover:border-border-hover hover:text-text"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </section>
  )
}

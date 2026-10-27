import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

/**
 * T-23 (AC-11, AC-12, AC-19, AC-24): `/admin/pagos` con filtro por pasarela,
 * desglose PayPal/MP y acceso a eventos/recibos.
 *
 * Prisma y Clerk se mockean: el test solo verifica la consulta, el filtro
 * (preservando paginacion) y la tabla que consume `view.ts`.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pago: {
      findMany: mocks.findMany,
      count: mocks.count,
    },
  },
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/components/ui/ajuste-paypal-button", () => ({
  AjustePaypalButton: (props: { pago: { id: string } }) => (
    <button type="button" data-testid={`ajuste-${props.pago.id}`}>
      Ajuste
    </button>
  ),
}))

// `redirect` de Next corta la ejecucion lanzando; replicarlo evita que la
// pagina continue tras redirigir en los tests de autorizacion.
mocks.redirect.mockImplementation((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

import AdminPagos from "@/app/(admin)/admin/pagos/page"

const FECHA = new Date("2026-10-20T12:00:00.000Z")
const RECIBO = "PAY-20261020-ABCDEF123456"

const PAGO_PAYPAL = {
  id: "pago_paypal",
  cliente: { nombre: "Cliente Demo" },
  hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
  suscripcion: null,
  enlacePago: {
    concepto: "Sitio ACME — Anticipo",
    descripcion: "Anticipo 50%",
    externalId: "ORDER-1",
    generadoPorNombre: "Ana Admin",
    enviadoPor: "ana",
    enviadoEn: FECHA,
    canalEnvio: "EMAIL",
    idioma: "es",
    eventos: [
      {
        id: "evento_duplicado",
        tipo: "PAYMENT.CAPTURE.DUPLICATED",
        resultado: "DUPLICADO",
        motivo: null,
        monto: null,
        moneda: null,
        creadoEn: FECHA,
      },
    ],
  },
  ajustes: [
    {
      id: "ajuste_1",
      tipo: "REEMBOLSO",
      monto: 10656,
      decision: "NINGUNA",
      motivo: "Solicitado por el cliente",
      creadoEn: FECHA,
    },
  ],
  eventos: [
    {
      id: "evento_refund",
      tipo: "PAYMENT.CAPTURE.REFUNDED",
      resultado: "REQUIERE_ACCION",
      motivo: null,
      monto: 10656,
      moneda: "usd",
      creadoEn: FECHA,
    },
  ],
  monto: 10656,
  montoAcordado: 10050,
  comision: 606,
  montoEsperado: 10656,
  moneda: "usd",
  metodo: "PAYPAL",
  pasarela: "PAYPAL",
  origen: "AUTOMATICO",
  externalId: "CAPTURE-1",
  paypalOrderId: "ORDER-1",
  reciboId: RECIBO,
  reciboEmitidoEn: FECHA,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  creadoEn: FECHA,
}

const PAGO_MP = {
  id: "pago_mp",
  cliente: { nombre: "Cliente Demo" },
  hito: null,
  suscripcion: null,
  enlacePago: {
    concepto: "Soporte octubre",
    descripcion: null,
    externalId: "PREF-1",
    generadoPorNombre: null,
    enviadoPor: null,
    enviadoEn: null,
    canalEnvio: null,
    idioma: null,
    eventos: [],
  },
  ajustes: [],
  eventos: [],
  monto: 500000,
  montoAcordado: 500000,
  comision: 0,
  montoEsperado: 500000,
  moneda: "ars",
  metodo: "MERCADOPAGO",
  pasarela: "MERCADOPAGO",
  origen: "AUTOMATICO",
  externalId: "MP-123",
  paypalOrderId: null,
  reciboId: null,
  reciboEmitidoEn: null,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  creadoEn: FECHA,
}

function staff() {
  return {
    userId: "user_1",
    nombre: "Asistente",
    rol: "asistente",
    esAdmin: false,
    cliente: null,
  }
}

async function renderPage(params: Record<string, string> = {}) {
  return render(
    await AdminPagos({ searchParams: Promise.resolve(params) })
  )
}

describe("/admin/pagos: PayPal (T-23)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireStaff.mockResolvedValue(staff())
    mocks.findMany.mockResolvedValue([PAGO_PAYPAL, PAGO_MP])
    mocks.count.mockResolvedValue(2)
  })

  it("incluye enlace, ajustes y eventos que requieren accion en la consulta", async () => {
    await renderPage()

    const consulta = mocks.findMany.mock.calls[0][0]
    expect(consulta.include.enlacePago.select.concepto).toBe(true)
    expect(consulta.include.enlacePago.select.generadoPorNombre).toBe(true)
    expect(
      consulta.include.enlacePago.select.eventos.where
    ).toEqual({ requiereAccion: true })
    expect(consulta.include.ajustes.select.tipo).toBe(true)
    expect(consulta.include.eventos.where).toEqual({ requiereAccion: true })
    expect(consulta.include.hito.select.proyecto.select.titulo).toBe(true)
  })

  it("filtra por pasarela desde searchParams y conserva la paginacion", async () => {
    mocks.count.mockResolvedValue(45)

    await renderPage({ pasarela: "PAYPAL" })

    expect(mocks.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ pasarela: "PAYPAL" })
    )
    expect(screen.getByLabelText("Pasarela")).toHaveValue("PAYPAL")

    const siguiente = screen.getByRole("link", { name: /siguiente/i })
    expect(siguiente).toHaveAttribute(
      "href",
      expect.stringContaining("pasarela=PAYPAL")
    )
    expect(siguiente).toHaveAttribute(
      "href",
      expect.stringContaining("page=2")
    )
  })

  it("muestra columnas de desglose, referencia, moneda y recibo de PayPal", async () => {
    await renderPage()

    for (const columna of [
      "Concepto",
      "Fecha",
      "Referencia",
      "Monto acordado",
      "Comisión",
      "Total",
      "Moneda",
      "Estado",
      "Revisión / ajustes",
      "Recibo",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: columna })
      ).toBeInTheDocument()
    }

    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("Capture CAPTURE-1")).toBeInTheDocument()
    expect(screen.getByText("Orden ORDER-1")).toBeInTheDocument()
    expect(screen.getByText("US$100,50")).toBeInTheDocument()
    expect(screen.getByText("US$6,06")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
    expect(screen.getAllByText("USD").length).toBeGreaterThan(0)
    expect(
      within(screen.getByTestId("pago-pago_paypal")).getByText("Pagado")
    ).toBeInTheDocument()

    const recibo = screen.getByRole("link", { name: /ver recibo/i })
    expect(recibo).toHaveAttribute("href", "/admin/pagos/pago_paypal/recibo")
  })

  it("distingue PayPal de Mercado Pago sin repetir la pasarela como método (AC-11)", async () => {
    await renderPage()

    const filaPaypal = within(screen.getByTestId("pago-pago_paypal"))
    const filaMp = within(screen.getByTestId("pago-pago_mp"))

    expect(
      filaPaypal.getByText(/PayPal · Automático · Cliente Demo/)
    ).toBeInTheDocument()
    expect(
      filaMp.getByText(/Mercado Pago · Automático · Cliente Demo/)
    ).toBeInTheDocument()
    expect(screen.queryByText("· PayPal")).not.toBeInTheDocument()
    expect(screen.queryByText("· Mercado Pago")).not.toBeInTheDocument()

    expect(screen.getAllByRole("link", { name: /ver recibo/i })).toHaveLength(1)
  })

  it("expone ajustes y eventos que requieren accion", async () => {
    await renderPage()

    expect(
      screen.getByText(/Reembolso US\$106,56 · sin cambio/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Requiere acción: Reembolso, Duplicado/)
    ).toBeInTheDocument()
  })

  it("muestra revisión pendiente y diferencia de monto", async () => {
    mocks.findMany.mockResolvedValue([
      {
        ...PAGO_PAYPAL,
        estadoPago: "REVISION",
        revisionEstado: "PENDIENTE",
        monto: 10000,
        montoEsperado: 10656,
      },
    ])

    await renderPage()

    const fila = within(screen.getByTestId("pago-pago_paypal"))
    expect(fila.getByText("En revisión")).toBeInTheDocument()
    expect(fila.getByText("Revisión: Pendiente")).toBeInTheDocument()
    expect(
      screen.getByText(/Esperado US\$106,56 · diferencia -US\$6,56/)
    ).toBeInTheDocument()
  })

  it("respeta la pagina solicitada y conserva el filtro en los enlaces (AC-11)", async () => {
    mocks.count.mockResolvedValue(60)

    await renderPage({ pasarela: "PAYPAL", page: "2" })

    const consulta = mocks.findMany.mock.calls[0][0]
    expect(consulta.where).toEqual({ pasarela: "PAYPAL" })
    expect(consulta.skip).toBe(20)
    expect(consulta.take).toBe(20)
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /anterior/i })
    ).toHaveAttribute("href", "/admin/pagos?page=1&pasarela=PAYPAL")
    expect(
      screen.getByRole("link", { name: /siguiente/i })
    ).toHaveAttribute("href", "/admin/pagos?page=3&pasarela=PAYPAL")
  })

  it("ignora una pasarela desconocida y no filtra (AC-11)", async () => {
    await renderPage({ pasarela: "STRIPE" })

    expect(mocks.findMany.mock.calls[0][0].where).toBeUndefined()
    expect(screen.getByLabelText("Pasarela")).toHaveValue("")
  })

  it("muestra la fecha del pago en la fila (AC-11)", async () => {
    await renderPage()

    const fecha = new Intl.DateTimeFormat("es-AR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(FECHA)

    expect(
      screen.getByRole("columnheader", { name: "Fecha" })
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId("pago-pago_paypal")).getByText(fecha)
    ).toBeInTheDocument()
  })

  it("muestra — cuando el pago no tiene fecha (AC-11)", async () => {
    mocks.findMany.mockResolvedValue([{ ...PAGO_PAYPAL, creadoEn: null }])

    await renderPage()

    expect(
      within(screen.getByTestId("pago-pago_paypal")).getAllByText("—")
    ).toHaveLength(1)
  })

  it("ignora una pagina y fechas invalidas (AC-11)", async () => {
    await renderPage({
      page: "abc",
      desde: "no-es-fecha",
      hasta: "2026-13-45",
    })

    const consulta = mocks.findMany.mock.calls[0][0]
    expect(consulta.skip).toBe(0)
    expect(consulta.where).toBeUndefined()
  })

  it("no enlaza el recibo de un pago PayPal sin recibo emitido (AC-11, AC-24)", async () => {
    mocks.findMany.mockResolvedValue([
      { ...PAGO_PAYPAL, reciboId: null, reciboEmitidoEn: null },
    ])

    await renderPage()

    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("no duplica el mismo evento que requiere accion (AC-11, AC-12)", async () => {
    const evento = PAGO_PAYPAL.eventos[0]
    mocks.findMany.mockResolvedValue([
      {
        ...PAGO_PAYPAL,
        eventos: [evento],
        enlacePago: { ...PAGO_PAYPAL.enlacePago, eventos: [evento] },
      },
    ])

    await renderPage()

    expect(
      screen.getAllByText(/Requiere acción: Reembolso/)
    ).toHaveLength(1)
  })

  it("no expone email ni telefono del cliente en la tabla (AC-19)", async () => {
    mocks.findMany.mockResolvedValue([
      {
        ...PAGO_PAYPAL,
        cliente: {
          nombre: "Cliente Demo",
          email: "cliente@example.com",
          telefono: "+54 9 11 5555-0000",
        },
      },
    ])

    await renderPage()

    expect(screen.getByText(/Cliente Demo/)).toBeInTheDocument()
    expect(screen.queryByText("cliente@example.com")).not.toBeInTheDocument()
    expect(screen.queryByText("+54 9 11 5555-0000")).not.toBeInTheDocument()
  })

  it("solo el admin ve la accion de reembolso/contracargo (T-26, AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue({
      userId: "user_1",
      nombre: "Admin",
      rol: "admin",
      esAdmin: true,
      cliente: null,
    })
    mocks.findMany.mockResolvedValue([
      {
        ...PAGO_PAYPAL,
        ajustes: [],
        hitoId: "hito_1",
        suscripcionId: null,
      },
    ])
    mocks.count.mockResolvedValue(1)

    await renderPage()

    expect(
      screen.getByRole("columnheader", { name: "Acciones" })
    ).toBeInTheDocument()
    expect(screen.getByTestId("ajuste-pago_paypal")).toBeInTheDocument()
  })

  it("no muestra la accion de ajuste a la asistente (T-26, AC-17)", async () => {
    await renderPage()

    expect(
      screen.queryByRole("columnheader", { name: "Acciones" })
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^ajuste-/)).not.toBeInTheDocument()
  })

  it("redirige al gate si no hay staff autenticado (AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(renderPage()).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.redirect).toHaveBeenCalledWith("/admin")
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})

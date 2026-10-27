import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * T-22 (AC-4, AC-15, AC-23): `/admin/cobros` integra PayPal para hitos y
 * soportes pendientes, muestra link vigente / ultimo intento y permite que la
 * asistente envie o regenere sin cambiar el estado del cobro. El resto de las
 * acciones del cobro sigue siendo admin-only (T-02).
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  hitoFindMany: vi.fn(),
  suscripcionFindMany: vi.fn(),
  hitoUpdate: vi.fn(),
  suscripcionUpdate: vi.fn(),
  getDolar: vi.fn(),
  paypalConfig: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hito: { findMany: mocks.hitoFindMany, update: mocks.hitoUpdate },
    suscripcion: {
      findMany: mocks.suscripcionFindMany,
      update: mocks.suscripcionUpdate,
    },
  },
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}))

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: mocks.getDolar,
}))

vi.mock("@/lib/paypal/config", () => ({
  paypalConfig: mocks.paypalConfig,
}))

vi.mock("@/components/ui/registrar-pago-button", () => ({
  RegistrarPagoButton: () => <button type="button">Registrar pago soporte</button>,
}))
vi.mock("@/components/ui/registrar-pago-hito-button", () => ({
  RegistrarPagoHitoButton: () => <button type="button">Registrar pago hito</button>,
}))
vi.mock("@/components/ui/generar-link-mp-button", () => ({
  GenerarLinkMpButton: () => <button type="button">Link MP soporte</button>,
}))
vi.mock("@/components/ui/generar-link-hito-button", () => ({
  GenerarLinkHitoButton: () => <button type="button">Link MP hito</button>,
}))
vi.mock("@/components/ui/recordar-email-button", () => ({
  RecordarEmailButton: () => <button type="button">Recordar email</button>,
}))
vi.mock("@/components/ui/subscription-actions", () => ({
  SubscriptionActions: () => <button type="button">Acciones soporte</button>,
}))
vi.mock("@/components/ui/marcar-hito-button", () => ({
  MarcarHitoButton: () => <button type="button">Marcar hito</button>,
}))

vi.mock("@/components/ui/registrar-pago-paypal-button", () => ({
  RegistrarPagoPaypalButton: (props: {
    conceptos: {
      tipo: string
      hitoId?: string
      suscripcionId?: string
    }[]
    puedeRegistrarManual: boolean
  }) => {
    if (!props.puedeRegistrarManual) return null
    const concepto = props.conceptos[0]
    const id = concepto?.hitoId ?? concepto?.suscripcionId ?? ""
    return (
      <button
        type="button"
        data-testid={`paypal-manual-${concepto?.tipo ?? "sin"}-${id}`}
      >
        Registrar pago PayPal
      </button>
    )
  },
}))

vi.mock("@/components/ui/generar-link-paypal-button", () => ({
  GenerarLinkPaypalButton: (props: {
    concepto:
      | { tipo: "hito"; hitoId: string }
      | { tipo: "soporte"; suscripcionId: string }
    enlaceExistente?: { enlaceId: string } | null
    ultimoIntento?: { estado: string } | null
    feeBps: number
    feeFixedCents: number
    paypalDisponible: boolean
    montoMensualCents?: number | null
    mesesDefault?: number
    ariaLabel?: string
  }) => {
    const id =
      props.concepto.tipo === "hito"
        ? props.concepto.hitoId
        : props.concepto.suscripcionId
    return (
      <div
        data-testid={`paypal-${props.concepto.tipo}-${id}`}
        data-enlace={props.enlaceExistente?.enlaceId ?? ""}
        data-ultimo={props.ultimoIntento?.estado ?? ""}
        data-fee={`${props.feeBps}/${props.feeFixedCents}`}
        data-disponible={String(props.paypalDisponible)}
        data-monto-mensual={String(props.montoMensualCents ?? "")}
        data-meses={String(props.mesesDefault ?? "")}
        aria-label={props.ariaLabel}
      />
    )
  },
}))

import AdminCobros from "@/app/(admin)/admin/cobros/page"

const FUTURO = new Date(Date.now() + 15 * 86400000)
const PASADO = new Date(Date.now() - 5 * 86400000)

const ENLACE_ACTIVO = {
  id: "enlace_activo",
  url: "https://pixelarch.dev/pago/paypal/activo",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: FUTURO,
  estado: "ACTIVO",
  meses: 1,
  idioma: "es",
  creadoEn: PASADO,
}

const ENLACE_FALLIDO = {
  id: "enlace_fallido",
  url: "https://pixelarch.dev/pago/paypal/fallido",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: PASADO,
  estado: "FALLIDO",
  meses: 1,
  idioma: "es",
  creadoEn: PASADO,
  ultimoError: "PayPal no pudo crear el checkout.",
}

function hitoDemo(overrides: Record<string, unknown> = {}) {
  return {
    id: "hito_activo",
    proyectoId: "proyecto_1",
    orden: 1,
    titulo: "Anticipo",
    monto: 10050,
    estado: "PENDIENTE",
    vencimiento: null,
    pagadoEn: null,
    mpLink: null,
    mpLinkPreferenceId: null,
    mpLinkExpira: null,
    clienteId: "cliente_1",
    ...overrides,
  }
}

const HITOS = [
  {
    ...hitoDemo(),
    proyecto: {
      id: "proyecto_1",
      titulo: "Sitio corporativo",
      clienteId: "cliente_1",
      cliente: { id: "cliente_1", nombre: "Cliente Demo", telefono: "+54 9 11 1234-5678" },
      servicio: { nombre: "Web" },
    },
    enlacesPago: [ENLACE_ACTIVO],
  },
  {
    ...hitoDemo({
      id: "hito_fallido",
      orden: 2,
      titulo: "Avance",
      vencimiento: PASADO,
    }),
    proyecto: {
      id: "proyecto_1",
      titulo: "Sitio corporativo",
      clienteId: "cliente_1",
      cliente: { id: "cliente_1", nombre: "Cliente Demo", telefono: null },
      servicio: { nombre: "Web" },
    },
    enlacesPago: [ENLACE_FALLIDO],
  },
]

const SERVICIO = {
  id: "serv_1",
  nombre: "Soporte Web",
  precioUnico: 0,
  precioBasico: 5000,
  precioMantenimiento: 10000,
}

const SOPORTES = [
  {
    id: "sop_activo",
    clienteId: "cliente_1",
    servicioId: "serv_1",
    plan: "SOPORTE",
    estado: "ACTIVE",
    precioCustom: null,
    proximoPago: PASADO,
    ultimoRecordatorioEn: null,
    mpLink: null,
    mpLinkExpira: null,
    mpLinkMeses: 2,
    deploymentPlatform: null,
    platformServiceId: null,
    cliente: { id: "cliente_1", nombre: "Cliente Demo", telefono: "+54 9 11 1234-5678" },
    servicio: SERVICIO,
    enlacesPago: [ENLACE_FALLIDO],
  },
  {
    id: "sop_basico",
    clienteId: "cliente_1",
    servicioId: "serv_1",
    plan: "BASICO",
    estado: "ACTIVE",
    precioCustom: null,
    proximoPago: FUTURO,
    ultimoRecordatorioEn: null,
    mpLink: null,
    mpLinkExpira: null,
    mpLinkMeses: null,
    deploymentPlatform: null,
    platformServiceId: null,
    cliente: { id: "cliente_1", nombre: "Cliente Demo", telefono: null },
    servicio: SERVICIO,
    enlacesPago: [],
  },
]

function staff(esAdmin: boolean) {
  return {
    userId: "user_1",
    nombre: esAdmin ? "Admin" : "Asistente",
    rol: esAdmin ? "admin" : "asistente",
    esAdmin,
    cliente: null,
  }
}

async function renderPage() {
  return render(await AdminCobros())
}

describe("Cobros: PayPal (T-22)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireStaff.mockResolvedValue(staff(true))
    mocks.hitoFindMany.mockResolvedValue(HITOS)
    mocks.suscripcionFindMany.mockResolvedValue(SOPORTES)
    mocks.getDolar.mockResolvedValue(null)
    mocks.paypalConfig.mockReturnValue({
      disponible: true,
      motivo: null,
      env: "sandbox",
      baseUrl: "https://api-m.sandbox.paypal.com",
      clientId: "client",
      clientSecret: "secret",
      webhookId: "webhook",
      fee: { bps: 540, fixedCents: 30 },
    })
  })

  it("incluye enlacesPago PAYPAL en las consultas de cobros", async () => {
    await renderPage()

    expect(mocks.hitoFindMany.mock.calls[0][0].include.enlacesPago).toEqual(
      expect.objectContaining({ where: { pasarela: "PAYPAL" } })
    )
    expect(
      mocks.suscripcionFindMany.mock.calls[0][0].include.enlacesPago
    ).toEqual(expect.objectContaining({ where: { pasarela: "PAYPAL" } }))
  })

  it("ofrece PayPal en hitos pendientes y soportes elegibles con config/fee", async () => {
    await renderPage()

    const hito = screen.getByTestId("paypal-hito-hito_activo")
    expect(hito).toHaveAttribute("data-enlace", "enlace_activo")
    expect(hito).toHaveAttribute("data-fee", "540/30")
    expect(hito).toHaveAttribute("data-disponible", "true")
    // AC-23: cada boton PayPal anuncia su concepto (proyecto + hito).
    expect(hito).toHaveAttribute(
      "aria-label",
      "PayPal — Sitio corporativo: Anticipo"
    )

    const soporte = screen.getByTestId("paypal-soporte-sop_activo")
    expect(soporte).toHaveAttribute("data-ultimo", "FALLIDO")
    expect(soporte).toHaveAttribute("data-fee", "540/30")
    expect(soporte).toHaveAttribute("data-monto-mensual", "10000")
    expect(soporte).toHaveAttribute("data-meses", "2")
    expect(soporte).toHaveAttribute(
      "aria-label",
      "PayPal — Soporte Soporte Web (Cliente Demo)"
    )

    // T-25: el admin tambien puede registrar el pago a mano, por hito y por
    // soporte elegible. El soporte BASICO no se ofrece.
    expect(
      screen.getByTestId("paypal-manual-hito-hito_activo")
    ).toBeInTheDocument()
    expect(
      screen.getByTestId("paypal-manual-soporte-sop_activo")
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId("paypal-manual-soporte-sop_basico")
    ).not.toBeInTheDocument()
  })

  it("muestra link vigente / vencimiento y el ultimo intento fallido", async () => {
    await renderPage()

    expect(screen.getByText(/Link PayPal vigente · vence/)).toBeInTheDocument()
    expect(
      screen.getAllByText(/PayPal: último intento fallido · /).length
    ).toBeGreaterThan(0)
  })

  it("no ofrece PayPal a un soporte que no es plan SOPORTE", async () => {
    await renderPage()

    expect(
      screen.queryByTestId("paypal-soporte-sop_basico")
    ).not.toBeInTheDocument()
  })

  it("la asistente puede operar PayPal y no ve las acciones admin-only", async () => {
    mocks.requireStaff.mockResolvedValue(staff(false))

    await renderPage()

    expect(
      screen.getByTestId("paypal-hito-hito_activo")
    ).toBeInTheDocument()
    expect(
      screen.getByTestId("paypal-soporte-sop_activo")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Registrar pago hito" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Marcar hito" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Recordar email" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Registrar pago soporte" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Acciones soporte" })
    ).not.toBeInTheDocument()
    // T-25: el registro manual PayPal es solo admin.
    expect(screen.queryAllByTestId(/^paypal-manual-/)).toHaveLength(0)
  })

  it("renderizar cobros no cambia el estado de hitos ni soportes", async () => {
    await renderPage()

    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
  })

  it("refleja PayPal no disponible sin romper el cobro", async () => {
    mocks.paypalConfig.mockReturnValue({
      disponible: false,
      motivo: "PayPal no disponible: configuracion incompleta.",
      env: null,
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      webhookId: null,
      fee: { bps: 540, fixedCents: 30 },
    })

    await renderPage()

    expect(screen.getByTestId("paypal-hito-hito_activo")).toHaveAttribute(
      "data-disponible",
      "false"
    )
    // El cobro sigue visible y el boton PayPal no reemplaza las acciones.
    expect(screen.getByText(/Hitos pendientes:/)).toBeInTheDocument()
  })
})

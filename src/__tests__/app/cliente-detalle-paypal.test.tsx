import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * T-21 (AC-1, AC-2, AC-12, AC-26): integracion del detalle del cliente con
 * PayPal. Verifica que la consulta incluya los `EnlacePago` PAYPAL del grupo,
 * que la configuracion server-side llegue al bloque de proyecto y al boton de
 * soporte, y que la asistente opere PayPal mientras las acciones de gestion
 * siguen siendo admin-only (T-21/T-02, AC-17).
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  clienteFindUnique: vi.fn(),
  servicioFindMany: vi.fn(),
  getDolar: vi.fn(),
  paypalConfig: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliente: { findUnique: mocks.clienteFindUnique },
    servicio: { findMany: mocks.servicioFindMany },
  },
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: mocks.getDolar,
}))

vi.mock("@/lib/paypal/config", () => ({
  paypalConfig: mocks.paypalConfig,
}))

vi.mock("@/components/ui/deploy-config", () => ({ DeployConfig: () => null }))
vi.mock("@/components/ui/entregar-button", () => ({ EntregarButton: () => null }))
vi.mock("@/components/ui/subscription-actions", () => ({
  SubscriptionActions: () => <button type="button">Acciones de soporte</button>,
}))
vi.mock("@/components/ui/asignar-producto-button", () => ({ AsignarProductoButton: () => null }))
vi.mock("@/components/ui/editar-cliente-button", () => ({ EditarClienteButton: () => null }))
vi.mock("@/components/ui/nuevo-proyecto-button", () => ({ NuevoProyectoButton: () => null }))
vi.mock("@/components/ui/activar-soporte-button", () => ({
  ActivarSoporteButton: () => <button type="button">Activar soporte</button>,
}))
vi.mock("@/components/ui/registrar-pago-button", () => ({
  RegistrarPagoButton: () => <button type="button">Registrar pago soporte</button>,
}))
vi.mock("@/components/ui/generar-link-mp-button", () => ({
  GenerarLinkMpButton: () => <button type="button">Generar link MP</button>,
}))
vi.mock("@/components/ui/ajustes-suscripcion-button", () => ({
  AjustesSuscripcionButton: () => <button type="button">Ajustes de soporte</button>,
}))

vi.mock("@/components/ui/proyecto-block", () => ({
  ProyectoBlock: (props: {
    proyecto: {
      id: string
      hitos: { id: string; enlacesPago?: unknown[] | null }[]
    }
    puedeGestionar?: boolean
    puedeOperarPaypal?: boolean
    paypal?: {
      disponible: boolean
      feeBps: number
      feeFixedCents: number
    } | null
  }) => (
    <div
      data-testid={`proyecto-${props.proyecto.id}`}
      data-gestionar={String(props.puedeGestionar)}
      data-operar-paypal={String(props.puedeOperarPaypal)}
      data-paypal={`${props.paypal?.disponible}/${props.paypal?.feeBps}/${props.paypal?.feeFixedCents}`}
    >
      {props.proyecto.hitos.map((hito) => (
        <span
          key={hito.id}
          data-testid={`hito-${hito.id}`}
          data-enlaces={String(hito.enlacesPago?.length ?? 0)}
        />
      ))}
    </div>
  ),
}))

vi.mock("@/components/ui/registrar-pago-paypal-button", () => ({
  RegistrarPagoPaypalButton: (props: {
    conceptos: { tipo: string }[]
    puedeRegistrarManual: boolean
  }) =>
    props.puedeRegistrarManual ? (
      <button
        type="button"
        data-testid="registrar-pago-paypal"
        data-tipos={props.conceptos.map((concepto) => concepto.tipo).join(",")}
      >
        Registrar pago PayPal
      </button>
    ) : null,
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

import ClienteDetalle from "@/app/(admin)/admin/clientes/[id]/page"

const FUTURO = new Date(Date.now() + 15 * 86400000)
const PASADO = new Date(Date.now() - 5 * 86400000)

const ENLACE_ACTIVO = {
  id: "enlace_soporte",
  url: "https://pixelarch.dev/pago/paypal/soporte",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: FUTURO,
  estado: "ACTIVO",
  meses: 3,
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

const ENLACE_INVALIDADO = {
  id: "enlace_invalidado",
  url: "https://pixelarch.dev/pago/paypal/invalidado",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: FUTURO,
  estado: "INVALIDADO",
  meses: 1,
  idioma: "es",
  creadoEn: PASADO,
  motivoInvalido: "REGENERADO",
}

function clienteDemo() {
  return {
    id: "cliente_1",
    nombre: "Cliente Demo",
    email: "cliente@example.com",
    empresa: "Demo S.A.",
    telefono: "+54 9 11 1234-5678",
    notas: null,
    activo: true,
    creadoEn: new Date("2026-01-01T12:00:00.000Z"),
    suscripciones: [
      {
        id: "sop_activo",
        clienteId: "cliente_1",
        servicioId: "serv_1",
        plan: "SOPORTE",
        estado: "ACTIVE",
        precioCustom: null,
        proximoPago: FUTURO,
        mpLink: null,
        mpLinkExpira: null,
        mpLinkMeses: 3,
        deploymentPlatform: null,
        platformServiceId: null,
        servicio: {
          nombre: "Soporte Web",
          precioUnico: 0,
          precioBasico: 0,
          precioMantenimiento: 10000,
        },
        enlacesPago: [ENLACE_ACTIVO, ENLACE_FALLIDO],
      },
      {
        id: "sop_basico",
        clienteId: "cliente_1",
        servicioId: "serv_1",
        plan: "BASICO",
        estado: "ACTIVE",
        precioCustom: null,
        proximoPago: FUTURO,
        mpLink: null,
        mpLinkExpira: null,
        mpLinkMeses: null,
        deploymentPlatform: null,
        platformServiceId: null,
        servicio: {
          nombre: "Soporte Web",
          precioUnico: 0,
          precioBasico: 5000,
          precioMantenimiento: 10000,
        },
        enlacesPago: [],
      },
      {
        // Fuera de la ventana de 7 dias de /admin/cobros: solo se puede
        // generar PayPal desde el detalle.
        id: "sop_lejano",
        clienteId: "cliente_1",
        servicioId: "serv_1",
        plan: "SOPORTE",
        estado: "ACTIVE",
        precioCustom: null,
        proximoPago: new Date(Date.now() + 30 * 86400000),
        mpLink: null,
        mpLinkExpira: null,
        mpLinkMeses: null,
        deploymentPlatform: null,
        platformServiceId: null,
        servicio: {
          nombre: "Soporte Web",
          precioUnico: 0,
          precioBasico: 0,
          precioMantenimiento: 10000,
        },
        enlacesPago: [],
      },
      {
        // PAST_DUE sin proximoPago (tampoco aparece en cobros).
        id: "sop_sin_fecha",
        clienteId: "cliente_1",
        servicioId: "serv_1",
        plan: "SOPORTE",
        estado: "PAST_DUE",
        precioCustom: null,
        proximoPago: null,
        mpLink: null,
        mpLinkExpira: null,
        mpLinkMeses: null,
        deploymentPlatform: null,
        platformServiceId: null,
        servicio: {
          nombre: "Soporte Web",
          precioUnico: 0,
          precioBasico: 0,
          precioMantenimiento: 10000,
        },
        enlacesPago: [ENLACE_INVALIDADO],
      },
      {
        id: "sop_pausado",
        clienteId: "cliente_1",
        servicioId: "serv_1",
        plan: "SOPORTE",
        estado: "PAUSED",
        precioCustom: null,
        proximoPago: null,
        mpLink: null,
        mpLinkExpira: null,
        mpLinkMeses: null,
        deploymentPlatform: null,
        platformServiceId: null,
        servicio: {
          nombre: "Soporte Web",
          precioUnico: 0,
          precioBasico: 0,
          precioMantenimiento: 10000,
        },
        enlacesPago: [],
      },
    ],
    proyectos: [
      {
        id: "proyecto_1",
        clienteId: "cliente_1",
        titulo: "Sitio corporativo",
        montoTotal: 20000,
        estado: "ACTIVO",
        notas: null,
        creadoEn: new Date("2026-01-01T12:00:00.000Z"),
        servicio: { nombre: "Web" },
        hitos: [
          {
            id: "hito_1",
            orden: 1,
            titulo: "Anticipo",
            monto: 10050,
            estado: "PENDIENTE",
            vencimiento: null,
            mpLink: null,
            mpLinkExpira: null,
            enlacesPago: [ENLACE_FALLIDO],
            _count: { pagos: 0 },
          },
          {
            id: "hito_2",
            orden: 2,
            titulo: "Entrega",
            monto: 10000,
            estado: "PAGADO",
            vencimiento: null,
            mpLink: null,
            mpLinkExpira: null,
            enlacesPago: [],
            _count: { pagos: 1 },
          },
        ],
      },
    ],
    pagos: [],
  }
}

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
  return render(
    await ClienteDetalle({ params: Promise.resolve({ id: "cliente_1" }) })
  )
}

describe("Detalle del cliente: PayPal (T-21)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireStaff.mockResolvedValue(staff(true))
    mocks.clienteFindUnique.mockResolvedValue(clienteDemo())
    mocks.servicioFindMany.mockResolvedValue([])
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

  it("incluye los EnlacePago PAYPAL en las consultas del detalle", async () => {
    await renderPage()

    const consulta = mocks.clienteFindUnique.mock.calls[0][0]
    expect(consulta.include.suscripciones.include.enlacesPago).toEqual(
      expect.objectContaining({ where: { pasarela: "PAYPAL" } })
    )
    expect(consulta.include.proyectos.include.hitos.include.enlacesPago).toEqual(
      expect.objectContaining({ where: { pasarela: "PAYPAL" } })
    )
  })

  it("pasa configuracion, fee y enlaces del grupo al bloque y al soporte", async () => {
    await renderPage()

    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-gestionar",
      "true"
    )
    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-operar-paypal",
      "true"
    )
    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-paypal",
      "true/540/30"
    )
    expect(screen.getByTestId("hito-hito_1")).toHaveAttribute(
      "data-enlaces",
      "1"
    )

    const paypalSoporte = screen.getByTestId("paypal-soporte-sop_activo")
    expect(paypalSoporte).toHaveAttribute("data-enlace", "enlace_soporte")
    expect(paypalSoporte).toHaveAttribute("data-ultimo", "")
    expect(paypalSoporte).toHaveAttribute("data-fee", "540/30")
    expect(paypalSoporte).toHaveAttribute("data-disponible", "true")
    expect(paypalSoporte).toHaveAttribute("data-monto-mensual", "10000")
    expect(paypalSoporte).toHaveAttribute("data-meses", "3")
    // AC-23: el nombre accesible identifica el concepto (no un "PayPal" ambiguo).
    expect(paypalSoporte).toHaveAttribute(
      "aria-label",
      "PayPal — Soporte Soporte Web"
    )
    // El admin conserva las acciones de gestion ademas de PayPal.
    expect(
      screen.getAllByRole("button", { name: "Registrar pago soporte" }).length
    ).toBeGreaterThan(0)
    // T-25: el registro manual ofrece hitos y soportes en el mismo modal.
    const manual = screen.getByTestId("registrar-pago-paypal")
    expect(manual.getAttribute("data-tipos")).toContain("hito")
    expect(manual.getAttribute("data-tipos")).toContain("soporte")
  })

  it("no ofrece PayPal en soportes no elegibles", async () => {
    await renderPage()

    expect(
      screen.queryByTestId("paypal-soporte-sop_basico")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId("paypal-soporte-sop_pausado")
    ).not.toBeInTheDocument()
  })

  it("permite a la asistente operar PayPal y le oculta las acciones admin-only (AC-1, AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(staff(false))

    await renderPage()

    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-gestionar",
      "false"
    )
    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-operar-paypal",
      "true"
    )
    expect(screen.getByTestId("paypal-soporte-sop_activo")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Registrar pago soporte" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Activar soporte" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Generar link MP" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Acciones de soporte" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Ajustes de soporte" })
    ).not.toBeInTheDocument()
    // T-25: el registro manual PayPal es solo admin.
    expect(
      screen.queryByTestId("registrar-pago-paypal")
    ).not.toBeInTheDocument()
  })

  /**
   * AC-1/AC-17: el detalle es la unica via para un soporte que no entra en la
   * ventana de 7 dias de /admin/cobros. Debe ofrecer PayPal a la asistente
   * aunque `proximoPago` sea lejano o nulo.
   */
  it("permite a la asistente generar PayPal en soportes fuera de la ventana de cobros", async () => {
    mocks.requireStaff.mockResolvedValue(staff(false))

    await renderPage()

    expect(
      screen.getByTestId("paypal-soporte-sop_lejano")
    ).toBeInTheDocument()
    const sinFecha = screen.getByTestId("paypal-soporte-sop_sin_fecha")
    expect(sinFecha).toBeInTheDocument()
    expect(sinFecha).toHaveAttribute("data-ultimo", "INVALIDADO")
  })

  it("propaga PayPal no disponible a la UI", async () => {
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

    expect(screen.getByTestId("proyecto-proyecto_1")).toHaveAttribute(
      "data-paypal",
      "false/540/30"
    )
    expect(screen.getByTestId("paypal-soporte-sop_activo")).toHaveAttribute(
      "data-disponible",
      "false"
    )
  })
})

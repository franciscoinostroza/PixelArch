import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-27 (AC-23, AC-27): UI de revision de una diferencia de monto PayPal.
 *
 * Cubre:
 * - visibilidad solo para admin y solo sobre pagos PayPal `REVISION` /
 *   `PENDIENTE`;
 * - monto cobrado vs esperado y diferencia, con texto ademas del color;
 * - aceptar/rechazar con confirmacion explicita y estado (accion + nota)
 *   conservado hasta confirmar;
 * - bloqueo de "aceptar" cuando la revision fue por moneda o falta referencia;
 * - teclado (foco inicial, trampa, Escape, retorno), errores `role=alert` y
 *   exito `role=status` + `aria-live`;
 * - payload exacto a `/api/admin/paypal/revision`, recibo, timeout y fallback
 *   a fetch;
 * - integracion en `/admin/pagos` (acciones admin-only).
 *
 * No hay red: `fetch` y Prisma/Clerk se mockean.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  redirect: vi.fn(),
  requireStaff: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  redirect: mocks.redirect,
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

mocks.redirect.mockImplementation((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

import AdminPagos from "@/app/(admin)/admin/pagos/page"
import {
  RevisionPaypalButton,
  type ResolverRevisionPaypalRequest,
  type ResolverRevisionPaypalResult,
  type RevisionPaypalPago,
} from "@/components/ui/revision-paypal-button"

const PAGO: RevisionPaypalPago = {
  id: "pago_revision",
  monto: 10000,
  montoEsperado: 10656,
  montoAcordado: 9394,
  comision: 606,
  moneda: "usd",
  revisionNota: "El total capturado no coincide con el total esperado del link.",
  revisionEstado: "PENDIENTE",
  estadoPago: "REVISION",
  pasarela: "PAYPAL",
  concepto: "Sitio ACME — Anticipo",
  referencia: "Capture CAPTURE-1",
  externalId: "CAPTURE-1",
  paypalOrderId: "ORDER-1",
  tieneHito: true,
  tieneSoporte: false,
  meses: null,
}

function resultado(
  overrides: Partial<ResolverRevisionPaypalResult> = {}
): ResolverRevisionPaypalResult {
  return {
    ok: true,
    pagoId: "pago_revision",
    accion: "ACEPTAR",
    estadoPago: "SUCCEEDED",
    revisionEstado: "ACEPTADO",
    reciboId: "RECIBO-1",
    hitoAplicado: true,
    mesesAcreditados: null,
    ...overrides,
  }
}

function renderBoton(
  overrides: {
    pago?: RevisionPaypalPago
    puedeResolverRevision?: boolean
    resolverRevision?: (
      input: ResolverRevisionPaypalRequest
    ) => Promise<ResolverRevisionPaypalResult>
    usarFetch?: boolean
    timeoutMs?: number
  } = {}
) {
  const resolverRevision = vi.fn(
    async (
      input: ResolverRevisionPaypalRequest
    ): Promise<ResolverRevisionPaypalResult> =>
      input.accion === "RECHAZAR"
        ? resultado({
            accion: "RECHAZAR",
            estadoPago: "REVISION",
            revisionEstado: "RECHAZADO",
            reciboId: null,
            hitoAplicado: false,
          })
        : resultado()
  )

  const renderizado = render(
    <RevisionPaypalButton
      pago={overrides.pago ?? PAGO}
      puedeResolverRevision={overrides.puedeResolverRevision ?? true}
      resolverRevision={
        overrides.usarFetch
          ? undefined
          : (overrides.resolverRevision ?? resolverRevision)
      }
      timeoutMs={overrides.timeoutMs}
    />
  )

  return { ...renderizado, resolverRevision }
}

async function abrir() {
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Revisar diferencia" })
  await user.click(trigger)
  const dialog = screen.getByRole("dialog", {
    name: "Resolver revisión de pago",
  })
  return { user, trigger, dialog }
}

async function confirmar(
  user: ReturnType<typeof userEvent.setup>,
  accion: "aceptación" | "rechazo" = "aceptación"
) {
  await user.click(
    screen.getByRole("button", { name: "Continuar" })
  )
  await user.click(
    await screen.findByRole("button", {
      name: `Confirmar ${accion}`,
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // `restoreAllMocks` del afterEach resetea la implementacion de `redirect`;
  // se reinstala antes de cada test.
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("RevisionPaypalButton: permisos y elegibilidad (AC-17, AC-27)", () => {
  it("no renderiza nada para la asistente", () => {
    renderBoton({ puedeResolverRevision: false })

    expect(
      screen.queryByRole("button", { name: "Revisar diferencia" })
    ).not.toBeInTheDocument()
  })

  it("muestra el disparador al admin sobre un pago en revision pendiente", () => {
    renderBoton()

    expect(
      screen.getByRole("button", { name: "Revisar diferencia" })
    ).toBeInTheDocument()
  })

  it("oculta la accion si el pago ya fue resuelto o no es PayPal", () => {
    for (const pago of [
      { ...PAGO, revisionEstado: "ACEPTADO" },
      { ...PAGO, revisionEstado: "RECHAZADO" },
      { ...PAGO, estadoPago: "SUCCEEDED" },
      { ...PAGO, pasarela: "MERCADOPAGO" },
    ]) {
      const { unmount } = render(
        <RevisionPaypalButton pago={pago} puedeResolverRevision />
      )
      expect(
        screen.queryByRole("button", { name: "Revisar diferencia" })
      ).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe("RevisionPaypalModal: montos y teclado (AC-23, AC-27)", () => {
  it("abre el dialogo con foco inicial y muestra cobrado, esperado y diferencia", async () => {
    renderBoton()
    const { dialog } = await abrir()

    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveFocus()
    expect(
      within(dialog).getByText(/Sitio ACME — Anticipo · Capture CAPTURE-1/)
    ).toBeInTheDocument()

    expect(within(dialog).getByText("Cobrado")).toBeInTheDocument()
    expect(within(dialog).getByText("US$100,00")).toBeInTheDocument()
    expect(within(dialog).getByText("Esperado")).toBeInTheDocument()
    expect(within(dialog).getByText("US$106,56")).toBeInTheDocument()
    expect(within(dialog).getByText("Diferencia")).toBeInTheDocument()
    expect(within(dialog).getByText("-US$6,56")).toBeInTheDocument()
    expect(
      within(dialog).getByText("El cobro es menor al esperado.")
    ).toBeInTheDocument()
  })

  it("cierra con Escape y devuelve el foco al disparador", async () => {
    renderBoton()
    const { user, trigger } = await abrir()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("atrapa el foco con Tab y Shift+Tab dentro del dialogo", async () => {
    renderBoton()
    const { user, dialog } = await abrir()

    for (let i = 0; i < 10; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    for (let i = 0; i < 5; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it("expone labels, aria-live y errores role=alert", async () => {
    const resolverRevision = vi
      .fn<() => Promise<ResolverRevisionPaypalResult>>()
      .mockRejectedValue(new Error("El pago ya fue resuelto por otra operacion."))
    renderBoton({ resolverRevision })
    const { user, dialog } = await abrir()

    expect(within(dialog).getByRole("status")).toHaveAttribute(
      "aria-live",
      "polite"
    )
    expect(within(dialog).getByLabelText("Nota (opcional)")).toBeInTheDocument()
    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeChecked()
    expect(
      within(dialog).getByRole("radio", {
        name: /Rechazar la diferencia/,
      })
    ).not.toBeChecked()

    await confirmar(user)

    const mensaje = await screen.findByText(
      "El pago ya fue resuelto por otra operacion."
    )
    expect(mensaje).toHaveAttribute("role", "alert")
    expect(resolverRevision).toHaveBeenCalledTimes(1)
  })
})

describe("RevisionPaypalModal: confirmacion y estado (AC-27)", () => {
  it("exige confirmacion y conserva accion y nota hasta confirmar", async () => {
    const { resolverRevision } = renderBoton()
    const { user, dialog } = await abrir()

    await user.type(
      within(dialog).getByLabelText("Nota (opcional)"),
      "Diferencia acordada por descuento"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Continuar" })
    )

    const confirmacion = await within(dialog).findByRole("alert")
    expect(confirmacion).toHaveTextContent(
      "¿Confirmás aceptar la diferencia y aplicar el pago?"
    )
    expect(
      within(dialog).getByRole("button", { name: "Confirmar aceptación" })
    ).toHaveFocus()
    expect(resolverRevision).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText("Nota (opcional)")).toHaveValue(
      "Diferencia acordada por descuento"
    )

    await user.click(within(dialog).getByRole("button", { name: "Volver" }))

    expect(
      within(dialog).getByLabelText("Nota (opcional)")
    ).toHaveValue("Diferencia acordada por descuento")
    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeChecked()

    await user.click(
      within(dialog).getByRole("button", { name: "Continuar" })
    )
    await user.click(
      await within(dialog).findByRole("button", {
        name: "Confirmar aceptación",
      })
    )

    await waitFor(() =>
      expect(resolverRevision).toHaveBeenCalledWith({
        pagoId: "pago_revision",
        accion: "ACEPTAR",
        nota: "Diferencia acordada por descuento",
      })
    )
    expect(await screen.findByText("Revisión aceptada")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Revisión aceptada.")
    expect(mocks.refresh).toHaveBeenCalledTimes(1)

    const recibo = screen.getByRole("link", { name: /ver recibo/i })
    expect(recibo).toHaveAttribute(
      "href",
      "/admin/pagos/pago_revision/recibo"
    )
  })

  it("permite rechazar la diferencia y no emite recibo", async () => {
    const { resolverRevision } = renderBoton()
    const { user, dialog } = await abrir()

    await user.click(
      within(dialog).getByRole("radio", {
        name: /Rechazar la diferencia/,
      })
    )
    await confirmar(user, "rechazo")

    await waitFor(() =>
      expect(resolverRevision).toHaveBeenCalledWith({
        pagoId: "pago_revision",
        accion: "RECHAZAR",
        nota: null,
      })
    )
    expect(await screen.findByText("Revisión rechazada")).toBeInTheDocument()
    expect(
      screen.getByText(/El pago quedó sin aplicar/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /ver recibo/i })
    ).not.toBeInTheDocument()
  })

  it("conserva la accion y la nota si la API falla y permite reintentar", async () => {
    const resolverRevision = vi
      .fn<() => Promise<ResolverRevisionPaypalResult>>()
      .mockRejectedValueOnce(new Error("El hito no esta pendiente."))
      .mockResolvedValueOnce(resultado())
    renderBoton({ resolverRevision })
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Nota (opcional)"), "Nota")
    await user.click(
      within(dialog).getByRole("button", { name: "Continuar" })
    )
    await user.click(
      await within(dialog).findByRole("button", {
        name: "Confirmar aceptación",
      })
    )

    expect(
      await screen.findByText("El hito no esta pendiente.")
    ).toHaveAttribute("role", "alert")
    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeChecked()
    expect(within(dialog).getByLabelText("Nota (opcional)")).toHaveValue("Nota")

    await user.click(
      await within(dialog).findByRole("button", {
        name: "Confirmar aceptación",
      })
    )

    expect(await screen.findByText("Revisión aceptada")).toBeInTheDocument()
    expect(resolverRevision).toHaveBeenCalledTimes(2)
  })

  it("deshabilita aceptar si la captura no fue en USD", async () => {
    renderBoton({
      pago: {
        ...PAGO,
        moneda: "eur",
        revisionNota: "Moneda capturada EUR",
      },
    })
    const { dialog } = await abrir()

    const aceptar = within(dialog).getByRole("radio", {
      name: /Aceptar la diferencia y aplicar el pago/,
    })
    expect(aceptar).toBeDisabled()
    expect(
      within(dialog).getByRole("radio", { name: /Rechazar la diferencia/ })
    ).toBeChecked()
    expect(
      within(dialog).getByText(/No se puede aceptar un pago en moneda distinta de USD/)
    ).toBeInTheDocument()
  })

  it("deshabilita aceptar si la revision fue por moneda aunque Pago.moneda sea usd (AC-27)", async () => {
    // Caso real de T-10/T-11: un capture en EUR se persiste como
    // `Pago.moneda = usd` y la moneda extranjera queda en `revisionNota`.
    // La UI debe bloquear "aceptar" por la nota, no solo por la columna moneda.
    renderBoton({
      pago: {
        ...PAGO,
        moneda: "usd",
        revisionNota:
          "Moneda capturada EUR; moneda del link USD; esperado USD.",
      },
    })
    const { dialog } = await abrir()

    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeDisabled()
    expect(
      within(dialog).getByRole("radio", { name: /Rechazar la diferencia/ })
    ).toBeChecked()
    expect(
      within(dialog).getByText(/No se puede aceptar un pago en moneda distinta de USD/)
    ).toBeInTheDocument()
  })

  it("deshabilita aceptar si falta la referencia externa", async () => {
    renderBoton({
      pago: { ...PAGO, externalId: null, paypalOrderId: null },
    })
    const { dialog } = await abrir()

    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeDisabled()
    expect(
      within(dialog).getByText(/no se puede emitir el recibo/)
    ).toBeInTheDocument()
  })
})

describe("RevisionPaypalModal: API y errores (AC-27)", () => {
  it("usa /api/admin/paypal/revision cuando no hay callback", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => resultado({ reciboId: "RECIBO-FETCH" }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user, dialog } = await abrir()

    await user.type(within(dialog).getByLabelText("Nota (opcional)"), "Nota")
    await confirmar(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/revision",
      expect.objectContaining({ method: "POST" })
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1]?.body as string) ?? "{}"
    )
    expect(body).toEqual({
      pagoId: "pago_revision",
      accion: "ACEPTAR",
      nota: "Nota",
    })
    expect(await screen.findByText("Revisión aceptada")).toBeInTheDocument()
  })

  it("muestra el error del servidor y no refresca", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({
            error: "El pago no esta pendiente de revision.",
          }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    renderBoton({ usarFetch: true })
    const { user } = await abrir()

    await confirmar(user)

    expect(
      await screen.findByText("El pago no esta pendiente de revision.")
    ).toHaveAttribute("role", "alert")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("corta por timeout y vuelve a habilitar la confirmacion", async () => {
    const resolverRevision = vi.fn(
      () => new Promise<ResolverRevisionPaypalResult>(() => {})
    )
    renderBoton({ resolverRevision, timeoutMs: 25 })
    const { user } = await abrir()

    await confirmar(user)

    expect(
      await screen.findByText(
        "La operación tardó demasiado. Reintentá.",
        {},
        { timeout: 2000 }
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Confirmar aceptación" })
    ).toBeEnabled()
  })

  it("no imprime ni envia PII del pagador aunque llegue en el pago (AC-19, AC-28)", async () => {
    const pagoConPii: RevisionPaypalPago & {
      pagadorEmail: string
      pagadorNombre: string
    } = {
      ...PAGO,
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador Ejemplo",
    }
    const { resolverRevision } = renderBoton({ pago: pagoConPii })
    const { user, dialog } = await abrir()

    expect(dialog.innerHTML).not.toContain("pagador@example.com")
    expect(dialog.innerHTML).not.toContain("Pagador Ejemplo")

    await confirmar(user)

    await waitFor(() => expect(resolverRevision).toHaveBeenCalledTimes(1))
    const payload = JSON.stringify(resolverRevision.mock.calls)
    expect(payload).not.toContain("pagador@example.com")
    expect(payload).not.toContain("Pagador Ejemplo")
    expect(resolverRevision).toHaveBeenCalledWith({
      pagoId: "pago_revision",
      accion: "ACEPTAR",
      nota: null,
    })
  })
})

describe("/admin/pagos: accion de revision (T-27, AC-17)", () => {
  const PAGO_PAGINA = {
    id: "pago_revision",
    cliente: { nombre: "Cliente Demo" },
    hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
    suscripcion: null,
    enlacePago: {
      concepto: "Sitio ACME — Anticipo",
      descripcion: null,
      externalId: "ORDER-1",
      generadoPorNombre: "Ana Admin",
      enviadoPor: "ana",
      enviadoEn: new Date("2026-10-20T12:00:00.000Z"),
      canalEnvio: "EMAIL",
      idioma: "es",
      eventos: [],
    },
    ajustes: [],
    eventos: [],
    monto: 10000,
    montoAcordado: 9394,
    comision: 606,
    montoEsperado: 10656,
    moneda: "usd",
    metodo: "PAYPAL",
    pasarela: "PAYPAL",
    origen: "AUTOMATICO",
    externalId: "CAPTURE-1",
    paypalOrderId: "ORDER-1",
    reciboId: null,
    reciboEmitidoEn: null,
    revisionNota: "El total capturado no coincide con el esperado.",
    revisionEstado: "PENDIENTE",
    revisionResueltaPor: null,
    revisionResueltaEn: null,
    meses: null,
    hitoId: "hito_1",
    suscripcionId: null,
    estadoPago: "REVISION",
    creadoEn: new Date("2026-10-20T12:00:00.000Z"),
  }

  function staff(esAdmin: boolean) {
    return {
      userId: esAdmin ? "user_admin" : "user_asistente",
      nombre: esAdmin ? "Admin" : "Asistente",
      rol: esAdmin ? "admin" : "asistente",
      esAdmin,
      cliente: null,
    }
  }

  async function renderPage(esAdmin = true) {
    mocks.requireStaff.mockResolvedValue(staff(esAdmin))
    mocks.findMany.mockResolvedValue([PAGO_PAGINA])
    mocks.count.mockResolvedValue(1)
    return render(
      await AdminPagos({ searchParams: Promise.resolve({}) })
    )
  }

  it("muestra la accion solo al admin", async () => {
    await renderPage(true)

    expect(
      screen.getByRole("columnheader", { name: "Acciones" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Resolver revisión — Sitio ACME — Anticipo",
      })
    ).toBeInTheDocument()
  })

  it("no muestra la accion a la asistente", async () => {
    await renderPage(false)

    expect(
      screen.queryByRole("columnheader", { name: "Acciones" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Resolver revisión/ })
    ).not.toBeInTheDocument()
  })

  it("abre el modal desde la fila y resuelve la revision con el endpoint", async () => {
    const fetchMock = vi.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () =>
            resultado({
              accion: "RECHAZAR",
              estadoPago: "REVISION",
              revisionEstado: "RECHAZADO",
              reciboId: null,
              hitoAplicado: false,
            }),
        }) as unknown as Response
    )
    vi.stubGlobal("fetch", fetchMock)

    await renderPage(true)

    const user = userEvent.setup()
    await user.click(
      screen.getByRole("button", {
        name: "Resolver revisión — Sitio ACME — Anticipo",
      })
    )

    const dialog = screen.getByRole("dialog", {
      name: "Resolver revisión de pago",
    })
    expect(within(dialog).getByText("-US$6,56")).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole("radio", { name: /Rechazar la diferencia/ })
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Continuar" })
    )
    await user.click(
      await within(dialog).findByRole("button", {
        name: "Confirmar rechazo",
      })
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/paypal/revision",
      expect.objectContaining({ method: "POST" })
    )
    expect(
      JSON.parse((fetchMock.mock.calls[0][1]?.body as string) ?? "{}")
    ).toEqual({
      pagoId: "pago_revision",
      accion: "RECHAZAR",
      nota: null,
    })
    expect(await screen.findByText("Revisión rechazada")).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("no ofrece resolver una revision ya aceptada", async () => {
    mocks.requireStaff.mockResolvedValue(staff(true))
    mocks.findMany.mockResolvedValue([
      { ...PAGO_PAGINA, revisionEstado: "ACEPTADO" },
    ])
    mocks.count.mockResolvedValue(1)

    render(await AdminPagos({ searchParams: Promise.resolve({}) }))

    expect(
      screen.queryByRole("button", { name: /Resolver revisión/ })
    ).not.toBeInTheDocument()
  })

  it("redirige al gate si no hay staff autenticado (AC-17)", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(
      AdminPagos({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})

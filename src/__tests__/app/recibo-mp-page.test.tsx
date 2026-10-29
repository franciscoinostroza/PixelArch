import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"

/**
 * T-05 (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-12, AC-13, AC-14, AC-17)
 * + T-06 (AC-8, AC-9, AC-10, AC-17, AC-19, AC-20, AC-22, AC-23, AC-25, AC-26):
 * pagina imprimible del recibo de Mercado Pago.
 *
 * Prisma, Clerk, la API de Mercado Pago y la navegacion se mockean; no se toca
 * la base real ni se llama a ninguna pasarela. La derivacion del identificador
 * se ejecuta de verdad (`mp-recibo.ts`) para comprobar que el documento y el id
 * usan la misma fecha. El email se envuelve con un spy sobre la implementacion
 * real de `@/lib/notifications` (Review T-05).
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  findUnique: vi.fn(),
  pagoUpdate: vi.fn(),
  pagoUpdateMany: vi.fn(),
  pagoCreate: vi.fn(),
  pagoDelete: vi.fn(),
  hitoUpdate: vi.fn(),
  hitoUpdateMany: vi.fn(),
  suscripcionUpdate: vi.fn(),
  suscripcionUpdateMany: vi.fn(),
  enlaceUpdate: vi.fn(),
  enlaceUpdateMany: vi.fn(),
  obtenerPagoMp: vi.fn(),
  crearLinkDePago: vi.fn(),
  sendPaymentReceipt: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))

vi.mock("@/lib/auth", () => ({
  requireStaff: mocks.requireStaff,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pago: {
      findUnique: mocks.findUnique,
      update: mocks.pagoUpdate,
      updateMany: mocks.pagoUpdateMany,
      create: mocks.pagoCreate,
      delete: mocks.pagoDelete,
    },
    // AC-17: el recibo no debe tocar el hito, el soporte ni el enlace de pago.
    hito: { update: mocks.hitoUpdate, updateMany: mocks.hitoUpdateMany },
    suscripcion: {
      update: mocks.suscripcionUpdate,
      updateMany: mocks.suscripcionUpdateMany,
    },
    enlacePago: {
      update: mocks.enlaceUpdate,
      updateMany: mocks.enlaceUpdateMany,
    },
  },
}))

// AC-22: la pagina no debe consultar la API de Mercado Pago.
vi.mock("@/lib/mercadopago", () => ({
  obtenerPagoMp: mocks.obtenerPagoMp,
  crearLinkDePago: mocks.crearLinkDePago,
}))

// Review T-05: spy sobre el export real, no un modulo falso que podria ocultar
// un import roto. El recibo solo lee datos del CRM y nunca debe llamarlo.
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>()
  mocks.sendPaymentReceipt.mockImplementation(actual.sendPaymentReceipt)
  return { ...actual, sendPaymentReceipt: mocks.sendPaymentReceipt }
})

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import ReciboMpPage from "@/app/(admin)/admin/pagos/[id]/recibo/page"
import { generarReciboIdMp } from "@/lib/mp-recibo"

const CREADO_EN = new Date("2026-10-20T12:00:00.000Z")
const EXTERNAL_ID = "1234567890"
const RECIBO_ID = generarReciboIdMp(EXTERNAL_ID, CREADO_EN)

const PAGO_MP = {
  id: "pago_mp",
  pasarela: "MERCADOPAGO",
  metodo: "MERCADOPAGO",
  estadoPago: "SUCCEEDED",
  externalId: EXTERNAL_ID,
  paypalOrderId: null,
  reciboId: null,
  reciboEmitidoEn: null,
  creadoEn: CREADO_EN,
  monto: 100000,
  montoAcordado: 100000,
  comision: 0,
  moneda: "ars",
  meses: null,
  cliente: { nombre: "Cliente Demo", email: "cliente@acme.test" },
  hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
  suscripcion: null,
  enlacePago: { concepto: "Sitio ACME — Anticipo" },
}

function params(id = "pago_mp"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function staff(rol: "admin" | "asistente" = "admin") {
  mocks.requireStaff.mockResolvedValue({
    userId: "user_1",
    nombre: rol === "admin" ? "Admin" : "Asistente",
    rol,
    esAdmin: rol === "admin",
    cliente: null,
  })
}

describe("pagina del recibo Mercado Pago (T-05)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // `clearAllMocks` limpia la implementacion del spy; se vuelve a enlazar la
    // real para que el test siga comprobando el export de `@/lib/notifications`.
    const notifications =
      await vi.importActual<typeof import("@/lib/notifications")>(
        "@/lib/notifications"
      )
    mocks.sendPaymentReceipt.mockImplementation(notifications.sendPaymentReceipt)
    staff()
  })

  it("redirige al gate si no hay staff autenticado y no consulta el pago (AC-1)", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(ReciboMpPage(params())).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("permite a la asistente abrir el recibo (AC-2)", async () => {
    staff("asistente")
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    expect(mocks.requireStaff).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Recibo interno de pago" })
    ).toBeInTheDocument()
    expect(screen.getByText("Pagado")).toBeInTheDocument()
    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    // AC-2: la asistente puede imprimirlo; el boton existe y esta habilitado.
    expect(
      screen.getByRole("button", { name: "Imprimir recibo" })
    ).toBeEnabled()
  })

  it("renderiza el camino feliz SUCCEEDED con los datos del pago (AC-3)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    const articulo = screen.getByRole("article")
    expect(articulo).toHaveTextContent("PixelArch")
    expect(
      screen.getByRole("heading", { level: 1, name: "Recibo interno de pago" })
    ).toBeInTheDocument()

    // Identificador derivado (D-1a): MP-AAAAMMDD-<32 hex>, sin prefijo PAY-.
    expect(RECIBO_ID).toMatch(/^MP-20261020-[0-9A-F]{32}$/)
    expect(screen.getByText(RECIBO_ID)).toBeInTheDocument()

    expect(screen.getByText("Pagado")).toBeInTheDocument()
    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    expect(screen.getByText("cliente@acme.test")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText("Mercado Pago")).toBeInTheDocument()
    expect(screen.getByText(EXTERNAL_ID)).toBeInTheDocument()
    expect(screen.getByText("ARS")).toBeInTheDocument()
    expect(screen.getByText("Total cobrado (ARS)")).toBeInTheDocument()
    // RF-16: el pie identifica el recibo interno y aclara que no es fiscal.
    expect(
      screen.getByText(
        "Recibo interno emitido por PixelArch. No reemplaza a una factura fiscal."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText("Documento generado desde pixelarch.dev")
    ).toBeInTheDocument()
  })

  it("prioriza el concepto del enlace aunque difiera del proyecto y el hito (AC-3, RF-9)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      // El fallback del fixture seria "Sitio ACME — Anticipo": el concepto del
      // enlace debe ganar, no coincidir por casualidad.
      enlacePago: { concepto: "Concepto propio del enlace" },
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Concepto propio del enlace")).toBeInTheDocument()
    expect(screen.queryByText("Sitio ACME — Anticipo")).not.toBeInTheDocument()
  })

  it("usa 'Pago Mercado Pago' si no hay enlace, hito ni soporte (AC-3, RF-9)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      enlacePago: null,
      hito: null,
      suscripcion: null,
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Pago Mercado Pago")).toBeInTheDocument()
  })

  it("recorta a 200 caracteres un concepto largo en lugar de no mostrar recibo (RF-9, AC-3)", async () => {
    const conceptoLargo = "C".repeat(250)
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      enlacePago: { concepto: conceptoLargo },
    })

    render(await ReciboMpPage(params()))

    const esperado = conceptoLargo.slice(0, 200)
    const nodo = screen.getByText(esperado)
    expect(nodo.textContent).toHaveLength(200)
    expect(screen.queryByText(conceptoLargo)).not.toBeInTheDocument()
  })

  it("normaliza un estado historico en minusculas antes de imprimirlo (AC-3)", async () => {
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, estadoPago: "succeeded" })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Pagado")).toBeInTheDocument()
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument()
  })

  it("usa la misma fecha (reciboEmitidoEn) para el identificador y el documento (AC-3, RF-10/RF-19)", async () => {
    const emision = new Date("2026-11-05T12:00:00.000Z")
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      reciboEmitidoEn: emision,
      creadoEn: CREADO_EN,
    })

    render(await ReciboMpPage(params()))

    // El id y la fecha visible salen de la fecha de emision, no de creadoEn.
    expect(screen.getByText(generarReciboIdMp(EXTERNAL_ID, emision))).toBeInTheDocument()
    expect(screen.getByText("5 de noviembre de 2026")).toBeInTheDocument()
    expect(screen.queryByText(RECIBO_ID)).not.toBeInTheDocument()
  })

  it("consulta el pago una sola vez con los datos minimos del recibo (RNF-6)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "pago_mp" },
      // Review T-05: select least-privilege; ni notas, ni evidencia, ni autor.
      select: {
        pasarela: true,
        metodo: true,
        estadoPago: true,
        externalId: true,
        paypalOrderId: true,
        reciboId: true,
        reciboEmitidoEn: true,
        creadoEn: true,
        monto: true,
        montoAcordado: true,
        comision: true,
        moneda: true,
        meses: true,
        // Solo los datos del cliente del CRM imprescindibles (RF-8).
        cliente: { select: { nombre: true, email: true } },
        hito: {
          select: { titulo: true, proyecto: { select: { titulo: true } } },
        },
        suscripcion: { select: { servicio: { select: { nombre: true } } } },
        enlacePago: { select: { concepto: true } },
      },
    })

    const consulta = mocks.findUnique.mock.calls[0][0] as {
      select: Record<string, unknown>
    }
    for (const campo of [
      "nota",
      "evidencia",
      "revisionNota",
      "revisionEstado",
      "revisionResueltaPor",
      "registradoPor",
      "origen",
      "cotizacion",
      "mpLink",
      "mpPreferenceId",
    ]) {
      expect(consulta.select).not.toHaveProperty(campo)
    }
  })

  it("arma el concepto con el proyecto y el hito (AC-4)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      enlacePago: null,
      hito: { titulo: "Segundo hito", proyecto: { titulo: "Portal interno" } },
      monto: 250000,
      montoAcordado: 250000,
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Portal interno — Segundo hito")).toBeInTheDocument()
    expect(screen.getAllByText("$2.500 ARS")).toHaveLength(2)
  })

  it("arma el concepto con el servicio y los meses de soporte (AC-5)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      enlacePago: null,
      hito: null,
      meses: 3,
      suscripcion: { servicio: { nombre: "Soporte mensual" } },
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Soporte mensual — 3 meses")).toBeInTheDocument()
  })

  it("muestra el importe en ARS con el formato del CRM y sin USD (AC-6)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    expect(screen.getAllByText("$1.000 ARS")).toHaveLength(2)
    expect(screen.getByText("Total cobrado (ARS)")).toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
    expect(screen.queryByText("Total cobrado (USD)")).not.toBeInTheDocument()
    expect(screen.queryByText("USD")).not.toBeInTheDocument()
  })

  it("muestra el importe en USD con referencia externa y sin ARS (AC-7)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      externalId: "MP-PAYMENT-USD-1",
      moneda: "usd",
      monto: 10050,
      montoAcordado: null,
      comision: 0,
    })

    render(await ReciboMpPage(params()))

    expect(screen.getAllByText("US$100,50")).toHaveLength(2)
    expect(screen.getByText("Total cobrado (USD)")).toBeInTheDocument()
    expect(screen.getByText("MP-PAYMENT-USD-1")).toBeInTheDocument()
    expect(screen.queryByText(/\$[\d.,]+\s+ARS/)).not.toBeInTheDocument()
    expect(screen.queryByText("Total cobrado (ARS)")).not.toBeInTheDocument()
  })

  it("muestra la referencia externa completa y exacta (AC-12)", async () => {
    const referencia = "MP-PAYMENT-1234567890123456789012345678901234567890"
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, externalId: referencia })

    render(await ReciboMpPage(params()))

    const nodo = screen.getByText(referencia)
    expect(nodo).toBeInTheDocument()
    expect(nodo).toHaveClass("break-words")
    expect(nodo.textContent).toBe(referencia)
  })

  it("no muestra PII extra del pagador aunque venga en el registro (AC-13)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador Demo",
      tarjeta: "4111111111111111",
      cvu: "0000003100010000000001",
      direccion: "Calle Falsa 123",
      cuit: "20-12345678-9",
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    expect(screen.queryByText(/pagador@example\.com/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Pagador Demo")).not.toBeInTheDocument()
    expect(screen.queryByText("4111111111111111")).not.toBeInTheDocument()
    expect(screen.queryByText("0000003100010000000001")).not.toBeInTheDocument()
    expect(screen.queryByText("Calle Falsa 123")).not.toBeInTheDocument()
    expect(screen.queryByText(/CUIT/i)).not.toBeInTheDocument()
  })

  it("no imprime nota, evidencia, revision, links, origen ni registradoPor (AC-14)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      nota: "nota interna confidencial",
      evidencia: "evidencia interna confidencial",
      revisionNota: "revision interna confidencial",
      registradoPor: "staff@internal.test",
      origen: "AUTOMATICO",
      hito: {
        titulo: "Anticipo",
        proyecto: { titulo: "Sitio ACME" },
        mpLink: "https://mp.example/link",
        mpPreferenceId: "pref_123456",
      },
      enlacePago: {
        concepto: "Sitio ACME — Anticipo",
        url: "https://mp.example/checkout",
        notaInterna: "nota del enlace confidencial",
      },
    })

    render(await ReciboMpPage(params()))

    expect(screen.queryByText(/nota interna confidencial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/evidencia interna confidencial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/revision interna confidencial/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/mp\.example/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/staff@internal\.test/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/AUTOMATICO/)).not.toBeInTheDocument()
    expect(screen.queryByText(/pref_123456/)).not.toBeInTheDocument()
    expect(screen.queryByText(/nota del enlace confidencial/i)).not.toBeInTheDocument()
  })

  it("conserva el recibo PayPal de un pago legacy con metodo PAYPAL (AC-21)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      pasarela: "MANUAL",
      metodo: "PAYPAL",
      reciboId: "PAY-20261020-ABCDEF123456",
      externalId: "CAPTURE-LEGACY-1",
      moneda: "usd",
      monto: 10656,
      montoAcordado: 10050,
      comision: 606,
    })

    render(await ReciboMpPage(params()))

    // `pasarelaEfectivaPago` usa `metodo` como respaldo historico: el pago sigue
    // mostrando el recibo PayPal y no se trata como manual.
    expect(screen.getByText("PAY-20261020-ABCDEF123456")).toBeInTheDocument()
    expect(screen.getByText("PayPal")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
  })

  it("no muta el pago ni envia emails al abrir el recibo (AC-17)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    expect(mocks.pagoUpdate).not.toHaveBeenCalled()
    expect(mocks.pagoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.pagoCreate).not.toHaveBeenCalled()
    expect(mocks.pagoDelete).not.toHaveBeenCalled()
    // AC-17: tampoco cambia el hito, el soporte ni el enlace de pago.
    expect(mocks.hitoUpdate).not.toHaveBeenCalled()
    expect(mocks.hitoUpdateMany).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdate).not.toHaveBeenCalled()
    expect(mocks.suscripcionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdate).not.toHaveBeenCalled()
    expect(mocks.enlaceUpdateMany).not.toHaveBeenCalled()
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
  })

  /* ---------------------------------------------------------------------- */
  /* T-06: bordes, seguridad y regresion                                    */
  /* ---------------------------------------------------------------------- */

  it.each(["FAILED", "PENDING"] as const)(
    "no muestra recibo para un pago %s (AC-8)",
    async (estadoPago) => {
      mocks.findUnique.mockResolvedValue({ ...PAGO_MP, estadoPago })

      await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")

      expect(mocks.notFound).toHaveBeenCalledTimes(1)
      expect(mocks.findUnique).toHaveBeenCalledTimes(1)
    }
  )

  it("no muestra recibo para un estado desconocido (AC-8, RF-3)", async () => {
    // RF-3: cualquier estado no reconocido se trata como no elegible aunque el
    // flujo actual de Mercado Pago no lo produzca.
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, estadoPago: "CANCELED" })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["REFUNDED", "Reembolsado"],
    ["CONTRACARGO", "Contracargo"],
  ] as const)(
    "muestra el estado real %s y conserva los montos (AC-9)",
    async (estadoPago, etiqueta) => {
      mocks.findUnique.mockResolvedValue({ ...PAGO_MP, estadoPago })

      render(await ReciboMpPage(params()))

      expect(screen.getByText(etiqueta)).toBeInTheDocument()
      expect(screen.queryByText("Pagado")).not.toBeInTheDocument()

      const tabla = screen.getByRole("table", { name: /desglose del pago/i })
      expect(within(tabla).getByRole("rowheader", { name: "Monto acordado" })).toBeInTheDocument()
      expect(within(tabla).getByRole("rowheader", { name: "Total cobrado (ARS)" })).toBeInTheDocument()
      // Los montos no se recalculan: mismo monto acordado y total del CRM.
      expect(screen.getAllByText("$1.000 ARS")).toHaveLength(2)
    }
  )

  it("muestra REVISION como 'En revision' y nunca como 'Pagado' (AC-10)", async () => {
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, estadoPago: "REVISION" })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("En revision")).toBeInTheDocument()
    expect(screen.queryByText("Pagado")).not.toBeInTheDocument()
    // No sugiere una accion de cobro desde el recibo.
    expect(screen.queryByRole("button", { name: /cobrar|pagar/i })).not.toBeInTheDocument()
  })

  it("emite recibo para un pago historico con pasarela MANUAL y metodo MERCADOPAGO (AC-19)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      pasarela: "MANUAL",
      metodo: "MERCADOPAGO",
    })

    render(await ReciboMpPage(params()))

    expect(screen.getByText("Mercado Pago")).toBeInTheDocument()
    expect(screen.getByText(EXTERNAL_ID)).toBeInTheDocument()
    expect(screen.getByText(RECIBO_ID)).toBeInTheDocument()
  })

  it.each([null, "", "   "] as const)(
    "sin referencia externa no muestra recibo ni inventa una (AC-20): %s",
    async (externalId) => {
      mocks.findUnique.mockResolvedValue({ ...PAGO_MP, externalId })

      await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")

      expect(mocks.notFound).toHaveBeenCalledTimes(1)
      expect(mocks.findUnique).toHaveBeenCalledTimes(1)
    }
  )

  it("recorta los espacios del externalId para el identificador y la referencia visible (Review T-05)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      externalId: `  ${EXTERNAL_ID}  `,
    })

    render(await ReciboMpPage(params()))

    // El id se deriva de la referencia recortada y la vista muestra el valor
    // recortado, sin inventar ni duplicar espacios.
    expect(screen.getByText(RECIBO_ID)).toBeInTheDocument()
    expect(screen.getByText(EXTERNAL_ID).textContent).toBe(EXTERNAL_ID)
    expect(screen.queryByText(`  ${EXTERNAL_ID}  `)).not.toBeInTheDocument()
  })

  it("no consulta la API de Mercado Pago al abrir el recibo (AC-22)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    expect(mocks.obtenerPagoMp).not.toHaveBeenCalled()
    expect(mocks.crearLinkDePago).not.toHaveBeenCalled()
  })

  it("no envia el email existente al abrir el recibo (AC-23)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    render(await ReciboMpPage(params()))

    // El spy envuelve la implementacion real (Review T-05); el recibo visual no
    // reenvia ni modifica el email de `sendPaymentReceipt`.
    expect(mocks.sendPaymentReceipt).not.toHaveBeenCalled()
    expect(mocks.sendPaymentReceipt.getMockImplementation()).toBeTypeOf("function")
  })

  it("no muestra recibo si el desglose de montos no reconcilia (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      monto: 100000,
      montoAcordado: 90000,
      comision: 0,
    })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("no muestra recibo si hay comision registrada sin monto acordado (AC-25, RF-13)", async () => {
    // RF-13: sin `montoAcordado` se usa el total cobrado; si ademas hay comision
    // mayor que 0, el desglose no reconcilia y no se emite un recibo inventado.
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      monto: 10606,
      montoAcordado: null,
      comision: 606,
    })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("no muestra recibo si la fecha del recibo es invalida (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      reciboEmitidoEn: new Date("fecha-invalida"),
    })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("no muestra recibo si la referencia externa supera el maximo (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      externalId: "R".repeat(129),
    })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("no muestra recibo si falta el cliente del CRM (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, cliente: null })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("no muestra recibo si el pago no existe (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue(null)

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("no muestra recibo si la moneda no es ARS ni USD (AC-25)", async () => {
    mocks.findUnique.mockResolvedValue({ ...PAGO_MP, moneda: "eur" })

    await expect(ReciboMpPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("trunca el concepto por puntos de codigo sin partir un emoji (Review T-05)", async () => {
    const concepto = `${"C".repeat(199)}😀resto`
    mocks.findUnique.mockResolvedValue({
      ...PAGO_MP,
      enlacePago: { concepto },
    })

    render(await ReciboMpPage(params()))

    const esperado = `${"C".repeat(199)}😀`
    const nodo = screen.getByText(esperado)
    expect(nodo.textContent).toBe(esperado)
    expect(nodo.textContent).not.toContain("\uFFFD")
    expect(Array.from(nodo.textContent ?? "")).toHaveLength(200)
  })

  it("mantiene la misma fecha e identificador en dos renders (AC-26)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_MP)

    const primero = render(await ReciboMpPage(params()))
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText(RECIBO_ID)).toBeInTheDocument()
    const htmlPrimero = primero.container.innerHTML
    primero.unmount()

    const segundo = render(await ReciboMpPage(params()))
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText(RECIBO_ID)).toBeInTheDocument()
    expect(segundo.container.innerHTML).toBe(htmlPrimero)
  })
})

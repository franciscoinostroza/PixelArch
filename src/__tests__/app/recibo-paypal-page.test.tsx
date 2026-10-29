import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"

/**
 * T-13 (AC-10, AC-12): permisos y datos de la pagina imprimible del recibo.
 *
 * Solo staff (admin o asistente), solo pagos PayPal con recibo emitido y
 * referencia externa. Prisma y la navegacion se mockean; no se toca la BD.
 */

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  findUnique: vi.fn(),
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
    },
  },
}))

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import ReciboPaypalPage from "@/app/(admin)/admin/pagos/[id]/recibo/page"

const PAGO_PAYPAL = {
  id: "pago_1",
  pasarela: "PAYPAL",
  estadoPago: "SUCCEEDED",
  reciboId: "PAY-20261020-ABCDEF123456",
  reciboEmitidoEn: new Date("2026-10-20T12:00:00.000Z"),
  creadoEn: new Date("2026-10-20T12:00:00.000Z"),
  externalId: "CAPTURE-ABC-1",
  paypalOrderId: "ORDER-1",
  monto: 10656,
  montoAcordado: 10050,
  comision: 606,
  moneda: "usd",
  meses: null,
  cliente: { nombre: "Cliente Demo", email: "cliente@acme.test" },
  hito: { titulo: "Anticipo", proyecto: { titulo: "Sitio ACME" } },
  suscripcion: null,
  enlacePago: { concepto: "Sitio ACME — Anticipo" },
}

function params(id = "pago_1"): { params: Promise<{ id: string }> } {
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

describe("pagina del recibo PayPal (T-13, AC-10, AC-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    staff()
  })

  it("redirige al gate si no hay staff autenticado", async () => {
    mocks.requireStaff.mockResolvedValue(null)

    await expect(ReciboPaypalPage(params())).rejects.toThrow("REDIRECT:/admin")
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("permite a la asistente abrir un recibo PayPal", async () => {
    staff("asistente")
    mocks.findUnique.mockResolvedValue(PAGO_PAYPAL)

    render(await ReciboPaypalPage(params()))

    expect(mocks.requireStaff).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Recibo interno de pago")).toBeInTheDocument()
    expect(screen.getByText("PAY-20261020-ABCDEF123456")).toBeInTheDocument()
    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
  })

  it("consulta el pago con cliente, concepto, hito y soporte", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_PAYPAL)

    await ReciboPaypalPage(params())

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pago_1" },
        include: expect.objectContaining({
          cliente: expect.anything(),
          enlacePago: expect.anything(),
          hito: expect.anything(),
          suscripcion: expect.anything(),
        }),
      })
    )
  })

  it("oculta el enlace de volver al imprimir (AC-10)", async () => {
    mocks.findUnique.mockResolvedValue(PAGO_PAYPAL)

    render(await ReciboPaypalPage(params()))

    const volver = screen.getByRole("link", { name: /volver a pagos/i })
    expect(volver).toHaveAttribute("href", "/admin/pagos")
    expect(volver.parentElement).toHaveClass("print:hidden")
  })

  it("usa proyecto/hito como concepto cuando el pago no trae enlace (AC-12)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      enlacePago: null,
      hito: { titulo: "Segundo hito", proyecto: { titulo: "Portal interno" } },
    })

    render(await ReciboPaypalPage(params()))

    expect(screen.getByText("Portal interno — Segundo hito")).toBeInTheDocument()
  })

  it("usa el servicio y los meses de soporte como concepto (AC-12)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      enlacePago: null,
      hito: null,
      meses: 3,
      suscripcion: { servicio: { nombre: "Soporte mensual" } },
    })

    render(await ReciboPaypalPage(params()))

    expect(screen.getByText("Soporte mensual — 3 meses")).toBeInTheDocument()
  })

  it("no expone datos del pagador ni de tarjeta aunque vengan en el registro (AC-10, AC-24)", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador",
      tarjeta: "4111111111111111",
      direccion: "Calle Falsa 123",
    })

    render(await ReciboPaypalPage(params()))

    expect(screen.queryByText(/pagador@example\.com/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Pagador")).not.toBeInTheDocument()
    expect(screen.queryByText("4111111111111111")).not.toBeInTheDocument()
    expect(screen.queryByText("Calle Falsa 123")).not.toBeInTheDocument()
    expect(screen.queryByText(/CUIT/i)).not.toBeInTheDocument()
  })

  it("devuelve notFound si el pago no esta en USD", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      moneda: "ars",
    })

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("devuelve notFound si el pago no existe", async () => {
    mocks.findUnique.mockResolvedValue(null)

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("devuelve notFound para un pago que no es de PayPal", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      pasarela: "MANUAL",
    })

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("devuelve notFound si el pago no tiene recibo emitido", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      reciboId: null,
    })

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("devuelve notFound si falta la referencia externa de PayPal", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      externalId: null,
      paypalOrderId: null,
    })

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })

  it("devuelve notFound si el desglose del pago no reconcilia", async () => {
    mocks.findUnique.mockResolvedValue({
      ...PAGO_PAYPAL,
      comision: 0,
    })

    await expect(ReciboPaypalPage(params())).rejects.toThrow("NOT_FOUND")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * T-03 (AC-11): /admin/pagos muestra etiquetas legibles para los estados
 * REVISION y CONTRACARGO, y distingue PayPal como metodo del pago.
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

import AdminPagos from "@/app/(admin)/admin/pagos/page"

const PAGO_BASE = {
  id: "pago_base",
  cliente: { nombre: "Cliente Demo", email: "cliente@example.com" },
  suscripcion: null,
  creadoEn: new Date("2026-10-19T12:00:00.000Z"),
  monto: 10050,
  moneda: "usd",
  metodo: "PAYPAL",
}

describe("/admin/pagos: estados nuevos y metodo PayPal (T-03, AC-11)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireStaff.mockResolvedValue({
      userId: "user_1",
      nombre: "Admin",
      rol: "admin",
      esAdmin: true,
      cliente: null,
    })
  })

  it("muestra En revisión y Contracargo en la tabla", async () => {
    mocks.findMany.mockResolvedValue([
      { ...PAGO_BASE, id: "pago_revision", estadoPago: "REVISION" },
      { ...PAGO_BASE, id: "pago_contracargo", estadoPago: "CONTRACARGO" },
    ])
    mocks.count.mockResolvedValue(2)

    render(await AdminPagos({ searchParams: Promise.resolve({}) }))

    // El texto tambien aparece en el selector de filtros: se valida la fila.
    expect(
      screen.getAllByText("En revisión").length
    ).toBeGreaterThan(1)
    expect(screen.getAllByText("Contracargo").length).toBeGreaterThan(1)
  })

  it("etiqueta el metodo PAYPAL en la fila", async () => {
    mocks.findMany.mockResolvedValue([
      { ...PAGO_BASE, id: "pago_paypal", estadoPago: "SUCCEEDED" },
    ])
    mocks.count.mockResolvedValue(1)

    render(await AdminPagos({ searchParams: Promise.resolve({}) }))

    // El metodo PayPal coincide con la pasarela y no se repite en la fila.
    expect(screen.getByText(/PayPal · Cliente Demo/)).toBeInTheDocument()
    // T-04b (AC-11, AC-18): el historial muestra el monto en es-AR.
    expect(screen.getByText(/US\$100,50/)).toBeInTheDocument()
    // T-26: el admin ve la accion de ajuste para el pago ajustable.
    expect(screen.getByTestId("ajuste-pago_paypal")).toBeInTheDocument()
  })
})

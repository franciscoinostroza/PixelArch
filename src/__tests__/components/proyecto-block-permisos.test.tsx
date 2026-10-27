import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * AC-17: las acciones de gestion del proyecto son admin-only y se ocultan
 * en la UI cuando el usuario es asistente (puedeGestionar=false).
 */

vi.mock("@/components/ui/marcar-hito-button", () => ({
  MarcarHitoButton: () => <button type="button">Marcar hito</button>,
}))
vi.mock("@/components/ui/registrar-pago-hito-button", () => ({
  RegistrarPagoHitoButton: () => <button type="button">Registrar pago hito</button>,
}))
vi.mock("@/components/ui/generar-link-hito-button", () => ({
  GenerarLinkHitoButton: () => <button type="button">Generar link hito</button>,
}))
vi.mock("@/components/ui/editar-hito-button", () => ({
  EditarHitoButton: () => <button type="button">Editar hito</button>,
}))
vi.mock("@/components/ui/agregar-hito-button", () => ({
  AgregarHitoButton: () => <button type="button">Agregar hito</button>,
}))
vi.mock("@/components/ui/editar-proyecto-button", () => ({
  EditarProyectoButton: () => <button type="button">Editar proyecto</button>,
}))
vi.mock("@/components/ui/proyecto-estado-select", () => ({
  ProyectoEstadoSelect: () => <select aria-label="Estado del proyecto" />,
}))

import { ProyectoBlock, type ProyectoConHitos } from "@/components/ui/proyecto-block"

const PROYECTO: ProyectoConHitos = {
  id: "proyecto_1",
  titulo: "Sitio corporativo",
  montoTotal: 10000,
  estado: "ACTIVO",
  notas: null,
  creadoEn: new Date("2026-01-01T12:00:00.000Z"),
  servicio: { nombre: "Web" },
  hitos: [
    {
      id: "hito_1",
      orden: 1,
      titulo: "Anticipo",
      monto: 5000,
      estado: "PENDIENTE",
      vencimiento: null,
      mpLink: null,
      mpLinkExpira: null,
      _count: { pagos: 0 },
    },
  ],
}

const ACCIONES = [
  "Editar proyecto",
  "Registrar pago hito",
  "Generar link hito",
  "Marcar hito",
  "Editar hito",
  "Agregar hito",
]

describe("ProyectoBlock: acciones admin-only (AC-17)", () => {
  it("oculta todas las acciones de gestion a la asistente", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} puedeGestionar={false} />)

    expect(screen.getByText("Sitio corporativo")).toBeInTheDocument()
    expect(screen.getByText("Anticipo")).toBeInTheDocument()
    // T-04b (AC-12, AC-18): montos del detalle del cliente en es-AR.
    expect(screen.getByText("US$100,00")).toBeInTheDocument()
    expect(screen.getByText("US$50,00")).toBeInTheDocument()

    for (const accion of ACCIONES) {
      expect(screen.queryByRole("button", { name: accion })).not.toBeInTheDocument()
    }
    expect(
      screen.queryByRole("combobox", { name: "Estado del proyecto" }),
    ).not.toBeInTheDocument()
  })

  it("muestra las acciones de gestion al admin", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} puedeGestionar />)

    for (const accion of ACCIONES) {
      expect(screen.getByRole("button", { name: accion })).toBeInTheDocument()
    }
    expect(
      screen.getByRole("combobox", { name: "Estado del proyecto" }),
    ).toBeInTheDocument()
  })
})

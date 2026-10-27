import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

/**
 * T-04b (AC-18): la suma de hitos del alta de proyecto recibe dolares y los
 * convierte a centavos para `formatearMonto`, mostrando miles y centavos.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { NuevoProyectoButton } from "@/components/ui/nuevo-proyecto-button"

describe("NuevoProyectoButton: suma de hitos en es-AR (T-04b, AC-18)", () => {
  it("convierte el total en dolares a centavos antes de formatear", async () => {
    render(<NuevoProyectoButton clienteId="cliente_1" servicios={[]} />)

    fireEvent.click(screen.getByRole("button", { name: /Nuevo proyecto/ }))
    fireEvent.change(screen.getByLabelText("Monto total (USD) *"), {
      target: { value: "1000.50" },
    })

    await waitFor(() => {
      expect(screen.getByText(/US\$1\.000,50/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/US\$100050/)).not.toBeInTheDocument()
  })
})

import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

/**
 * T-04b (AC-18, AC-24): los botones de link MP reciben `precioUsd` en centavos.
 * Si se dividieran o multiplicaran por 100 de mas, estos textos fallarian.
 */

import { GenerarLinkHitoButton } from "@/components/ui/generar-link-hito-button"
import { GenerarLinkMpButton } from "@/components/ui/generar-link-mp-button"

describe("call sites de links MP: USD en centavos (T-04b, AC-18)", () => {
  it("el hito muestra el monto en es-AR sin corrimiento", () => {
    render(
      <GenerarLinkHitoButton
        hitoId="hito_1"
        hitoTitulo="Anticipo"
        proyectoTitulo="Landing"
        precioUsd={100050}
        precioArs={null}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Link MP/ }))

    expect(screen.getByText(/Anticipo · ≈ US\$1\.000,50/)).toBeInTheDocument()
  })

  it("el soporte muestra precio mensual y total por meses en es-AR", () => {
    render(
      <GenerarLinkMpButton
        suscripcionId="suscripcion_1"
        servicio="Soporte"
        cliente="ACME"
        precioUsd={100050}
        precioArs={null}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /Link MP/ }))

    expect(screen.getByText(/ACME · US\$1\.000,50\/mes/)).toBeInTheDocument()
    expect(screen.getByText(/≈ US\$1\.000,50 × 1 mes/)).toBeInTheDocument()
  })
})

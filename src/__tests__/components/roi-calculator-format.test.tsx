import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * T-04b (AC-18): la calculadora trabaja en dolares y debe convertir a centavos
 * antes de `formatearMonto` (sin perder los centavos ni multiplicar de mas).
 */

import { RoiCalculator } from "@/components/sections/roi-calculator"

describe("RoiCalculator: formato USD es-AR (T-04b, AC-18)", () => {
  it("muestra ahorro mensual y anual con miles y centavos", () => {
    render(<RoiCalculator />)

    // Defaults: 8h/semana * 4,33 * 70% = 24h; 24h * US$15 = US$360/mes.
    expect(screen.getByText("US$360,00")).toBeInTheDocument()
    expect(screen.getByText("US$4.320,00")).toBeInTheDocument()
    expect(screen.queryByText("US$360.00")).not.toBeInTheDocument()
  })
})

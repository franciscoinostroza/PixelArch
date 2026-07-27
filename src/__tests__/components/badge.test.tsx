import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText("Active")).toBeInTheDocument()
  })

  it("applies default variant", () => {
    render(<Badge>Default</Badge>)
    expect(screen.getByText("Default").className).toContain("bg-panel")
  })

  it("applies accent variant", () => {
    render(<Badge variant="accent">Accent</Badge>)
    const badge = screen.getByText("Accent")
    expect(badge.className).toContain("bg-violet/10")
    expect(badge.className).toContain("text-violet")
  })

  it("applies accent2 variant", () => {
    render(<Badge variant="accent2">Green</Badge>)
    const badge = screen.getByText("Green")
    expect(badge.className).toContain("bg-mint/10")
    expect(badge.className).toContain("text-mint")
  })

  it("applies muted variant", () => {
    render(<Badge variant="muted">Muted</Badge>)
    const badge = screen.getByText("Muted")
    expect(badge.className).toContain("bg-panel")
    expect(badge.className).toContain("text-text-dim")
  })

  it("applies custom className", () => {
    render(<Badge className="custom">Custom</Badge>)
    expect(screen.getByText("Custom").className).toContain("custom")
  })
})

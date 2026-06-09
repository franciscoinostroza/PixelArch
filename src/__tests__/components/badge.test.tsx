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
    expect(screen.getByText("Default").className).toContain("bg-card-bg")
  })

  it("applies accent variant", () => {
    render(<Badge variant="accent">Accent</Badge>)
    const badge = screen.getByText("Accent")
    expect(badge.className).toContain("bg-accent/10")
    expect(badge.className).toContain("text-accent")
  })

  it("applies accent2 variant", () => {
    render(<Badge variant="accent2">Green</Badge>)
    const badge = screen.getByText("Green")
    expect(badge.className).toContain("bg-accent2/10")
    expect(badge.className).toContain("text-accent2")
  })

  it("applies muted variant", () => {
    render(<Badge variant="muted">Muted</Badge>)
    const badge = screen.getByText("Muted")
    expect(badge.className).toContain("bg-bg2")
    expect(badge.className).toContain("text-muted")
  })

  it("applies custom className", () => {
    render(<Badge className="custom">Custom</Badge>)
    expect(screen.getByText("Custom").className).toContain("custom")
  })
})

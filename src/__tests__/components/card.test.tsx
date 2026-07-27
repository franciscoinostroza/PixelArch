import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Content</Card>)
    expect(screen.getByText("Content")).toBeInTheDocument()
  })

  it("applies base card classes", () => {
    render(<Card>Card</Card>)
    const card = screen.getByText("Card")
    expect(card.className).toContain("rounded-xl")
    expect(card.className).toContain("border-border")
    expect(card.className).toContain("bg-panel")
  })

  it("applies custom className", () => {
    render(<Card className="custom-class">Styled</Card>)
    expect(screen.getByText("Styled").className).toContain("custom-class")
  })

  it("renders nested structure Card > CardHeader > CardTitle", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
      </Card>
    )
    expect(screen.getByText("Title")).toBeInTheDocument()
    expect(screen.getByText("Description")).toBeInTheDocument()
    expect(screen.getByText("Content")).toBeInTheDocument()
  })

  it("CardTitle uses font-display", () => {
    render(<CardTitle>Title</CardTitle>)
    expect(screen.getByText("Title").className).toContain("font-display")
  })

  it("CardDescription uses muted text", () => {
    render(<CardDescription>Desc</CardDescription>)
    expect(screen.getByText("Desc").className).toContain("text-text-dim")
  })
})

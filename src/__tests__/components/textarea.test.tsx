import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Textarea } from "@/components/ui/textarea"

describe("Textarea", () => {
  it("renders textarea element", () => {
    render(<Textarea />)
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("forwards ref", () => {
    const ref = { current: null }
    render(<Textarea ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
  })

  it("applies custom className", () => {
    render(<Textarea className="custom-class" />)
    expect(screen.getByRole("textbox").className).toContain("custom-class")
  })

  it("displays placeholder text", () => {
    render(<Textarea placeholder="Write here" />)
    expect(screen.getByPlaceholderText("Write here")).toBeInTheDocument()
  })

  it("handles value and onChange", async () => {
    const handleChange = vi.fn()
    const user = userEvent.setup()
    render(<Textarea value="" onChange={handleChange} />)
    await user.type(screen.getByRole("textbox"), "a")
    expect(handleChange).toHaveBeenCalled()
  })

  it("respects disabled state", () => {
    render(<Textarea disabled />)
    expect(screen.getByRole("textbox")).toBeDisabled()
  })
})

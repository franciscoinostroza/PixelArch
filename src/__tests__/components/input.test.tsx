import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Input } from "@/components/ui/input"

describe("Input", () => {
  it("renders input element", () => {
    render(<Input />)
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("forwards ref", () => {
    const ref = { current: null }
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it("applies custom className", () => {
    render(<Input className="custom-class" />)
    expect(screen.getByRole("textbox").className).toContain("custom-class")
  })

  it("handles type prop", () => {
    render(<Input type="email" />)
    expect(screen.getByRole("textbox")).toHaveAttribute("type", "email")
  })

  it("handles value and onChange", async () => {
    const handleChange = vi.fn()
    const user = userEvent.setup()
    render(<Input value="" onChange={handleChange} />)
    await user.type(screen.getByRole("textbox"), "a")
    expect(handleChange).toHaveBeenCalled()
  })

  it("displays placeholder text", () => {
    render(<Input placeholder="Enter name" />)
    expect(screen.getByPlaceholderText("Enter name")).toBeInTheDocument()
  })

  it("respects disabled state", () => {
    render(<Input disabled />)
    expect(screen.getByRole("textbox")).toBeDisabled()
  })
})

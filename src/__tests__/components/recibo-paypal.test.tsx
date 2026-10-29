import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-13 (AC-10, AC-24): recibo interno imprimible de PayPal.
 *
 * Cubre el contenido, el desglose exacto, el formato es-AR, la ausencia de
 * datos del pagador/tarjeta/fiscales y el boton de impresion.
 */

import {
  ReciboPaypal,
  type ReciboPaypalProps,
} from "@/components/ui/recibo-paypal"
import type { ReciboPaypal as ReciboPaypalDatos } from "@/lib/paypal/receipts"

const RECIBO: ReciboPaypalDatos = {
  reciboId: "PAY-20261020-ABCDEF123456",
  concepto: "Sitio ACME — Anticipo",
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  moneda: "usd",
  fecha: new Date("2026-10-20T12:00:00.000Z"),
  pasarela: "PAYPAL",
  referenciaExterna: "CAPTURE-ABC-1",
}

function props(overrides: Partial<ReciboPaypalProps> = {}): ReciboPaypalProps {
  return {
    recibo: RECIBO,
    cliente: { nombre: "Cliente Demo", email: "cliente@acme.test" },
    estado: "SUCCEEDED",
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ReciboPaypal: contenido y desglose (AC-10, AC-24)", () => {
  it("muestra la marca, el id, el concepto, la referencia y los datos del cliente", () => {
    render(<ReciboPaypal {...props()} />)

    expect(screen.getByText("Recibo interno de pago")).toBeInTheDocument()
    expect(screen.getByText("PAY-20261020-ABCDEF123456")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    expect(screen.getByText("cliente@acme.test")).toBeInTheDocument()
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText("CAPTURE-ABC-1")).toBeInTheDocument()
    expect(screen.getByText("PayPal")).toBeInTheDocument()
    expect(screen.getByText("USD")).toBeInTheDocument()
    expect(screen.getByText("Estado")).toBeInTheDocument()
    expect(screen.getByText("Pagado")).toBeInTheDocument()
  })

  it("muestra monto acordado, comision y total con formato es-AR", () => {
    render(<ReciboPaypal {...props()} />)

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    expect(tabla).toBeInTheDocument()

    expect(screen.getByText("Monto acordado")).toBeInTheDocument()
    expect(screen.getByText("Comisión de PayPal")).toBeInTheDocument()
    expect(screen.getByText("Total cobrado (USD)")).toBeInTheDocument()

    expect(screen.getByText("US$100,50")).toBeInTheDocument()
    expect(screen.getByText("US$6,06")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()

    // El formato en-US queda reservado a las plantillas EN.
    expect(screen.queryByText("US$100.50")).not.toBeInTheDocument()
    expect(screen.queryByText("US$106.56")).not.toBeInTheDocument()
  })

  it("muestra la misma fecha en dos renders con la misma fecha (AC-26)", () => {
    // 01:00 UTC es el dia anterior en Argentina: el formateo debe fijarse en
    // UTC para no variar entre servidor, hidratacion e impresiones.
    const recibo = { ...RECIBO, fecha: new Date("2026-10-20T01:00:00.000Z") }

    const primero = render(<ReciboPaypal {...props({ recibo })} />)
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    const domPrimero = primero.container.innerHTML
    primero.unmount()

    const segundo = render(<ReciboPaypal {...props({ recibo })} />)
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(segundo.container.innerHTML).toBe(domPrimero)
  })

  it("usa el separador de miles argentino", () => {
    render(
      <ReciboPaypal
        {...props({
          recibo: {
            ...RECIBO,
            montoAcordado: 100050,
            comision: 6000,
            total: 106050,
          },
        })}
      />
    )

    expect(screen.getByText("US$1.000,50")).toBeInTheDocument()
    expect(screen.getByText("US$1.060,50")).toBeInTheDocument()
  })

  it("no muestra datos del pagador, de tarjeta ni fiscales", () => {
    const conDatosExtra = {
      ...props(),
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador",
      tarjeta: "4111111111111111",
    } as unknown as ReciboPaypalProps

    render(<ReciboPaypal {...conDatosExtra} />)

    expect(screen.queryByText(/pagador@example\.com/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Pagador")).not.toBeInTheDocument()
    expect(screen.queryByText("4111111111111111")).not.toBeInTheDocument()
    expect(screen.queryByText(/CUIT/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/condición iva/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/factura a/i)).not.toBeInTheDocument()
    // AC-10: deja explicito que el recibo es interno y no una factura fiscal.
    expect(
      screen.getByText(/No reemplaza a una factura fiscal/i)
    ).toBeInTheDocument()
  })

  it("imprime con window.print al presionar el boton", async () => {
    const print = vi.fn()
    const originalPrint = window.print
    window.print = print
    const user = userEvent.setup()

    try {
      render(<ReciboPaypal {...props()} />)
      const boton = screen.getByRole("button", { name: "Imprimir recibo" })
      expect(boton).toHaveClass("print:hidden")
      // AC-16: foco visible al recorrer el recibo con teclado.
      expect(boton).toHaveClass("focus-visible:ring-2")
      expect(boton).toHaveClass("focus-visible:ring-cyan")
      const articulo = screen.getByRole("article")
      expect(articulo).toHaveClass("print:shadow-none")
      expect(articulo).toHaveClass("print:p-0")
      expect(articulo).toHaveClass("print:border-0")
      await user.tab()
      expect(boton).toHaveFocus()
      await user.click(boton)
      expect(print).toHaveBeenCalledTimes(1)
    } finally {
      window.print = originalPrint
    }
  })

  it("conserva el DOM historico y la tabla semantica accesible (AC-16, AC-21)", () => {
    render(<ReciboPaypal {...props()} />)

    const articulo = screen.getByRole("article")
    const titulo = screen.getByRole("heading", {
      level: 1,
      name: "Recibo interno de pago",
    })
    expect(titulo).toHaveAttribute("id", "recibo-paypal-titulo")
    expect(articulo).toHaveAttribute("aria-labelledby", "recibo-paypal-titulo")

    const definiciones = articulo.querySelector("dl")
    expect(definiciones).not.toBeNull()
    expect(definiciones?.querySelectorAll("dt")).toHaveLength(6)

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    const caption = tabla.querySelector("caption")
    expect(caption).toHaveClass("sr-only")
    expect(caption).toHaveTextContent("Desglose del pago en dólares estadounidenses")

    const columnas = within(tabla).getAllByRole("columnheader")
    expect(columnas).toHaveLength(2)
    for (const columna of columnas) {
      expect(columna).toHaveAttribute("scope", "col")
    }

    // Monto acordado, comision y total (tfoot) se leen como texto.
    const filas = within(tabla).getAllByRole("rowheader")
    expect(filas).toHaveLength(3)
    for (const fila of filas) {
      expect(fila).toHaveAttribute("scope", "row")
    }
    const total = within(tabla).getByRole("rowheader", {
      name: "Total cobrado (USD)",
    })
    const pie = tabla.querySelector("tfoot")
    expect(pie).not.toBeNull()
    expect(pie).toContainElement(total)
  })

  it("la hoja de estilos de impresion oculta sidebar y margenes del admin (AC-10)", () => {
    // El recibo se renderiza dentro del layout admin (`admin.css`). En papel o
    // PDF no debe arrastrar la sidebar ni el padding del area de contenido.
    const css = readFileSync(
      join(process.cwd(), "src", "app", "(admin)", "admin.css"),
      "utf8"
    )

    const mediaPrint = css.indexOf("@media print")
    expect(mediaPrint).toBeGreaterThanOrEqual(0)
    const bloque = css.slice(mediaPrint)

    // AC-15: el recibo se imprime en una pagina A4 con margenes acotados.
    expect(bloque).toMatch(/@page\s*\{[^}]*size:\s*A4/)
    expect(bloque).toMatch(/@page\s*\{[^}]*margin:\s*12mm/)
    expect(bloque).toMatch(/\.a-shell\s*\{[^}]*display:\s*block/)
    expect(bloque).toMatch(
      /\.a-shell \.a-side,[\s\S]*?\.a-shell \.a-menu,[\s\S]*?\.a-shell \.a-side-foot\s*\{[^}]*display:\s*none/
    )
    expect(bloque).toMatch(/\.a-shell \.a-main\s*\{[^}]*margin-left:\s*0/)
    expect(bloque).toMatch(/\.a-shell \.a-main\s*\{[^}]*padding:\s*0/)
  })
})

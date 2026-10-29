import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-04 (AC-3, AC-6, AC-7, AC-13, AC-15, AC-16, AC-26): recibo interno de
 * Mercado Pago.
 *
 * Cubre el contenido, el desglose ARS/USD, la comision 0 vs > 0, la ausencia de
 * PII del pagador, la impresion, la accesibilidad y la estabilidad de la fecha.
 * Incluye ademas el default de `ReciboPago` (Review T-03): `idTitulo` y
 * `reciboIdClassName` con `break-words` cuando el adaptador no los pisa.
 */

import {
  ReciboMercadoPago,
  type ReciboMercadoPagoProps,
} from "@/components/ui/recibo-mercadopago"
import { ReciboPago, type ReciboPagoDatos } from "@/components/ui/recibo-pago"
import type { ReciboMercadoPago as ReciboMercadoPagoDatos } from "@/lib/mp-utils"

const RECIBO: ReciboMercadoPagoDatos = {
  reciboId: "MP-20261020-0123456789ABCDEF0123456789ABCDEF",
  concepto: "Sitio ACME — Anticipo",
  montoAcordado: 100000,
  comision: 0,
  total: 100000,
  moneda: "ars",
  fecha: new Date("2026-10-20T12:00:00.000Z"),
  pasarela: "MERCADOPAGO",
  referenciaExterna: "1234567890",
}

function props(overrides: Partial<ReciboMercadoPagoProps> = {}): ReciboMercadoPagoProps {
  return {
    recibo: RECIBO,
    cliente: { nombre: "Cliente Demo", email: "cliente@acme.test" },
    estado: "SUCCEEDED",
    ...overrides,
  }
}

/** Recibo en dolares con comision real (> 0) para el desglose completo. */
const RECIBO_USD: ReciboMercadoPagoDatos = {
  ...RECIBO,
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  moneda: "usd",
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ReciboMercadoPago: contenido (AC-3, AC-13)", () => {
  it("muestra la marca, el id, el estado, el cliente, el concepto, la pasarela y la referencia", () => {
    render(<ReciboMercadoPago {...props()} />)

    const articulo = screen.getByRole("article")
    expect(articulo).toHaveTextContent("PixelArch")
    expect(screen.getByText("Recibo interno de pago")).toBeInTheDocument()
    expect(screen.getByText(RECIBO.reciboId)).toBeInTheDocument()
    expect(screen.getByText("Cliente Demo")).toBeInTheDocument()
    expect(screen.getByText("cliente@acme.test")).toBeInTheDocument()
    expect(screen.getByText("Sitio ACME — Anticipo")).toBeInTheDocument()
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(screen.getByText("Mercado Pago")).toBeInTheDocument()
    expect(screen.getByText("1234567890")).toBeInTheDocument()
    expect(screen.getByText("ARS")).toBeInTheDocument()
    expect(screen.getByText("Estado")).toBeInTheDocument()
    expect(screen.getByText("Pagado")).toBeInTheDocument()
  })

  it("no muestra datos del pagador, de tarjeta ni fiscales (AC-13)", () => {
    const conDatosExtra = {
      ...props(),
      pagadorEmail: "pagador@example.com",
      pagadorNombre: "Pagador Demo",
      tarjeta: "4111 1111 1111 1111",
      cvu: "0000003100010000000001",
    } as unknown as ReciboMercadoPagoProps

    render(<ReciboMercadoPago {...conDatosExtra} />)

    expect(screen.queryByText(/pagador@example\.com/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Pagador Demo")).not.toBeInTheDocument()
    expect(screen.queryByText("4111 1111 1111 1111")).not.toBeInTheDocument()
    expect(screen.queryByText("0000003100010000000001")).not.toBeInTheDocument()
    expect(screen.queryByText(/CBU|CVU/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CUIT/i)).not.toBeInTheDocument()
    // El recibo es interno y deja explicito que no es una factura fiscal.
    expect(screen.getByText(/No reemplaza a una factura fiscal/i)).toBeInTheDocument()
  })
})

describe("ReciboMercadoPago: moneda y desglose (AC-6, AC-7)", () => {
  it("en ARS usa el formato del CRM y no mezcla USD", () => {
    render(<ReciboMercadoPago {...props()} />)

    expect(screen.getByText("Total cobrado (ARS)")).toBeInTheDocument()
    // Con comision 0 el monto acordado y el total coinciden: ambos se leen como
    // texto en la fila y en el pie de la tabla.
    expect(screen.getAllByText("$1.000 ARS")).toHaveLength(2)
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument()
    expect(screen.queryByText("Total cobrado (USD)")).not.toBeInTheDocument()
    expect(screen.queryByText("USD")).not.toBeInTheDocument()
  })

  it("en USD usa el formato del CRM y no mezcla ARS", () => {
    render(<ReciboMercadoPago {...props({ recibo: RECIBO_USD })} />)

    expect(screen.getByText("Total cobrado (USD)")).toBeInTheDocument()
    expect(screen.getByText("US$100,50")).toBeInTheDocument()
    expect(screen.getByText("US$6,06")).toBeInTheDocument()
    expect(screen.getByText("US$106,56")).toBeInTheDocument()
    expect(screen.queryByText(/\$[\d.,]+\s+ARS/)).not.toBeInTheDocument()
    expect(screen.queryByText("Total cobrado (ARS)")).not.toBeInTheDocument()

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    expect(tabla.querySelector("caption")).toHaveTextContent(
      "Desglose del pago en dólares estadounidenses"
    )
  })

  it("con comision 0 no muestra la fila de comision ni inventa un desglose (AC-6)", () => {
    render(<ReciboMercadoPago {...props()} />)

    expect(screen.queryByText("Comisión de Mercado Pago")).not.toBeInTheDocument()
    expect(screen.getByText(/coincide con el monto acordado/)).toBeInTheDocument()

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    // Monto acordado + total (tfoot); sin fila de comision.
    expect(within(tabla).getAllByRole("rowheader")).toHaveLength(2)
  })

  it("con comision > 0 muestra el desglose completo y el total", () => {
    const recibo: ReciboMercadoPagoDatos = {
      ...RECIBO,
      montoAcordado: 1000000,
      comision: 50000,
      total: 1050000,
    }

    render(<ReciboMercadoPago {...props({ recibo })} />)

    expect(screen.getByText("Monto acordado")).toBeInTheDocument()
    expect(screen.getByText("Comisión de Mercado Pago")).toBeInTheDocument()
    expect(screen.getByText("$10.000 ARS")).toBeInTheDocument()
    expect(screen.getByText("$500 ARS")).toBeInTheDocument()
    expect(screen.getByText("$10.500 ARS")).toBeInTheDocument()
    expect(screen.getByText(/incluye la comisión de Mercado Pago/)).toBeInTheDocument()

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    expect(within(tabla).getAllByRole("rowheader")).toHaveLength(3)
  })

  it("usa el separador de miles argentino en ARS", () => {
    const recibo: ReciboMercadoPagoDatos = {
      ...RECIBO,
      montoAcordado: 12345600,
      comision: 0,
      total: 12345600,
    }

    render(<ReciboMercadoPago {...props({ recibo })} />)

    expect(screen.getAllByText("$123.456 ARS")).toHaveLength(2)
  })
})

describe("ReciboMercadoPago: estados (AC-9, AC-10)", () => {
  it.each([
    ["SUCCEEDED", "Pagado"],
    ["REVISION", "En revision"],
    ["REFUNDED", "Reembolsado"],
    ["CONTRACARGO", "Contracargo"],
  ] as const)("muestra el estado %s como texto: %s", (estado, etiqueta) => {
    render(<ReciboMercadoPago {...props({ estado })} />)

    const estadoTexto = screen.getByText(etiqueta)
    expect(estadoTexto.tagName).toBe("P")
    expect(estadoTexto).toBeVisible()

    if (estado !== "SUCCEEDED") {
      // AC-9/AC-10: REVISION, REFUNDED y CONTRACARGO nunca dicen "Pagado".
      expect(screen.queryByText("Pagado")).not.toBeInTheDocument()
    }
  })
})

describe("ReciboMercadoPago: impresion y accesibilidad (AC-15, AC-16)", () => {
  it("oculta el boton al imprimir y llama a window.print", async () => {
    const print = vi.fn()
    const originalPrint = window.print
    window.print = print
    const user = userEvent.setup()

    try {
      render(<ReciboMercadoPago {...props()} />)
      const boton = screen.getByRole("button", { name: "Imprimir recibo" })

      expect(boton).toHaveClass("print:hidden")
      expect(boton.parentElement).toHaveClass("print:hidden")
      // Foco visible al recorrer el recibo con teclado.
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

  it("usa un titulo propio y una tabla semantica con caption y scope", () => {
    render(<ReciboMercadoPago {...props()} />)

    const articulo = screen.getByRole("article")
    const titulo = screen.getByRole("heading", {
      level: 1,
      name: "Recibo interno de pago",
    })
    expect(titulo).toHaveAttribute("id", "recibo-mercadopago-titulo")
    expect(articulo).toHaveAttribute("aria-labelledby", "recibo-mercadopago-titulo")

    const tabla = screen.getByRole("table", { name: /desglose del pago/i })
    const caption = tabla.querySelector("caption")
    expect(caption).toHaveClass("sr-only")
    expect(caption).toHaveTextContent("Desglose del pago en pesos argentinos")

    const columnas = within(tabla).getAllByRole("columnheader")
    expect(columnas).toHaveLength(2)
    for (const columna of columnas) {
      expect(columna).toHaveAttribute("scope", "col")
    }

    const filas = within(tabla).getAllByRole("rowheader")
    expect(filas).toHaveLength(2)
    for (const fila of filas) {
      expect(fila).toHaveAttribute("scope", "row")
    }

    const total = within(tabla).getByRole("rowheader", {
      name: "Total cobrado (ARS)",
    })
    const pie = tabla.querySelector("tfoot")
    expect(pie).not.toBeNull()
    expect(pie).toContainElement(total)
  })

  it("usa `break-words` por default en el id y en la referencia externa (Review T-03)", () => {
    const recibo: ReciboMercadoPagoDatos = {
      ...RECIBO,
      referenciaExterna: "MP-PAYMENT-ID-123456789012345678901234567890",
    }

    render(<ReciboMercadoPago {...props({ recibo })} />)

    // El adaptador no pisa `reciboIdClassName`: el default del generico evita
    // que un identificador largo se corte en A4.
    expect(screen.getByText(recibo.reciboId)).toHaveClass("break-words")
    expect(screen.getByText(recibo.referenciaExterna)).toHaveClass("break-words")
  })

  it("muestra la misma fecha en dos renders con la misma fecha (AC-26)", () => {
    // 01:00 UTC es el dia anterior en Argentina: el formateo debe fijarse en
    // UTC para no variar entre servidor, hidratacion e impresiones.
    const recibo: ReciboMercadoPagoDatos = {
      ...RECIBO,
      fecha: new Date("2026-10-20T01:00:00.000Z"),
    }

    const primero = render(<ReciboMercadoPago {...props({ recibo })} />)
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    const domPrimero = primero.container.innerHTML
    primero.unmount()

    const segundo = render(<ReciboMercadoPago {...props({ recibo })} />)
    expect(screen.getByText("20 de octubre de 2026")).toBeInTheDocument()
    expect(segundo.container.innerHTML).toBe(domPrimero)
  })
})

describe("ReciboPago: defaults del generico (Review T-03)", () => {
  const DATOS: ReciboPagoDatos = {
    reciboId: "PAGO-DEFAULT-1",
    concepto: "Concepto generico",
    fecha: new Date("2026-10-20T12:00:00.000Z"),
    pasarelaLabel: "Mercado Pago",
    referenciaExterna: "REF-GENERICA-1",
    moneda: "ars",
    monedaLabel: "ARS",
    filas: [{ etiqueta: "Monto acordado", monto: 100000 }],
    total: 100000,
    etiquetaTotal: "Total cobrado (ARS)",
    caption: "Desglose del pago en pesos argentinos",
    notaImportes: "Nota de importes",
  }

  it("sin props opcionales usa `recibo-pago-titulo` y `break-words`", () => {
    render(
      <ReciboPago
        recibo={DATOS}
        cliente={{ nombre: "Cliente Demo" }}
        estado="SUCCEEDED"
      />
    )

    const articulo = screen.getByRole("article")
    const titulo = screen.getByRole("heading", {
      level: 1,
      name: "Recibo interno de pago",
    })
    expect(titulo).toHaveAttribute("id", "recibo-pago-titulo")
    expect(articulo).toHaveAttribute("aria-labelledby", "recibo-pago-titulo")
    expect(screen.getByText(DATOS.reciboId)).toHaveClass("break-words")
  })
})

describe("ReciboMercadoPago: limites de importacion (T-04, R-8)", () => {
  function leerFuente(relativa: string) {
    return readFileSync(join(process.cwd(), relativa), "utf8")
  }

  it("no importa el dominio server-only mp-recibo ni node:crypto", () => {
    const fuente = leerFuente("src/components/ui/recibo-mercadopago.tsx")

    // R-8: `mp-recibo.ts` usa `node:crypto`; el adaptador cliente solo puede
    // tomar el tipo del modulo browser-safe `mp-utils.ts`.
    expect(fuente).not.toMatch(/@\/lib\/mp-recibo/)
    expect(fuente).not.toMatch(/(?:from\s+|require\s*\(\s*)["'](?:node:)?crypto["']/)
    expect(fuente).toMatch(
      /import\s+type\s+\{[^}]*\}\s+from\s+["']@\/lib\/mp-utils["']/
    )
  })

  it("el generico ReciboPago tampoco arrastra el dominio server-only", () => {
    const fuente = leerFuente("src/components/ui/recibo-pago.tsx")

    expect(fuente).not.toMatch(/@\/lib\/mp-recibo/)
    expect(fuente).not.toMatch(/(?:from\s+|require\s*\(\s*)["'](?:node:)?crypto["']/)
  })
})

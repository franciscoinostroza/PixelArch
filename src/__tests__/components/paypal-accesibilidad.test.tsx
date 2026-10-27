import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"

/**
 * T-28 (AC-23): pase de accesibilidad de los flujos PayPal.
 *
 * Cubre los cuatro modales (link, registro manual, ajuste y revision):
 * - foco inicial en el dialogo y retorno al disparador;
 * - Escape y trampa de foco con Tab/Shift+Tab;
 * - `aria-labelledby` / `aria-describedby`, `aria-live` y `role=alert`;
 * - labels de los campos y estados expresados con texto, no solo color;
 * - bloqueo de cierre (Escape, X y fondo) mientras la operacion esta en curso;
 * - contraste: los textos informativos del admin usan `--color-text-dim`.
 *
 * No hay red: callbacks y `fetch` se mockean.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import { AjustePaypalButton } from "@/components/ui/ajuste-paypal-button"
import { GenerarLinkPaypalButton } from "@/components/ui/generar-link-paypal-button"
import type { PaypalEnviarResult } from "@/components/ui/paypal-link-modal"
import { PaypalDialog } from "@/components/ui/paypal-dialog"
import { RegistrarPagoPaypalButton } from "@/components/ui/registrar-pago-paypal-button"
import {
  RevisionPaypalButton,
  type ResolverRevisionPaypalResult,
} from "@/components/ui/revision-paypal-button"

function enFuturo(dias = 10): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString()
}

const ENLACE = {
  enlaceId: "enlace_1",
  url: "https://pixelarch.dev/pago/paypal/token-1",
  montoAcordado: 10050,
  comision: 606,
  total: 10656,
  expiraEn: enFuturo(),
  reutilizado: true,
}

const AJUSTE_PAGO = {
  id: "pago_1",
  monto: 10656,
  moneda: "usd",
  montoAjustado: 0,
  tieneHito: true,
  tieneSoporte: false,
  estadoPago: "SUCCEEDED",
  revisionEstado: null,
  concepto: "Sitio ACME — Anticipo",
  referencia: "Capture CAPTURE-1",
  pasarela: "PAYPAL",
}

const REVISION_PAGO = {
  id: "pago_revision",
  monto: 10000,
  montoEsperado: 10656,
  montoAcordado: 9394,
  comision: 606,
  moneda: "usd",
  revisionNota: "El total capturado no coincide con el total esperado del link.",
  revisionEstado: "PENDIENTE",
  estadoPago: "REVISION",
  pasarela: "PAYPAL",
  concepto: "Sitio ACME — Anticipo",
  referencia: "Capture CAPTURE-1",
  externalId: "CAPTURE-1",
  paypalOrderId: "ORDER-1",
  tieneHito: true,
  tieneSoporte: false,
  meses: null,
}

type Flujo = "link" | "manual" | "ajuste" | "revision"

const FLUJOS: ReadonlyArray<{
  flujo: Flujo
  disparador: string
  titulo: string
}> = [
  {
    flujo: "link",
    disparador: "Generar link PayPal",
    titulo: "Link de pago PayPal",
  },
  {
    flujo: "manual",
    disparador: "Registrar pago PayPal",
    titulo: "Registrar pago PayPal",
  },
  {
    flujo: "ajuste",
    disparador: "Ajuste PayPal",
    titulo: "Reembolso o contracargo",
  },
  {
    flujo: "revision",
    disparador: "Revisar diferencia",
    titulo: "Resolver revisión de pago",
  },
]

function renderFlujo(flujo: Flujo) {
  switch (flujo) {
    case "link":
      return render(
        <GenerarLinkPaypalButton
          concepto={{ tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" }}
          montoAcordadoDefaultCents={10050}
          feeBps={540}
          feeFixedCents={30}
          paypalDisponible
          enlaceExistente={ENLACE}
          generarLink={vi.fn()}
          enviarLink={vi.fn()}
        />
      )
    case "manual":
      return render(
        <RegistrarPagoPaypalButton
          conceptos={[
            {
              tipo: "hito",
              hitoId: "hito_1",
              titulo: "Anticipo",
              montoAcordadoCents: 10050,
            },
          ]}
          feeBps={540}
          feeFixedCents={30}
          puedeRegistrarManual
        />
      )
    case "ajuste":
      return render(
        <AjustePaypalButton pago={AJUSTE_PAGO} puedeRegistrarAjuste />
      )
    case "revision":
      return render(
        <RevisionPaypalButton
          pago={REVISION_PAGO}
          puedeResolverRevision
        />
      )
  }
}

async function abrirFlujo(flujo: Flujo) {
  const definicion = FLUJOS.find((candidato) => candidato.flujo === flujo)
  if (!definicion) throw new Error(`Flujo desconocido: ${flujo}`)

  const user = userEvent.setup()
  const trigger = screen.getByRole("button", {
    name: definicion.disparador,
  })
  await user.click(trigger)
  const dialog = screen.getByRole("dialog", { name: definicion.titulo })

  return { user, trigger, dialog }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("PaypalDialog: no cierra mientras la operacion esta en curso", () => {
  it("bloquea Escape, la X y el fondo con busy y los habilita al terminar", async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    const { rerender } = render(
      <PaypalDialog open onClose={onClose} title="Dialogo de prueba" busy>
        <button type="button">Accion</button>
      </PaypalDialog>
    )

    const dialog = screen.getByRole("dialog", { name: "Dialogo de prueba" })
    expect(dialog).toHaveAttribute("aria-busy", "true")

    await user.keyboard("{Escape}")
    expect(onClose).not.toHaveBeenCalled()

    const cerrar = screen.getByRole("button", { name: "Cerrar modal" })
    expect(cerrar).toBeDisabled()
    fireEvent.click(cerrar)
    expect(onClose).not.toHaveBeenCalled()

    // Un click programatico en el fondo tampoco cierra mientras esta busy.
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()

    rerender(
      <PaypalDialog open onClose={onClose} title="Dialogo de prueba">
        <button type="button">Accion</button>
      </PaypalDialog>
    )

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("flujos PayPal: foco, aria y teclado (AC-23)", () => {
  it.each(FLUJOS)(
    "$flujo: foco inicial, aria-labelledby/describedby y aria-live",
    async ({ flujo, titulo }) => {
      const { unmount } = renderFlujo(flujo)
      const { dialog } = await abrirFlujo(flujo)

      expect(dialog).toHaveAttribute("aria-modal", "true")
      expect(dialog).toHaveFocus()

      const labelledby = dialog.getAttribute("aria-labelledby")
      expect(labelledby).toBeTruthy()
      expect(
        labelledby ? document.getElementById(labelledby)?.textContent : null
      ).toBe(titulo)

      const describedby = dialog.getAttribute("aria-describedby")
      expect(describedby).toBeTruthy()
      expect(
        describedby ? document.getElementById(describedby) : null
      ).not.toBeNull()

      expect(within(dialog).getByRole("status")).toHaveAttribute(
        "aria-live",
        "polite"
      )

      unmount()
    }
  )

  it.each(FLUJOS)(
    "$flujo: Escape cierra y devuelve el foco al disparador",
    async ({ flujo }) => {
      const { unmount } = renderFlujo(flujo)
      const { user, trigger } = await abrirFlujo(flujo)

      await user.keyboard("{Escape}")

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()

      unmount()
    }
  )

  it.each(FLUJOS)(
    "$flujo: atrapa el foco con Tab y Shift+Tab",
    async ({ flujo }) => {
      const { unmount } = renderFlujo(flujo)
      const { user, dialog } = await abrirFlujo(flujo)

      for (let i = 0; i < 10; i += 1) {
        await user.tab()
        expect(dialog).toContainElement(document.activeElement as HTMLElement)
      }

      for (let i = 0; i < 5; i += 1) {
        await user.tab({ shift: true })
        expect(dialog).toContainElement(document.activeElement as HTMLElement)
      }

      unmount()
    }
  )

  it.each(FLUJOS)(
    "$flujo: los campos tienen label accesible",
    async ({ flujo }) => {
      const { unmount } = renderFlujo(flujo)
      const { dialog } = await abrirFlujo(flujo)

      const labels: Record<Flujo, string[]> = {
        link: ["Monto acordado (USD)", "Idioma del mensaje", "Link de pago"],
        manual: [
          "Concepto",
          "Capture id",
          "Order id",
          "Monto acordado (USD)",
          "Comisión (USD)",
          "Total (USD)",
          "Evidencia (texto o URL)",
          "Fecha de registro",
        ],
        ajuste: [
          "Tipo de ajuste",
          "Monto del ajuste (USD)",
          "Motivo",
          "Evidencia",
          "Decisión",
        ],
        revision: ["Nota (opcional)"],
      }

      for (const label of labels[flujo]) {
        expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
      }

      if (flujo === "revision") {
        expect(
          within(dialog).getByRole("radio", {
            name: /Aceptar la diferencia y aplicar el pago/,
          })
        ).toBeInTheDocument()
        expect(
          within(dialog).getByRole("radio", {
            name: /Rechazar la diferencia/,
          })
        ).toBeInTheDocument()
      }

      unmount()
    }
  )
})

describe("flujos PayPal: errores y estados con texto (AC-23)", () => {
  it("link: aria-invalid + role=alert y estado visible sin depender del color", async () => {
    renderFlujo("link")
    const { user, dialog } = await abrirFlujo("link")

    const monto = within(dialog).getByLabelText("Monto acordado (USD)")
    await user.clear(monto)
    await user.type(monto, "abc")

    expect(monto).toHaveAttribute("aria-invalid", "true")
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Ingresá un monto válido en USD (por ejemplo 100,50)."
    )
    expect(within(dialog).getByText(/Link vigente reutilizado/)).toBeInTheDocument()
    expect(within(dialog).getByText(/válido hasta/)).toBeInTheDocument()
  })

  it("manual: error role=alert y aria-invalid en la referencia", async () => {
    renderFlujo("manual")
    const { user, dialog } = await abrirFlujo("manual")

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Indicá el capture id y/o el order id de PayPal."
    )
    expect(within(dialog).getByLabelText("Capture id")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(
      within(dialog).getByText(/El pago original|Se emite con los datos del cliente/)
    ).toBeInTheDocument()
  })

  it("ajuste: error role=alert y aviso textual de que conserva el pago", async () => {
    renderFlujo("ajuste")
    const { user, dialog } = await abrirFlujo("ajuste")

    await user.click(
      within(dialog).getByRole("button", { name: "Registrar ajuste" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Indicá al menos un motivo o una evidencia."
    )
    expect(
      within(dialog).getByText(/El pago original se conserva/)
    ).toBeInTheDocument()
  })

  it("revision: muestra la diferencia con texto, no solo con color", async () => {
    renderFlujo("revision")
    const { user, dialog } = await abrirFlujo("revision")

    expect(within(dialog).getByText("Cobrado")).toBeInTheDocument()
    expect(within(dialog).getByText("Esperado")).toBeInTheDocument()
    expect(within(dialog).getByText("Diferencia")).toBeInTheDocument()
    expect(
      within(dialog).getByText("El cobro es menor al esperado.")
    ).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole("button", { name: "Continuar" })
    )

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "¿Confirmás aceptar la diferencia y aplicar el pago?"
    )
  })

  it("revision: bloquea aceptar una captura en moneda distinta", async () => {
    render(
      <RevisionPaypalButton
        pago={{
          ...REVISION_PAGO,
          moneda: "eur",
          revisionNota: "Moneda capturada EUR",
        }}
        puedeResolverRevision
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Revisar diferencia" }))
    const dialog = screen.getByRole("dialog", {
      name: "Resolver revisión de pago",
    })

    expect(
      within(dialog).getByRole("radio", {
        name: /Aceptar la diferencia y aplicar el pago/,
      })
    ).toBeDisabled()
    expect(
      within(dialog).getByText(
        /No se puede aceptar un pago en moneda distinta de USD/
      )
    ).toBeInTheDocument()
  })
})

describe("flujos PayPal: bloqueo de cierre durante la peticion (AC-23)", () => {
  it("manual: Escape y la X no cierran mientras registra", async () => {
    let resolver: ((valor: { ok: boolean; pagoId: string | null }) => void) | undefined
    const registrarPago = vi.fn(
      () =>
        new Promise<{ ok: boolean; pagoId: string | null }>((resolve) => {
          resolver = resolve
        })
    )

    render(
      <RegistrarPagoPaypalButton
        conceptos={[
          {
            tipo: "hito",
            hitoId: "hito_1",
            titulo: "Anticipo",
            montoAcordadoCents: 10050,
          },
        ]}
        feeBps={540}
        feeFixedCents={30}
        puedeRegistrarManual
        registrarPago={registrarPago}
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Registrar pago PayPal" }))
    const dialog = screen.getByRole("dialog", { name: "Registrar pago PayPal" })

    await user.type(within(dialog).getByLabelText("Capture id"), "CAPTURE-1")
    await user.type(
      within(dialog).getByLabelText("Evidencia (texto o URL)"),
      "Comprobante recibido"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Registrar pago" })
    )

    expect(dialog).toHaveAttribute("aria-busy", "true")

    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    const cerrar = within(dialog).getByRole("button", { name: "Cerrar modal" })
    expect(cerrar).toBeDisabled()
    fireEvent.click(cerrar)
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await act(async () => {
      resolver?.({ ok: true, pagoId: "pago_1" })
    })
  })

  it("revision: Escape y la X no cierran mientras resuelve la diferencia", async () => {
    let resolver: ((valor: ResolverRevisionPaypalResult) => void) | undefined
    const resolverRevision = vi.fn(
      () =>
        new Promise<ResolverRevisionPaypalResult>((resolve) => {
          resolver = resolve
        })
    )

    render(
      <RevisionPaypalButton
        pago={REVISION_PAGO}
        puedeResolverRevision
        resolverRevision={resolverRevision}
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Revisar diferencia" }))
    const dialog = screen.getByRole("dialog", {
      name: "Resolver revisión de pago",
    })

    await user.click(within(dialog).getByRole("button", { name: "Continuar" }))
    await user.click(
      await within(dialog).findByRole("button", { name: "Confirmar aceptación" })
    )

    expect(dialog).toHaveAttribute("aria-busy", "true")

    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    const cerrar = within(dialog).getByRole("button", { name: "Cerrar modal" })
    expect(cerrar).toBeDisabled()
    fireEvent.click(cerrar)
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await act(async () => {
      resolver?.({
        ok: true,
        pagoId: "pago_revision",
        accion: "ACEPTAR",
        estadoPago: "SUCCEEDED",
        revisionEstado: "ACEPTADO",
        reciboId: "RECIBO-1",
        hitoAplicado: true,
        mesesAcreditados: null,
      })
    })
  })

  it("link: Escape no cierra mientras envia el cobro", async () => {
    let resolver: ((valor: PaypalEnviarResult) => void) | undefined
    const enviarLink = vi.fn(
      () =>
        new Promise<PaypalEnviarResult>((resolve) => {
          resolver = resolve
        })
    )

    render(
      <GenerarLinkPaypalButton
        concepto={{ tipo: "hito", hitoId: "hito_1", titulo: "Anticipo" }}
        montoAcordadoDefaultCents={10050}
        feeBps={540}
        feeFixedCents={30}
        paypalDisponible
        enlaceExistente={ENLACE}
        generarLink={vi.fn()}
        enviarLink={enviarLink}
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Generar link PayPal" }))
    const dialog = screen.getByRole("dialog", { name: "Link de pago PayPal" })

    await user.click(
      within(dialog).getByRole("button", { name: "Enviar por email" })
    )

    expect(dialog).toHaveAttribute("aria-busy", "true")

    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    const cerrar = within(dialog).getByRole("button", { name: "Cerrar modal" })
    expect(cerrar).toBeDisabled()

    await act(async () => {
      resolver?.({
        ok: true,
        canal: "EMAIL",
        enviado: true,
      })
    })
  })
})

function colorDe(css: string, nombre: string): string {
  const match = css.match(
    new RegExp(`${nombre}\\s*:\\s*(#[0-9a-fA-F]{6})`)
  )
  if (!match) throw new Error(`No se encontro ${nombre}`)
  return match[1]
}

function luminanciaRelativa(hex: string): number {
  const canales = [1, 3, 5].map((indice) => {
    const valor = Number.parseInt(hex.slice(indice, indice + 2), 16) / 255
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2]
}

function razonDeContraste(primero: string, segundo: string): number {
  const [claro, oscuro] = [
    luminanciaRelativa(primero),
    luminanciaRelativa(segundo),
  ].sort((a, b) => b - a)
  return (claro + 0.05) / (oscuro + 0.05)
}

describe("contraste y estados no dependientes del color", () => {
  it("mantiene contraste AA en el texto informativo sobre el panel (AC-23)", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8"
    )
    const panel = colorDe(css, "--color-panel")
    const dim = colorDe(css, "--color-text-dim")
    const texto = colorDe(css, "--color-text")

    // El admin usa --color-text-dim para informacion (>= 4.5:1) y deja
    // --color-text-faint solo para adornos.
    expect(razonDeContraste(dim, panel)).toBeGreaterThanOrEqual(4.5)
    expect(razonDeContraste(texto, panel)).toBeGreaterThanOrEqual(7)
  })

  it("usa --color-text-dim en los textos informativos del admin", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/(admin)/admin.css"),
      "utf8"
    )

    expect(css).toMatch(
      /\.a-table th \{[^}]*color: var\(--color-text-dim\)/
    )
    expect(css).toMatch(
      /\.a-table \.a-faint \{[^}]*color: var\(--color-text-dim\)/
    )
    expect(css).toMatch(
      /\.a-prow \.a-date \{[^}]*color: var\(--color-text-dim\)/
    )
    expect(css).toMatch(
      /\.a-field::placeholder \{ color: var\(--color-text-dim\) \}/
    )
  })
})

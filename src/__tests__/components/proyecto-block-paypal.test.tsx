import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * T-21 (AC-1, AC-2, AC-12, AC-26): el bloque de proyecto ofrece PayPal solo en
 * hitos pendientes, con la configuracion server-side y el link vigente/ultimo
 * intento del grupo. La asistente opera PayPal; las acciones de gestion
 * (registrar pago, marcar/editar hito) siguen siendo admin-only.
 */

import type { GenerarLinkPaypalButtonProps } from "@/components/ui/generar-link-paypal-button"
import type { ProyectoConHitos } from "@/components/ui/proyecto-block"

vi.mock("@/components/ui/marcar-hito-button", () => ({
  MarcarHitoButton: () => <button type="button">Marcar hito</button>,
}))
vi.mock("@/components/ui/registrar-pago-hito-button", () => ({
  RegistrarPagoHitoButton: () => <button type="button">Registrar pago hito</button>,
}))
vi.mock("@/components/ui/generar-link-hito-button", () => ({
  GenerarLinkHitoButton: () => <button type="button">Generar link hito</button>,
}))
vi.mock("@/components/ui/editar-hito-button", () => ({
  EditarHitoButton: () => <button type="button">Editar hito</button>,
}))
vi.mock("@/components/ui/agregar-hito-button", () => ({
  AgregarHitoButton: () => <button type="button">Agregar hito</button>,
}))
vi.mock("@/components/ui/editar-proyecto-button", () => ({
  EditarProyectoButton: () => <button type="button">Editar proyecto</button>,
}))
vi.mock("@/components/ui/proyecto-estado-select", () => ({
  ProyectoEstadoSelect: () => <select aria-label="Estado del proyecto" />,
}))
vi.mock("@/components/ui/generar-link-paypal-button", () => ({
  GenerarLinkPaypalButton: (props: GenerarLinkPaypalButtonProps) => {
    const conceptoId =
      props.concepto.tipo === "hito"
        ? props.concepto.hitoId
        : props.concepto.suscripcionId
    return (
      <button
        type="button"
        data-testid={`paypal-${props.concepto.tipo}-${conceptoId}`}
        data-enlace={props.enlaceExistente?.enlaceId ?? ""}
        data-ultimo={props.ultimoIntento?.estado ?? ""}
        data-fee={`${props.feeBps}/${props.feeFixedCents}`}
        data-disponible={String(props.paypalDisponible)}
        aria-label={props.ariaLabel}
      >
        {props.label ?? "PayPal"}
      </button>
    )
  },
}))

import { ProyectoBlock } from "@/components/ui/proyecto-block"

// Fechas relativas al momento del test: el componente resuelve la vigencia con
// `new Date()`, asi que un fixture con fecha fija caducaria con el tiempo.
const DIA_MS = 24 * 60 * 60 * 1000
const enDias = (dias: number) =>
  new Date(Date.now() + dias * DIA_MS).toISOString()

const ENLACE_ACTIVO = {
  id: "enlace_activo",
  url: "https://pixelarch.dev/pago/paypal/activo",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: enDias(20),
  estado: "ACTIVO",
  meses: 1,
  idioma: "es",
  creadoEn: enDias(-1),
}

const ENLACE_FALLIDO = {
  id: "enlace_fallido",
  url: "https://pixelarch.dev/pago/paypal/fallido",
  total: 10656,
  montoAcordado: 10050,
  comision: 606,
  expiraEn: enDias(-10),
  estado: "FALLIDO",
  meses: 1,
  idioma: "es",
  creadoEn: enDias(-12),
  ultimoError: "PayPal no pudo crear el checkout.",
}

const PROYECTO: ProyectoConHitos = {
  id: "proyecto_1",
  titulo: "Sitio corporativo",
  montoTotal: 20000,
  estado: "ACTIVO",
  notas: null,
  creadoEn: new Date("2026-01-01T12:00:00.000Z"),
  servicio: { nombre: "Web" },
  hitos: [
    {
      id: "hito_activo",
      orden: 1,
      titulo: "Anticipo",
      monto: 10050,
      estado: "PENDIENTE",
      vencimiento: null,
      mpLink: null,
      mpLinkExpira: null,
      enlacesPago: [ENLACE_ACTIVO, ENLACE_FALLIDO],
      _count: { pagos: 0 },
    },
    {
      id: "hito_fallido",
      orden: 2,
      titulo: "Avance",
      monto: 10050,
      estado: "PENDIENTE",
      vencimiento: null,
      mpLink: null,
      mpLinkExpira: null,
      enlacesPago: [ENLACE_FALLIDO],
      _count: { pagos: 0 },
    },
    {
      id: "hito_pagado",
      orden: 3,
      titulo: "Entrega",
      monto: 10000,
      estado: "PAGADO",
      vencimiento: null,
      mpLink: null,
      mpLinkExpira: null,
      enlacesPago: [ENLACE_ACTIVO],
      _count: { pagos: 1 },
    },
  ],
}

const PAYPAL = { disponible: true, feeBps: 540, feeFixedCents: 30 }

describe("ProyectoBlock: PayPal en hitos (T-21)", () => {
  it("pasa configuracion y link vigente al hito pendiente", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} paypal={PAYPAL} />)

    const boton = screen.getByTestId("paypal-hito-hito_activo")
    expect(boton).toHaveAttribute("data-enlace", "enlace_activo")
    expect(boton).toHaveAttribute("data-ultimo", "")
    expect(boton).toHaveAttribute("data-fee", "540/30")
    expect(boton).toHaveAttribute("data-disponible", "true")
    expect(boton).toHaveAttribute(
      "aria-label",
      "PayPal — Sitio corporativo: Anticipo"
    )
    expect(screen.getByText(/Link PayPal vigente · vence/)).toBeInTheDocument()
  })

  it("muestra el ultimo intento fallido cuando no hay link vigente", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} paypal={PAYPAL} />)

    const boton = screen.getByTestId("paypal-hito-hito_fallido")
    expect(boton).toHaveAttribute("data-enlace", "")
    expect(boton).toHaveAttribute("data-ultimo", "FALLIDO")
    expect(
      screen.getByText(/PayPal: último intento fallido · /)
    ).toBeInTheDocument()
  })

  it("no ofrece PayPal en un hito pagado", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} paypal={PAYPAL} />)

    expect(screen.queryByTestId("paypal-hito-hito_pagado")).not.toBeInTheDocument()
  })

  it("no ofrece PayPal sin configuracion server-side", () => {
    render(<ProyectoBlock proyecto={PROYECTO} rate={null} />)

    expect(screen.queryByTestId(/^paypal-hito-/)).not.toBeInTheDocument()
  })

  /**
   * AC-1/AC-17: la asistente tambien inicia cobros PayPal. El detalle del
   * cliente debe ofrecer el boton de PayPal en un hito pendiente; solo las
   * acciones de gestion (registrar pago, marcar/editar hito) son admin-only.
   */
  it("permite a la asistente operar PayPal y oculta las acciones de gestion (AC-1, AC-17)", () => {
    render(
      <ProyectoBlock
        proyecto={PROYECTO}
        rate={null}
        paypal={PAYPAL}
        puedeGestionar={false}
        puedeOperarPaypal
      />
    )

    expect(screen.getByTestId("paypal-hito-hito_activo")).toBeInTheDocument()
    expect(screen.getByTestId("paypal-hito-hito_fallido")).toBeInTheDocument()
    expect(
      screen.queryByTestId("paypal-hito-hito_pagado")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Registrar pago hito" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Marcar hito" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Editar hito" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Link PayPal vigente · vence/)
    ).toBeInTheDocument()
  })

  it("oculta PayPal cuando el usuario no puede operarlo", () => {
    render(
      <ProyectoBlock
        proyecto={PROYECTO}
        rate={null}
        paypal={PAYPAL}
        puedeGestionar={false}
        puedeOperarPaypal={false}
      />
    )

    expect(screen.queryByTestId(/^paypal-hito-/)).not.toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"

/**
 * T-02 (AC-3, AC-5, AC-6; RF-1, RF-4, RF-5): dashboard vacio y shell del
 * portal. El esquema faltante se muestra como estado operativo, sin datos ni
 * formularios; el shell no expone navegacion del CRM.
 */

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  pathname: "/propuestas",
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import PropuestasDashboardPage, {
  metadata,
} from "@/app/(propuestas)/propuestas/page"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import {
  formatearFechaHoraPortal,
  formatearFechaPortal,
} from "@/lib/propuestas/fechas"
import { PortalShell } from "@/components/propuestas/portal-shell"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/propuestas"
})

describe("dashboard vacio del portal (AC-3, AC-5)", () => {
  it("muestra el estado vacio cuando el esquema esta aplicado", async () => {
    mocks.queryRaw.mockResolvedValue([])

    render(await PropuestasDashboardPage())

    expect(
      screen.getByRole("heading", { name: /todavía no hay campañas/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("form")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("no renderiza formularios ni datos si falta el esquema (AC-6)", async () => {
    mocks.queryRaw.mockRejectedValue({ code: "P2021" })

    render(await PropuestasDashboardPage())

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(screen.getByText(CODIGO_ESQUEMA_NO_APLICADO)).toBeInTheDocument()
    expect(screen.queryByRole("form")).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(screen.getByText(/comprobado/i)).toBeInTheDocument()
  })

  it("trata un error raw 42P01 como esquema no aplicado", async () => {
    mocks.queryRaw.mockRejectedValue({
      code: "P2010",
      meta: { code: "42P01" },
    })

    render(await PropuestasDashboardPage())

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
  })

  it("no oculta errores que no son de esquema", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("base caida"))

    await expect(PropuestasDashboardPage()).rejects.toThrow("base caida")
  })

  it("publica metadata noindex/nofollow (AC-5)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe("esErrorTablaFaltante (AC-6)", () => {
  it("detecta P2021 y el codigo raw 42P01", () => {
    expect(esErrorTablaFaltante({ code: "P2021" })).toBe(true)
    expect(esErrorTablaFaltante({ code: "42P01" })).toBe(true)
    expect(
      esErrorTablaFaltante({ code: "P2010", meta: { code: "42P01" } }),
    ).toBe(true)
    expect(
      esErrorTablaFaltante(
        new Error('relation "CampanaProspeccion" does not exist'),
      ),
    ).toBe(true)
  })

  it("no confunde otros errores ni valores vacios", () => {
    expect(esErrorTablaFaltante(new Error("timeout"))).toBe(false)
    expect(esErrorTablaFaltante({ code: "P2002" })).toBe(false)
    expect(esErrorTablaFaltante(null)).toBe(false)
    expect(esErrorTablaFaltante(undefined)).toBe(false)
    expect(esErrorTablaFaltante("P2021")).toBe(false)
  })
})

describe("shell del portal (AC-3, RNF-7)", () => {
  it("muestra las secciones propias, la identidad y el enlace al CRM", () => {
    render(
      <PortalShell admin={{ userId: "user_1", nombre: "Ana Perez" }}>
        <div>contenido</div>
      </PortalShell>,
    )

    expect(
      screen.getByRole("navigation", { name: /secciones del portal/i }),
    ).toBeInTheDocument()
    for (const nombre of [
      "Panel",
      "Buscar",
      "Bandeja",
      "Plantillas",
      "Envíos",
      "Supresiones",
    ]) {
      expect(screen.getByRole("link", { name: nombre })).toBeInTheDocument()
    }

    expect(screen.getByText("Ana Perez")).toBeInTheDocument()
    expect(screen.getByText("contenido")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /volver al crm/i })).toHaveAttribute(
      "href",
      "/admin/dashboard",
    )
    expect(
      screen.getByRole("link", { name: /saltar al contenido/i }),
    ).toHaveAttribute("href", "#portal-main")
  })

  it("no incluye navegacion del CRM (AC-3)", () => {
    render(
      <PortalShell admin={{ userId: "user_1", nombre: "Ana Perez" }}>
        <div>contenido</div>
      </PortalShell>,
    )

    for (const nombre of [
      /clientes/i,
      /cobros/i,
      /pagos/i,
      /servicios/i,
      /productos/i,
      /blog/i,
    ]) {
      expect(screen.queryByRole("link", { name: nombre })).not.toBeInTheDocument()
    }
  })

  it("expone el menu mobile con aria-expanded y aria-controls (AC-3, RNF-7)", () => {
    render(
      <PortalShell admin={{ userId: "user_1", nombre: "Ana Perez" }}>
        <div>contenido</div>
      </PortalShell>,
    )

    const menu = screen.getByRole("button", { name: /menú/i })
    expect(menu).toHaveAttribute("aria-expanded", "false")
    expect(menu).toHaveAttribute("aria-controls", "portal-nav")

    fireEvent.click(menu)

    expect(menu).toHaveAttribute("aria-expanded", "true")
  })

  it("marca la seccion activa y solo ella con aria-current", () => {
    mocks.pathname = "/propuestas/bandeja"

    render(
      <PortalShell admin={{ userId: "user_1", nombre: "Ana Perez" }}>
        <div>contenido</div>
      </PortalShell>,
    )

    expect(screen.getByRole("link", { name: "Bandeja" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("link", { name: "Panel" })).not.toHaveAttribute(
      "aria-current",
    )
  })
})

describe("fechas de UI del portal (AC-5)", () => {
  it("formatea fechas UTC sin correr el dia", () => {
    expect(
      formatearFechaPortal(new Date("2026-11-10T02:00:00.000Z")),
    ).toContain("10")
  })

  it("formatea marcas de tiempo en la zona de Argentina", () => {
    expect(
      formatearFechaHoraPortal(new Date("2026-11-10T15:30:00.000Z")),
    ).toContain("12:30")
  })
})

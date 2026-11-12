import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"

/**
 * T-02 (AC-3, AC-5, AC-6; RF-1, RF-4, RF-5): dashboard vacio y shell del
 * portal. El esquema faltante se muestra como estado operativo, sin datos ni
 * formularios; el shell no expone navegacion del CRM.
 *
 * T-12 (AC-7; RF-9, RF-12): pagina `/propuestas/buscar` y formulario de alta
 * de campana (aviso de "no busca ni envia", plantillas activas, idempotencia
 * por montaje, doble submit bloqueado y errores accesibles).
 */

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  plantillaFindMany: vi.fn(),
  pathname: "/propuestas",
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    plantillaPropuesta: { findMany: mocks.plantillaFindMany },
  },
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
import BuscarProspectosPage, {
  metadata as metadataBuscar,
} from "@/app/(propuestas)/propuestas/buscar/page"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import {
  formatearFechaHoraPortal,
  formatearFechaPortal,
} from "@/lib/propuestas/fechas"
import { PortalShell } from "@/components/propuestas/portal-shell"
import { CampanaForm } from "@/components/propuestas/campana-form"

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/propuestas"
  mocks.plantillaFindMany.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
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

/* ------------------------------------------------------------------ */
/* T-12 (AC-7; RF-9, RF-12): alta de campana en /propuestas/buscar     */
/* ------------------------------------------------------------------ */

function formulario(): HTMLFormElement {
  const boton = screen.getByRole("button", { name: /crear campaña/i })
  return boton.closest("form") as HTMLFormElement
}

function completarCampos(): void {
  fireEvent.change(screen.getByLabelText(/nombre de la campaña/i), {
    target: { value: "Estudio contable Palermo" },
  })
  fireEvent.change(screen.getByLabelText(/consulta de búsqueda/i), {
    target: { value: "estudios contables en Palermo, CABA" },
  })
}

async function cuerpoEnviado(
  fetchMock: ReturnType<typeof vi.fn>,
  indice = 0,
): Promise<Record<string, unknown>> {
  const [, init] = fetchMock.mock.calls[indice] as [string, RequestInit]
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe("/propuestas/buscar (T-12, AC-7; RF-9)", () => {
  it("muestra el aviso de que no busca ni envia, el formulario y las plantillas activas", async () => {
    mocks.plantillaFindMany.mockResolvedValue([
      { id: "plantilla_1", nombre: "Primer contacto", version: 2 },
    ])

    render(await BuscarProspectosPage())

    expect(
      screen.getByText(/crear una campaña no busca ni envía nada/i),
    ).toBeInTheDocument()
    expect(screen.getByRole("note")).toBeInTheDocument()

    expect(screen.getByLabelText(/nombre de la campaña/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/consulta de búsqueda/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/zona/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/rubro/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/límite por corrida/i)).toBeInTheDocument()

    const selector = screen.getByRole("combobox")
    expect(
      within(selector).getByRole("option", {
        name: "Primer contacto (v2)",
      }),
    ).toBeInTheDocument()

    expect(mocks.plantillaFindMany).toHaveBeenCalledWith({
      where: { activa: true },
      select: { id: true, nombre: true, version: true },
      orderBy: [{ nombre: "asc" }, { version: "desc" }],
    })
  })

  it("publica metadata noindex/nofollow", () => {
    expect(metadataBuscar.robots).toEqual({ index: false, follow: false })
  })

  it("con esquema faltante muestra EstadoOperativo y no renderiza el formulario", async () => {
    mocks.plantillaFindMany.mockRejectedValue({ code: "P2021" })

    render(await BuscarProspectosPage())

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(screen.getByText("Esquema no aplicado")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /crear campaña/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/nombre de la campaña/i),
    ).not.toBeInTheDocument()
  })

  it("no oculta errores que no son de esquema", async () => {
    mocks.plantillaFindMany.mockRejectedValue(new Error("base caida"))

    await expect(BuscarProspectosPage()).rejects.toThrow("base caida")
  })
})

describe("CampanaForm (T-12, AC-7; RF-9, RF-12)", () => {
  it("hace POST al endpoint con una idempotencyKey UUID y muestra exito accesible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "camp_1", estado: "BORRADOR" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaForm plantillas={[]} />)
    completarCampos()
    fireEvent.submit(formulario())

    const resultado = await screen.findByRole("status", {
      name: /resultado de la creación de campaña/i,
    })
    expect(
      within(resultado).getByText("La campaña quedó en borrador"),
    ).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/campanas")
    expect(init.method).toBe("POST")

    const body = await cuerpoEnviado(fetchMock)
    expect(body.nombre).toBe("Estudio contable Palermo")
    expect(body.consulta).toBe("estudios contables en Palermo, CABA")
    expect(body.limiteCorrida).toBe(20)
    expect(body.zona).toBeUndefined()
    expect(body.rubro).toBeUndefined()
    expect(body.plantillaId).toBeUndefined()
    expect(body.idempotencyKey).toMatch(UUID_V4)
    expect(body).not.toHaveProperty("filtros")
  })

  it("reutiliza la idempotencyKey del montaje tras un error y muestra role=alert", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ codigo: "RATE_LIMIT" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: "camp_1", estado: "BORRADOR" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaForm plantillas={[]} />)
    completarCampos()

    fireEvent.submit(formulario())
    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/demasiadas solicitudes/i)

    fireEvent.submit(formulario())
    await screen.findByRole("status", {
      name: /resultado de la creación de campaña/i,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const primera = await cuerpoEnviado(fetchMock, 0)
    const segunda = await cuerpoEnviado(fetchMock, 1)
    expect(primera.idempotencyKey).toMatch(UUID_V4)
    expect(segunda.idempotencyKey).toBe(primera.idempotencyKey)
  })

  it("bloquea el doble submit mientras la request esta en curso", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaForm plantillas={[]} />)
    completarCampos()

    const form = formulario()
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole("button", { name: /creando campaña/i }),
    ).toBeDisabled()

    resolver({
      ok: true,
      status: 201,
      json: async () => ({ id: "camp_1", estado: "BORRADOR" }),
    })
    await screen.findByRole("status", {
      name: /resultado de la creación de campaña/i,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("asocia los errores de validacion con aria-describedby y no envia", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaForm plantillas={[]} />)

    fireEvent.submit(formulario())

    expect(
      await screen.findByText("El nombre es obligatorio."),
    ).toBeInTheDocument()
    const nombre = screen.getByLabelText(/nombre de la campaña/i)
    expect(nombre).toHaveAttribute("aria-invalid", "true")
    expect(nombre).toHaveAttribute("aria-describedby", "campana-nombre-error")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("muestra las plantillas activas recibidas como opciones", () => {
    render(
      <CampanaForm
        plantillas={[
          { id: "plantilla_1", nombre: "Primer contacto", version: 2 },
          { id: "plantilla_2", nombre: "Follow-up", version: 1 },
        ]}
      />,
    )

    expect(
      screen.getByRole("option", { name: "Primer contacto (v2)" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "Follow-up (v1)" }),
    ).toBeInTheDocument()
  })
})

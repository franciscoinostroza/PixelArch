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
 *
 * T-13 (AC-8, AC-11, AC-12, AC-14; RF-16): detalle de campana, tabla de
 * prospectos, consumo y acciones (`campana-acciones`). El detalle es solo
 * lectura; ejecutar/cancelar viven en el componente cliente con confirmacion,
 * guard de doble clic y refresco del server component.
 */

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  plantillaFindMany: vi.fn(),
  campanaFindUnique: vi.fn(),
  pathname: "/propuestas",
  refresh: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    plantillaPropuesta: { findMany: mocks.plantillaFindMany },
    campanaProspeccion: { findUnique: mocks.campanaFindUnique },
  },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
  notFound: mocks.notFound,
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
import CampanaDetallePage, {
  metadata as metadataCampana,
} from "@/app/(propuestas)/propuestas/campanas/[id]/page"
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
import { CampanaAcciones } from "@/components/propuestas/campana-acciones"
import {
  AltaProspecto,
  ProspectoAcciones,
  ProspectoFicha,
  type ProspectoEditable,
} from "@/components/propuestas/prospecto-ficha"
import {
  PROSPECTO_MOTIVO_MAX,
  PROSPECTO_NOTA_MAX,
} from "@/lib/propuestas/validation"

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = "/propuestas"
  mocks.plantillaFindMany.mockResolvedValue([])
  mocks.campanaFindUnique.mockResolvedValue(null)
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

/* ------------------------------------------------------------------ */
/* T-13 (AC-8, AC-11, AC-12, AC-14; RF-16)                             */
/* Detalle de campana y acciones                                       */
/* ------------------------------------------------------------------ */

interface ProspectoFilaFixture {
  id: string
  nombreNegocio: string
  sitioWeb: string | null
  ciudad: string | null
  estado: string
  posibleDuplicadoDeId: string | null
  score: number | null
}

interface ConsumoFixture {
  id: string
  fecha: Date
  llamadas: number
  unidades: number
  costoCentavos: number
}

interface CampanaDetalleFixture {
  id: string
  nombre: string
  consulta: string
  zona: string | null
  rubro: string | null
  estado: string
  limiteCorrida: number
  creadaPorNombre: string | null
  ultimoError: string | null
  creadoEn: Date
  iniciadaEn: Date | null
  finalizadaEn: Date | null
  plantilla: { nombre: string; version: number } | null
  prospectos: ProspectoFilaFixture[]
  consumos: ConsumoFixture[]
}

function campanaDetalleFixture(
  overrides: Partial<CampanaDetalleFixture> = {},
): CampanaDetalleFixture {
  return {
    id: "camp_1",
    nombre: "Estudios contables Palermo",
    consulta: "estudios contables en Palermo, CABA",
    zona: "Palermo, CABA",
    rubro: "Contabilidad",
    estado: "COMPLETADA",
    limiteCorrida: 10,
    creadaPorNombre: "Ana Pérez",
    ultimoError: null,
    creadoEn: new Date("2026-11-10T12:00:00.000Z"),
    iniciadaEn: new Date("2026-11-10T12:05:00.000Z"),
    finalizadaEn: new Date("2026-11-10T12:06:00.000Z"),
    plantilla: { nombre: "Primer contacto", version: 2 },
    prospectos: [],
    consumos: [],
    ...overrides,
  }
}

async function renderDetalle(id = "camp_1") {
  return render(
    await CampanaDetallePage({ params: Promise.resolve({ id }) }),
  )
}

describe("/propuestas/campanas/[id] (T-13, AC-8, AC-11, AC-14)", () => {
  it("renderiza estado, consulta, prospectos, duplicados y consumo", async () => {
    mocks.campanaFindUnique.mockResolvedValue(
      campanaDetalleFixture({
        prospectos: [
          {
            id: "pros_1",
            nombreNegocio: "Alfa",
            sitioWeb: "https://alfa.com.ar",
            ciudad: "Palermo, CABA",
            estado: "NUEVO",
            posibleDuplicadoDeId: null,
            score: null,
          },
          {
            id: "pros_2",
            nombreNegocio: "Beta",
            sitioWeb: "https://beta.com.ar",
            ciudad: "Palermo, CABA",
            estado: "NUEVO",
            posibleDuplicadoDeId: "pros_previo",
            score: 72,
          },
        ],
        consumos: [
          {
            id: "consumo_1",
            fecha: new Date("2026-11-10T00:00:00.000Z"),
            llamadas: 2,
            unidades: 2,
            costoCentavos: 150,
          },
        ],
      }),
    )

    await renderDetalle()

    expect(
      screen.getByRole("heading", { name: "Estudios contables Palermo" }),
    ).toBeInTheDocument()
    // El estado aparece en el badge y en el texto de acciones terminales.
    expect(screen.getAllByText("COMPLETADA").length).toBeGreaterThan(0)
    expect(
      screen.getByText("estudios contables en Palermo, CABA"),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText("Palermo, CABA").length,
    ).toBeGreaterThanOrEqual(3)
    expect(screen.getByText("Contabilidad")).toBeInTheDocument()
    expect(screen.getByText("Primer contacto (v2)")).toBeInTheDocument()
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument()

    const contadores = screen.getByRole("region", {
      name: /contadores de la campaña/i,
    })
    expect(within(contadores).getAllByText("2")).toHaveLength(2)
    expect(within(contadores).getAllByText("1")).toHaveLength(2)

    const tabla = screen.getByRole("table", {
      name: /prospectos creados por la campaña/i,
    })
    expect(within(tabla).getByText("Alfa")).toBeInTheDocument()
    expect(
      within(tabla).getByRole("link", { name: "https://alfa.com.ar" }),
    ).toHaveAttribute("href", "https://alfa.com.ar")
    expect(
      within(tabla).getByTitle(/referencia interna: pros_previo/i),
    ).toBeInTheDocument()
    expect(within(tabla).getByText("72")).toBeInTheDocument()
    // T-15 aun no existe: "Ver ficha" es un boton deshabilitado, no un enlace
    // a una ruta inexistente.
    const verFicha = within(tabla).getAllByRole("button", {
      name: /ver ficha/i,
    })
    expect(verFicha).toHaveLength(2)
    expect(verFicha[0]).toBeDisabled()
    expect(verFicha[0]).toHaveAttribute("title", "Disponible en T-15")
    expect(
      within(tabla).queryByRole("link", { name: /ver ficha/i }),
    ).not.toBeInTheDocument()
    expect(
      within(tabla).getAllByRole("button", { name: /analizar/i })[0],
    ).toBeDisabled()
    // T-14 habilito la correccion y el descarte manual por fila.
    const descartar = within(tabla).getAllByRole("button", {
      name: /descartar/i,
    })
    expect(descartar).toHaveLength(2)
    expect(descartar[0]).toBeEnabled()
    expect(
      within(tabla).getAllByRole("button", { name: /editar/i }),
    ).toHaveLength(2)

    const consumo = screen.getByRole("region", {
      name: /consumo de google places/i,
    })
    expect(
      within(consumo).getByRole("table", {
        name: /consumo diario de google places/i,
      }),
    ).toBeInTheDocument()
    expect(within(consumo).getAllByText(/US\$\s?1,50/)).toHaveLength(2)
  })

  it("muestra los estados vacios de prospectos y consumo", async () => {
    mocks.campanaFindUnique.mockResolvedValue(
      campanaDetalleFixture({ estado: "BORRADOR" }),
    )

    await renderDetalle()

    expect(
      screen.getByText(/la corrida todavía no creó prospectos/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/todavía no hay consumo de places registrado/i),
    ).toBeInTheDocument()
  })

  it.each([
    ["BORRADOR", true, true],
    ["EN_CURSO", false, true],
    ["COMPLETADA", false, false],
    ["PARCIAL", false, false],
    ["FALLIDA", false, false],
    ["CANCELADA", false, false],
  ] as const)(
    "en %s muestra ejecutar=%s y cancelar=%s",
    async (estado, puedeEjecutar, puedeCancelar) => {
      mocks.campanaFindUnique.mockResolvedValue(
        campanaDetalleFixture({ estado }),
      )

      await renderDetalle()

      const ejecutar = screen.queryByRole("button", {
        name: /ejecutar búsqueda/i,
      })
      const cancelar = screen.queryByRole("button", {
        name: /cancelar campaña/i,
      })

      if (puedeEjecutar) {
        expect(ejecutar).toBeInTheDocument()
      } else {
        expect(ejecutar).not.toBeInTheDocument()
      }

      if (puedeCancelar) {
        expect(cancelar).toBeInTheDocument()
      } else {
        expect(cancelar).not.toBeInTheDocument()
        expect(
          screen.getByText(/no hay acciones disponibles/i),
        ).toBeInTheDocument()
      }
    },
  )

  it("muestra el ultimo error sanitizado sin PII", async () => {
    mocks.campanaFindUnique.mockResolvedValue(
      campanaDetalleFixture({
        estado: "FALLIDA",
        ultimoError:
          "fallo juan@example.com en https://interno.test/db?token=secreto",
      }),
    )

    await renderDetalle()

    const nota = screen.getByRole("note", {
      name: /último error de la campaña/i,
    })
    expect(nota).toHaveTextContent("[email]")
    expect(nota).toHaveTextContent("[url]")
    expect(nota).not.toHaveTextContent("juan@example.com")
    expect(nota).not.toHaveTextContent("interno.test")
  })

  it("publica metadata noindex/nofollow (AC-5) y usa notFound si no existe", async () => {
    expect(metadataCampana.robots).toEqual({ index: false, follow: false })

    mocks.campanaFindUnique.mockResolvedValue(null)

    await expect(
      CampanaDetallePage({ params: Promise.resolve({ id: "no-existe" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("con esquema faltante muestra EstadoOperativo y ninguna accion", async () => {
    mocks.campanaFindUnique.mockRejectedValue({ code: "P2021" })

    await renderDetalle()

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(screen.getByText("Esquema no aplicado")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /ejecutar búsqueda/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /cancelar campaña/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
  })

  it("no oculta errores que no son de esquema", async () => {
    mocks.campanaFindUnique.mockRejectedValue(new Error("base caida"))

    await expect(
      CampanaDetallePage({ params: Promise.resolve({ id: "camp_1" }) }),
    ).rejects.toThrow("base caida")
  })

  it("mantiene el alta manual y la tabla de prospectos (T-14, AC-13)", async () => {
    mocks.campanaFindUnique.mockResolvedValue(
      campanaDetalleFixture({
        estado: "EN_CURSO",
        prospectos: [
          {
            id: "pros_1",
            nombreNegocio: "Consultora Alfa",
            sitioWeb: "https://alfa.com.ar",
            ciudad: "Palermo, CABA",
            estado: "NUEVO",
            posibleDuplicadoDeId: null,
            score: null,
          },
        ],
      }),
    )

    await renderDetalle()

    expect(
      screen.getByRole("heading", { name: /agregar prospecto manualmente/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no pegues datos sensibles ni listas compradas/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("table", {
        name: /prospectos creados por la campaña/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Agregar prospecto" }),
    ).toBeInTheDocument()
  })
})

describe("CampanaAcciones (T-13, AC-8, AC-11, AC-12; RF-12, RF-16)", () => {
  it("ejecuta con confirmacion, anuncia el resultado y refresca", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "COMPLETADA",
        creados: 2,
        reutilizados: 0,
        duplicados: 1,
        omitidos: 0,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)

    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole("group", {
        name: /confirmar ejecución de la búsqueda/i,
      }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Confirmar búsqueda" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/búsqueda ejecutada/i)
    expect(resultado).toHaveTextContent(/2 creados/i)
    expect(resultado).toHaveTextContent(/completada/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/campanas/camp_1/ejecutar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ confirmado: true })

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    expect(
      screen.queryByRole("button", { name: "Ejecutar búsqueda" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Cancelar campaña" }),
    ).not.toBeInTheDocument()
  })

  it("cancelar solo aparece en BORRADOR/EN_CURSO y confirma antes de llamar", async () => {
    mocks.campanaFindUnique.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ estado: "CANCELADA" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="EN_CURSO" />)

    expect(
      screen.queryByRole("button", { name: "Ejecutar búsqueda" }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar campaña" }))
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/quedó cancelada/i)
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/propuestas/campanas/camp_1/cancelar",
    )
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(
      screen.queryByRole("button", { name: "Cancelar campaña" }),
    ).not.toBeInTheDocument()
  })

  it("en estado terminal no ofrece acciones", () => {
    render(<CampanaAcciones campanaId="camp_1" estado="COMPLETADA" />)

    expect(
      screen.queryByRole("button", { name: "Ejecutar búsqueda" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Cancelar campaña" }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/no hay acciones disponibles/i)).toBeInTheDocument()
    expect(screen.getByText("COMPLETADA")).toBeInTheDocument()
  })

  it("volver cierra la confirmacion sin llamar a la API", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))
    fireEvent.click(screen.getByRole("button", { name: "Volver" }))

    expect(
      screen.queryByRole("group", {
        name: /confirmar ejecución de la búsqueda/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Ejecutar búsqueda" }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("bloquea el doble clic mientras la corrida esta en curso", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))

    const confirmar = screen.getByRole("button", {
      name: "Confirmar búsqueda",
    })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    // Con la confirmacion abierta, el boton visible queda deshabilitado y la
    // region marca aria-busy: el segundo click no dispara otra request.
    expect(
      screen.getByRole("button", { name: "Confirmar búsqueda" }),
    ).toBeDisabled()
    expect(
      screen.getByRole("region", { name: /acciones de la campaña/i }),
    ).toHaveAttribute("aria-busy", "true")

    resolver({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "COMPLETADA",
        creados: 0,
        reutilizados: 0,
        duplicados: 0,
        omitidos: 0,
      }),
    })
    await screen.findByRole("status")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("muestra un error accesible y refresca si la campana ya cambio de estado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "ESTADO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar búsqueda" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/ya no está en un estado/i)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())

    // Sin exito no se inventa un estado final: sigue en BORRADOR.
    expect(
      screen.getByRole("button", { name: "Ejecutar búsqueda" }),
    ).toBeInTheDocument()
  })

  it("mapea NO_CONFIGURADO sin filtrar detalles", async () => {
    const fetchNoConfig = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ codigo: "NO_CONFIGURADO" }),
    })
    vi.stubGlobal("fetch", fetchNoConfig)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar búsqueda" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /google places no está configurado/i,
    )
  })

  it("muestra un error de red accesible sin filtrar detalles internos", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fallo interno juan@example.com"))
    vi.stubGlobal("fetch", fetchMock)

    render(<CampanaAcciones campanaId="camp_1" estado="BORRADOR" />)
    fireEvent.click(screen.getByRole("button", { name: "Ejecutar búsqueda" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirmar búsqueda" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/error de red/i)
    expect(alerta).not.toHaveTextContent("juan@example.com")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
})

/* ------------------------------------------------------------------ */
/* T-14 (AC-13, AC-14, AC-19; RF-18, RF-22)                            */
/* Alta manual, correccion y descarte                                  */
/* ------------------------------------------------------------------ */

function prospectoEditable(
  overrides: Partial<ProspectoEditable> = {},
): ProspectoEditable {
  return {
    id: "pros_1",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://alfa.com.ar/contacto",
    email: "contacto@alfa.com.ar",
    telefono: "+541155555555",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    contactoNombre: null,
    contactoCargo: null,
    fuenteUrl: "https://alfa.com.ar/contacto",
    emailFuenteUrl: null,
    estado: "NUEVO",
    ...overrides,
  }
}

function formularioDe(elemento: HTMLElement): HTMLFormElement {
  return elemento.closest("form") as HTMLFormElement
}

describe("AltaProspecto (T-14, AC-13, AC-19)", () => {
  it("abre el panel con aviso de datos sensibles, fuentes y contador de nota", () => {
    render(<AltaProspecto campanaId="camp_1" />)

    const abrir = screen.getByRole("button", { name: "Agregar prospecto" })
    expect(abrir).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(abrir)

    expect(
      screen.getByRole("button", { name: "Cerrar formulario" }),
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("note")).toHaveTextContent(
      /no pegues datos sensibles ni listas compradas/i,
    )
    expect(screen.getByLabelText(/^sitio web$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fuente de los datos/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fuente del email/i)).toBeInTheDocument()

    const nota = screen.getByLabelText(/nota de procedencia/i)
    expect(nota).toHaveAttribute("maxlength", String(PROSPECTO_NOTA_MAX))
    expect(
      screen.getByText(new RegExp(`0/${PROSPECTO_NOTA_MAX} caracteres`)),
    ).toBeInTheDocument()

    fireEvent.change(nota, { target: { value: "x".repeat(120) } })
    expect(
      screen.getByText(new RegExp(`120/${PROSPECTO_NOTA_MAX} caracteres`)),
    ).toBeInTheDocument()
  })

  it("envía POST con procedencia, muestra éxito accesible y refresca (AC-13)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "pros_1", estado: "NUEVO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AltaProspecto campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar prospecto" }))

    fireEvent.change(screen.getByLabelText(/nombre del negocio/i), {
      target: { value: "Consultora Alfa" },
    })
    fireEvent.change(screen.getByLabelText(/^sitio web$/i), {
      target: { value: "https://www.alfa.com.ar/contacto" },
    })
    fireEvent.change(screen.getByLabelText(/email de contacto/i), {
      target: { value: "contacto@alfa.com.ar" },
    })
    fireEvent.change(screen.getByLabelText(/fuente de los datos/i), {
      target: { value: "https://www.alfa.com.ar/contacto" },
    })
    fireEvent.change(screen.getByLabelText(/nota de procedencia/i), {
      target: {
        value: "Datos de la página de contacto publicada por el negocio.",
      },
    })

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Agregar prospecto" }),
      ),
    )

    const exito = await screen.findByRole("status")
    expect(exito).toHaveTextContent(/prospecto agregado con su fuente y nota/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/prospectos")
    expect(url).not.toContain("contacto@")
    expect(init.method).toBe("POST")

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      campanaId: "camp_1",
      nombreNegocio: "Consultora Alfa",
      email: "contacto@alfa.com.ar",
      fuenteUrl: "https://www.alfa.com.ar/contacto",
      nota: "Datos de la página de contacto publicada por el negocio.",
    })
    expect(body).not.toHaveProperty("emailFuenteUrl")

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.getByLabelText(/nota de procedencia/i)).toHaveValue("")
  })

  it("valida en el cliente con errores accesibles y no envía sin datos (AC-13)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<AltaProspecto campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar prospecto" }))
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Agregar prospecto" }),
      ),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /revisá los datos/i,
    )
    expect(screen.getByLabelText(/nombre del negocio/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("exige una fuente y la asocia al campo (AC-13)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<AltaProspecto campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar prospecto" }))
    fireEvent.change(screen.getByLabelText(/nombre del negocio/i), {
      target: { value: "Consultora Alfa" },
    })
    fireEvent.change(screen.getByLabelText(/nota de procedencia/i), {
      target: { value: "Datos públicos verificados." },
    })
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Agregar prospecto" }),
      ),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /falta la fuente/i,
    )
    const fuente = screen.getByLabelText(/fuente de los datos/i)
    expect(fuente).toHaveAttribute("aria-invalid", "true")
    expect(fuente).toHaveAttribute("aria-describedby")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rechaza en el cliente un sitio social o agregador (AC-19)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<AltaProspecto campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar prospecto" }))
    fireEvent.change(screen.getByLabelText(/nombre del negocio/i), {
      target: { value: "Consultora Alfa" },
    })
    fireEvent.change(screen.getByLabelText(/^sitio web$/i), {
      target: { value: "https://www.instagram.com/consultora-alfa" },
    })
    fireEvent.change(screen.getByLabelText(/fuente de los datos/i), {
      target: { value: "https://www.instagram.com/consultora-alfa" },
    })
    fireEvent.change(screen.getByLabelText(/nota de procedencia/i), {
      target: { value: "Datos públicos del perfil." },
    })

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Agregar prospecto" }),
      ),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no es una web de negocio válida/i,
    )
    expect(screen.getByLabelText(/^sitio web$/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("ProspectoFicha edición (T-14, AC-13, AC-19)", () => {
  it("envía solo los campos cambiados con motivo y sin PII en la URL (AC-13)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "pros_1", estado: "NUEVO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ProspectoFicha prospecto={prospectoEditable()} />)

    fireEvent.change(screen.getByLabelText(/teléfono comercial/i), {
      target: { value: "+54 11 4444 0000" },
    })

    const motivo = screen.getByLabelText(/motivo de la corrección/i)
    expect(motivo).toHaveAttribute("maxlength", String(PROSPECTO_MOTIVO_MAX))
    expect(
      screen.getByText(new RegExp(`0/${PROSPECTO_MOTIVO_MAX} caracteres`)),
    ).toBeInTheDocument()
    fireEvent.change(motivo, {
      target: { value: "Corrección verificada en la fuente pública." },
    })

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar corrección" }),
      ),
    )

    const exito = await screen.findByRole("status")
    expect(exito).toHaveTextContent(/corrección guardada/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/prospectos/pros_1")
    expect(url).not.toContain("contacto@")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(String(init.body))).toEqual({
      telefono: "+54 11 4444 0000",
      motivo: "Corrección verificada en la fuente pública.",
    })

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("no envía si solo se escribe el motivo sin cambiar datos (AC-13)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<ProspectoFicha prospecto={prospectoEditable()} />)
    fireEvent.change(screen.getByLabelText(/motivo de la corrección/i), {
      target: { value: "Nada cambió en los datos." },
    })
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar corrección" }),
      ),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /no cambiaste ningún dato/i,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("exige la fuente del email nuevo y la marca con aria-invalid (AC-19)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ProspectoFicha
        prospecto={prospectoEditable({
          fuenteUrl: null,
          emailFuenteUrl: null,
        })}
      />,
    )

    fireEvent.change(screen.getByLabelText(/email de contacto/i), {
      target: { value: "ventas@beta.com.ar" },
    })
    fireEvent.change(screen.getByLabelText(/motivo de la corrección/i), {
      target: { value: "Email publicado por el negocio." },
    })
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar corrección" }),
      ),
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /falta la fuente del email nuevo/i,
    )
    expect(screen.getByLabelText(/fuente del email/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("muestra un error accesible si el prospecto está suprimido (AC-13)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "SUPRIMIDO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ProspectoFicha prospecto={prospectoEditable()} />)
    fireEvent.change(screen.getByLabelText(/teléfono comercial/i), {
      target: { value: "+54 11 4444 0000" },
    })
    fireEvent.change(screen.getByLabelText(/motivo de la corrección/i), {
      target: { value: "Corrección verificada." },
    })
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar corrección" }),
      ),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/el contacto está suprimido/i)
    expect(alerta).not.toHaveTextContent("contacto@alfa.com.ar")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
})

describe("ProspectoAcciones (T-14, AC-13)", () => {
  it("abre Editar y exige motivo antes de confirmar el descarte (AC-13)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ estado: "DESCARTADO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ProspectoAcciones prospecto={prospectoEditable()} />)

    fireEvent.click(screen.getByRole("button", { name: "Editar" }))
    const editar = screen.getByRole("dialog", { name: "Corregir prospecto" })
    expect(
      within(editar).getByLabelText(/motivo de la corrección/i),
    ).toBeInTheDocument()
    fireEvent.click(within(editar).getByRole("button", { name: "Cerrar modal" }))

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    const descarte = screen.getByRole("dialog", {
      name: "Descartar prospecto",
    })
    expect(within(descarte).getByText(/vas a descartar/i)).toHaveTextContent(
      /consultora alfa/i,
    )

    const motivo = within(descarte).getByLabelText(/motivo del descarte/i)
    expect(motivo).toHaveAttribute("maxlength", String(PROSPECTO_MOTIVO_MAX))
    expect(
      within(descarte).getByText(
        new RegExp(`0/${PROSPECTO_MOTIVO_MAX} caracteres`),
      ),
    ).toBeInTheDocument()

    fireEvent.submit(formularioDe(motivo))
    expect(
      await within(descarte).findByText("El motivo es obligatorio."),
    ).toBeInTheDocument()
    expect(motivo).toHaveAttribute("aria-invalid", "true")
    expect(motivo).toHaveAttribute("aria-describedby")
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(motivo, {
      target: { value: "El negocio no encaja con el servicio." },
    })
    fireEvent.submit(formularioDe(motivo))

    const exito = await within(descarte).findByRole("status")
    expect(exito).toHaveTextContent(/prospecto descartado/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/prospectos/pros_1/descartar")
    expect(url).not.toContain("contacto@")
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: "El negocio no encaja con el servicio.",
    })

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: "Descartar" })).toBeDisabled()
  })

  it("muestra el error del servidor de forma accesible sin filtrar PII (AC-13)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "SUPRIMIDO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ProspectoAcciones prospecto={prospectoEditable()} />)
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    const descarte = screen.getByRole("dialog", {
      name: "Descartar prospecto",
    })
    fireEvent.change(within(descarte).getByLabelText(/motivo del descarte/i), {
      target: { value: "El negocio no encaja." },
    })
    fireEvent.submit(
      formularioDe(within(descarte).getByLabelText(/motivo del descarte/i)),
    )

    const alerta = await within(descarte).findByRole("alert")
    expect(alerta).toHaveTextContent(/suprimido/i)
    expect(alerta).not.toHaveTextContent("contacto@alfa.com.ar")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("deshabilita Editar y Descartar de un prospecto suprimido (AC-15, AC-19)", () => {
    render(
      <ProspectoAcciones
        prospecto={prospectoEditable({ estado: "SUPRIMIDO" })}
      />,
    )

    expect(screen.getByRole("button", { name: "Editar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Descartar" })).toBeDisabled()
  })
})


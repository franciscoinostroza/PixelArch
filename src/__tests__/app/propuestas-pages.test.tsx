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
  plantillaFindUnique: vi.fn(),
  campanaFindUnique: vi.fn(),
  prospectoFindUnique: vi.fn(),
  prospectoFindFirst: vi.fn(),
  envioFindFirst: vi.fn(),
  envioFindMany: vi.fn(),
  pathname: "/propuestas",
  refresh: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    plantillaPropuesta: {
      findMany: mocks.plantillaFindMany,
      findUnique: mocks.plantillaFindUnique,
    },
    campanaProspeccion: { findUnique: mocks.campanaFindUnique },
    prospecto: {
      findUnique: mocks.prospectoFindUnique,
      findFirst: mocks.prospectoFindFirst,
    },
    envioPropuesta: {
      findFirst: mocks.envioFindFirst,
      findMany: mocks.envioFindMany,
    },
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
import ProspectoDetallePage, {
  metadata as metadataProspecto,
} from "@/app/(propuestas)/propuestas/prospectos/[id]/page"
import PlantillasPage, {
  metadata as metadataPlantillas,
} from "@/app/(propuestas)/propuestas/plantillas/page"
import PlantillaDetallePage, {
  metadata as metadataPlantilla,
} from "@/app/(propuestas)/propuestas/plantillas/[id]/page"
import BandejaPage, {
  metadata as metadataBandeja,
} from "@/app/(propuestas)/propuestas/bandeja/page"
import { ScoreDesglose } from "@/components/propuestas/score-desglose"
import { AnalizarProspecto } from "@/components/propuestas/analizar-prospecto-button"
import { PlantillaForm } from "@/components/propuestas/plantilla-form"
import {
  BorradorEditor,
  GenerarBorrador,
} from "@/components/propuestas/borrador-editor"
import { AprobacionPanel } from "@/components/propuestas/aprobacion-panel"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import { hashContenidoEnvio } from "@/lib/propuestas/envios"
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
  mocks.plantillaFindUnique.mockResolvedValue(null)
  mocks.campanaFindUnique.mockResolvedValue(null)
  mocks.prospectoFindUnique.mockResolvedValue(null)
  mocks.prospectoFindFirst.mockResolvedValue(null)
  mocks.envioFindFirst.mockResolvedValue(null)
  mocks.envioFindMany.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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
    expect(
      screen.getByText(
        /el análisis se ejecuta desde la ficha de cada prospecto con el botón Analizar/i,
      ),
    ).toBeInTheDocument()

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
    // T-15: "Ver ficha" es un enlace a la ficha del prospecto y el analisis
    // vive alli, no como boton deshabilitado en la tabla.
    const verFicha = within(tabla).getAllByRole("link", {
      name: /ver ficha/i,
    })
    expect(verFicha).toHaveLength(2)
    expect(verFicha[0]).toHaveAttribute(
      "href",
      "/propuestas/prospectos/pros_1",
    )
    expect(verFicha[1]).toHaveAttribute(
      "href",
      "/propuestas/prospectos/pros_2",
    )
    expect(
      within(tabla).queryByRole("button", { name: /ver ficha/i }),
    ).not.toBeInTheDocument()
    expect(
      within(tabla).queryByRole("button", { name: /analizar/i }),
    ).not.toBeInTheDocument()
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

/* ------------------------------------------------------------------ */
/* T-15 (AC-9, AC-10, AC-19, AC-20, AC-21; RF-13..16, RF-31..33)      */
/* Ficha del prospecto, score y boton Analizar                         */
/* ------------------------------------------------------------------ */

const MARCADOR_HTML = "HTML_SECRETO_MARCADOR"

function prospectoDetalleFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pros_1",
    nombreNegocio: "Consultora Alfa",
    sitioWeb: "https://alfa.com.ar/",
    dominioNormalizado: "alfa.com.ar",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    email: "ventas@alfa.com.ar",
    telefono: "+541155551234",
    contactoNombre: "Ana",
    contactoCargo: "Socia",
    emailFuenteUrl: "https://alfa.com.ar/contacto",
    emailFechaFuente: new Date("2026-11-10T15:00:00.000Z"),
    fuenteTipo: "CARGA_MANUAL",
    fuenteUrl: "https://alfa.com.ar/contacto",
    fechaFuente: new Date("2026-11-10T14:00:00.000Z"),
    estado: "PUNTUADO",
    score: 88,
    scoreDetalle: {
      total: 88,
      version: "v1",
      componentes: [
        {
          clave: "CONTACTO_PROFESIONAL",
          etiqueta: "Contacto profesional",
          puntos: 30,
          maximo: 30,
          motivos: ["Email profesional con fuente registrada."],
        },
        {
          clave: "SITIO_PROPIO",
          etiqueta: "Sitio propio",
          puntos: 20,
          maximo: 20,
          motivos: ["El sitio usa HTTPS."],
        },
        {
          clave: "OPORTUNIDAD_TECNICA",
          etiqueta: "Oportunidad tecnica",
          puntos: 8,
          maximo: 20,
          motivos: ["La auditoria detecta margen de mejora tecnica."],
        },
        {
          clave: "ENCAJE_CAMPANA",
          etiqueta: "Encaje de campana",
          puntos: 15,
          maximo: 15,
          motivos: ["El rubro coincide con la campana."],
        },
        {
          clave: "COMPLETITUD",
          etiqueta: "Completitud",
          puntos: 15,
          maximo: 15,
          motivos: ["El telefono suma completitud."],
        },
      ],
    },
    auditoriaResumen: {
      estado: "OK",
      fecha: "2026-11-12T15:30:00.000Z",
      finalUrl: "https://alfa.com.ar/",
      scores: { velocidad: 40, ssl: 90, seo: 50, seguridad: 60 },
      findings: [
        {
          type: "warn",
          text: "La velocidad del sitio puede mejorar.",
        },
      ],
      motivo: null,
      html: `<html>${MARCADOR_HTML}</html>`,
      certificado: "BEGIN CERTIFICATE",
    },
    auditoriaEstado: "OK",
    auditoriaFecha: new Date("2026-11-12T15:30:00.000Z"),
    posibleDuplicadoDeId: "pros_otro",
    motivoSinEnriquecer: null,
    notas: "Nota interna del prospecto.",
    ultimaInteraccionEn: new Date("2026-11-12T16:00:00.000Z"),
    creadoEn: new Date("2026-11-10T12:00:00.000Z"),
    actualizadoEn: new Date("2026-11-12T16:00:00.000Z"),
    campanaOrigen: {
      id: "camp_1",
      nombre: "Estudios contables Palermo",
      estado: "EN_CURSO",
      rubro: "Consultoría",
      zona: "Palermo, CABA",
    },
    ...overrides,
  }
}

async function renderProspecto(id = "pros_1") {
  return render(
    await ProspectoDetallePage({ params: Promise.resolve({ id }) }),
  )
}

describe("/propuestas/prospectos/[id] (T-15, AC-9, AC-10, AC-19, AC-20, AC-21)", () => {
  it("renderiza ficha, fuentes, auditoria, score, estado y enlace a la campana", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())

    await renderProspecto()

    expect(
      screen.getByRole("heading", { name: "Consultora Alfa" }),
    ).toBeInTheDocument()
    expect(screen.getAllByText("PUNTUADO").length).toBeGreaterThan(0)

    const datos = screen.getByRole("region", {
      name: /datos del prospecto/i,
    })
    expect(
      within(datos).getByRole("link", { name: "https://alfa.com.ar/" }),
    ).toHaveAttribute("href", "https://alfa.com.ar/")
    expect(screen.getByRole("link", { name: "ventas@alfa.com.ar" })).toHaveAttribute(
      "href",
      "mailto:ventas@alfa.com.ar",
    )
    expect(screen.getByText("+541155551234")).toBeInTheDocument()
    expect(screen.getByText(/Ana — Socia/)).toBeInTheDocument()
    expect(screen.getByText("Carga manual con fuente")).toBeInTheDocument()
    expect(
      screen.getByText("Email registrado con fuente"),
    ).toBeInTheDocument()

    expect(
      screen.getByRole("link", {
        name: /Volver a la campaña «Estudios contables Palermo»/,
      }),
    ).toHaveAttribute("href", "/propuestas/campanas/camp_1")
    expect(
      screen.getAllByRole("link", { name: "Estudios contables Palermo" })[0],
    ).toHaveAttribute("href", "/propuestas/campanas/camp_1")

    // Fuentes y fechas: cada dato con su procedencia.
    const fuentes = screen.getByRole("region", { name: /fuentes y fechas/i })
    expect(
      within(fuentes).getAllByRole("link", {
        name: "https://alfa.com.ar/contacto",
      }).length,
    ).toBeGreaterThanOrEqual(2)
    expect(
      within(fuentes).getAllByText(/10 de nov de 2026/i).length,
    ).toBeGreaterThanOrEqual(2)

    // Auditoria resumida sin HTML ni certificado.
    const auditoria = screen.getByRole("region", {
      name: /auditoría del sitio/i,
    })
    expect(within(auditoria).getByText("OK")).toBeInTheDocument()
    expect(within(auditoria).getByText("40/100")).toBeInTheDocument()
    expect(within(auditoria).getByText("90/100")).toBeInTheDocument()
    expect(
      within(auditoria).getByText(/La velocidad del sitio puede mejorar/i),
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(MARCADOR_HTML)
    expect(document.body).not.toHaveTextContent("BEGIN CERTIFICATE")

    // Score total y desglose accesible.
    const score = screen.getByRole("region", {
      name: /score del prospecto y motivos/i,
    })
    expect(within(score).getByText("88")).toBeInTheDocument()
    expect(within(score).getByText("30/30 puntos")).toBeInTheDocument()
    expect(within(score).getByText("8/20 puntos")).toBeInTheDocument()
    expect(
      within(score).getByText(/Email profesional con fuente registrada/i),
    ).toBeInTheDocument()

    // Duplicado visible con enlace interno.
    const duplicado = screen.getByRole("note", {
      name: /posible duplicado/i,
    })
    expect(
      within(duplicado).getByRole("link", { name: /ver ficha relacionada/i }),
    ).toHaveAttribute("href", "/propuestas/prospectos/pros_otro")
  })

  it("publica metadata noindex y falla con notFound si no existe (AC-5, AC-9)", async () => {
    expect(metadataProspecto.robots).toEqual({ index: false, follow: false })

    mocks.prospectoFindUnique.mockResolvedValue(null)

    await expect(
      ProspectoDetallePage({ params: Promise.resolve({ id: "no-existe" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("con esquema faltante muestra EstadoOperativo y no renderiza datos ni acciones", async () => {
    mocks.prospectoFindUnique.mockRejectedValue({ code: "P2021" })

    await renderProspecto()

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(screen.getByText("Esquema no aplicado")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Analizar" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: /datos del prospecto/i }),
    ).not.toBeInTheDocument()
  })

  it("no oculta errores que no son de esquema", async () => {
    mocks.prospectoFindUnique.mockRejectedValue(new Error("base caida"))

    await expect(
      ProspectoDetallePage({ params: Promise.resolve({ id: "pros_1" }) }),
    ).rejects.toThrow("base caida")
  })

  it("muestra el motivo SIN_WEB y el estado sin auditoria cuando corresponde (AC-10)", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({
        estado: "SIN_ENRIQUECER",
        motivoSinEnriquecer: "SIN_WEB",
        email: null,
        auditoriaResumen: null,
        auditoriaEstado: null,
        auditoriaFecha: null,
        score: 20,
        scoreDetalle: null,
        posibleDuplicadoDeId: null,
      }),
    )

    await renderProspecto()

    expect(
      screen.getByRole("note", { name: /motivo sin enriquecer/i }),
    ).toHaveTextContent("SIN_WEB")
    expect(
      screen.getByText(/Sin email: no se puede aprobar/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Sin auditoría registrada/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("note", { name: /posible duplicado/i }),
    ).not.toBeInTheDocument()
  })

  it("distingue un email registrado sin fuente (AC-19)", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ emailFuenteUrl: null }),
    )

    await renderProspecto()

    expect(
      screen.getByText("Email registrado sin fuente"),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Email registrado con fuente"),
    ).not.toBeInTheDocument()
    expect(
      screen
        .getByRole("region", { name: /fuentes y fechas/i })
        .textContent,
    ).toContain("Fuente del email")
  })

  it("incluye el boton Analizar y no enlaza a /api/audit", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())

    await renderProspecto()

    expect(
      screen.getByRole("region", { name: /analizar prospecto/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Analizar" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/No se envía ningún email/i)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain("/api/audit")
  })
})

describe("AnalizarProspecto (T-15, AC-9, AC-19, AC-20, AC-21)", () => {
  it("hace POST, bloquea el doble clic, muestra pending, resultado y refresca", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)

    const boton = screen.getByRole("button", { name: "Analizar" })
    fireEvent.click(boton)
    fireEvent.click(boton)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole("button", { name: /analizando/i }),
    ).toBeDisabled()
    expect(
      screen.getByRole("region", { name: /analizar prospecto/i }),
    ).toHaveAttribute("aria-busy", "true")

    resolver({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "PUNTUADO",
        emailEncontrado: true,
        tieneEmail: true,
        auditoriaEstado: "OK",
        score: 88,
      }),
    })

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Análisis completado/i)
    expect(resultado).toHaveTextContent(/Se encontró un email profesional/i)
    expect(resultado).toHaveTextContent(/Auditoría: OK/i)
    expect(resultado).toHaveTextContent(/Score: 88\/100/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/prospectos/pros_1/analizar")
    expect(url).not.toContain("ventas@")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({})
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it("muestra un error accesible por codigo y refresca (AC-9)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ codigo: "CUPO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/cupo diario/i)
    expect(alerta).not.toHaveTextContent("contacto@")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("muestra SUPRIMIDO como aviso sin filtrar el email (AC-15)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "SUPRIMIDO",
        emailEncontrado: false,
        tieneEmail: false,
        auditoriaEstado: null,
        score: null,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const aviso = await screen.findByRole("status")
    expect(aviso).toHaveTextContent(/quedó SUPRIMIDO/i)
    expect(aviso).not.toHaveTextContent("@")
  })

  it("si el prospecto ya tenia email y no se encontro uno nuevo, lo dice y refresca (AC-19)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "PUNTUADO",
        emailEncontrado: false,
        tieneEmail: true,
        auditoriaEstado: "OK",
        score: 88,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(
      /ya tenía un email registrado; se conservó sin cambios/i,
    )
    expect(resultado).not.toHaveTextContent(
      /Se encontró un email profesional publicado/i,
    )
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it("si no hay email ni se encontro uno, avisa que no se puede aprobar (AC-19)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "PUNTUADO",
        emailEncontrado: false,
        tieneEmail: false,
        auditoriaEstado: "OK",
        score: 58,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(
      /No se encontró un email público; el prospecto sigue sin contacto/i,
    )
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it("un SIN_ENRIQUECER se muestra como aviso, no como exito (AC-10)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "SIN_ENRIQUECER",
        emailEncontrado: false,
        tieneEmail: false,
        auditoriaEstado: "FALLIDA",
        score: 40,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const aviso = await screen.findByRole("status")
    expect(aviso).toHaveTextContent(/No se pudo completar el análisis del sitio/i)
    expect(aviso).toHaveTextContent(/Auditoría: FALLIDA/i)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it("un error de red se muestra saneado y refresca (AC-9)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fallo juan@example.com"))
    vi.stubGlobal("fetch", fetchMock)

    render(<AnalizarProspecto prospectoId="pros_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Analizar" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/Error de red/i)
    expect(alerta).not.toHaveTextContent("juan@example.com")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
})

describe("ScoreDesglose (T-15, AC-21; RF-33)", () => {
  it("muestra total, componentes, motivos y maximo de forma accesible", () => {
    render(
      <ScoreDesglose
        score={88}
        detalle={{
          total: 88,
          version: "v1",
          componentes: [
            {
              clave: "CONTACTO_PROFESIONAL",
              etiqueta: "Contacto profesional",
              puntos: 30,
              maximo: 30,
              motivos: ["Email profesional con fuente registrada."],
            },
            {
              clave: "OPORTUNIDAD_TECNICA",
              etiqueta: "Oportunidad tecnica",
              puntos: 8,
              maximo: 20,
              motivos: [],
            },
          ],
        }}
      />,
    )

    const region = screen.getByRole("region", {
      name: /score del prospecto y motivos/i,
    })
    expect(within(region).getByText("88")).toBeInTheDocument()
    expect(within(region).getByText("30/30 puntos")).toBeInTheDocument()
    expect(within(region).getByText("8/20 puntos")).toBeInTheDocument()
    expect(
      within(region).getByText(/Email profesional con fuente registrada/i),
    ).toBeInTheDocument()
    expect(
      within(region).getByText(/Sin motivos registrados para este componente/i),
    ).toBeInTheDocument()
  })

  it("no inventa datos si falta el desglose y avisa del score pendiente", () => {
    render(<ScoreDesglose score={null} detalle={null} />)

    expect(
      screen.getByText(/Todavía no hay un score calculado/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/puntos/i),
    ).not.toBeInTheDocument()
  })

  it("con un JSON manipulado conserva solo componentes validos sin romper", () => {
    render(
      <ScoreDesglose
        score={50}
        detalle={{
          total: 50,
          componentes: [
            null,
            { clave: "X", etiqueta: "Sin puntos", puntos: "30", maximo: 30 },
            {
              clave: "VALIDO",
              etiqueta: "Componente valido",
              puntos: 10,
              maximo: 20,
              motivos: ["Motivo valido.", "", 42],
            },
          ],
        }}
      />,
    )

    expect(screen.getByText("Componente valido")).toBeInTheDocument()
    expect(screen.getByText("10/20 puntos")).toBeInTheDocument()
    expect(screen.getByText("Motivo valido.")).toBeInTheDocument()
    expect(screen.queryByText("Sin puntos")).not.toBeInTheDocument()
    expect(screen.queryByText("42")).not.toBeInTheDocument()
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

/* ------------------------------------------------------------------ */
/* T-16 (AC-22, AC-23, AC-24; RF-34..RF-39)                            */
/* Plantillas, bandeja y panel de borrador en la ficha                 */
/* ------------------------------------------------------------------ */

function plantillaResumenFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pl_1",
    nombre: "Primer contacto",
    idioma: "es",
    asunto: "Una idea para {{nombreNegocio}}",
    variablesPermitidas: ["nombreNegocio", "hallazgoPrincipal"],
    version: 2,
    actualizadoEn: new Date("2026-11-12T15:30:00.000Z"),
    ...overrides,
  }
}

function plantillaDetalleFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pl_1",
    nombre: "Primer contacto",
    idioma: "es",
    asunto: "Una idea para {{nombreNegocio}}",
    cuerpo:
      "Vi {{sitioWeb}} en {{ciudad}}: {{hallazgoPrincipal}}.",
    variablesPermitidas: [
      "nombreNegocio",
      "sitioWeb",
      "ciudad",
      "hallazgoPrincipal",
    ],
    version: 2,
    activa: true,
    creadaPorNombre: "Ana Pérez",
    actualizadoEn: new Date("2026-11-12T15:30:00.000Z"),
    ...overrides,
  }
}

function prospectoPreviaFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "pros_1",
    nombreNegocio: "Consultora Alfa",
    ciudad: "Palermo, CABA",
    rubro: "Consultoría",
    sitioWeb: "https://alfa.com.ar/",
    contactoNombre: "Ana",
    score: 88,
    auditoriaResumen: {
      findings: [
        { type: "warn", text: "La velocidad puede mejorar." },
      ],
    },
    campanaOrigen: { rubro: "Consultoría", zona: "Palermo, CABA" },
    ...overrides,
  }
}

function envioBandejaFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "env_1",
    estado: "BORRADOR",
    secuencia: 1,
    version: 1,
    asunto: "Asunto del borrador",
    actualizadoEn: new Date("2026-11-12T15:00:00.000Z"),
    prospecto: {
      id: "pros_1",
      nombreNegocio: "Consultora Alfa",
      ciudad: "Palermo, CABA",
      rubro: "Consultoría",
      score: 88,
      estado: "BORRADOR",
    },
    campana: { id: "camp_1", nombre: "Estudios contables" },
    ...overrides,
  }
}

describe("/propuestas/plantillas (T-16, AC-22)", () => {
  it("lista las plantillas activas, sus variables y el alta", async () => {
    mocks.plantillaFindMany.mockResolvedValue([plantillaResumenFixture()])

    render(await PlantillasPage())

    expect(
      screen.getByRole("heading", { level: 1, name: "Plantillas" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Primer contacto" }),
    ).toHaveAttribute("href", "/propuestas/plantillas/pl_1")
    expect(screen.getByText(/v2 · es/)).toBeInTheDocument()
    expect(
      screen.getAllByText("{{nombreNegocio}}").length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText("{{hallazgoPrincipal}}").length,
    ).toBeGreaterThan(0)

    expect(screen.getByLabelText(/nombre de la plantilla/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^asunto$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/cuerpo \(texto plano\)/i)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Crear plantilla" }),
    ).toBeInTheDocument()

    expect(mocks.plantillaFindMany).toHaveBeenCalledWith({
      where: { activa: true },
      select: {
        id: true,
        nombre: true,
        idioma: true,
        asunto: true,
        variablesPermitidas: true,
        version: true,
        actualizadoEn: true,
      },
      orderBy: [{ nombre: "asc" }, { version: "desc" }],
      take: 100,
    })
  })

  it("muestra un estado vacio que invita a crear la primera plantilla", async () => {
    mocks.plantillaFindMany.mockResolvedValue([])

    render(await PlantillasPage())

    expect(
      screen.getByText(/todavía no hay plantillas activas/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Crear plantilla" }),
    ).toBeInTheDocument()
  })

  it("con el esquema faltante falla cerrado sin formulario", async () => {
    mocks.plantillaFindMany.mockRejectedValue({ code: "P2021" })

    render(await PlantillasPage())

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("button", { name: "Crear plantilla" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/nombre de la plantilla/i),
    ).not.toBeInTheDocument()
  })

  it("no oculta errores que no son de esquema", async () => {
    mocks.plantillaFindMany.mockRejectedValue(new Error("base caida"))

    await expect(PlantillasPage()).rejects.toThrow("base caida")
  })

  it("publica metadata noindex/nofollow", () => {
    expect(metadataPlantillas.robots).toEqual({ index: false, follow: false })
  })
})

describe("PlantillaForm (T-16, AC-22; RF-37)", () => {
  it("crea la version 1 por POST con variables y muestra exito accesible", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "pl_1", version: 1 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<PlantillaForm />)

    fireEvent.change(screen.getByLabelText(/nombre de la plantilla/i), {
      target: { value: "Primer contacto" },
    })
    fireEvent.change(screen.getByLabelText(/^asunto$/i), {
      target: { value: "Una idea para {{nombreNegocio}}" },
    })
    fireEvent.change(screen.getByLabelText(/cuerpo \(texto plano\)/i), {
      target: {
        value: "Hola {{contactoNombre}},\n\nVi {{hallazgoPrincipal}}.",
      },
    })

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Crear plantilla" }),
      ),
    )

    const resultado = await screen.findByRole("status", {
      name: /resultado del guardado de la plantilla/i,
    })
    expect(resultado).toHaveTextContent("La plantilla quedó activa")
    expect(resultado).toHaveTextContent(/no se envió ningún email/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/plantillas")
    expect(init.method).toBe("POST")

    const body = await cuerpoEnviado(fetchMock)
    expect(body).toMatchObject({
      nombre: "Primer contacto",
      idioma: "es",
      asunto: "Una idea para {{nombreNegocio}}",
      cuerpo: "Hola {{contactoNombre}},\n\nVi {{hallazgoPrincipal}}.",
    })
    expect(body.variablesPermitidas).toEqual(
      expect.arrayContaining([
        "nombreNegocio",
        "ciudad",
        "rubro",
        "sitioWeb",
        "contactoNombre",
        "saludo",
        "hallazgoPrincipal",
        "score",
        "remitenteNombre",
        "anio",
      ]),
    )
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("valida en el cliente con errores accesibles y no envia", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<PlantillaForm />)
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Crear plantilla" }),
      ),
    )

    expect(
      await screen.findByText("El nombre de la plantilla es obligatorio."),
    ).toBeInTheDocument()
    const nombre = screen.getByLabelText(/nombre de la plantilla/i)
    expect(nombre).toHaveAttribute("aria-invalid", "true")
    expect(nombre).toHaveAttribute(
      "aria-describedby",
      "plantilla-nombre-error",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("muestra el error saneado por codigo del servidor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ codigo: "VALIDACION" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<PlantillaForm />)
    fireEvent.change(screen.getByLabelText(/nombre de la plantilla/i), {
      target: { value: "Primer contacto" },
    })
    fireEvent.change(screen.getByLabelText(/^asunto$/i), {
      target: { value: "Propuesta" },
    })
    fireEvent.change(screen.getByLabelText(/cuerpo \(texto plano\)/i), {
      target: { value: "Hola." },
    })
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Crear plantilla" }),
      ),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/la plantilla no es válida/i)
    expect(alerta).not.toHaveTextContent("Hola.")
  })

  it("en edicion avisa de la version nueva, bloquea el nombre y hace PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "pl_2", version: 3 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <PlantillaForm
        plantilla={{
          id: "pl_1",
          nombre: "Primer contacto",
          idioma: "es",
          asunto: "Una idea para {{nombreNegocio}}",
          cuerpo: "Hola {{nombreNegocio}}.",
          variablesPermitidas: ["nombreNegocio"],
          version: 2,
        }}
      />,
    )

    expect(screen.getByText("Primer contacto")).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: /nombre de la plantilla/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("note")).toHaveTextContent(
      /crea la versión 3 y desactiva la versión 2/i,
    )

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Crear versión nueva" }),
      ),
    )

    const resultado = await screen.findByRole("status", {
      name: /resultado del guardado de la plantilla/i,
    })
    expect(resultado).toHaveTextContent("Se creó la versión 3")
    expect(resultado).toHaveTextContent(/versión anterior quedó desactivada/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/plantillas/pl_1")
    expect(init.method).toBe("PATCH")
    const body = await cuerpoEnviado(fetchMock)
    expect(body).not.toHaveProperty("nombre")
    expect(body).toMatchObject({
      idioma: "es",
      asunto: "Una idea para {{nombreNegocio}}",
      cuerpo: "Hola {{nombreNegocio}}.",
      variablesPermitidas: ["nombreNegocio"],
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })
})

describe("/propuestas/plantillas/[id] (T-16, AC-22)", () => {
  async function renderPlantilla(id = "pl_1") {
    return render(
      await PlantillaDetallePage({ params: Promise.resolve({ id }) }),
    )
  }

  it("muestra el editor y una vista previa con un prospecto real", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(plantillaDetalleFixture())
    mocks.prospectoFindFirst.mockResolvedValue(prospectoPreviaFixture())

    await renderPlantilla()

    expect(
      screen.getByRole("heading", { level: 1, name: "Primer contacto" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/v2 · activa/)).toBeInTheDocument()
    expect(
      screen.getByRole("region", { name: /editor de la plantilla/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Crear versión nueva" }),
    ).toBeInTheDocument()

    const previa = screen.getByRole("region", {
      name: /vista previa con un prospecto real/i,
    })
    expect(
      within(previa).getByText("Una idea para Consultora Alfa"),
    ).toBeInTheDocument()
    expect(
      within(previa).getAllByText(
        /Vi https:\/\/alfa\.com\.ar\/ en Palermo, CABA: La velocidad puede mejorar\./,
      ).length,
    ).toBeGreaterThan(0)
    expect(
      within(previa).getByRole("link", { name: "Consultora Alfa" }),
    ).toHaveAttribute("href", "/propuestas/prospectos/pros_1")
    expect(within(previa).getByText("88/100")).toBeInTheDocument()
    expect(within(previa).getByText(/no incluye el footer legal/i)).toBeInTheDocument()

    expect(mocks.plantillaFindUnique).toHaveBeenCalledWith({
      where: { id: "pl_1" },
      select: {
        id: true,
        nombre: true,
        idioma: true,
        asunto: true,
        cuerpo: true,
        variablesPermitidas: true,
        version: true,
        activa: true,
        creadaPorNombre: true,
        actualizadoEn: true,
      },
    })
    expect(mocks.prospectoFindFirst).toHaveBeenCalledWith({
      where: {
        email: { not: null },
        estado: { notIn: ["SUPRIMIDO", "DESCARTADO"] },
      },
      orderBy: [{ score: "desc" }, { creadoEn: "desc" }],
      select: {
        id: true,
        nombreNegocio: true,
        ciudad: true,
        rubro: true,
        sitioWeb: true,
        contactoNombre: true,
        score: true,
        auditoriaResumen: true,
        campanaOrigen: { select: { rubro: true, zona: true } },
      },
    })

    // Sin PII en URLs: solo ids internos.
    for (const enlace of Array.from(document.querySelectorAll("a"))) {
      expect(enlace.getAttribute("href") ?? "").not.toContain("@")
    }
  })

  it("sin prospectos con email muestra un estado vacio y no inventa datos", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(plantillaDetalleFixture())
    mocks.prospectoFindFirst.mockResolvedValue(null)

    await renderPlantilla()

    expect(
      screen.getByText(/no hay ningún prospecto con email para previsualizar/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/prospecto usado/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+\/100/)).not.toBeInTheDocument()
  })

  it("escapa HTML en la vista previa", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(
      plantillaDetalleFixture({
        asunto: "Propuesta",
        cuerpo: "<script>alert(1)</script>",
        variablesPermitidas: [],
      }),
    )
    mocks.prospectoFindFirst.mockResolvedValue(prospectoPreviaFixture())

    await renderPlantilla()

    const previa = screen.getByRole("region", {
      name: /vista previa con un prospecto real/i,
    })
    expect(previa.innerHTML).toContain("&lt;script&gt;")
    expect(previa.innerHTML).not.toContain("<script>alert(1)</script>")
  })

  it("muestra un error accesible si la plantilla guardada no renderiza", async () => {
    mocks.plantillaFindUnique.mockResolvedValue(
      plantillaDetalleFixture({
        cuerpo: "Hola {{email}}",
        variablesPermitidas: [],
      }),
    )
    mocks.prospectoFindFirst.mockResolvedValue(prospectoPreviaFixture())

    await renderPlantilla()

    expect(screen.getByRole("alert")).toHaveTextContent(
      /la versión guardada no se puede renderizar/i,
    )
  })

  it("publica metadata noindex y usa notFound si no existe", async () => {
    expect(metadataPlantilla.robots).toEqual({ index: false, follow: false })

    mocks.plantillaFindUnique.mockResolvedValue(null)

    await expect(
      PlantillaDetallePage({ params: Promise.resolve({ id: "no-existe" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("con el esquema faltante falla cerrado sin editor", async () => {
    mocks.plantillaFindUnique.mockRejectedValue({ code: "P2021" })

    await renderPlantilla()

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("button", { name: "Crear versión nueva" }),
    ).not.toBeInTheDocument()
  })
})

describe("/propuestas/bandeja (T-16, AC-22, AC-24)", () => {
  it("lista BORRADOR/APROBADO por score, sin acciones masivas ni PII en URLs", async () => {
    mocks.envioFindMany.mockResolvedValue([
      envioBandejaFixture({
        id: "env_media",
        estado: "BORRADOR",
        asunto: "Asunto medio",
        prospecto: {
          id: "pros_media",
          nombreNegocio: "Beta",
          ciudad: "Córdoba",
          rubro: "Diseño",
          score: 40,
          estado: "BORRADOR",
        },
      }),
      envioBandejaFixture({
        id: "env_alta",
        estado: "APROBADO",
        asunto: "Asunto alto",
        prospecto: {
          id: "pros_alta",
          nombreNegocio: "Alfa",
          ciudad: "Palermo, CABA",
          rubro: "Consultoría",
          score: 88,
          estado: "APROBADO",
        },
      }),
      envioBandejaFixture({
        id: "env_sin_score",
        estado: "BORRADOR",
        asunto: "Asunto sin score",
        prospecto: {
          id: "pros_sin_score",
          nombreNegocio: "Gamma",
          ciudad: null,
          rubro: null,
          score: null,
          estado: "BORRADOR",
        },
      }),
    ])

    render(await BandejaPage())

    const filas = screen.getAllByRole("listitem")
    expect(filas).toHaveLength(3)
    expect(within(filas[0]).getByText("Alfa")).toBeInTheDocument()
    expect(within(filas[0]).getByText("APROBADO")).toBeInTheDocument()
    expect(within(filas[1]).getByText("Beta")).toBeInTheDocument()
    expect(within(filas[1]).getByText(/40\/100/)).toBeInTheDocument()
    expect(within(filas[2]).getByText("Gamma")).toBeInTheDocument()
    expect(
      within(filas[2]).getAllByText("—").length,
    ).toBeGreaterThan(0)

    expect(
      screen.getByText(/2 en borrador · 1 aprobados sin enviar/i),
    ).toBeInTheDocument()
    expect(screen.getByRole("note")).toHaveTextContent(
      /la bandeja es solo lectura/i,
    )
    expect(screen.getByRole("note")).toHaveTextContent(
      /no hay aprobación ni envío por lote/i,
    )
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(screen.queryAllByRole("button")).toHaveLength(0)

    const enlaces = screen.getAllByRole("link")
    expect(
      enlaces.some(
        (enlace) =>
          enlace.getAttribute("href") === "/propuestas/prospectos/pros_alta",
      ),
    ).toBe(true)
    for (const enlace of enlaces) {
      expect(enlace.getAttribute("href") ?? "").not.toContain("@")
    }

    expect(mocks.envioFindMany).toHaveBeenCalledWith({
      where: { estado: { in: ["BORRADOR", "APROBADO"] } },
      select: {
        id: true,
        estado: true,
        secuencia: true,
        version: true,
        asunto: true,
        actualizadoEn: true,
        prospecto: {
          select: {
            id: true,
            nombreNegocio: true,
            ciudad: true,
            rubro: true,
            score: true,
            estado: true,
          },
        },
        campana: { select: { id: true, nombre: true } },
      },
      orderBy: { actualizadoEn: "desc" },
      take: 200,
    })
  })

  it("muestra el estado vacio y no inventa borradores", async () => {
    mocks.envioFindMany.mockResolvedValue([])

    render(await BandejaPage())

    expect(
      screen.getByRole("heading", { name: /no hay borradores pendientes/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("con el esquema faltante falla cerrado sin datos", async () => {
    mocks.envioFindMany.mockRejectedValue({ code: "P2021" })

    render(await BandejaPage())

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("publica metadata noindex/nofollow", () => {
    expect(metadataBandeja.robots).toEqual({ index: false, follow: false })
  })
})

describe("panel de borrador en la ficha del prospecto (T-16, AC-22, AC-24)", () => {
  const campanaConPlantilla = {
    id: "camp_1",
    nombre: "Estudios contables Palermo",
    estado: "EN_CURSO",
    rubro: "Consultoría",
    zona: "Palermo, CABA",
    plantillaId: "pl_1",
  }

  it("ofrece Generar borrador con las plantillas activas de la campana", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ campanaOrigen: campanaConPlantilla }),
    )
    mocks.plantillaFindMany.mockResolvedValue([
      { id: "pl_1", nombre: "Primer contacto", version: 1 },
    ])

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(
      within(panel).getByRole("button", { name: "Generar borrador" }),
    ).toBeEnabled()
    expect(
      within(panel).getByRole("option", { name: "Primer contacto (v1)" }),
    ).toBeInTheDocument()
    expect(
      within(panel).getByText(/no inventa métricas, no usa LLM/i),
    ).toBeInTheDocument()
    expect(mocks.plantillaFindMany).toHaveBeenCalledWith({
      where: { activa: true },
      select: { id: true, nombre: true, version: true },
      orderBy: [{ nombre: "asc" }, { version: "desc" }],
    })
    expect(mocks.envioFindFirst).toHaveBeenCalledWith({
      where: {
        prospectoId: "pros_1",
        estado: { in: ["BORRADOR", "APROBADO"] },
      },
      orderBy: { actualizadoEn: "desc" },
      select: {
        id: true,
        estado: true,
        version: true,
        secuencia: true,
        asunto: true,
        cuerpoTexto: true,
        cuerpoHtml: true,
        hashContenido: true,
        destinatario: true,
        fromEmail: true,
        fromNombre: true,
        replyTo: true,
        plantillaId: true,
        plantillaVersion: true,
        aprobadoAsunto: true,
        aprobadoCuerpoHtml: true,
        aprobadoCuerpoTexto: true,
        aprobadoPorNombre: true,
        aprobadoEn: true,
      },
    })
  })

  it("sin email avisa que no se puede redactar y deshabilita la accion", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({
        email: null,
        campanaOrigen: campanaConPlantilla,
      }),
    )
    mocks.plantillaFindMany.mockResolvedValue([
      { id: "pl_1", nombre: "Primer contacto", version: 1 },
    ])

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(
      within(panel).getByText(/el prospecto no tiene email de contacto/i),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole("button", { name: "Generar borrador" }),
    ).toBeDisabled()
  })

  it("con un borrador abierto muestra el editor en lugar del boton", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ campanaOrigen: campanaConPlantilla }),
    )
    mocks.plantillaFindMany.mockResolvedValue([
      { id: "pl_1", nombre: "Primer contacto", version: 1 },
    ])
    mocks.envioFindFirst.mockResolvedValue({
      id: "env_1",
      estado: "BORRADOR",
      version: 1,
      secuencia: 1,
      asunto: "Una idea para Consultora Alfa",
      cuerpoTexto: "Hola Ana,\n\nTe escribo.",
    })

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(within(panel).getByLabelText("Asunto")).toHaveValue(
      "Una idea para Consultora Alfa",
    )
    expect(within(panel).getByLabelText(/cuerpo \(texto plano\)/i)).toHaveValue(
      "Hola Ana,\n\nTe escribo.",
    )
    expect(
      within(panel).getByRole("button", { name: "Guardar borrador" }),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole("button", { name: "Generar borrador" }),
    ).not.toBeInTheDocument()
  })

  it("con un envio aprobado avisa que editar invalida la aprobacion", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ campanaOrigen: campanaConPlantilla }),
    )
    mocks.plantillaFindMany.mockResolvedValue([
      { id: "pl_1", nombre: "Primer contacto", version: 1 },
    ])
    mocks.envioFindFirst.mockResolvedValue({
      id: "env_1",
      estado: "APROBADO",
      version: 2,
      secuencia: 1,
      asunto: "Una idea para Consultora Alfa",
      cuerpoTexto: "Hola Ana,\n\nTe escribo.",
    })

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(within(panel).getByRole("note")).toHaveTextContent(
      /este envío está aprobado \(versión 2, secuencia 1\)/i,
    )
    expect(
      within(panel).getByRole("button", {
        name: "Guardar como versión nueva",
      }),
    ).toBeInTheDocument()
  })

  it("no renderiza datos ni acciones si falta el esquema", async () => {
    mocks.prospectoFindUnique.mockRejectedValue({ code: "P2021" })

    await renderProspecto()

    expect(
      screen.queryByRole("region", { name: /borrador de propuesta/i }),
    ).not.toBeInTheDocument()
  })
})

describe("GenerarBorrador (T-16, AC-22, AC-23)", () => {
  const PLANTILLAS = [{ id: "pl_1", nombre: "Primer contacto", version: 1 }]

  it("hace un POST determinista y muestra el resultado sin enviar", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ envioId: "env_1", secuencia: 1, version: 1 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="PUNTUADO"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Generar borrador" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(
      /Borrador creado \(secuencia 1, versión 1\)/i,
    )
    expect(resultado).toHaveTextContent(/no se envió ningún email/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/prospectos/pros_1/borrador")
    expect(url).not.toContain("@")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      modo: "PLANTILLA",
      plantillaId: "pl_1",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("muestra el motivo saneado del servidor sin PII", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "SIN_EMAIL" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="PUNTUADO"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Generar borrador" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/no tiene email de contacto/i)
    expect(alerta).not.toHaveTextContent("@")
  })

  it("sin plantillas activas deshabilita la accion y enlaza al alta", () => {
    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={[]}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="PUNTUADO"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Generar borrador" }),
    ).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent(
      /no hay plantillas activas/i,
    )
    expect(
      screen.getByRole("link", { name: /creá una plantilla/i }),
    ).toHaveAttribute("href", "/propuestas/plantillas")
  })

  it("un prospecto no puntuado explica el estado y no habilita la accion", () => {
    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="NUEVO"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Generar borrador" }),
    ).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent(
      /se necesita un prospecto puntuado/i,
    )
  })
})

describe("AprobacionPanel (T-17, AC-25, AC-27; RF-40..RF-42, RF-44)", () => {
  const PROPS = {
    envioId: "env_1",
    estado: "BORRADOR",
    version: 1,
    secuencia: 1,
    plantillaVersion: 1,
    destinatario: "ventas@alfa.com.ar",
    fromEmail: "propuestas@pixelarch.dev",
    fromNombre: "PixelArch",
    replyTo: "hola@pixelarch.dev",
    asunto: "Una idea para Consultora Alfa",
    cuerpoTexto: "Hola Ana,\n\nTe escribo.",
    cuerpoHtml: "<p>Hola Ana,</p>",
    aprobadoAsunto: null as string | null,
    aprobadoCuerpoTexto: null as string | null,
    aprobadoCuerpoHtml: null as string | null,
    aprobadoPorNombre: null as string | null,
    aprobadoEnTexto: null as string | null,
    bloqueos: [] as string[],
    fuentes: {
      sitioWeb: "https://alfa.com.ar/",
      fuenteUrl: "https://alfa.com.ar/contacto",
      emailFuenteUrl: "https://alfa.com.ar/contacto",
    },
    score: 88,
    auditoriaEstado: "OK",
  }

  it("avisa que aprobar no envía y exige confirmación explícita", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<AprobacionPanel {...PROPS} />)

    const aviso = screen.getByRole("note", { name: /aprobar no envía/i })
    expect(aviso).toHaveTextContent(/no llama a resend/i)
    expect(aviso).toHaveTextContent(/envío real es otra acción separada/i)

    expect(screen.getByText("ventas@alfa.com.ar")).toBeInTheDocument()
    expect(
      screen.getByText("PixelArch <propuestas@pixelarch.dev>"),
    ).toBeInTheDocument()
    expect(screen.getByText("hola@pixelarch.dev")).toBeInTheDocument()
    expect(screen.getByText("Una idea para Consultora Alfa")).toBeInTheDocument()
    expect(screen.getByText("88/100")).toBeInTheDocument()
    expect(screen.getByText("OK")).toBeInTheDocument()
    expect(screen.getByText("v1 · secuencia 1")).toBeInTheDocument()

    const boton = screen.getByRole("button", { name: "Aprobar" })
    expect(boton).toBeDisabled()
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    expect(
      screen.getByRole("button", { name: "Aprobar" }),
    ).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("con bloqueos de aprobación no habilita el botón (sin importar el gate)", () => {
    render(
      <AprobacionPanel
        {...PROPS}
        bloqueos={[
          "Falta PROPUESTAS_SECRETO o no es valido.",
          "Falta PROPUESTAS_TEXTO_LEGAL aprobado.",
        ]}
      />,
    )

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled()
    const bloqueo = screen.getByRole("note", {
      name: /motivos por los que no se puede aprobar/i,
    })
    expect(bloqueo).toHaveTextContent(/PROPUESTAS_SECRETO/)
    expect(bloqueo).toHaveTextContent(/PROPUESTAS_TEXTO_LEGAL/)
  })

  it("no bloquea por PROPUESTAS_ENVIO_HABILITADO ni RESEND_API_KEY", () => {
    // El componente solo recibe bloqueos de aprobación; el gate y Resend son
    // requisitos del envío (T-18) y no deben impedir aprobar el snapshot.
    render(<AprobacionPanel {...PROPS} bloqueos={[]} />)

    expect(
      screen.queryByRole("note", {
        name: /motivos por los que no se puede aprobar/i,
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled()
  })

  it("bloquea si falta la fuente pública de los datos", () => {
    render(
      <AprobacionPanel
        {...PROPS}
        fuentes={{ sitioWeb: null, fuenteUrl: null, emailFuenteUrl: null }}
      />,
    )

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeDisabled()
    expect(
      screen.getByRole("note", {
        name: /motivos por los que no se puede aprobar/i,
      }),
    ).toHaveTextContent(/falta la fuente pública/i)
  })

  it("solo un BORRADOR muestra el botón y el checkbox", () => {
    for (const estado of ["ENVIANDO", "ENVIADO", "CANCELADO"]) {
      const { unmount } = render(
        <AprobacionPanel {...PROPS} estado={estado} />,
      )
      expect(
        screen.queryByRole("button", { name: "Aprobar" }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent(
        /solo un borrador puede aprobarse/i,
      )
      unmount()
    }
  })

  it("en APROBADO muestra el snapshot inmutable y no ofrece aprobar de nuevo", () => {
    render(
      <AprobacionPanel
        {...PROPS}
        estado="APROBADO"
        aprobadoAsunto="[publicidad] Asunto aprobado"
        aprobadoCuerpoTexto="Cuerpo aprobado en el snapshot"
        aprobadoCuerpoHtml="<html>HTML aprobado</html>"
        aprobadoPorNombre="Ana Pérez"
        aprobadoEnTexto="12 de nov de 2026, 15:00"
      />,
    )

    expect(
      screen.queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(
      /snapshot aprobado e inmutable por Ana Pérez el 12 de nov de 2026, 15:00/i,
    )
    expect(screen.getByText("[publicidad] Asunto aprobado")).toBeInTheDocument()
    expect(
      screen.queryByText("Una idea para Consultora Alfa"),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Cuerpo aprobado en el snapshot")).toBeInTheDocument()
    expect(screen.getByText("HTML del snapshot")).toBeInTheDocument()
    expect(screen.getByText(/no se envía nada automáticamente/i)).toBeInTheDocument()
  })

  it("aprueba con { confirmado: true }, muestra el resultado y refresca", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        estado: "APROBADO",
        aprobadoEn: "2026-11-12T18:00:00.000Z",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AprobacionPanel {...PROPS} />)
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Aprobación registrada el/i)
    expect(resultado).toHaveTextContent(/No se envió ningún email/i)
    expect(resultado).toHaveTextContent(/acción separada/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/envios/env_1/aprobar")
    expect(url).not.toContain("@")
    expect(url).not.toContain("/enviar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ confirmado: true })
    expect(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    ).not.toBeChecked()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("muestra un error accesible del servidor sin PII", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        codigo: "REVALIDACION",
        motivos: [
          "El contenido del borrador cambio desde que se genero o esta incompleto.",
        ],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AprobacionPanel {...PROPS} />)
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(
      /la aprobación ya no coincide con el contenido actual/i,
    )
    expect(alerta).toHaveTextContent(/El contenido del borrador cambio/i)
    expect(alerta).not.toHaveTextContent("ventas@alfa.com.ar")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("mapea los códigos de permiso sin filtrar datos", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ codigo: "PROHIBIDO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<AprobacionPanel {...PROPS} />)
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/no tenés permisos para aprobar/i)
    expect(alerta).not.toHaveTextContent("Hola Ana")
  })

  it("no hace fetch si falta confirmar", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<AprobacionPanel {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("ficha del prospecto: aprobación (T-17, AC-25, AC-27)", () => {
  const ENV_APROBACION = {
    NEXT_PUBLIC_URL: "https://pixelarch.dev",
    PROPUESTAS_SECRETO: "secreto-de-pruebas-propuestas-1234567890",
    PROPUESTAS_TEXTO_LEGAL: "Texto legal de prueba aprobado.",
    PROPUESTAS_BASE_LEGAL: "Base legal de prueba aprobada.",
    PROPUESTAS_FROM_EMAIL: "propuestas@pixelarch.dev",
    PROPUESTAS_REPLY_TO: "hola@pixelarch.dev",
    PROPUESTAS_FROM_NOMBRE: "PixelArch",
    PROPUESTAS_ENVIO_HABILITADO: "false",
  }

  function stubEntornoAprobacion(): void {
    for (const [clave, valor] of Object.entries(ENV_APROBACION)) {
      vi.stubEnv(clave, valor)
    }
    vi.stubEnv("RESEND_API_KEY", "")
  }

  function envioAbiertoFixture(overrides: Record<string, unknown> = {}) {
    const asunto = "Una idea para Consultora Alfa"
    const cuerpoTexto = "Hola Ana,\n\nTe escribo."
    const cuerpoHtml = "<p>Hola Ana,</p><p>Te escribo.</p>"
    const secuencia = 1

    return {
      id: "env_1",
      estado: "BORRADOR",
      version: 1,
      secuencia,
      asunto,
      cuerpoTexto,
      cuerpoHtml,
      hashContenido: hashContenidoEnvio({
        asunto,
        cuerpoTexto,
        cuerpoHtml,
        destinatario: "ventas@alfa.com.ar",
        plantillaId: "pl_1",
        plantillaVersion: 1,
        secuencia,
      }),
      destinatario: "ventas@alfa.com.ar",
      fromEmail: "propuestas@pixelarch.dev",
      fromNombre: "PixelArch",
      replyTo: "hola@pixelarch.dev",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      aprobadoAsunto: null,
      aprobadoCuerpoHtml: null,
      aprobadoCuerpoTexto: null,
      aprobadoPorNombre: null,
      aprobadoEn: null,
      ...overrides,
    }
  }

  it("muestra el panel con aviso y confirma sin bloquearse por el gate ni Resend", async () => {
    stubEntornoAprobacion()
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.envioFindFirst.mockResolvedValue(envioAbiertoFixture())

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /aprobación de la propuesta/i,
    })
    expect(
      within(panel).getByRole("note", { name: /aprobar no envía/i }),
    ).toHaveTextContent(/no llama a resend/i)
    expect(within(panel).getByText("ventas@alfa.com.ar")).toBeInTheDocument()
    expect(
      within(panel).getByText("PixelArch <propuestas@pixelarch.dev>"),
    ).toBeInTheDocument()
    expect(
      within(panel).getByRole("button", { name: "Aprobar" }),
    ).toBeDisabled()

    fireEvent.click(
      within(panel).getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )
    expect(
      within(panel).getByRole("button", { name: "Aprobar" }),
    ).toBeEnabled()
    expect(
      within(panel).queryByRole("note", {
        name: /motivos por los que no se puede aprobar/i,
      }),
    ).not.toBeInTheDocument()
  })

  it("bloquea la aprobación si falta configuración del snapshot", async () => {
    vi.stubEnv("NEXT_PUBLIC_URL", "https://pixelarch.dev")
    vi.stubEnv("PROPUESTAS_SECRETO", "")
    vi.stubEnv("PROPUESTAS_TEXTO_LEGAL", "")
    vi.stubEnv("PROPUESTAS_BASE_LEGAL", "")
    vi.stubEnv("PROPUESTAS_FROM_EMAIL", "")
    vi.stubEnv("PROPUESTAS_REPLY_TO", "")
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.envioFindFirst.mockResolvedValue(envioAbiertoFixture())

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /aprobación de la propuesta/i,
    })
    fireEvent.click(
      within(panel).getByRole("checkbox", {
        name: /confirmo que revisé el destinatario/i,
      }),
    )

    expect(
      within(panel).getByRole("button", { name: "Aprobar" }),
    ).toBeDisabled()
    const bloqueos = within(panel).getByRole("note", {
      name: /motivos por los que no se puede aprobar/i,
    })
    expect(bloqueos).toHaveTextContent(/PROPUESTAS_SECRETO/i)
    expect(bloqueos).toHaveTextContent(/PROPUESTAS_TEXTO_LEGAL/i)
    expect(bloqueos).toHaveTextContent(/PROPUESTAS_BASE_LEGAL/i)
  })

  it("en APROBADO muestra el snapshot guardado y no ofrece aprobar", async () => {
    stubEntornoAprobacion()
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.envioFindFirst.mockResolvedValue(
      envioAbiertoFixture({
        estado: "APROBADO",
        version: 2,
        aprobadoAsunto: "[publicidad] Asunto aprobado",
        aprobadoCuerpoTexto: "Cuerpo aprobado en el snapshot",
        aprobadoCuerpoHtml: "<html>HTML aprobado</html>",
        aprobadoPorNombre: "Ana Pérez",
        aprobadoEn: new Date("2026-11-12T18:00:00.000Z"),
      }),
    )

    await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /aprobación de la propuesta/i,
    })
    expect(
      within(panel).queryByRole("button", { name: "Aprobar" }),
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole("checkbox"),
    ).not.toBeInTheDocument()
    expect(within(panel).getByRole("status")).toHaveTextContent(
      /snapshot aprobado e inmutable por Ana Pérez/i,
    )
    expect(
      within(panel).getByText("[publicidad] Asunto aprobado"),
    ).toBeInTheDocument()
  })
})

describe("BorradorEditor (T-16, AC-22, AC-24)", () => {
  const PROPS = {
    envioId: "env_1",
    prospectoId: "pros_1",
    version: 1,
    secuencia: 1,
    asunto: "Una idea para Consultora Alfa",
    cuerpoTexto: "Hola Ana,\n\nTe escribo.",
  }

  it("en BORRADOR actualiza en sitio y muestra el resultado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ envioId: "env_1", version: 1 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<BorradorEditor {...PROPS} estado="BORRADOR" />)

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar borrador" }),
      ),
    )

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Borrador actualizado \(versión 1\)/i)
    expect(resultado).toHaveTextContent(/no se envió ningún email/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/envios/env_1")
    expect(url).not.toContain("@")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(String(init.body))).toEqual({
      asunto: "Una idea para Consultora Alfa",
      cuerpoTexto: "Hola Ana,\n\nTe escribo.",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("en APROBADO avisa que se crea una version y se cancela la aprobacion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ envioId: "env_2", version: 2 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<BorradorEditor {...PROPS} estado="APROBADO" version={2} />)

    expect(screen.getByRole("note")).toHaveTextContent(
      /guardar crea una versión nueva en borrador/i,
    )

    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar como versión nueva" }),
      ),
    )

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Se creó la versión 2/i)
    expect(resultado).toHaveTextContent(/aprobación anterior quedó cancelada/i)
    expect(resultado).toHaveTextContent(/aprobá de nuevo/i)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("muestra un error accesible si el envio cambio de estado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "ESTADO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<BorradorEditor {...PROPS} estado="BORRADOR" />)
    fireEvent.submit(
      formularioDe(
        screen.getByRole("button", { name: "Guardar borrador" }),
      ),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/el envío cambió de estado/i)
    expect(alerta).not.toHaveTextContent("Hola Ana")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("no envia un cuerpo vacio desde la UI", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<BorradorEditor {...PROPS} estado="BORRADOR" />)

    fireEvent.change(screen.getByLabelText(/cuerpo \(texto plano\)/i), {
      target: { value: "   " },
    })

    expect(
      screen.getByRole("button", { name: "Guardar borrador" }),
    ).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})


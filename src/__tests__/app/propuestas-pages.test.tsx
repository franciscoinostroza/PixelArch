import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { AnchorHTMLAttributes, ReactNode } from "react"
import { unstable_noStore } from "next/cache"

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
  supresionFindMany: vi.fn(),
  consumoFindMany: vi.fn(),
  consumoUpsert: vi.fn(),
  pathname: "/propuestas",
  refresh: vi.fn(),
  push: vi.fn(),
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
    supresionProspecto: { findMany: mocks.supresionFindMany },
    consumoProveedor: {
      findMany: mocks.consumoFindMany,
      upsert: mocks.consumoUpsert,
    },
  },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
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

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }))

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
import EnviosPage, {
  metadata as metadataEnvios,
} from "@/app/(propuestas)/propuestas/envios/page"
import SupresionesPage, {
  dynamic as dynamicSupresiones,
  metadata as metadataSupresiones,
} from "@/app/(propuestas)/propuestas/supresiones/page"
import {
  SupresionForm,
  SupresionPurgarForm,
  SupresionRevocarForm,
} from "@/components/propuestas/supresion-form"
import { ScoreDesglose } from "@/components/propuestas/score-desglose"
import { AnalizarProspecto } from "@/components/propuestas/analizar-prospecto-button"
import { PlantillaForm } from "@/components/propuestas/plantilla-form"
import {
  BorradorEditor,
  GenerarBorrador,
} from "@/components/propuestas/borrador-editor"
import { AprobacionPanel } from "@/components/propuestas/aprobacion-panel"
import { ArcoPanel, type ProspectoArco } from "@/components/propuestas/arco-panel"
import {
  EnvioConfirmacion,
  EnvioSeguimiento,
} from "@/components/propuestas/envio-confirmacion"
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
import {
  CupoDia,
  type EstadoCupoDia,
  type FilaCupoDia,
} from "@/components/propuestas/cupo-dia"
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
import BajaPropuestasPage, {
  dynamic as dynamicBaja,
  metadata as metadataBaja,
  revalidate as revalidateBaja,
} from "@/app/(propuestas-baja)/propuestas/baja/[token]/page"
import BajaPropuestasLayout, {
  metadata as metadataLayoutBaja,
} from "@/app/(propuestas-baja)/layout"
import { BajaConfirmar } from "@/components/propuestas/baja-confirmar"
import { crearTokenBaja, hashEmail } from "@/lib/propuestas/supresion"

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
  mocks.supresionFindMany.mockResolvedValue([])
  mocks.consumoFindMany.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/* ------------------------------------------------------------------ */
/* T-21: datos de consumo inyectados en Prisma (día/mes y ámbito)      */
/* ------------------------------------------------------------------ */

interface ConsumoFilaMock {
  campanaId: string
  prospectoId: string | null
  proveedor: string
  fecha: Date
  unidades: number
  llamadas: number
  costoCentavos: number
}

interface WhereConsumoMock {
  fecha: Date | { gte: Date; lt: Date }
  campanaId?: string
  prospectoId?: string
}

/**
 * Implementación de `consumoProveedor.findMany` que respeta el `where` real:
 * filtra por día y por campaña/prospecto, o suma costos del rango mensual. Sin
 * esto las páginas verían el mismo agregado para el ámbito acotado y el global.
 */
function consumoFindManyPorFilas(filas: readonly ConsumoFilaMock[]) {
  return (args: { where: WhereConsumoMock }) => {
    const { where } = args
    const fecha = where.fecha

    if (fecha instanceof Date) {
      const dia = fecha.getTime()

      return filas
        .filter((fila) => fila.fecha.getTime() === dia)
        .filter(
          (fila) =>
            where.campanaId === undefined ||
            fila.campanaId === where.campanaId,
        )
        .filter(
          (fila) =>
            where.prospectoId === undefined ||
            (fila.prospectoId ?? null) === where.prospectoId,
        )
        .map((fila) => ({
          proveedor: fila.proveedor,
          unidades: fila.unidades,
          llamadas: fila.llamadas,
          costoCentavos: fila.costoCentavos,
        }))
    }

    return filas
      .filter(
        (fila) =>
          fila.fecha.getTime() >= fecha.gte.getTime() &&
          fila.fecha.getTime() < fecha.lt.getTime(),
      )
      .map((fila) => ({ costoCentavos: fila.costoCentavos }))
  }
}

function diaUTCDe(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
  )
}

/** Piezas mínimas para que `CupoDia` muestre contadores en vez de no configurado. */
function stubConsumoConfigurado(): void {
  vi.stubEnv("PROPUESTAS_PLACES_API_KEY", "places-key")
  vi.stubEnv("RESEND_API_KEY", "resend-key")
  vi.stubEnv("PROPUESTAS_SECRETO", "s".repeat(32))
}

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

  it("T-21: muestra cupos globales con alerta 80%, bloqueo 100% y costo", async () => {
    vi.stubEnv("PROPUESTAS_PLACES_API_KEY", "places-key")
    vi.stubEnv("RESEND_API_KEY", "resend-key")
    vi.stubEnv("PROPUESTAS_SECRETO", "s".repeat(32))
    mocks.queryRaw.mockResolvedValue([])
    mocks.consumoFindMany.mockResolvedValue([
      {
        proveedor: "GOOGLE_PLACES",
        unidades: 16,
        llamadas: 16,
        costoCentavos: 150,
      },
      {
        proveedor: "RESEND",
        unidades: 20,
        llamadas: 20,
        costoCentavos: 200,
      },
      {
        proveedor: "WEB_FETCH",
        unidades: 1,
        llamadas: 1,
        costoCentavos: 0,
      },
    ])

    render(await PropuestasDashboardPage())

    const cupos = screen.getByRole("region", { name: /cupos del día/i })
    expect(within(cupos).getByText("Google Places")).toBeInTheDocument()
    expect(within(cupos).getByText("Aviso 80%")).toBeInTheDocument()
    expect(within(cupos).getByText("Bloqueado al 100%")).toBeInTheDocument()
    expect(within(cupos).getAllByText(/US\$\s?1,50/).length).toBeGreaterThan(0)
    expect(
      within(cupos).getAllByText(/sin costo estimado/i).length,
    ).toBeGreaterThan(0)
    expect(
      within(cupos).getByRole("link", { name: /ver supresiones/i }),
    ).toHaveAttribute("href", "/propuestas/supresiones")
    expect(
      within(cupos).getByText(/no hay cola automática ni sobreconsumo/i),
    ).toBeInTheDocument()
  })

  it("T-21: si falta configuración muestra estado operativo y no inventa números", async () => {
    mocks.queryRaw.mockResolvedValue([])

    render(await PropuestasDashboardPage())

    const cupos = screen.getByRole("region", { name: /cupos del día/i })
    expect(
      within(cupos).getByText("Estado operativo: no configurado"),
    ).toBeInTheDocument()
    expect(
      within(cupos).getAllByText("No configurado").length,
    ).toBeGreaterThan(0)
    expect(
      within(cupos).getAllByText(/falta PROPUESTAS_PLACES_API_KEY/i).length,
    ).toBeGreaterThan(0)
    expect(
      within(cupos).getAllByText(/falta PROPUESTAS_SECRETO/i).length,
    ).toBeGreaterThan(0)
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

  it("no duplica el generador cuando hay un BORRADOR o APROBADO abierto (AC-22, AC-31)", async () => {
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

    const borrador = await renderProspecto()

    const panel = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(
      within(panel).getByRole("button", { name: "Guardar borrador" }),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole("button", { name: "Generar borrador" }),
    ).not.toBeInTheDocument()
    borrador.unmount()

    mocks.envioFindFirst.mockResolvedValue({
      id: "env_1",
      estado: "APROBADO",
      version: 2,
      secuencia: 1,
      asunto: "Una idea para Consultora Alfa",
      cuerpoTexto: "Hola Ana,\n\nTe escribo.",
    })

    const aprobado = await renderProspecto()

    const panelAprobado = screen.getByRole("region", {
      name: /borrador de propuesta/i,
    })
    expect(
      within(panelAprobado).getByRole("button", {
        name: "Guardar como versión nueva",
      }),
    ).toBeInTheDocument()
    expect(
      within(panelAprobado).queryByRole("button", { name: "Generar borrador" }),
    ).not.toBeInTheDocument()
    aprobado.unmount()
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

  it("con estado ENVIADO habilita el follow-up manual y hace POST del borrador nuevo (AC-31)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ envioId: "env_2", secuencia: 2, version: 1 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="ENVIADO"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Generar borrador" }),
    ).toBeEnabled()
    const aviso = screen.getByRole("status")
    expect(aviso).toHaveTextContent(/follow-up es\s+manual/i)
    expect(aviso).toHaveTextContent(
      /requiere un borrador nuevo y una aprobación nueva/i,
    )
    expect(aviso).toHaveTextContent(/máximo de mensajes configurado/i)
    expect(aviso).toHaveTextContent(
      /no hay follow-up automático ni envío programado/i,
    )

    fireEvent.click(screen.getByRole("button", { name: "Generar borrador" }))

    const resultado = await screen.findByText(
      /Borrador creado \(secuencia 2, versión 1\)/i,
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

  it("se deshabilita con ENVIANDO y con un envío abierto, sin generar (AC-31)", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const { unmount } = render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="ENVIANDO"
      />,
    )
    expect(
      screen.getByRole("button", { name: "Generar borrador" }),
    ).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent(
      /estado\s+ENVIANDO/i,
    )
    fireEvent.click(screen.getByRole("button", { name: "Generar borrador" }))
    unmount()

    render(
      <GenerarBorrador
        prospectoId="pros_1"
        plantillas={PLANTILLAS}
        plantillaPorDefectoId={null}
        tieneEmail
        estadoProspecto="ENVIADO"
        hayEnvioAbierto
      />,
    )
    expect(
      screen.getByRole("button", { name: "Generar borrador" }),
    ).toBeDisabled()
    expect(
      screen.getByText(/ya hay un envío abierto o pendiente/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Generar borrador" }))

    expect(fetchMock).not.toHaveBeenCalled()
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

/* ------------------------------------------------------------------ */
/* T-18 (AC-26, AC-28..AC-31; RF-43..RF-50): historial, confirmacion,  */
/* seguimiento y ficha                                                  */
/* ------------------------------------------------------------------ */

function envioHistorialFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "env_1",
    estado: "ENVIADO",
    version: 1,
    secuencia: 1,
    destinatario: "ventas@alfa.com.ar",
    proveedorMessageId: "msg_live_1",
    error: null,
    creadoEn: new Date("2026-11-12T17:00:00.000Z"),
    actualizadoEn: new Date("2026-11-12T18:00:00.000Z"),
    aprobadoEn: new Date("2026-11-12T17:30:00.000Z"),
    enviadoEn: new Date("2026-11-12T18:00:00.000Z"),
    prospecto: { id: "pros_1", nombreNegocio: "Consultora Alfa" },
    campana: { id: "camp_1", nombre: "Estudios contables Palermo" },
    ...overrides,
  }
}

describe("/propuestas/envios (T-18, AC-26, AC-29; RF-43..RF-49)", () => {
  it("muestra el historial con destinatario enmascarado, message ID y error saneado", async () => {
    mocks.envioFindMany.mockResolvedValue([
      envioHistorialFixture(),
      envioHistorialFixture({
        id: "env_2",
        estado: "FALLIDO",
        version: 2,
        secuencia: 2,
        proveedorMessageId: null,
        error: "PROVEEDOR: Resend no respondio correctamente.",
      }),
    ])

    render(await EnviosPage())

    expect(
      screen.getByRole("heading", { name: /historial de envíos/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/2 envíos en el historial/i)).toBeInTheDocument()
    expect(screen.getByText(/1 enviados/i)).toBeInTheDocument()
    expect(screen.getByText(/1 con fallo o supresión/i)).toBeInTheDocument()

    // El email completo no se muestra: solo la mascara.
    expect(screen.getAllByText(/v\*\*\*@alfa\.com\.ar/i).length).toBe(2)
    expect(document.body).not.toHaveTextContent("ventas@alfa.com.ar")

    expect(screen.getByText("msg_live_1")).toBeInTheDocument()
    expect(screen.getByText("ENVIADO")).toBeInTheDocument()
    expect(screen.getByText("FALLIDO")).toBeInTheDocument()
    expect(
      screen.getByText(/PROVEEDOR: Resend no respondio correctamente/i),
    ).toBeInTheDocument()

    const ficha = screen.getAllByRole("link", {
      name: /ver en la ficha del prospecto/i,
    })
    expect(ficha[0]).toHaveAttribute("href", "/propuestas/prospectos/pros_1")
    expect(
      screen.getAllByRole("link", { name: "Consultora Alfa" })[0],
    ).toHaveAttribute("href", "/propuestas/prospectos/pros_1")
    expect(
      screen.getAllByRole("link", { name: "Estudios contables Palermo" })[0],
    ).toHaveAttribute("href", "/propuestas/campanas/camp_1")

    expect(screen.getByRole("note")).toHaveTextContent(/solo lectura/i)
  })

  it("muestra el estado vacio sin acciones", async () => {
    mocks.envioFindMany.mockResolvedValue([])

    render(await EnviosPage())

    expect(
      screen.getByRole("heading", { name: /todavía no hay envíos/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("con esquema faltante muestra EstadoOperativo y no lista envios", async () => {
    mocks.envioFindMany.mockRejectedValue({ code: "P2021" })

    render(await EnviosPage())

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
  })

  it("no oculta errores que no son de esquema y publica noindex", async () => {
    expect(metadataEnvios.robots).toEqual({ index: false, follow: false })

    mocks.envioFindMany.mockRejectedValue(new Error("base caida"))

    await expect(EnviosPage()).rejects.toThrow("base caida")
  })
})

describe("EnvioConfirmacion (T-18, AC-26, AC-28, AC-30)", () => {
  const PROPS = {
    envioId: "env_1",
    destinatario: "ventas@alfa.com.ar",
    asunto: "Una idea para Consultora Alfa",
    version: 2,
    secuencia: 1,
  }

  it("avisa que no hay autoenvio y exige un checkbox separado del de aprobacion", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<EnvioConfirmacion {...PROPS} />)

    const region = screen.getByRole("region", {
      name: /confirmación de envío/i,
    })
    expect(
      within(region).getByRole("heading", { name: /enviar la propuesta/i }),
    ).toBeInTheDocument()
    expect(within(region).getByText("APROBADO")).toBeInTheDocument()
    expect(
      within(region).getByText(/no hay autoenvío, envío por lote, cola ni programación/i),
    ).toBeInTheDocument()
    expect(
      within(region).getByText("ventas@alfa.com.ar"),
    ).toBeInTheDocument()
    expect(
      within(region).getByText("Una idea para Consultora Alfa"),
    ).toBeInTheDocument()
    expect(within(region).getByText("v2 · secuencia 1")).toBeInTheDocument()
    expect(within(region).queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(
      within(region).getByRole("button", { name: "Enviar email" }),
    )

    const dialogo = screen.getByRole("dialog", {
      name: /confirmar envío real/i,
    })
    expect(dialogo).toHaveAttribute("aria-modal", "true")
    const checkbox = within(dialogo).getByRole("checkbox", {
      name: /entiendo que se enviará un email real/i,
    })
    expect(checkbox).not.toBeChecked()
    expect(
      within(dialogo).getByRole("button", { name: "Enviar email real" }),
    ).toBeDisabled()

    fireEvent.click(checkbox)

    expect(
      within(dialogo).getByRole("button", { name: "Enviar email real" }),
    ).toBeEnabled()
  })

  it("con el gate o la configuración incompletos muestra el badge y no abre el diálogo (AC-30)", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <EnvioConfirmacion
        {...PROPS}
        habilitado={false}
        motivos={[
          "PROPUESTAS_ENVIO_HABILITADO no esta en true; el envio esta deshabilitado.",
          "Falta RESEND_API_KEY; el envio esta deshabilitado.",
        ]}
      />,
    )

    const region = screen.getByRole("region", {
      name: /confirmación de envío/i,
    })
    expect(within(region).getByText("ENVÍO DESHABILITADO")).toBeInTheDocument()
    const estado = within(region).getByRole("status")
    expect(estado).toHaveTextContent(/deshabilitado en este entorno/i)
    expect(estado).toHaveTextContent(/PROPUESTAS_ENVIO_HABILITADO/)
    expect(estado).toHaveTextContent(/RESEND_API_KEY/)
    expect(estado).toHaveTextContent(/no se envió nada/i)

    const boton = within(region).getByRole("button", {
      name: "Enviar email",
    })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)

    expect(
      screen.queryByRole("dialog", { name: /confirmar envío real/i }),
    ).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("hace POST con { confirmacion: 'ENVIAR' }, una sola vez, y muestra el message ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ estado: "ENVIADO", messageId: "msg_live_1" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<EnvioConfirmacion {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar email" }))
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /entiendo que se enviará un email real/i,
      }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar email real" }),
    )

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Email enviado a Resend/i)
    expect(resultado).toHaveTextContent(/Message ID: msg_live_1/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/envios/env_1/enviar")
    expect(url).not.toContain("@")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ confirmacion: "ENVIAR" })
    expect(
      screen.queryByRole("dialog", { name: /confirmar envío real/i }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("bloquea el doble clic y no dispara dos envios", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(<EnvioConfirmacion {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar email" }))
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /entiendo que se enviará un email real/i,
      }),
    )
    const confirmar = screen.getByRole("button", {
      name: "Enviar email real",
    })
    fireEvent.click(confirmar)
    fireEvent.click(confirmar)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole("button", { name: /enviando/i }),
    ).toBeDisabled()

    resolver({
      ok: true,
      status: 200,
      json: async () => ({ estado: "ENVIADO", messageId: "msg_unico" }),
    })
    await screen.findByRole("status")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("muestra errores accesibles por codigo sin PII y refresca", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        codigo: "CUPO",
        motivos: ["Se alcanzo el cupo diario de envios."],
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<EnvioConfirmacion {...PROPS} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar email" }))
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /entiendo que se enviará un email real/i,
      }),
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar email real" }),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/cupo diario de envíos/i)
    expect(alerta).toHaveTextContent(/no se encola/i)
    expect(alerta).toHaveTextContent(/Se alcanzo el cupo diario/i)
    expect(alerta).not.toHaveTextContent("ventas@alfa.com.ar")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("mapea ESTADO y REVALIDACION sin mostrar el cuerpo del email", async () => {
    for (const [codigo, texto] of [
      ["ESTADO", /cambió de estado/i],
      ["REVALIDACION", /aprobación ya no coincide/i],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ codigo }),
      })
      vi.stubGlobal("fetch", fetchMock)

      const { unmount } = render(<EnvioConfirmacion {...PROPS} />)
      fireEvent.click(screen.getByRole("button", { name: "Enviar email" }))
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /entiendo que se enviará un email real/i,
        }),
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Enviar email real" }),
      )

      const alerta = await screen.findByRole("alert")
      expect(alerta).toHaveTextContent(texto)
      expect(alerta).not.toHaveTextContent("Hola Ana")
      unmount()
    }
  })
})

describe("EnvioSeguimiento (T-18, AC-28, AC-29, AC-31)", () => {
  const BASE = {
    envioId: "env_1",
    version: 2,
    secuencia: 1,
    proveedorMessageId: null as string | null,
    error: null as string | null,
    fechaTexto: null as string | null,
    hayEnvioAbierto: false,
  }

  it("en ENVIADO muestra message ID, fecha y permite registrar el resultado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ estado: "REBOTADO", suprimido: true }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <EnvioSeguimiento
        {...BASE}
        estado="ENVIADO"
        proveedorMessageId="msg_live_1"
        fechaTexto="12 de nov de 2026, 15:00"
      />,
    )

    const region = screen.getByRole("region", {
      name: /seguimiento del envío/i,
    })
    expect(within(region).getByText("ENVIADO")).toBeInTheDocument()
    expect(within(region).getByText("msg_live_1")).toBeInTheDocument()
    expect(
      within(region).getByText("12 de nov de 2026, 15:00"),
    ).toBeInTheDocument()
    expect(within(region).getByText(/v2 · secuencia 1/)).toBeInTheDocument()
    expect(
      within(region).getByText(/no usa webhooks de resend/i),
    ).toBeInTheDocument()

    fireEvent.change(within(region).getByLabelText("Resultado"), {
      target: { value: "REBOTE_DURO" },
    })
    expect(
      within(region).getByText(/suprimen el email por hash/i),
    ).toBeInTheDocument()

    fireEvent.change(within(region).getByLabelText(/detalle \(opcional\)/i), {
      target: { value: "Rebote verificado en el panel." },
    })
    fireEvent.click(
      within(region).getByRole("button", { name: "Registrar resultado" }),
    )

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Resultado registrado: Rebote duro/i)
    expect(resultado).toHaveTextContent(/quedó suprimido/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/envios/env_1/resultado")
    expect(url).not.toContain("@")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      tipo: "REBOTE_DURO",
      detalle: "Rebote verificado en el panel.",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("en RESPONDIDO muestra el estado final y no ofrece mas acciones", () => {
    render(<EnvioSeguimiento {...BASE} estado="RESPONDIDO" />)

    expect(
      screen.getByText(/el resultado de este envío ya está registrado/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Registrar resultado" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /crear versión borrador/i }),
    ).not.toBeInTheDocument()
  })

  it("en ENVIANDO explica la reconciliacion manual sin reintentar", () => {
    render(<EnvioSeguimiento {...BASE} estado="ENVIANDO" />)

    expect(
      screen.getByText(/más de 10 minutos sin confirmación/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no se reintenta solo/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /crear versión borrador/i }),
    ).not.toBeInTheDocument()
  })

  it("en FALLIDO crea una version BORRADOR sin enviar ni reintentar solo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ envioId: "env_2", version: 3 }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <EnvioSeguimiento
        {...BASE}
        estado="FALLIDO"
        error="PROVEEDOR: Resend no respondio correctamente."
      />,
    )

    expect(screen.getByText(/reintento manual/i)).toBeInTheDocument()
    expect(
      screen.getByText(/un envío fallido no se reintenta solo/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText("PROVEEDOR: Resend no respondio correctamente."),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", {
        name: /crear versión borrador para reintentar/i,
      }),
    )

    const resultado = await screen.findByRole("status")
    expect(resultado).toHaveTextContent(/Se creó un borrador nuevo \(v3\)/i)
    expect(resultado).toHaveTextContent(/No se envió nada/i)
    expect(resultado).toHaveTextContent(/editalo y aprobalo/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/envios/env_1/reintentar")
    expect(url).not.toContain("/enviar")
    expect(url).not.toContain("@")
    expect(init.method).toBe("POST")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("si ya hay un envio abierto no ofrece otro reintento", () => {
    render(
      <EnvioSeguimiento {...BASE} estado="FALLIDO" hayEnvioAbierto />,
    )

    expect(
      screen.getByText(/ya hay un borrador o una aprobación pendiente/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /crear versión borrador/i }),
    ).not.toBeInTheDocument()
  })

  it("muestra errores accesibles del resultado sin PII", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ codigo: "ESTADO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<EnvioSeguimiento {...BASE} estado="ENVIADO" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar resultado" }),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/cambió de estado/i)
    expect(alerta).not.toHaveTextContent("Hola Ana")
  })
})

describe("ficha del prospecto: envio y seguimiento (T-18, AC-26, AC-29)", () => {
  function stubEntornoEnvio(): void {
    for (const [clave, valor] of Object.entries({
      NEXT_PUBLIC_URL: "https://pixelarch.dev",
      PROPUESTAS_SECRETO: "secreto-de-pruebas-propuestas-1234567890",
      PROPUESTAS_TEXTO_LEGAL: "Texto legal de prueba aprobado.",
      PROPUESTAS_BASE_LEGAL: "Base legal de prueba aprobada.",
      PROPUESTAS_FROM_EMAIL: "propuestas@pixelarch.dev",
      PROPUESTAS_REPLY_TO: "hola@pixelarch.dev",
      PROPUESTAS_FROM_NOMBRE: "PixelArch",
      PROPUESTAS_ENVIO_HABILITADO: "true",
      RESEND_API_KEY: "re_test_key_123456789",
    })) {
      vi.stubEnv(clave, valor)
    }
  }

  function envioAbiertoAprobado(): Record<string, unknown> {
    return {
      id: "env_1",
      estado: "APROBADO",
      version: 2,
      secuencia: 1,
      asunto: "Una idea para Consultora Alfa",
      cuerpoTexto: "Hola Ana,\n\nTe escribo.",
      cuerpoHtml: "<p>Hola Ana,</p>",
      hashContenido: "a".repeat(64),
      destinatario: "ventas@alfa.com.ar",
      fromEmail: "propuestas@pixelarch.dev",
      fromNombre: "PixelArch",
      replyTo: "hola@pixelarch.dev",
      plantillaId: "pl_1",
      plantillaVersion: 1,
      aprobadoAsunto: "[publicidad] Una idea para Consultora Alfa",
      aprobadoCuerpoHtml: "<html>HTML aprobado</html>",
      aprobadoCuerpoTexto: "Cuerpo aprobado",
      aprobadoPorNombre: "Ana Pérez",
      aprobadoEn: new Date("2026-11-12T17:30:00.000Z"),
      tokenBaja: "v1.pros_1." + "a".repeat(64) + "." + "b".repeat(43),
      aprobadoHash: "c".repeat(64),
    }
  }

  function envioSeguimientoFixture(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: "env_1",
      estado: "ENVIADO",
      version: 2,
      secuencia: 1,
      proveedorMessageId: "msg_live_1",
      error: null,
      enviadoEn: new Date("2026-11-12T18:00:00.000Z"),
      ...overrides,
    }
  }

  it("en APROBADO muestra la confirmacion de envio separada del panel de aprobacion", async () => {
    stubEntornoEnvio()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.envioFindFirst.mockImplementation(
      (args: { where?: { estado?: { in?: string[] } } }) => {
        if (args.where?.estado?.in?.includes("ENVIANDO")) return null
        return envioAbiertoAprobado()
      },
    )

    await renderProspecto()

    const confirmacion = screen.getByRole("region", {
      name: /confirmación de envío/i,
    })
    expect(
      within(confirmacion).getByRole("button", { name: "Enviar email" }),
    ).toBeInTheDocument()
    expect(
      within(confirmacion).getByText("[publicidad] Una idea para Consultora Alfa"),
    ).toBeInTheDocument()
    expect(within(confirmacion).getByText("v2 · secuencia 1")).toBeInTheDocument()
    // No se envia nada al solo renderizar la ficha.
    expect(fetchMock).not.toHaveBeenCalled()

    // Con la configuracion completa el dialogo de confirmacion se abre.
    fireEvent.click(
      within(confirmacion).getByRole("button", { name: "Enviar email" }),
    )
    const dialogo = screen.getByRole("dialog", {
      name: /confirmar envío real/i,
    })
    expect(
      within(dialogo).getByRole("checkbox", {
        name: /entiendo que se enviará un email real/i,
      }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("con el gate apagado o sin Resend muestra el envío deshabilitado sin abrir el diálogo (AC-30)", async () => {
    stubEntornoEnvio()
    vi.stubEnv("PROPUESTAS_ENVIO_HABILITADO", "false")
    vi.stubEnv("RESEND_API_KEY", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.envioFindFirst.mockImplementation(
      (args: { where?: { estado?: { in?: string[] } } }) => {
        if (args.where?.estado?.in?.includes("ENVIANDO")) return null
        return envioAbiertoAprobado()
      },
    )

    await renderProspecto()

    const confirmacion = screen.getByRole("region", {
      name: /confirmación de envío/i,
    })
    expect(
      within(confirmacion).getByText("ENVÍO DESHABILITADO"),
    ).toBeInTheDocument()
    const estado = within(confirmacion).getByRole("status")
    expect(estado).toHaveTextContent(/deshabilitado en este entorno/i)
    expect(estado).toHaveTextContent(/PROPUESTAS_ENVIO_HABILITADO/)
    expect(estado).toHaveTextContent(/RESEND_API_KEY/)

    const boton = within(confirmacion).getByRole("button", {
      name: "Enviar email",
    })
    expect(boton).toBeDisabled()
    fireEvent.click(boton)

    expect(
      screen.queryByRole("dialog", { name: /confirmar envío real/i }),
    ).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("en ENVIADO muestra el seguimiento con message ID y resultado", async () => {
    stubEntornoEnvio()
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ estado: "ENVIADO" }),
    )
    mocks.envioFindFirst.mockImplementation(
      (args: { where?: { estado?: { in?: string[] } } }) => {
        if (args.where?.estado?.in?.includes("ENVIANDO")) {
          return envioSeguimientoFixture()
        }
        return null
      },
    )

    await renderProspecto()

    const seguimiento = screen.getByRole("region", {
      name: /seguimiento del envío/i,
    })
    expect(within(seguimiento).getByText("ENVIADO")).toBeInTheDocument()
    expect(within(seguimiento).getByText("msg_live_1")).toBeInTheDocument()
    expect(
      within(seguimiento).getByRole("button", { name: "Registrar resultado" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: /confirmación de envío/i }),
    ).not.toBeInTheDocument()
  })

  it("en FALLIDO muestra el error saneado y el reintento manual", async () => {
    stubEntornoEnvio()
    mocks.prospectoFindUnique.mockResolvedValue(
      prospectoDetalleFixture({ estado: "APROBADO" }),
    )
    mocks.envioFindFirst.mockImplementation(
      (args: { where?: { estado?: { in?: string[] } } }) => {
        if (args.where?.estado?.in?.includes("ENVIANDO")) {
          return envioSeguimientoFixture({
            estado: "FALLIDO",
            proveedorMessageId: null,
            error: "PROVEEDOR: Resend no respondio correctamente.",
          })
        }
        return null
      },
    )

    await renderProspecto()

    const seguimiento = screen.getByRole("region", {
      name: /seguimiento del envío/i,
    })
    expect(within(seguimiento).getByText("FALLIDO")).toBeInTheDocument()
    expect(
      within(seguimiento).getByText(
        "PROVEEDOR: Resend no respondio correctamente.",
      ),
    ).toBeInTheDocument()
    expect(
      within(seguimiento).getByRole("button", {
        name: /crear versión borrador para reintentar/i,
      }),
    ).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* T-19 (AC-16, AC-33, AC-34, AC-35; RF-51, RF-52, RF-56)             */
/* Baja publica: pagina, layout y confirmacion explicita               */
/* ------------------------------------------------------------------ */

const SECRETO_BAJA = "secreto-de-pruebas-t19-baja-publica-0123456789"
const EMAIL_BAJA = "info@consultora-ejemplo.com"
const HASH_BAJA = hashEmail(EMAIL_BAJA, SECRETO_BAJA)
const TOKEN_BAJA = crearTokenBaja("pros_baja_1", HASH_BAJA, SECRETO_BAJA)
const TOKEN_BAJA_ALTERADO =
  TOKEN_BAJA.slice(0, -1) + (TOKEN_BAJA.endsWith("A") ? "B" : "A")

async function vistaDeBaja(token: string): Promise<string> {
  const { container, unmount } = render(
    await BajaPropuestasPage({ params: Promise.resolve({ token }) }),
  )
  const html = container.innerHTML
  unmount()
  return html
}

describe("/propuestas/baja/[token] (T-19, AC-33; RF-51)", () => {
  it("publica metadata noindex/nocache, no-referrer y no-store (AC-33)", () => {
    expect(metadataBaja.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    })
    expect(metadataBaja.referrer).toBe("no-referrer")
    expect(metadataLayoutBaja.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    })
    expect(metadataLayoutBaja.referrer).toBe("no-referrer")
    expect(dynamicBaja).toBe("force-dynamic")
    expect(revalidateBaja).toBe(0)
  })

  it("renderiza sin guard admin, sin auto-POST y sin datos del prospecto", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", SECRETO_BAJA)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      await BajaPropuestasPage({
        params: Promise.resolve({ token: TOKEN_BAJA }),
      }),
    )

    expect(
      screen.getByRole("heading", { name: "Baja de propuestas" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Confirmar baja" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no necesitás cuenta/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/abrir esta página no da de baja nada por sí solo/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/inmediata y global/i)).toBeInTheDocument()

    // No se dispara ninguna baja al abrir la pagina.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(unstable_noStore).toHaveBeenCalled()

    // Sin email, token ni id del prospecto en el DOM.
    const texto = document.body.textContent ?? ""
    expect(texto).not.toContain(EMAIL_BAJA)
    expect(texto).not.toContain(TOKEN_BAJA)
    expect(texto).not.toContain("pros_baja_1")
    expect(document.body.innerHTML).not.toContain("mailto:")
  })

  it("token valido, alterado y ya usado devuelven la misma vista generica (AC-33)", async () => {
    vi.stubEnv("PROPUESTAS_SECRETO", SECRETO_BAJA)

    const valido = await vistaDeBaja(TOKEN_BAJA)
    const alterado = await vistaDeBaja(TOKEN_BAJA_ALTERADO)
    // La pagina no consulta la base: un enlace ya usado luce igual.
    const usado = await vistaDeBaja(TOKEN_BAJA)

    expect(alterado).toBe(valido)
    expect(usado).toBe(valido)
    expect(valido).not.toContain(EMAIL_BAJA)
    expect(valido).not.toContain(TOKEN_BAJA)
    expect(valido).not.toContain("SUPRIMIDO")
    expect(valido).not.toContain("consultora-ejemplo")
  })

  it("el layout es minimo y no muestra navegacion del CRM (AC-33)", () => {
    render(
      <BajaPropuestasLayout>
        <p>contenido de baja</p>
      </BajaPropuestasLayout>,
    )

    expect(screen.getByText("contenido de baja")).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    for (const nombre of [/clientes/i, /cobros/i, /pagos/i, /propuestas/i]) {
      expect(screen.queryByRole("link", { name: nombre })).not.toBeInTheDocument()
    }
  })

  it("pagina, layout y componente no importan Clerk/Prisma ni hacen fetch al renderizar (AC-33)", () => {
    const appDir = path.join(process.cwd(), "src", "app", "(propuestas-baja)")
    const pagina = readFileSync(
      path.join(appDir, "propuestas", "baja", "[token]", "page.tsx"),
      "utf8",
    )
    const layout = readFileSync(path.join(appDir, "layout.tsx"), "utf8")
    const componente = readFileSync(
      path.join(
        process.cwd(),
        "src",
        "components",
        "propuestas",
        "baja-confirmar.tsx",
      ),
      "utf8",
    )

    for (const [nombre, fuente] of [
      ["pagina", pagina],
      ["layout", layout],
    ] as const) {
      expect(fuente, nombre).not.toMatch(
        /requireAdmin|@clerk|@\/lib\/prisma|@\/lib\/auth/,
      )
      expect(fuente, nombre).not.toMatch(/\bfetch\s*\(/)
    }

    // La baja solo se dispara con el click del boton, no por efecto.
    expect(componente).not.toMatch(/useEffect/)
    expect(componente).not.toMatch(/\bconsole\./)
    expect(componente).toMatch(/onClick=\{\(\) => void confirmarBaja\(\)\}/)
  })
})

describe("BajaConfirmar (T-19, AC-33, AC-34; RF-51, RF-52)", () => {
  it("no hace auto-POST: exige un click explicito (AC-33)", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Confirmar baja" }),
    ).toBeEnabled()
    expect(screen.getByText(/paso explícito/i)).toBeInTheDocument()
    expect(document.body.textContent ?? "").not.toContain(TOKEN_BAJA)
  })

  it("pending bloquea el doble click y envia el token por POST (AC-33, AC-34)", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)
    const boton = screen.getByRole("button", { name: "Confirmar baja" })
    fireEvent.click(boton)
    fireEvent.click(boton)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const enCurso = screen.getByRole("button", { name: /confirmando/i })
    expect(enCurso).toBeDisabled()
    expect(enCurso.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true")

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/opt-out")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN_BAJA })

    resolver({ ok: true, status: 200 })

    expect(
      await screen.findByText(/Listo\. Si este enlace correspondía/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Baja registrada" }),
    ).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const texto = document.body.textContent ?? ""
    expect(texto).not.toContain(EMAIL_BAJA)
    expect(texto).not.toContain(TOKEN_BAJA)
  })

  it("un 202 one-click se muestra como exito generico (AC-34)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baja" }))

    expect(
      await screen.findByText(/Listo\. Si este enlace correspondía/i),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("un error 500 muestra un mensaje generico y permite reintentar (AC-33)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: `fallo ${EMAIL_BAJA} ${TOKEN_BAJA}` }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baja" }))

    expect(
      await screen.findByText(/No pudimos completar la baja/i),
    ).toBeInTheDocument()
    const texto = document.body.textContent ?? ""
    expect(texto).not.toContain(EMAIL_BAJA)
    expect(texto).not.toContain(TOKEN_BAJA)
    expect(
      screen.getByRole("button", { name: "Confirmar baja" }),
    ).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Confirmar baja" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it("un 429 muestra el aviso de rate limit sin filtrar datos (AC-33)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 })
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baja" }))

    expect(
      await screen.findByText(/demasiadas solicitudes desde tu conexión/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? "").not.toContain(TOKEN_BAJA)
    expect(
      screen.getByRole("button", { name: "Confirmar baja" }),
    ).toBeEnabled()
  })

  it("un fallo de red se muestra generico y sin PII (AC-33)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error(`fallo ${EMAIL_BAJA} ${TOKEN_BAJA}`))
    vi.stubGlobal("fetch", fetchMock)

    render(<BajaConfirmar token={TOKEN_BAJA} />)
    fireEvent.click(screen.getByRole("button", { name: "Confirmar baja" }))

    expect(
      await screen.findByText(/No pudimos completar la baja/i),
    ).toBeInTheDocument()
    const texto = document.body.textContent ?? ""
    expect(texto).not.toContain(EMAIL_BAJA)
    expect(texto).not.toContain(TOKEN_BAJA)
    expect(
      screen.getByRole("button", { name: "Confirmar baja" }),
    ).toBeEnabled()
  })
})

/* ------------------------------------------------------------------ */
/* T-20 (AC-15..AC-18, AC-27, AC-36; RF-23..RF-28, RF-56)             */
/* Supresiones: pagina, alta manual y revocacion excepcional           */
/* ------------------------------------------------------------------ */

const SECRETO_SUPRESIONES = "secreto-de-pruebas-t20-supresiones-0123456789"
const EMAIL_SUPRIMIDO = "ventas@alfa.com.ar"
const HASH_SUPRIMIDO = hashEmail(EMAIL_SUPRIMIDO, SECRETO_SUPRESIONES)
const CLAVE_SUPRIMIDA = `EMAIL:${HASH_SUPRIMIDO}`

function filaSupresion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "sup_1",
    ambito: "EMAIL",
    clave: CLAVE_SUPRIMIDA,
    emailEnmascarado: "v***@alfa.com.ar",
    dominioNegocio: null,
    motivo: "REBOTE_DURO",
    origen: "MANUAL",
    activa: true,
    creadaPorNombre: "Ana Pérez",
    creadaEn: new Date("2026-11-12T15:00:00.000Z"),
    revocadaEn: null,
    motivoRevocacion: null,
    ...overrides,
  }
}

function filaDeSupresion(nombre: RegExp): HTMLElement {
  return screen.getByRole("heading", { name: nombre }).closest("li") as HTMLElement
}

function formularioSupresion(): HTMLFormElement {
  return screen
    .getByRole("button", { name: "Registrar supresión" })
    .closest("form") as HTMLFormElement
}

function completarAltaEmail(): void {
  fireEvent.change(screen.getByLabelText(/email a suprimir/i), {
    target: { value: "Ventas@Alfa.com.ar" },
  })
}

describe("/propuestas/supresiones: lista (T-20, AC-15, AC-18)", () => {
  it("lista hash, email enmascarado, dominio, motivo, fecha, origen y estado sin PII completa", async () => {
    mocks.supresionFindMany.mockResolvedValue([
      filaSupresion(),
      filaSupresion({
        id: "sup_dom",
        ambito: "DOMINIO",
        clave: "DOMINIO:alfa.com.ar",
        emailEnmascarado: null,
        dominioNegocio: "alfa.com.ar",
        motivo: "MANUAL",
      }),
      filaSupresion({
        id: "sup_revocada",
        clave: `EMAIL:${"b".repeat(64)}`,
        emailEnmascarado: "j***@beta.com",
        activa: false,
        revocadaEn: new Date("2026-11-13T10:30:00.000Z"),
        motivoRevocacion: "Autorización expresa del titular",
      }),
    ])

    render(await SupresionesPage())

    expect(
      screen.getByRole("heading", { name: "Supresiones" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/2 activas · 2 por email · 1 por dominio/i),
    ).toBeInTheDocument()

    const email = filaDeSupresion(/v\*\*\*@alfa\.com\.ar/i)
    expect(within(email).getByText(/^EMAIL:/)).toBeInTheDocument()
    expect(within(email).getByText("v***@alfa.com.ar")).toBeInTheDocument()
    expect(within(email).getByText("Rebote duro")).toBeInTheDocument()
    expect(within(email).getByText("MANUAL")).toBeInTheDocument()
    expect(
      within(email).getByText(
        formatearFechaHoraPortal(new Date("2026-11-12T15:00:00.000Z")),
      ),
    ).toBeInTheDocument()
    expect(within(email).getByText("Activa")).toBeInTheDocument()
    expect(within(email).getByText(/registrada por ana pérez/i)).toBeInTheDocument()

    const dominio = filaDeSupresion(/^alfa\.com\.ar$/)
    expect(within(dominio).getByText("DOMINIO:alfa.com.ar")).toBeInTheDocument()
    expect(within(dominio).getByText("DOMINIO")).toBeInTheDocument()
    expect(within(dominio).getByText("Manual")).toBeInTheDocument()

    const revocada = filaDeSupresion(/j\*\*\*@beta\.com/i)
    expect(within(revocada).getByText("Revocada")).toBeInTheDocument()
    expect(
      within(revocada).getByText(/Autorización expresa del titular/i),
    ).toBeInTheDocument()

    // No se muestra el email completo ni datos del CRM.
    const texto = document.body.textContent ?? ""
    expect(texto).not.toContain(EMAIL_SUPRIMIDO)
    expect(texto).not.toContain("beta@")

    // La supresion sigue siendo global/permanente hasta una excepcion. La
    // purga manual existe solo sobre revocadas; no hay acciones masivas.
    expect(screen.getAllByText(/global y permanente/i).length).toBeGreaterThan(0)
    expect(
      screen.getByText(/la purga es una excepción administrativa/i),
    ).toBeInTheDocument()
    // La purga no guarda el texto libre del motivo (puede contener PII).
    expect(
      screen.getByText(/el texto del motivo de la purga no se guarda/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no hay acciones masivas desde esta página/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: /revocar todas|purgar todas|eliminar todas|borrar todas/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /revocar la supresión de/i }),
    ).toHaveLength(2)

    // "Purgar" solo aparece en la fila revocada; las activas solo se revocan.
    expect(
      within(email).queryByRole("button", { name: /purgar/i }),
    ).not.toBeInTheDocument()
    expect(
      within(dominio).queryByRole("button", { name: /purgar/i }),
    ).not.toBeInTheDocument()
    expect(
      within(revocada).getByRole("button", {
        name: /purgar la supresión de j\*\*\*@beta\.com/i,
      }),
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      within(revocada).queryByRole("button", {
        name: /revocar la supresión de/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: /purgar la supresión de/i }),
    ).toHaveLength(1)
  })

  it("muestra el estado vacio y mantiene el alta manual disponible", async () => {
    mocks.supresionFindMany.mockResolvedValue([])

    render(await SupresionesPage())

    expect(
      screen.getByRole("heading", { name: /todavía no hay supresiones/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /nueva supresión/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Registrar supresión" }),
    ).toBeInTheDocument()
  })

  it("si falta el esquema falla cerrado sin datos ni formularios (AC-6)", async () => {
    mocks.supresionFindMany.mockRejectedValue({ code: "P2021" })

    render(await SupresionesPage())

    const estado = screen.getByRole("alert")
    expect(estado).toHaveAttribute("data-estado", CODIGO_ESQUEMA_NO_APLICADO)
    expect(
      screen.queryByRole("form", { name: /alta manual de supresión/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: /nueva supresión/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("publica metadata noindex/nofollow y render dinamico (AC-5)", () => {
    expect(metadataSupresiones.robots).toEqual({
      index: false,
      follow: false,
    })
    expect(dynamicSupresiones).toBe("force-dynamic")
  })
})

describe("SupresionForm: alta manual (T-20, AC-15, AC-18)", () => {
  it("envia EMAIL normalizado por el servidor, sin auto-submit y sin mostrar el email completo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "sup_1",
        clave: CLAVE_SUPRIMIDA,
        creada: true,
        reactivada: false,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<SupresionForm />)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/email a suprimir/i)).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/dominio de negocio a suprimir/i),
    ).not.toBeInTheDocument()

    completarAltaEmail()
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "OPT_OUT" },
    })
    fireEvent.submit(formularioSupresion())

    const resultado = await screen.findByRole("status", {
      name: /resultado del alta de supresión/i,
    })
    expect(resultado).toHaveTextContent(/supresión creada/i)
    expect(resultado).toHaveTextContent(/el contacto quedó suprimido/i)
    expect(resultado).toHaveTextContent(CLAVE_SUPRIMIDA)
    expect(resultado).toHaveTextContent(/no se envió ningún email/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/supresiones")
    expect(url).not.toContain("Ventas")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      ambito: "EMAIL",
      email: "Ventas@Alfa.com.ar",
      motivo: "OPT_OUT",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())

    // El alta no reemplaza el email por una version en claro en la UI.
    expect(document.body.textContent ?? "").not.toContain("Ventas@Alfa.com.ar")
  })

  it("un alta idempotente (200, creada:false, reactivada:false) muestra que la clave ya existia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: "sup_1",
          clave: CLAVE_SUPRIMIDA,
          creada: false,
          reactivada: false,
        }),
      }),
    )

    render(<SupresionForm />)
    completarAltaEmail()
    fireEvent.submit(formularioSupresion())

    const resultado = await screen.findByRole("status", {
      name: /resultado del alta de supresión/i,
    })
    expect(resultado).toHaveTextContent(/supresión existente/i)
    expect(resultado).toHaveTextContent(/la clave ya estaba suprimida/i)
    expect(resultado).toHaveTextContent(CLAVE_SUPRIMIDA)
  })

  it("distingue la reactivacion (200, creada:false, reactivada:true) de una fila revocada", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "sup_revocada",
        clave: CLAVE_SUPRIMIDA,
        creada: false,
        reactivada: true,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<SupresionForm />)
    completarAltaEmail()
    fireEvent.submit(formularioSupresion())

    const resultado = await screen.findByRole("status", {
      name: /resultado del alta de supresión/i,
    })
    expect(resultado).toHaveTextContent(/supresión reactivada/i)
    expect(resultado).toHaveTextContent(
      /la supresión revocada volvió a quedar activa/i,
    )
    // Conserva los datos originales y no reabre prospectos ni envios.
    expect(resultado).toHaveTextContent(
      /se conservaron el motivo, el origen y la fecha de creación originales/i,
    )
    expect(resultado).toHaveTextContent(
      /no se reabrieron prospectos ni envíos/i,
    )
    expect(resultado).toHaveTextContent(CLAVE_SUPRIMIDA)
    expect(resultado).not.toHaveTextContent(/el contacto quedó suprimido/i)
    expect(resultado).not.toHaveTextContent(/la clave ya estaba suprimida/i)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("permite cambiar a DOMINIO y envia solo el dominio de negocio", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "sup_dom",
        clave: "DOMINIO:alfa.com.ar",
        creada: true,
        reactivada: false,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<SupresionForm />)

    fireEvent.change(screen.getByLabelText("Ámbito"), {
      target: { value: "DOMINIO" },
    })
    expect(
      screen.queryByLabelText(/email a suprimir/i),
    ).not.toBeInTheDocument()

    fireEvent.change(
      screen.getByLabelText(/dominio de negocio a suprimir/i),
      { target: { value: "alfa.com.ar" } },
    )
    fireEvent.submit(formularioSupresion())

    expect(
      await screen.findByRole("status", {
        name: /resultado del alta de supresión/i,
      }),
    ).toHaveTextContent("DOMINIO:alfa.com.ar")

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      ambito: "DOMINIO",
      dominioNegocio: "alfa.com.ar",
      motivo: "MANUAL",
    })
  })

  it("valida en el cliente sin llamar a la API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<SupresionForm />)
    fireEvent.submit(formularioSupresion())

    expect(await screen.findByText("El email es obligatorio.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(formularioSupresion()).toHaveAttribute("aria-busy", "false")
  })

  it.each([
    ["VALIDACION", /revisá el email o el dominio y el motivo/i],
    ["NO_CONFIGURADO", /falta PROPUESTAS_SECRETO/i],
    ["RATE_LIMIT", /demasiadas solicitudes/i],
  ])("muestra el error %s de forma accesible", async (codigo, mensaje) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: codigo === "RATE_LIMIT" ? 429 : 400,
        json: async () => ({ codigo }),
      }),
    )

    render(<SupresionForm />)
    completarAltaEmail()
    fireEvent.submit(formularioSupresion())

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(mensaje)
    expect(alerta).not.toHaveTextContent("Ventas@Alfa.com.ar")
  })

  it("un error de red se muestra generico y sin PII", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fallo con Ventas@Alfa.com.ar")),
    )

    render(<SupresionForm />)
    completarAltaEmail()
    fireEvent.submit(formularioSupresion())

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/error de red/i)
    expect(alerta).not.toHaveTextContent("Ventas@Alfa.com.ar")
  })
})

describe("SupresionRevocarForm: excepcion con motivo (T-20, AC-18)", () => {
  it("exige motivo y confirmacion antes de llamar a la API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <SupresionRevocarForm id="sup_1" etiqueta="v***@alfa.com.ar" />,
    )

    const abrir = screen.getByRole("button", {
      name: /revocar la supresión de v\*\*\*@alfa\.com\.ar/i,
    })
    expect(abrir).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(abrir)

    expect(
      screen.getByText(/no reabre prospectos ni reactiva envíos/i),
    ).toBeInTheDocument()
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirmar revocación" })
        .closest("form") as HTMLFormElement,
    )
    expect(
      await screen.findByText(/indicá el motivo de la excepción/i),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/motivo de la excepción/i), {
      target: { value: "Autorización del titular" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirmar revocación" })
        .closest("form") as HTMLFormElement,
    )
    expect(
      await screen.findByText(/confirmá que la revocación es una excepción/i),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("revoca con confirmacion explicita y avisa que no reabre prospectos", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "sup_1", activa: false }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <SupresionRevocarForm id="sup_1" etiqueta="v***@alfa.com.ar" />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: /revocar la supresión de/i }),
    )
    fireEvent.change(screen.getByLabelText(/motivo de la excepción/i), {
      target: { value: "Autorización expresa del titular" },
    })
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que la revocación es una excepción/i,
      }),
    )
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirmar revocación" })
        .closest("form") as HTMLFormElement,
    )

    const estado = await screen.findByRole("status")
    expect(estado).toHaveTextContent(/supresión revocada/i)
    expect(estado).toHaveTextContent(/no se reabrieron prospectos ni envíos/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/supresiones/sup_1/revocar")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: "Autorización expresa del titular",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())

    expect(document.body.textContent ?? "").not.toContain(EMAIL_SUPRIMIDO)
  })

  it.each([
    [404, "NO_ENCONTRADO", /no existe o fue eliminada/i],
    [409, "ESTADO", /ya estaba revocada/i],
  ])("un %s %s se muestra accesible", async (status, codigo, mensaje) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ codigo }),
      }),
    )

    render(
      <SupresionRevocarForm id="sup_1" etiqueta="v***@alfa.com.ar" />,
    )
    fireEvent.click(
      screen.getByRole("button", { name: /revocar la supresión de/i }),
    )
    fireEvent.change(screen.getByLabelText(/motivo de la excepción/i), {
      target: { value: "Excepcion documentada" },
    })
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que la revocación es una excepción/i,
      }),
    )
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirmar revocación" })
        .closest("form") as HTMLFormElement,
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(mensaje)
    expect(alerta).not.toHaveTextContent(EMAIL_SUPRIMIDO)
  })
})

describe("SupresionPurgarForm: purga manual (T-20, AC-15..AC-18, AC-27)", () => {
  function abrirPurga(): void {
    fireEvent.click(
      screen.getByRole("button", { name: /purgar la supresión de/i }),
    )
  }

  function formularioPurga(): HTMLFormElement {
    return screen
      .getByRole("button", { name: "Confirmar purga" })
      .closest("form") as HTMLFormElement
  }

  function completarPurga(
    motivo = "Limpieza de un registro revocado por error.",
  ): void {
    fireEvent.change(screen.getByLabelText(/motivo de la purga/i), {
      target: { value: motivo },
    })
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /confirmo que la purga es una excepción administrativa definitiva/i,
      }),
    )
  }

  it("avisa que es una excepción definitiva y exige motivo y confirmación", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )

    const abrir = screen.getByRole("button", {
      name: /purgar la supresión de j\*\*\*@beta\.com/i,
    })
    expect(abrir).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(abrir)

    expect(
      screen.getByText(/borra la fila de supresión de forma definitiva/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no reabre prospectos ni envíos/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/solo se permite sobre supresiones ya revocadas/i),
    ).toBeInTheDocument()
    // El texto libre del motivo no se persiste ni se loguea: solo queda un
    // registro operativo con identificador, admin, longitud y hash.
    expect(
      screen.getByText(/no se guarda el texto del motivo/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/constancia operativa sin datos personales/i),
    ).toBeInTheDocument()

    fireEvent.submit(formularioPurga())
    expect(
      await screen.findByText(/indicá el motivo de la purga/i),
    ).toBeInTheDocument()
    const motivo = screen.getByLabelText(/motivo de la purga/i)
    expect(motivo).toHaveAttribute("aria-invalid", "true")
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(motivo, {
      target: { value: "Autorización del titular." },
    })
    fireEvent.submit(formularioPurga())
    expect(
      await screen.findByText(
        /confirmá que la purga es una excepción administrativa definitiva/i,
      ),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("purga con pending accesible, muestra éxito y refresca el server component", async () => {
    let resolver: (valor: unknown) => void = () => undefined
    const pendiente = new Promise((resolve) => {
      resolver = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(pendiente)
    vi.stubGlobal("fetch", fetchMock)

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )
    abrirPurga()
    completarPurga("Limpieza de un registro revocado por error.")
    const form = formularioPurga()
    fireEvent.submit(form)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      screen.getByRole("button", { name: /purgando/i }),
    ).toBeDisabled()
    expect(form).toHaveAttribute("aria-busy", "true")

    resolver({
      ok: true,
      status: 200,
      json: async () => ({ id: "sup_revocada", purgada: true }),
    })

    const estado = await screen.findByRole("status")
    expect(estado).toHaveTextContent(/supresión purgada/i)
    expect(estado).toHaveTextContent(
      /no se reabrieron prospectos ni envíos/i,
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/supresiones/sup_revocada/purga")
    expect(url).not.toContain("@")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: "Limpieza de un registro revocado por error.",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))

    expect(document.body.textContent ?? "").not.toContain(EMAIL_SUPRIMIDO)
  })

  it.each([
    [409, "ESTADO", /primero revocá la supresión/i],
    [404, "NO_ENCONTRADO", /no existe o ya fue purgada/i],
    [403, "PROHIBIDO", /no tenés permisos para purgar/i],
    [429, "RATE_LIMIT", /demasiadas solicitudes/i],
  ])("un %s %s se muestra accesible sin PII", async (status, codigo, mensaje) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ codigo }),
      }),
    )

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )
    abrirPurga()
    completarPurga()
    fireEvent.submit(formularioPurga())

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(mensaje)
    expect(alerta).not.toHaveTextContent("j***@beta.com")
    expect(alerta).not.toHaveTextContent(EMAIL_SUPRIMIDO)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("una respuesta inválida no se toma como purga ni refresca", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "sup_revocada", purgada: false }),
      }),
    )

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )
    abrirPurga()
    completarPurga()
    fireEvent.submit(formularioPurga())

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/respuesta del servidor no es válida/i)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("un error de red se muestra saneado y sin PII", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fallo con juan@example.com")),
    )

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )
    abrirPurga()
    completarPurga()
    fireEvent.submit(formularioPurga())

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/error de red/i)
    expect(alerta).not.toHaveTextContent("juan@example.com")
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("cancelar cierra la confirmación sin llamar a la API", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <SupresionPurgarForm id="sup_revocada" etiqueta="j***@beta.com" />,
    )
    abrirPurga()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    expect(
      screen.queryByRole("button", { name: "Confirmar purga" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /purgar la supresión de/i }),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* T-21 (AC-38, AC-39; RF-57, RF-58): cupos, consumo y alertas        */
/* ------------------------------------------------------------------ */

function filaCupoDia(overrides: Partial<FilaCupoDia> = {}): FilaCupoDia {
  return {
    proveedor: "GOOGLE_PLACES",
    usado: 0,
    cap: 20,
    restante: 20,
    alerta: false,
    costoCentavos: 0,
    ...overrides,
  }
}

function estadoCupoDia(
  overrides: Partial<EstadoCupoDia> = {},
): EstadoCupoDia {
  return {
    fecha: new Date("2026-11-12T00:00:00.000Z"),
    proveedores: [
      filaCupoDia(),
      filaCupoDia({ proveedor: "WEB_FETCH", cap: 100, restante: 100 }),
      filaCupoDia({ proveedor: "AUDITORIA" }),
      filaCupoDia({ proveedor: "REDACTOR" }),
      filaCupoDia({ proveedor: "RESEND" }),
    ],
    totalCostoCentavos: 0,
    presupuestoMensualCentavos: 0,
    gastadoMesCentavos: null,
    restanteMesCentavos: null,
    alertaPresupuesto: false,
    ...overrides,
  }
}

describe("CupoDia (T-21, AC-38, AC-39; RF-57, RF-58)", () => {
  it("AC-38: variante completo muestra usado/cap/restante/alerta y costo", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [
            filaCupoDia({
              usado: 16,
              restante: 4,
              alerta: true,
              costoCentavos: 150,
            }),
            filaCupoDia({
              proveedor: "WEB_FETCH",
              usado: 0,
              cap: 100,
              restante: 100,
              costoCentavos: 0,
            }),
            filaCupoDia({
              proveedor: "RESEND",
              usado: 2,
              restante: 18,
              costoCentavos: 200,
            }),
          ],
          totalCostoCentavos: 350,
          presupuestoMensualCentavos: 1_000,
          gastadoMesCentavos: 350,
          restanteMesCentavos: 650,
        })}
        disponibilidad={{ places: true, resend: true, secreto: true }}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    expect(region).toHaveAttribute("data-variante", "completo")
    expect(
      within(region).getByRole("heading", { level: 2, name: "Cupos del día" }),
    ).toBeInTheDocument()
    expect(within(region).getByText(/solo lectura/i)).toBeInTheDocument()
    expect(within(region).getByText(/12 de nov de 2026/)).toBeInTheDocument()
    expect(
      within(region).getAllByText(/US\$\s?3,50/).length,
    ).toBeGreaterThan(0)

    const places = within(region).getByRole("listitem", {
      name: /google places: 16 de 20 búsquedas/i,
    })
    expect(places).toHaveAttribute("data-estado", "ALERTA")
    expect(within(places).getByText("16 / 20")).toBeInTheDocument()
    expect(within(places).getByText("4")).toBeInTheDocument()
    expect(within(places).getByText(/US\$\s?1,50/)).toBeInTheDocument()
    expect(within(places).getByText("Aviso 80%")).toBeInTheDocument()

    const barra = within(places).getByRole("progressbar", {
      name: /uso de google places/i,
    })
    expect(barra).toHaveAttribute("aria-valuemin", "0")
    expect(barra).toHaveAttribute("aria-valuemax", "20")
    expect(barra).toHaveAttribute("aria-valuenow", "16")
    expect(barra).toHaveAttribute("aria-valuetext", "16 de 20 usados")

    const web = within(region).getByRole("listitem", {
      name: /fetch web: 0 de 100 páginas/i,
    })
    expect(within(web).getByText("Dentro del cupo")).toBeInTheDocument()
    expect(within(web).getByText(/sin costo estimado/i)).toBeInTheDocument()

    const resend = within(region).getByRole("listitem", {
      name: /resend: 2 de 20 envíos/i,
    })
    expect(within(resend).getByText(/US\$\s?2,00/)).toBeInTheDocument()

    const presupuesto = within(region)
      .getByText("Presupuesto mensual global")
      .closest("[data-estado]") as HTMLElement
    expect(presupuesto).toHaveAttribute("data-estado", "OK")
    expect(presupuesto).toHaveTextContent(
      /Gastado US\$\s?3,50 de US\$\s?10,00/i,
    )
    expect(presupuesto).toHaveTextContent(/restante US\$\s?6,50/i)
    expect(
      within(presupuesto).getByRole("progressbar", {
        name: /uso de presupuesto mensual/i,
      }),
    ).toHaveAttribute("aria-valuemax", "1000")

    expect(
      within(region).getByRole("link", { name: /ver supresiones/i }),
    ).toHaveAttribute("href", "/propuestas/supresiones")
    expect(
      within(region).getByText(/no hay cola automática ni sobreconsumo/i),
    ).toBeInTheDocument()
  })

  it("AC-39: al 100% de cupo y de presupuesto se bloquea, sin cola", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [
            filaCupoDia({
              proveedor: "RESEND",
              usado: 20,
              restante: 0,
              alerta: true,
              costoCentavos: 200,
            }),
          ],
          totalCostoCentavos: 200,
          presupuestoMensualCentavos: 1_000,
          gastadoMesCentavos: 1_000,
          restanteMesCentavos: 0,
          alertaPresupuesto: true,
          presupuestoBloqueado: true,
        })}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    const resend = within(region).getByRole("listitem", {
      name: /resend: 20 de 20 envíos/i,
    })
    expect(resend).toHaveAttribute("data-estado", "BLOQUEADO")
    expect(within(resend).getByText("Bloqueado al 100%")).toBeInTheDocument()
    expect(within(resend).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "20",
    )

    const presupuesto = within(region)
      .getByText("Presupuesto mensual global")
      .closest("[data-estado]") as HTMLElement
    expect(presupuesto).toHaveAttribute("data-estado", "BLOQUEADO")
    expect(
      within(presupuesto).getByText("Bloqueado al 100%"),
    ).toBeInTheDocument()
    expect(within(region).getAllByText("Bloqueado al 100%")).toHaveLength(2)
    expect(
      within(region).getByText(/no hay cola automática ni sobreconsumo/i),
    ).toBeInTheDocument()
  })

  it("AC-38: la variante compacta excluye Places y no repite presupuesto ni pie", () => {
    render(
      <CupoDia
        titulo="Consumo de la campaña (hoy)"
        variante="compacto"
        estado={estadoCupoDia({
          proveedores: [
            filaCupoDia({ usado: 5, restante: 15 }),
            filaCupoDia({
              proveedor: "WEB_FETCH",
              usado: 3,
              cap: 100,
              restante: 97,
            }),
          ],
        })}
        excluir={["GOOGLE_PLACES"]}
        mostrarPresupuesto={false}
        mostrarPie={false}
      />,
    )

    const region = screen.getByRole("region", {
      name: "Consumo de la campaña (hoy)",
    })
    expect(region).toHaveAttribute("data-variante", "compacto")
    expect(
      within(region).getByRole("heading", {
        level: 3,
        name: "Consumo de la campaña (hoy)",
      }),
    ).toBeInTheDocument()
    expect(within(region).queryByText("Google Places")).not.toBeInTheDocument()
    expect(
      within(region).getByRole("listitem", {
        name: /fetch web: 3 de 100 páginas/i,
      }),
    ).toBeInTheDocument()
    expect(
      within(region).queryByText("Presupuesto mensual global"),
    ).not.toBeInTheDocument()
    expect(
      within(region).queryByRole("link", { name: /ver supresiones/i }),
    ).not.toBeInTheDocument()
    expect(
      within(region).queryByText(/no hay cola automática/i),
    ).not.toBeInTheDocument()
  })

  it("AC-38/AC-39: cap <= 0 y configuración faltante muestran no configurado", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [
            filaCupoDia({ usado: 3, restante: 17 }),
            filaCupoDia({ proveedor: "RESEND", usado: 0, restante: 20 }),
            filaCupoDia({
              proveedor: "REDACTOR",
              usado: 3,
              cap: 0,
              restante: 0,
            }),
            filaCupoDia({
              proveedor: "WEB_FETCH",
              usado: 0,
              cap: 100,
              restante: 100,
              costoCentavos: 0,
            }),
          ],
          totalCostoCentavos: 0,
        })}
        disponibilidad={{ places: false, resend: false, secreto: false }}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    const estadoOperativo = within(region).getByRole("status", {
      name: /configuración de cupos/i,
    })
    expect(estadoOperativo).toHaveAttribute("data-estado", "NO_CONFIGURADO")
    expect(
      within(estadoOperativo).getByText("Estado operativo: no configurado"),
    ).toBeInTheDocument()
    expect(
      within(estadoOperativo).getByText(/falta PROPUESTAS_PLACES_API_KEY/i),
    ).toBeInTheDocument()
    expect(
      within(estadoOperativo).getByText(/falta RESEND_API_KEY/i),
    ).toBeInTheDocument()
    expect(
      within(estadoOperativo).getByText(/falta PROPUESTAS_SECRETO/i),
    ).toBeInTheDocument()

    const places = within(region).getByRole("listitem", {
      name: /google places: no configurado/i,
    })
    expect(places).toHaveAttribute("data-estado", "NO_CONFIGURADO")
    expect(
      within(places).getByText(/falta PROPUESTAS_PLACES_API_KEY/i),
    ).toBeInTheDocument()
    // No se inventan números para una pieza sin configurar.
    expect(within(places).queryByText("3 / 20")).not.toBeInTheDocument()

    const resend = within(region).getByRole("listitem", {
      name: /resend: no configurado/i,
    })
    expect(within(resend).getByText(/falta RESEND_API_KEY/i)).toBeInTheDocument()

    const redactor = within(region).getByRole("listitem", {
      name: /redactor: no configurado/i,
    })
    expect(
      within(redactor).getByText(/el cupo diario es 0 o invalido/i),
    ).toBeInTheDocument()

    // Lo que sí está configurado sigue mostrando costo 0 explícito.
    const web = within(region).getByRole("listitem", {
      name: /fetch web: 0 de 100 páginas/i,
    })
    expect(within(web).getByText(/sin costo estimado/i)).toBeInTheDocument()
    expect(within(region).getAllByRole("progressbar")).toHaveLength(1)
  })

  it("AC-38: sin proveedores muestra estado vacío y no inventa medidores", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [],
          totalCostoCentavos: 0,
          presupuestoMensualCentavos: 0,
          gastadoMesCentavos: null,
          restanteMesCentavos: null,
        })}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    expect(within(region).getByRole("status")).toHaveTextContent(
      /no hay proveedores para mostrar en este ámbito/i,
    )
    expect(
      within(region).getByText(/sin presupuesto mensual configurado/i),
    ).toBeInTheDocument()
    expect(within(region).getByText(/sin costo estimado/i)).toBeInTheDocument()
    expect(within(region).queryAllByRole("progressbar")).toHaveLength(0)
  })

  it("AC-39: presupuesto al 80% avisa sin bloquear", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [filaCupoDia({ usado: 1, restante: 19 })],
          totalCostoCentavos: 800,
          presupuestoMensualCentavos: 1_000,
          gastadoMesCentavos: 800,
          restanteMesCentavos: 200,
          alertaPresupuesto: true,
          presupuestoBloqueado: false,
        })}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    const presupuesto = within(region)
      .getByText("Presupuesto mensual global")
      .closest("[data-estado]") as HTMLElement
    expect(presupuesto).toHaveAttribute("data-estado", "ALERTA")
    expect(within(presupuesto).getByText("Aviso 80%")).toBeInTheDocument()
    expect(presupuesto).toHaveTextContent(/restante US\$\s?2,00/i)

    const barra = within(presupuesto).getByRole("progressbar")
    expect(barra).toHaveAttribute("aria-valuenow", "800")
    expect(barra).toHaveAttribute("aria-valuemax", "1000")
    expect(barra).toHaveAttribute("aria-valuetext", "800 de 1000 usados")
  })

  it("AC-38: presupuesto configurado sin dato de gasto no inventa números", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          presupuestoMensualCentavos: 1_000,
          gastadoMesCentavos: null,
          restanteMesCentavos: null,
        })}
      />,
    )

    const region = screen.getByRole("region", { name: "Cupos del día" })
    expect(
      within(region).getByText(/no hay dato de gasto del mes/i),
    ).toBeInTheDocument()
    expect(within(region).queryByText(/Gastado US\$/)).not.toBeInTheDocument()
  })

  it("AC-38: todos los medidores exponen progressbar accesible", () => {
    render(
      <CupoDia
        estado={estadoCupoDia({
          proveedores: [
            filaCupoDia({ usado: 16, restante: 4, alerta: true }),
            filaCupoDia({ proveedor: "RESEND", usado: 2, restante: 18 }),
          ],
          presupuestoMensualCentavos: 1_000,
          gastadoMesCentavos: 800,
          restanteMesCentavos: 200,
          alertaPresupuesto: true,
        })}
      />,
    )

    const barras = screen.getAllByRole("progressbar")
    expect(barras).toHaveLength(3)
    for (const barra of barras) {
      expect(barra).toHaveAttribute("aria-label")
      expect(barra).toHaveAttribute("aria-valuemin", "0")
      expect(barra).toHaveAttribute("aria-valuetext")
      const maximo = Number(barra.getAttribute("aria-valuemax"))
      const actual = Number(barra.getAttribute("aria-valuenow"))
      expect(maximo).toBeGreaterThan(0)
      expect(actual).toBeGreaterThanOrEqual(0)
      expect(actual).toBeLessThanOrEqual(maximo)
    }
  })
})

describe("T-21: cupos en dashboard, campaña y ficha", () => {
  it("AC-38: el dashboard muestra la tarjeta global, conserva el estado vacío y no muta", async () => {
    vi.stubEnv("PROPUESTAS_PLACES_API_KEY", "places-key")
    vi.stubEnv("RESEND_API_KEY", "resend-key")
    vi.stubEnv("PROPUESTAS_SECRETO", "s".repeat(32))
    mocks.queryRaw.mockResolvedValue([])
    mocks.consumoFindMany.mockResolvedValue([
      {
        proveedor: "GOOGLE_PLACES",
        unidades: 16,
        llamadas: 16,
        costoCentavos: 150,
        // Campos que no pertenecen al agregado: no deben filtrarse a la UI.
        email: "fuga@example.com",
        nombreNegocio: "Cliente Secreto",
      },
    ])

    render(await PropuestasDashboardPage())

    const region = screen.getByRole("region", { name: "Cupos del día" })
    expect(within(region).getByText("Google Places")).toBeInTheDocument()
    expect(within(region).getByText("Aviso 80%")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /todavía no hay campañas/i }),
    ).toBeInTheDocument()

    // Sin PII: el medidor solo usa los contadores del agregado.
    expect(document.body).not.toHaveTextContent("fuga@example.com")
    expect(document.body).not.toHaveTextContent("Cliente Secreto")
    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("AC-39: el dashboard lee el presupuesto mensual global y avisa al 80%", async () => {
    vi.stubEnv("PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS", "1000")
    mocks.queryRaw.mockResolvedValue([])
    mocks.consumoFindMany.mockResolvedValue([
      { proveedor: "RESEND", unidades: 1, llamadas: 1, costoCentavos: 800 },
    ])

    render(await PropuestasDashboardPage())

    const region = screen.getByRole("region", { name: "Cupos del día" })
    const presupuesto = within(region)
      .getByText("Presupuesto mensual global")
      .closest("[data-estado]") as HTMLElement
    expect(presupuesto).toHaveAttribute("data-estado", "ALERTA")
    expect(presupuesto).toHaveTextContent(
      /Gastado US\$\s?8,00 de US\$\s?10,00/i,
    )
    expect(presupuesto).toHaveTextContent(/restante US\$\s?2,00/i)

    // Día + mes: el gasto mensual sale del agregado global.
    expect(mocks.consumoFindMany).toHaveBeenCalledTimes(2)
    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
  })

  it("AC-6/AC-38: sin esquema no consulta consumo ni muestra cupos", async () => {
    mocks.queryRaw.mockRejectedValue({ code: "P2021" })

    render(await PropuestasDashboardPage())

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("region", { name: "Cupos del día" }),
    ).not.toBeInTheDocument()
    expect(mocks.consumoFindMany).not.toHaveBeenCalled()
    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
  })

  it("AC-6/AC-38: si falla la consulta de consumo por esquema, falla cerrado", async () => {
    mocks.queryRaw.mockResolvedValue([])
    mocks.consumoFindMany.mockRejectedValue({ code: "P2021" })

    render(await PropuestasDashboardPage())

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("region", { name: "Cupos del día" }),
    ).not.toBeInTheDocument()
  })

  it("AC-38: la campaña acota su consumo y no duplica Places del global", async () => {
    stubConsumoConfigurado()
    const dia = diaUTCDe(new Date())
    mocks.campanaFindUnique.mockResolvedValue(
      campanaDetalleFixture({
        consumos: [
          {
            id: "consumo_1",
            fecha: dia,
            llamadas: 5,
            unidades: 5,
            costoCentavos: 50,
          },
        ],
      }),
    )
    mocks.consumoFindMany.mockImplementation(
      consumoFindManyPorFilas([
        {
          campanaId: "camp_1",
          prospectoId: null,
          proveedor: "GOOGLE_PLACES",
          fecha: dia,
          unidades: 5,
          llamadas: 5,
          costoCentavos: 50,
        },
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "WEB_FETCH",
          fecha: dia,
          unidades: 3,
          llamadas: 3,
          costoCentavos: 0,
        },
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "AUDITORIA",
          fecha: dia,
          unidades: 1,
          llamadas: 1,
          costoCentavos: 0,
        },
        {
          campanaId: "camp_2",
          prospectoId: null,
          proveedor: "GOOGLE_PLACES",
          fecha: dia,
          unidades: 12,
          llamadas: 12,
          costoCentavos: 120,
        },
      ]),
    )

    await renderDetalle()

    const campana = screen.getByRole("region", {
      name: "Consumo de la campaña (hoy)",
    })
    expect(campana).toHaveAttribute("data-variante", "compacto")
    // Places se detalla abajo: no se repite su fila en el consumo acotado.
    expect(within(campana).queryByText("Google Places")).not.toBeInTheDocument()
    expect(
      within(campana).getByRole("listitem", {
        name: /fetch web: 3 de 100 páginas/i,
      }),
    ).toBeInTheDocument()
    expect(
      within(campana).getByRole("listitem", {
        name: /auditoría: 1 de 20 auditorías/i,
      }),
    ).toBeInTheDocument()
    expect(
      within(campana).queryByText("Presupuesto mensual global"),
    ).not.toBeInTheDocument()
    expect(
      within(campana).getAllByText(/US\$\s?0,50/).length,
    ).toBeGreaterThan(0)

    const global = screen.getByRole("region", {
      name: "Cupos globales del día",
    })
    const placesGlobal = within(global).getByRole("listitem", {
      name: /google places: 17 de 20 búsquedas/i,
    })
    expect(within(placesGlobal).getByText("17 / 20")).toBeInTheDocument()
    expect(
      within(global).getAllByText(/US\$\s?1,70/).length,
    ).toBeGreaterThan(0)

    // El detalle de Places conserva su propia sección y tabla.
    expect(
      screen.getByRole("region", { name: "Consumo de Google Places" }),
    ).toBeInTheDocument()
    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()

    const llamadas = mocks.consumoFindMany.mock.calls.map(
      ([args]) => args as { where: WhereConsumoMock },
    )
    expect(
      llamadas.some(
        (args) =>
          args.where.campanaId === "camp_1" &&
          args.where.fecha instanceof Date,
      ),
    ).toBe(true)
    expect(
      llamadas.some(
        (args) =>
          args.where.campanaId === undefined &&
          args.where.prospectoId === undefined &&
          args.where.fecha instanceof Date,
      ),
    ).toBe(true)
  })

  it("AC-6/AC-38: si falla el consumo de la campaña por esquema, no muestra cupos", async () => {
    mocks.campanaFindUnique.mockResolvedValue(campanaDetalleFixture())
    mocks.consumoFindMany.mockRejectedValue({ code: "P2021" })

    await renderDetalle()

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("region", { name: "Consumo de la campaña (hoy)" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Cupos globales del día" }),
    ).not.toBeInTheDocument()
  })

  it("AC-38/AC-39: la ficha muestra el consumo acotado del prospecto sin PII", async () => {
    stubConsumoConfigurado()
    const dia = diaUTCDe(new Date())
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.consumoFindMany.mockImplementation(
      consumoFindManyPorFilas([
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "WEB_FETCH",
          fecha: dia,
          unidades: 5,
          llamadas: 5,
          costoCentavos: 0,
        },
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "AUDITORIA",
          fecha: dia,
          unidades: 20,
          llamadas: 20,
          costoCentavos: 0,
        },
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "RESEND",
          fecha: dia,
          unidades: 2,
          llamadas: 2,
          costoCentavos: 200,
        },
        {
          campanaId: "camp_1",
          prospectoId: "pros_2",
          proveedor: "WEB_FETCH",
          fecha: dia,
          unidades: 90,
          llamadas: 90,
          costoCentavos: 0,
        },
      ]),
    )

    await renderProspecto()

    const prospecto = screen.getByRole("region", {
      name: "Consumo del prospecto (hoy)",
    })
    expect(prospecto).toHaveAttribute("data-variante", "compacto")

    const web = within(prospecto).getByRole("listitem", {
      name: /fetch web: 5 de 100 páginas/i,
    })
    expect(within(web).getByText("5 / 100")).toBeInTheDocument()
    // El consumo del otro prospecto no se suma al ámbito acotado.
    expect(within(web).getByText("95")).toBeInTheDocument()

    const auditoria = within(prospecto).getByRole("listitem", {
      name: /auditoría: 20 de 20 auditorías/i,
    })
    expect(auditoria).toHaveAttribute("data-estado", "BLOQUEADO")
    expect(
      within(auditoria).getByText("Bloqueado al 100%"),
    ).toBeInTheDocument()

    const resend = within(prospecto).getByRole("listitem", {
      name: /resend: 2 de 20 envíos/i,
    })
    expect(within(resend).getByText(/US\$\s?2,00/)).toBeInTheDocument()

    // Sin PII en el medidor (ni siquiera en atributos).
    expect(prospecto.innerHTML).not.toContain("ventas@alfa.com.ar")
    expect(prospecto.innerHTML).not.toContain("+541155551234")

    // El global sí suma ambos prospectos y avisa al 95%.
    const global = screen.getByRole("region", {
      name: "Cupos globales del día",
    })
    expect(
      within(global).getByRole("listitem", {
        name: /fetch web: 95 de 100 páginas/i,
      }),
    ).toBeInTheDocument()
    expect(within(global).getByText("Aviso 80%")).toBeInTheDocument()
    expect(global.innerHTML).not.toContain("ventas@alfa.com.ar")

    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()

    const llamadas = mocks.consumoFindMany.mock.calls.map(
      ([args]) => args as { where: WhereConsumoMock },
    )
    expect(
      llamadas.some(
        (args) =>
          args.where.prospectoId === "pros_1" &&
          args.where.fecha instanceof Date,
      ),
    ).toBe(true)
    expect(
      llamadas.some(
        (args) =>
          args.where.prospectoId === undefined &&
          args.where.campanaId === undefined &&
          args.where.fecha instanceof Date,
      ),
    ).toBe(true)
  })

  it("AC-39: el presupuesto global bloqueado se muestra en la ficha sin tocar el consumo acotado", async () => {
    stubConsumoConfigurado()
    vi.stubEnv("PROPUESTAS_PRESUPUESTO_MENSUAL_CENTAVOS", "100")
    const dia = diaUTCDe(new Date())
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.consumoFindMany.mockImplementation(
      consumoFindManyPorFilas([
        {
          campanaId: "camp_1",
          prospectoId: "pros_1",
          proveedor: "RESEND",
          fecha: dia,
          unidades: 1,
          llamadas: 1,
          costoCentavos: 200,
        },
      ]),
    )

    await renderProspecto()

    const global = screen.getByRole("region", {
      name: "Cupos globales del día",
    })
    const presupuesto = within(global)
      .getByText("Presupuesto mensual global")
      .closest("[data-estado]") as HTMLElement
    expect(presupuesto).toHaveAttribute("data-estado", "BLOQUEADO")
    expect(presupuesto).toHaveTextContent(/Bloqueado al 100%/)

    const prospecto = screen.getByRole("region", {
      name: "Consumo del prospecto (hoy)",
    })
    expect(
      within(prospecto).queryByText("Presupuesto mensual global"),
    ).not.toBeInTheDocument()
    expect(
      within(prospecto).getByRole("listitem", {
        name: /resend: 1 de 20 envíos/i,
      }),
    ).not.toHaveAttribute("data-estado", "BLOQUEADO")
    expect(mocks.consumoUpsert).not.toHaveBeenCalled()
  })

  it("AC-6/AC-38: si falla el consumo del prospecto por esquema, falla cerrado", async () => {
    mocks.prospectoFindUnique.mockResolvedValue(prospectoDetalleFixture())
    mocks.consumoFindMany.mockRejectedValue({ code: "P2021" })

    await renderProspecto()

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-estado",
      CODIGO_ESQUEMA_NO_APLICADO,
    )
    expect(
      screen.queryByRole("region", { name: "Consumo del prospecto (hoy)" }),
    ).not.toBeInTheDocument()
  })
})

describe("T-21: cupos sin mutaciones ni auto-refresh (AC-38, AC-39)", () => {
  const RAIZ = process.cwd()
  const ARCHIVOS = [
    [
      "CupoDia",
      path.join(RAIZ, "src", "components", "propuestas", "cupo-dia.tsx"),
    ],
    [
      "dashboard",
      path.join(RAIZ, "src", "app", "(propuestas)", "propuestas", "page.tsx"),
    ],
    [
      "campaña",
      path.join(
        RAIZ,
        "src",
        "app",
        "(propuestas)",
        "propuestas",
        "campanas",
        "[id]",
        "page.tsx",
      ),
    ],
    [
      "ficha",
      path.join(
        RAIZ,
        "src",
        "app",
        "(propuestas)",
        "propuestas",
        "prospectos",
        "[id]",
        "page.tsx",
      ),
    ],
  ] as const

  it.each(ARCHIVOS)(
    "AC-38: %s no usa polling, timers, fetch ni efectos",
    (_nombre, archivo) => {
      const codigo = readFileSync(archivo, "utf8")
      expect(codigo).not.toMatch(
        /\bsetInterval\b|\bsetTimeout\b|\buseEffect\b|\bfetch\s*\(/,
      )
    },
  )

  it("AC-38: CupoDia es presentacional, sin Prisma, red ni mutaciones", () => {
    const codigo = readFileSync(
      path.join(RAIZ, "src", "components", "propuestas", "cupo-dia.tsx"),
      "utf8",
    )
    expect(codigo).not.toMatch(/@\/lib\/prisma|@prisma\/client/)
    expect(codigo).not.toMatch(/\bprisma\s*\./)
    expect(codigo).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    )
    expect(codigo).not.toMatch(/["']use client["']/)
  })

  it.each(ARCHIVOS.filter(([nombre]) => nombre !== "CupoDia"))(
    "AC-38: %s solo lee datos (sin mutaciones Prisma)",
    (_nombre, archivo) => {
      const codigo = readFileSync(archivo, "utf8")
      expect(codigo).not.toMatch(
        /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
      )
    },
  )
})

/* ------------------------------------------------------------------ */
/* T-22: panel ARCO de la ficha                                        */
/* ------------------------------------------------------------------ */

describe("ArcoPanel (T-22, AC-37; RF-30, RF-65)", () => {
  interface DescargaFake {
    create: ReturnType<typeof vi.fn>
    revoke: ReturnType<typeof vi.fn>
    click: ReturnType<typeof vi.spyOn>
    cleanup: () => void
  }

  let descargaActiva: DescargaFake | null = null

  function instalarDescargaFake(): DescargaFake {
    const descriptorCreate = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL",
    )
    const descriptorRevoke = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL",
    )

    const create = vi.fn(() => "blob:arco")
    const revoke = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: create,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revoke,
    })

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)

    const fake: DescargaFake = {
      create,
      revoke,
      click,
      cleanup: () => {
        click.mockRestore()
        if (descriptorCreate) {
          Object.defineProperty(URL, "createObjectURL", descriptorCreate)
        } else {
          Reflect.deleteProperty(URL, "createObjectURL")
        }
        if (descriptorRevoke) {
          Object.defineProperty(URL, "revokeObjectURL", descriptorRevoke)
        } else {
          Reflect.deleteProperty(URL, "revokeObjectURL")
        }
      },
    }

    descargaActiva = fake
    return fake
  }

  function fixtureArco(
    overrides: Partial<ProspectoArco> = {},
  ): ProspectoArco {
    return {
      id: "pros_1",
      nombreNegocio: "Consultora Alfa",
      sitioWeb: "https://alfa.com.ar/",
      email: "ventas@alfa.com.ar",
      telefono: "+541155551234",
      ciudad: "CABA",
      rubro: "Consultoría",
      contactoNombre: "Ana",
      contactoCargo: "Socia",
      fuenteUrl: "https://alfa.com.ar/contacto",
      emailFuenteUrl: "https://alfa.com.ar/contacto",
      estado: "PUNTUADO",
      ...overrides,
    }
  }

  afterEach(() => {
    descargaActiva?.cleanup()
    descargaActiva = null
    vi.restoreAllMocks()
  })

  it("AC-37: muestra las acciones ARCO sin hacer red al montar", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)

    const region = screen.getByRole("region", { name: "Derechos ARCO" })
    expect(region).toHaveAttribute("aria-busy", "false")
    expect(
      within(region).getByRole("button", { name: "Exportar datos" }),
    ).toBeEnabled()
    expect(
      within(region).getByRole("button", { name: "Rectificar" }),
    ).toBeEnabled()
    expect(
      within(region).getByRole("button", { name: "Eliminar" }),
    ).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()

    const rectificar = within(region).getByRole("button", {
      name: "Rectificar",
    })
    expect(rectificar).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(rectificar)
    expect(rectificar).toHaveAttribute("aria-expanded", "true")
    expect(
      within(region).getByLabelText(/motivo de la rectificación/i),
    ).toBeInTheDocument()
  })

  it("AC-37: exportar hace POST al id interno, descarga el JSON y no pone PII en la URL", async () => {
    const descarga = instalarDescargaFake()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-disposition": 'attachment; filename="arco-pros_1.json"',
      }),
      blob: async () => ({ size: 2, type: "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Exportar datos" }),
    )

    const mensaje = await screen.findByRole("status")
    expect(mensaje).toHaveTextContent(/Exportación descargada/i)
    expect(mensaje).toHaveTextContent(/no incluye tokens, hashes/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/arco/pros_1")
    expect(url).not.toContain("ventas@alfa.com.ar")
    expect(url).not.toContain("Consultora")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ tipo: "EXPORTAR" })

    expect(descarga.create).toHaveBeenCalledTimes(1)
    expect(descarga.click).toHaveBeenCalledTimes(1)
    expect(descarga.revoke).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it("AC-37: un error de exportación se muestra accesible y no descarga", async () => {
    const descarga = instalarDescargaFake()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ codigo: "NO_CONFIGURADO" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Exportar datos" }),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/PROPUESTAS_SECRETO/i)
    expect(descarga.create).not.toHaveBeenCalled()
    expect(descarga.click).not.toHaveBeenCalled()
  })

  it("AC-37: rectificar envía solo los campos cambiados con el motivo y refresca", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rectificado: true, campos: ["telefono"] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Rectificar" }))
    fireEvent.change(screen.getByLabelText(/teléfono comercial/i), {
      target: { value: "+5491100001111" },
    })
    fireEvent.change(screen.getByLabelText(/motivo de la rectificación/i), {
      target: { value: "Pedido ARCO del titular" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar rectificación" }),
    )

    const mensaje = await screen.findByRole("status")
    expect(mensaje).toHaveTextContent(/Rectificación guardada/i)
    expect(mensaje).toHaveTextContent(/no se envió ningún email/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/arco/pros_1")
    expect(JSON.parse(String(init.body))).toEqual({
      tipo: "RECTIFICAR",
      cambios: { telefono: "+5491100001111" },
      motivo: "Pedido ARCO del titular",
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("AC-37: el motivo es obligatorio y el error queda asociado al campo", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Rectificar" }))
    fireEvent.change(screen.getByLabelText(/teléfono comercial/i), {
      target: { value: "+5491100001111" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar rectificación" }),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/motivo es obligatorio/i)
    const motivo = screen.getByLabelText(/motivo de la rectificación/i)
    expect(motivo).toHaveAttribute("aria-invalid", "true")
    expect(motivo.getAttribute("aria-describedby")).toMatch(
      /motivo-rectificar-error/,
    )
    expect(screen.getByText("El motivo es obligatorio.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("AC-37: cambiar el email sin fuente se bloquea en el cliente", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ArcoPanel
        prospecto={fixtureArco({ emailFuenteUrl: null, fuenteUrl: null })}
        campanaId="camp_1"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Rectificar" }))
    fireEvent.change(screen.getByLabelText(/email de contacto/i), {
      target: { value: "nuevo@alfa.com.ar" },
    })
    fireEvent.change(screen.getByLabelText(/motivo de la rectificación/i), {
      target: { value: "Correo actualizado" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar rectificación" }),
    )

    const alerta = await screen.findByRole("alert")
    expect(alerta).toHaveTextContent(/Falta la fuente del email nuevo/i)
    expect(
      screen.getByText(/Para cambiar el email indicá la fuente/i),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("AC-37: un prospecto suprimido no ofrece rectificar", () => {
    render(
      <ArcoPanel
        prospecto={fixtureArco({ estado: "SUPRIMIDO" })}
        campanaId="camp_1"
      />,
    )

    const rectificar = screen.getByRole("button", { name: "Rectificar" })
    expect(rectificar).toBeDisabled()
    expect(rectificar.getAttribute("title")).toContain("suprimido")
    fireEvent.click(rectificar)
    expect(
      screen.queryByLabelText(/motivo de la rectificación/i),
    ).not.toBeInTheDocument()
  })

  it("AC-37: eliminar exige confirmación y avisa que la supresión se conserva", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        eliminado: true,
        supresion: { id: "sup_1", creada: true, reactivada: false },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))

    const region = screen.getByRole("region", { name: "Derechos ARCO" })
    const aviso = within(region).getByRole("note")
    expect(aviso).toHaveTextContent(/borradores, snapshots y envíos/i)
    expect(aviso).toHaveTextContent(/SOLICITUD_ARCO/)
    expect(aviso).toHaveTextContent(/No se toca el CRM/i)

    const submit = within(region).getByRole("button", {
      name: "Eliminar prospecto",
    })
    expect(submit).toBeDisabled()

    // Enviar el formulario sin marcar la confirmación no hace ninguna request.
    const form = submit.closest("form")
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)
    expect(fetchMock).not.toHaveBeenCalled()

    const checkbox = within(region).getByRole("checkbox", {
      name: /Confirmo la eliminación/i,
    })
    fireEvent.click(checkbox)
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    const mensaje = await screen.findByRole("status")
    expect(mensaje).toHaveTextContent(/Prospecto eliminado/i)
    expect(mensaje).toHaveTextContent(/supresión SOLICITUD_ARCO quedó registrada/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/propuestas/arco/pros_1")
    expect(url).not.toContain("ventas@alfa.com.ar")
    expect(JSON.parse(String(init.body))).toEqual({
      tipo: "ELIMINAR",
      confirmado: true,
    })
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/propuestas/campanas/camp_1"),
    )
  })

  it("AC-37: sin email avisa que no se crea supresión", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eliminado: true, supresion: null }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ArcoPanel
        prospecto={fixtureArco({ email: null })}
        campanaId="camp_1"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))

    const region = screen.getByRole("region", { name: "Derechos ARCO" })
    const aviso = within(region).getByRole("note")
    expect(aviso).toHaveTextContent(/no tiene email/i)
    expect(aviso).toHaveTextContent(/sin crear una supresión/i)

    fireEvent.click(
      within(region).getByRole("checkbox", {
        name: /Confirmo la eliminación/i,
      }),
    )
    fireEvent.click(
      within(region).getByRole("button", { name: "Eliminar prospecto" }),
    )

    const mensaje = await screen.findByRole("status")
    expect(mensaje).toHaveTextContent(/No tenía email/i)
    expect(mensaje).toHaveTextContent(/no se creó una supresión/i)
  })

  it("AC-37: cerrar o cambiar de panel descarta la confirmación y el motivo de eliminar", () => {
    render(<ArcoPanel prospecto={fixtureArco()} campanaId="camp_1" />)

    const region = screen.getByRole("region", { name: "Derechos ARCO" })
    const botonEliminar = within(region).getByRole("button", {
      name: "Eliminar",
    })

    fireEvent.click(botonEliminar)
    fireEvent.change(within(region).getByLabelText(/motivo o referencia/i), {
      target: { value: "Solicitud del titular" },
    })
    const checkbox = within(region).getByRole("checkbox", {
      name: /Confirmo la eliminación/i,
    })
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    expect(
      within(region).getByRole("button", { name: "Eliminar prospecto" }),
    ).toBeEnabled()

    // Cancelar cierra el panel y descarta el estado armado.
    fireEvent.click(within(region).getByRole("button", { name: "Cancelar" }))
    expect(
      within(region).queryByLabelText(/motivo o referencia/i),
    ).not.toBeInTheDocument()
    expect(botonEliminar).toHaveAttribute("aria-expanded", "false")

    // Reabrir no deja la confirmación ni el motivo previos.
    fireEvent.click(botonEliminar)
    const motivoReabierto = within(region).getByLabelText(/motivo o referencia/i)
    expect(motivoReabierto).toHaveValue("")
    const checkboxReabierto = within(region).getByRole("checkbox", {
      name: /Confirmo la eliminación/i,
    })
    expect(checkboxReabierto).not.toBeChecked()
    expect(
      within(region).getByRole("button", { name: "Eliminar prospecto" }),
    ).toBeDisabled()

    // Cambiar a rectificar y volver a eliminar también resetea el panel.
    fireEvent.change(motivoReabierto, {
      target: { value: "Otra referencia" },
    })
    fireEvent.click(checkboxReabierto)
    expect(checkboxReabierto).toBeChecked()

    fireEvent.click(within(region).getByRole("button", { name: "Rectificar" }))
    expect(
      within(region).queryByLabelText(/motivo o referencia/i),
    ).not.toBeInTheDocument()

    fireEvent.click(botonEliminar)
    expect(within(region).getByLabelText(/motivo o referencia/i)).toHaveValue("")
    expect(
      within(region).getByRole("checkbox", {
        name: /Confirmo la eliminación/i,
      }),
    ).not.toBeChecked()
    expect(
      within(region).getByRole("button", { name: "Eliminar prospecto" }),
    ).toBeDisabled()
  })
})


import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * AC-17, AC-25 / plan §5.1: todas las APIs admin siguen validando el rol en
 * servidor. La asistente (requireAdmin -> null) no puede ejecutar ninguna de
 * estas rutas, incluidas las de registro manual de pagos.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rateLimit: vi.fn(() => true),
}))

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  requireStaff: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/resend", () => ({ resend: () => null }))
vi.mock("@/lib/deploy", () => ({ pauseDeploy: vi.fn(), resumeDeploy: vi.fn() }))
vi.mock("@/lib/mercadopago", () => ({
  crearLinkDePago: vi.fn(),
  obtenerPagoMp: vi.fn(),
}))
vi.mock("@/lib/notifications", () => ({
  sendPaymentReceipt: vi.fn(),
  sendPaymentReminder: vi.fn(),
}))
vi.mock("@/lib/dolar", () => ({
  getDolarVentaBancoNacion: vi.fn(async () => null),
}))

import * as asignarProducto from "@/app/api/admin/asignar-producto/route"
import * as clientes from "@/app/api/admin/clientes/route"
import * as clienteDetalle from "@/app/api/admin/clientes/[id]/route"
import * as entregar from "@/app/api/admin/entregar/route"
import * as hitoDetalle from "@/app/api/admin/hitos/[id]/route"
import * as mpLink from "@/app/api/admin/mp/link/route"
import * as pagos from "@/app/api/admin/pagos/route"
import * as proyectos from "@/app/api/admin/proyectos/route"
import * as proyectoDetalle from "@/app/api/admin/proyectos/[id]/route"
import * as proyectoTarea from "@/app/api/admin/proyectos/[id]/hitos/route"
import * as recordar from "@/app/api/admin/recordar/route"
import * as soporte from "@/app/api/admin/soporte/route"
import * as suscripciones from "@/app/api/admin/suscripciones/route"

const PARAMS = { params: Promise.resolve({ id: "id_1" }) }

const CASOS: { nombre: string; ejecutar: (req: Request) => Promise<Response> }[] = [
  { nombre: "POST /api/admin/clientes", ejecutar: (req) => clientes.POST(req) },
  {
    nombre: "PATCH /api/admin/clientes/[id]",
    ejecutar: (req) => clienteDetalle.PATCH(req, PARAMS),
  },
  { nombre: "POST /api/admin/proyectos", ejecutar: (req) => proyectos.POST(req) },
  {
    nombre: "PATCH /api/admin/proyectos/[id]",
    ejecutar: (req) => proyectoDetalle.PATCH(req, PARAMS),
  },
  {
    nombre: "POST /api/admin/proyectos/[id]/hitos",
    ejecutar: (req) => proyectoTarea.POST(req, PARAMS),
  },
  {
    nombre: "PATCH /api/admin/hitos/[id]",
    ejecutar: (req) => hitoDetalle.PATCH(req, PARAMS),
  },
  {
    nombre: "DELETE /api/admin/hitos/[id]",
    ejecutar: (req) => hitoDetalle.DELETE(req, PARAMS),
  },
  { nombre: "POST /api/admin/soporte", ejecutar: (req) => soporte.POST(req) },
  { nombre: "POST /api/admin/pagos", ejecutar: (req) => pagos.POST(req) },
  { nombre: "POST /api/admin/mp/link", ejecutar: (req) => mpLink.POST(req) },
  {
    nombre: "PATCH /api/admin/suscripciones",
    ejecutar: (req) => suscripciones.PATCH(req),
  },
  { nombre: "POST /api/admin/recordar", ejecutar: (req) => recordar.POST(req) },
  { nombre: "POST /api/admin/entregar", ejecutar: (req) => entregar.POST(req) },
  {
    nombre: "POST /api/admin/asignar-producto",
    ejecutar: (req) => asignarProducto.POST(req),
  },
]

function request(): Request {
  return new Request("https://pixelarch.dev/api/admin/accion", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
}

describe("APIs admin: rechazo sin rol admin (AC-17, AC-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimit.mockReturnValue(true)
    mocks.requireAdmin.mockResolvedValue(null)
  })

  for (const caso of CASOS) {
    it(`${caso.nombre} responde 403 a la asistente o a un usuario sin rol`, async () => {
      const res = await caso.ejecutar(request())

      expect(res.status).toBe(403)
      expect(mocks.requireAdmin).toHaveBeenCalledTimes(1)
    })
  }
})

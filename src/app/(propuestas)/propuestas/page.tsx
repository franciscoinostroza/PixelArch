import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Ban,
  FileText,
  Inbox,
  Mail,
  MapPin,
  Search,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { configPropuestas } from "@/lib/propuestas/config"
import {
  estadoCupos,
  type EstadoCupos,
} from "@/lib/propuestas/consumo"
import {
  CODIGO_ESQUEMA_NO_APLICADO,
  esErrorTablaFaltante,
} from "@/lib/propuestas/errores"
import {
  EstadoOperativo,
  EstadoVacio,
} from "@/components/propuestas/estado-vacio"
import { CupoDia } from "@/components/propuestas/cupo-dia"
import { PageHeader } from "@/components/propuestas/ui/page-header"
import { Panel } from "@/components/propuestas/ui/panel"
import { StatusPill } from "@/components/propuestas/ui/status-pill"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Panel de propuestas",
  robots: { index: false, follow: false },
}

/**
 * T-02 (AC-1, AC-3, AC-6; RF-1, RF-4): dashboard vacio del portal.
 *
 * T-21 (AC-38, AC-39; RF-57, RF-58): agrega los cupos globales del dia
 * (`estadoCupos`) con costo, aviso 80% y bloqueo 100%. Solo lectura: no
 * reserva, no encola y no llama a proveedores. Si el esquema falta, se
 * conserva el estado operativo y no se muestran datos ni formularios.
 *
 * FASE 2 "PixelArch Console": cabecera, tira de estado operativo, cupos,
 * estado vacio con CTA y atajos. Sin consultas nuevas ni datos de campaignas.
 */
async function esquemaDisponible(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "CampanaProspeccion" LIMIT 1`
    return true
  } catch (error) {
    if (esErrorTablaFaltante(error)) return false
    throw error
  }
}

interface PiezaOperativa {
  nombre: string
  disponible: boolean
  Icono: LucideIcon
}

const ATAJOS: ReadonlyArray<{
  href: string
  titulo: string
  descripcion: string
  Icono: LucideIcon
}> = [
  {
    href: "/propuestas/buscar",
    titulo: "Buscar",
    descripcion: "Creá una campaña de prospección.",
    Icono: Search,
  },
  {
    href: "/propuestas/bandeja",
    titulo: "Bandeja",
    descripcion: "Revisá borradores y aprobados pendientes.",
    Icono: Inbox,
  },
  {
    href: "/propuestas/plantillas",
    titulo: "Plantillas",
    descripcion: "Versiones y vista previa de mensajes.",
    Icono: FileText,
  },
  {
    href: "/propuestas/envios",
    titulo: "Envíos",
    descripcion: "Historial y estados de cada envío.",
    Icono: Send,
  },
]

export default async function PropuestasDashboardPage() {
  const disponible = await esquemaDisponible()

  if (!disponible) {
    return (
      <EstadoOperativo
        codigo={CODIGO_ESQUEMA_NO_APLICADO}
        titulo="Esquema no aplicado"
        descripcion="El portal queda deshabilitado hasta que se aplique el esquema de propuestas. No se muestran datos ni formularios."
        fecha={new Date()}
      />
    )
  }

  let cupos: EstadoCupos
  try {
    cupos = await estadoCupos(new Date(), { cliente: prisma })
  } catch (error) {
    if (esErrorTablaFaltante(error)) {
      return (
        <EstadoOperativo
          codigo={CODIGO_ESQUEMA_NO_APLICADO}
          titulo="Esquema no aplicado"
          descripcion="El portal queda deshabilitado hasta que se aplique el esquema de propuestas. No se muestran datos ni formularios."
          fecha={new Date()}
        />
      )
    }
    throw error
  }

  const config = configPropuestas()

  const piezas: readonly PiezaOperativa[] = [
    {
      nombre: "Google Places",
      disponible: config.places.disponible,
      Icono: MapPin,
    },
    {
      nombre: "Email",
      disponible: config.resend.disponible,
      Icono: Mail,
    },
    {
      nombre: "Supresión",
      disponible: config.supresion.disponible,
      Icono: Ban,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Portal interno"
        title="Propuestas"
        description="Prospección asistida, borradores y envíos con aprobación manual. Este portal está separado del CRM."
      />

      <section
        aria-label="Estado operativo del portal"
        className="p-status-strip mb-8"
      >
        {piezas.map((pieza) => {
          const Icono = pieza.Icono

          return (
            <div
              key={pieza.nombre}
              className="p-status-item"
              data-estado={
                pieza.disponible ? "CONFIGURADO" : "NO_CONFIGURADO"
              }
            >
              <span className="p-status-icon" aria-hidden="true">
                <Icono size={15} />
              </span>
              <span className="p-status-name">{pieza.nombre}</span>
              <StatusPill tone={pieza.disponible ? "mint" : "amber"}>
                {pieza.disponible ? "Configurado" : "No configurado"}
              </StatusPill>
            </div>
          )
        })}

        <div className="p-status-meta">
          <StatusPill tone="violet">
            <ShieldCheck size={12} aria-hidden="true" />
            Aprobación manual · el envío se confirma aparte
          </StatusPill>
        </div>
      </section>

      <div className="mb-8">
        <CupoDia
          estado={cupos}
          disponibilidad={{
            places: config.places.disponible,
            resend: config.resend.disponible,
            secreto: config.secreto !== null,
          }}
        />
      </div>

      <EstadoVacio
        titulo="Todavía no hay campañas"
        descripcion="Cuando crees la primera búsqueda vas a ver acá el estado de las campañas, la cola de revisión y el consumo del día."
        accion={
          <Link href="/propuestas/buscar" className="p-btn p-btn--primary">
            Crear primera búsqueda
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        }
      />

      <Panel title="Atajos" className="mt-8">
        <div className="p-shortcut-grid">
          {ATAJOS.map((atajo) => {
            const Icono = atajo.Icono

            return (
              <Link
                key={atajo.href}
                href={atajo.href}
                className="p-shortcut"
              >
                <span className="p-shortcut-icon" aria-hidden="true">
                  <Icono size={17} />
                </span>
                <span className="p-shortcut-copy">
                  <span className="p-shortcut-title">{atajo.titulo}</span>
                  <span className="p-shortcut-description">
                    {atajo.descripcion}
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

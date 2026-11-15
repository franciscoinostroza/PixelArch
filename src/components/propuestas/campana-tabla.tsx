/**
 * T-13 (AC-14; RF-16) / T-14 (AC-13, AC-19; RF-18, RF-22): tabla de
 * prospectos de una campaña.
 *
 * Server component de solo lectura para los datos. Las acciones de alta,
 * corrección y descarte viven en `prospecto-ficha.tsx` (client) y se montan
 * por fila. "Ver ficha" enlaza a la ficha del prospecto, donde vive el botón
 * "Analizar" que ejecuta el enriquecimiento. La tabla tiene `caption` y
 * encabezados con `scope` para lectores de pantalla.
 *
 * FASE 2 "PixelArch Console": tabla con estilos del portal, estado como pill y
 * score como chip. Conserva caption, scopes, textos y acciones por fila.
 */

import Link from "next/link"
import { ProspectoAcciones } from "@/components/propuestas/prospecto-ficha"
import {
  StatusPill,
  type StatusTone,
} from "@/components/propuestas/ui/status-pill"

export interface ProspectoFila {
  id: string
  nombreNegocio: string
  sitioWeb: string | null
  email: string | null
  telefono: string | null
  ciudad: string | null
  rubro: string | null
  contactoNombre: string | null
  contactoCargo: string | null
  fuenteUrl: string | null
  emailFuenteUrl: string | null
  estado: string
  posibleDuplicadoDeId: string | null
  score: number | null
}

interface CampanaTablaProps {
  prospectos: ProspectoFila[]
}

const TONOS_ESTADO: Record<string, StatusTone> = {
  NUEVO: "cyan",
  SIN_ENRIQUECER: "neutral",
  ENRIQUECIDO: "violet",
  PUNTUADO: "violet",
  BORRADOR: "neutral",
  APROBADO: "amber",
  ENVIADO: "mint",
  RESPONDIO: "mint",
  DESCARTADO: "red",
  SUPRIMIDO: "red",
}

function tonoEstado(estado: string): StatusTone {
  return TONOS_ESTADO[estado] ?? "neutral"
}

export function CampanaTabla({ prospectos }: CampanaTablaProps) {
  if (prospectos.length === 0) {
    return (
      <p className="p-table-empty">
        La corrida todavía no creó prospectos. Ejecutá la búsqueda cuando la
        campaña esté en borrador; los resultados se van a listar acá.
      </p>
    )
  }

  return (
    <div className="p-table-wrap">
      <table className="p-table p-table--wide">
        <caption className="sr-only">
          Prospectos creados por la campaña
        </caption>
        <thead>
          <tr>
            <th scope="col">Negocio</th>
            <th scope="col">Sitio</th>
            <th scope="col">Ciudad</th>
            <th scope="col">Estado</th>
            <th scope="col">Posible duplicado</th>
            <th scope="col">Score</th>
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {prospectos.map((prospecto) => (
            <tr key={prospecto.id}>
              <th scope="row" className="p-table-rowhead">
                {prospecto.nombreNegocio}
              </th>
              <td>
                {prospecto.sitioWeb ? (
                  <a
                    href={prospecto.sitioWeb}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="p-table-link"
                  >
                    {prospecto.sitioWeb}
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td>{prospecto.ciudad ?? "—"}</td>
              <td>
                <StatusPill tone={tonoEstado(prospecto.estado)}>
                  {prospecto.estado}
                </StatusPill>
              </td>
              <td>
                {prospecto.posibleDuplicadoDeId ? (
                  <span
                    className="p-duplicate-flag"
                    title={`Referencia interna: ${prospecto.posibleDuplicadoDeId}`}
                  >
                    Sí
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {prospecto.score === null ? (
                  "—"
                ) : (
                  <span
                    className="p-score-chip"
                    role="img"
                    aria-label={`Score ${prospecto.score} de 100`}
                  >
                    {prospecto.score}
                  </span>
                )}
              </td>
              <td>
                <div className="p-table-actions">
                  <Link
                    href={`/propuestas/prospectos/${prospecto.id}`}
                    className="p-btn p-btn--ghost p-btn--sm"
                  >
                    Ver ficha
                  </Link>
                  <ProspectoAcciones prospecto={prospecto} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

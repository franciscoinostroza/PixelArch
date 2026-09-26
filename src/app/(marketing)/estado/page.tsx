import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

export const metadata: Metadata = {
  title: "Estado del servicio — PixelArch",
  description: "Estado en vivo de la plataforma PixelArch: uptime, latencia e historial de incidentes de los últimos 90 días.",
  alternates: { canonical: "/estado" },
}

export const revalidate = 60

const ORDEN = ["Sitio web", "Blog", "API", "Base de datos"]

interface LatestRow {
  servicio: string
  ok: boolean
  statusCode: number | null
  latenciaMs: number
  creadoEn: Date
}

interface StatRow {
  servicio: string
  uptime: number
  avgLatencia: number
  total: number
}

interface DailyRow {
  day: Date
  allOk: boolean
  total: number
}

interface IncidentRow {
  day: Date
  servicios: string[]
  fallas: number
}

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return "hace instantes"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return `hace ${days} d`
}

export default async function EstadoPage() {
  let latest: LatestRow[] = []
  let stats: StatRow[] = []
  let daily: DailyRow[] = []
  let incidents: IncidentRow[] = []
  let dbError = false

  try {
    ;[latest, stats, daily, incidents] = await Promise.all([
      prisma.$queryRaw<LatestRow[]>`
        SELECT DISTINCT ON (servicio) servicio, ok, "statusCode", "latenciaMs", "creadoEn"
        FROM "UptimeCheck"
        ORDER BY servicio, "creadoEn" DESC
      `,
      prisma.$queryRaw<StatRow[]>`
        SELECT servicio,
               (AVG(CASE WHEN ok THEN 100.0 ELSE 0 END))::float AS uptime,
               (AVG("latenciaMs"))::float AS "avgLatencia",
               (COUNT(*))::int AS total
        FROM "UptimeCheck"
        WHERE "creadoEn" > now() - interval '90 days'
        GROUP BY servicio
      `,
      prisma.$queryRaw<DailyRow[]>`
        SELECT date_trunc('day', "creadoEn") AS day,
               bool_and(ok) AS "allOk",
               (COUNT(*))::int AS total
        FROM "UptimeCheck"
        WHERE "creadoEn" > now() - interval '90 days'
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.$queryRaw<IncidentRow[]>`
        SELECT date_trunc('day', "creadoEn") AS day,
               array_agg(DISTINCT servicio) AS servicios,
               (COUNT(*))::int AS fallas
        FROM "UptimeCheck"
        WHERE NOT ok AND "creadoEn" > now() - interval '90 days'
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 10
      `,
    ])
  } catch (e) {
    dbError = true
    logger.error("Error consultando el historial de uptime", { error: String(e) })
  }

  const now = new Date()
  const hasData = latest.length > 0

  const sortedLatest = [...latest].sort((a, b) => ORDEN.indexOf(a.servicio) - ORDEN.indexOf(b.servicio))
  const sortedStats = [...stats].sort((a, b) => ORDEN.indexOf(a.servicio) - ORDEN.indexOf(b.servicio))
  const statByService = new Map(sortedStats.map((s) => [s.servicio, s]))

  const allOk = hasData && sortedLatest.every((l) => l.ok)
  const failedServices = sortedLatest.filter((l) => !l.ok).map((l) => l.servicio)

  const totalChecks = sortedStats.reduce((acc, s) => acc + s.total, 0)
  const globalUptime = totalChecks > 0
    ? sortedStats.reduce((acc, s) => acc + s.uptime * s.total, 0) / totalChecks
    : null

  const lastCheck = sortedLatest.length > 0
    ? new Date(Math.max(...sortedLatest.map((l) => l.creadoEn.getTime())))
    : null

  const dailyMap = new Map(daily.map((d) => [new Date(d.day).toISOString().slice(0, 10), d.allOk]))
  const bars: { day: string; state: "ok" | "fail" | "empty" }[] = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    const val = dailyMap.get(key)
    bars.push({ day: key, state: val === undefined ? "empty" : val ? "ok" : "fail" })
  }

  return (
    <section className="estado" style={{ position: "relative", zIndex: 1, overflow: "hidden", padding: "clamp(88px, 10vw, 132px) 0", background: "rgba(7,6,12,0.88)", backdropFilter: "blur(3px)" }}>
      <div className="section-divider section-divider--cyan" aria-hidden="true" />
      <div className="section-band section-band--cyan" aria-hidden="true" />
      <div className="section-glow section-glow--cyan" style={{ width: "420px", height: "420px", right: "-140px", top: "4%" }} aria-hidden="true" />

      <div className="wrap" style={{ maxWidth: "var(--maxw, 1180px)", marginInline: "auto", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div className="section-head" style={{ maxWidth: "640px", marginBottom: "40px" }}>
          <p className="eyebrow">Estado del servicio</p>
          <h1 style={{ fontFamily: "var(--font-pixel-display)", fontWeight: 700, letterSpacing: 0, fontSize: "clamp(1.9rem, 3.6vw, 2.8rem)", marginBottom: "14px" }}>
            Todo lo que entregamos, monitoreado
          </h1>
          <p style={{ color: "var(--color-text-dim)", fontSize: "1.02rem", lineHeight: 1.7 }}>
            Esta página se alimenta de chequeos automáticos cada 10 minutos a los servicios de la plataforma. Es el mismo monitoreo que incluimos en cada plan.
          </p>
        </div>

        {dbError || !hasData ? (
          <div className="estado-empty">
            <span className="estado-empty-dot" aria-hidden="true" />
            <div>
              <h2>{dbError ? "No pudimos cargar el estado" : "Recolectando datos…"}</h2>
              <p>
                {dbError
                  ? "Hubo un problema consultando el historial. Probá de nuevo en unos minutos."
                  : "El monitoreo corre cada 10 minutos. En la próxima pasada vas a ver acá el estado y el historial de todos los servicios."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className={allOk ? "estado-hero ok" : "estado-hero fail"}>
              <div>
                <h2>{allOk ? "✅ Todos los sistemas operativos" : "⚠️ Servicios con problemas"}</h2>
                <p className="estado-hero-meta">
                  {allOk
                    ? `Última verificación: ${lastCheck ? relativeTime(lastCheck, now) : "—"} · chequeo automático cada 10 minutos`
                    : `Con fallas: ${failedServices.join(", ")}`}
                </p>
              </div>
              {globalUptime !== null && (
                <div style={{ textAlign: "right" }}>
                  <div className="estado-uptime">{globalUptime.toFixed(2)}%</div>
                  <p className="estado-uptime-label">UPTIME · ÚLTIMOS 90 DÍAS</p>
                </div>
              )}
            </div>

            <div className="estado-services">
              {sortedLatest.map((l) => {
                const stat = statByService.get(l.servicio)
                return (
                  <div key={l.servicio} className="estado-svc">
                    <span className={l.ok ? "estado-dot ok" : "estado-dot fail"} aria-hidden="true" />
                    <b>{l.servicio}</b>
                    <div className="estado-svc-meta">
                      <span>{l.latenciaMs} ms</span>
                      <span>{stat ? `${stat.uptime.toFixed(2)}%` : "—"}</span>
                      <span className="estado-svc-last">{relativeTime(new Date(l.creadoEn), now)}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <h3 className="estado-sub">Historial — últimos 90 días</h3>
            <div className="estado-bars" role="img" aria-label="Historial de disponibilidad de los últimos 90 días">
              {bars.map((b) => (
                <i key={b.day} className={`estado-bar ${b.state}`} title={`${b.day}: ${b.state === "ok" ? "operativo" : b.state === "fail" ? "con fallas" : "sin datos"}`} />
              ))}
            </div>
            <div className="estado-bars-legend">
              <span><i className="estado-bar ok" /> Operativo</span>
              <span><i className="estado-bar fail" /> Con fallas</span>
              <span><i className="estado-bar empty" /> Sin datos</span>
            </div>

            <h3 className="estado-sub">Incidentes</h3>
            {incidents.length === 0 ? (
              <p className="estado-no-incidents">Sin incidentes en los últimos 90 días 🎉</p>
            ) : (
              incidents.map((inc) => (
                <div key={new Date(inc.day).toISOString()} className="estado-incident">
                  <div className="estado-incident-head">
                    <span className="estado-incident-badge">Resuelto</span>
                    <span className="estado-incident-date">
                      {new Date(inc.day).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                  <p>
                    {inc.fallas} {inc.fallas === 1 ? "chequeo fallido" : "chequeos fallidos"} en: {inc.servicios.join(", ")}.
                  </p>
                </div>
              ))
            )}

            <p className="estado-note">
              Monitoreo propio: chequeos cada 10 minutos desde GitHub Actions a los endpoints de la plataforma, con historial de 120 días.
              ¿Querés este mismo nivel de monitoreo para tu proyecto? <a href="/#contacto">Hablemos</a>.
            </p>
          </>
        )}
      </div>

      <style>{`
        .estado-hero {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          border-radius: 18px;
          padding: 26px 30px;
          margin-bottom: 24px;
        }
        .estado-hero.ok {
          background: linear-gradient(160deg, rgba(52,211,153,0.08), rgba(17,14,26,0.6));
          border: 1px solid rgba(52,211,153,0.25);
        }
        .estado-hero.fail {
          background: linear-gradient(160deg, rgba(248,113,113,0.08), rgba(17,14,26,0.6));
          border: 1px solid rgba(248,113,113,0.3);
        }
        .estado-hero h2 { font-size: 1.3rem; margin-bottom: 6px }
        .estado-hero-meta { font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-text-dim) }
        .estado-uptime { font-size: 2.2rem; font-weight: 700; color: #34d399; letter-spacing: -0.02em }
        .estado-uptime-label { font-family: var(--font-mono); font-size: 0.62rem; color: var(--color-text-faint); letter-spacing: 0.1em }

        .estado-services { display: flex; flex-direction: column; gap: 10px }
        .estado-svc {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 15px 20px;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          background: rgba(17,14,26,0.6);
        }
        .estado-svc b { font-size: 0.92rem }
        .estado-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .estado-dot.ok { background: #34d399; box-shadow: 0 0 10px rgba(52,211,153,0.6) }
        .estado-dot.fail { background: #f87171; box-shadow: 0 0 10px rgba(248,113,113,0.6) }
        .estado-svc-meta {
          margin-left: auto;
          display: flex;
          gap: 22px;
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--color-text-dim);
        }
        .estado-svc-last { color: var(--color-text-faint) }

        .estado-sub { font-size: 1rem; margin: 34px 0 14px }
        .estado-bars {
          display: flex;
          gap: 2px;
          align-items: flex-end;
          height: 44px;
        }
        .estado-bar {
          flex: 1;
          height: 100%;
          border-radius: 2px;
          display: inline-block;
        }
        .estado-bar.ok { background: rgba(52,211,153,0.55) }
        .estado-bar.fail { background: rgba(248,113,113,0.8) }
        .estado-bar.empty { background: rgba(255,255,255,0.07) }
        .estado-bars-legend {
          display: flex;
          gap: 18px;
          margin-top: 10px;
          font-family: var(--font-mono);
          font-size: 0.64rem;
          color: var(--color-text-faint);
        }
        .estado-bars-legend span { display: inline-flex; align-items: center; gap: 7px }
        .estado-bars-legend .estado-bar { width: 12px; height: 12px; flex: none }

        .estado-no-incidents { color: var(--color-text-dim); font-size: 0.9rem }
        .estado-incident {
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          background: rgba(17,14,26,0.6);
          padding: 18px 22px;
          margin-bottom: 10px;
        }
        .estado-incident-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap }
        .estado-incident-badge {
          font-family: var(--font-mono);
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 600;
          background: rgba(52,211,153,0.12);
          color: #34d399;
          border: 1px solid rgba(52,211,153,0.3);
          padding: 3px 10px;
          border-radius: 999px;
        }
        .estado-incident-date { font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-text-faint) }
        .estado-incident p { color: var(--color-text-dim); font-size: 0.86rem; line-height: 1.6 }

        .estado-empty {
          display: flex;
          gap: 16px;
          align-items: flex-start;
          border: 1px solid rgba(34,211,238,0.25);
          border-radius: 16px;
          background: linear-gradient(160deg, rgba(34,211,238,0.06), rgba(17,14,26,0.5));
          padding: 24px 26px;
        }
        .estado-empty-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #22d3ee;
          box-shadow: 0 0 12px rgba(34,211,238,0.6);
          flex-shrink: 0;
          margin-top: 6px;
        }
        .estado-empty h2 { font-size: 1.1rem; margin-bottom: 6px }
        .estado-empty p { color: var(--color-text-dim); font-size: 0.9rem; line-height: 1.7 }

        .estado-note {
          margin-top: 36px;
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-faint);
          line-height: 1.8;
        }
        .estado-note a { color: #22d3ee; text-decoration: underline; text-underline-offset: 3px }

        @media (max-width: 640px) {
          .estado-svc { flex-wrap: wrap }
          .estado-svc-meta { margin-left: 23px; width: 100%; gap: 14px }
        }
      `}</style>
    </section>
  )
}
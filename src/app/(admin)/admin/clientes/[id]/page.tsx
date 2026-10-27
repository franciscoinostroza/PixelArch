import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { DeployConfig } from "@/components/ui/deploy-config"
import { EntregarButton } from "@/components/ui/entregar-button"
import { SubscriptionActions } from "@/components/ui/subscription-actions"
import { AsignarProductoButton } from "@/components/ui/asignar-producto-button"
import { EditarClienteButton } from "@/components/ui/editar-cliente-button"
import { NuevoProyectoButton } from "@/components/ui/nuevo-proyecto-button"
import { ProyectoBlock } from "@/components/ui/proyecto-block"
import { ActivarSoporteButton } from "@/components/ui/activar-soporte-button"
import { RegistrarPagoButton } from "@/components/ui/registrar-pago-button"
import { RegistrarPagoPaypalButton, type PaypalManualConcepto } from "@/components/ui/registrar-pago-paypal-button"
import { AjustePaypalButton, type AjustePaypalPago } from "@/components/ui/ajuste-paypal-button"
import { GenerarLinkMpButton } from "@/components/ui/generar-link-mp-button"
import { GenerarLinkPaypalButton } from "@/components/ui/generar-link-paypal-button"
import { AjustesSuscripcionButton } from "@/components/ui/ajustes-suscripcion-button"
import { PagoPaypalRow } from "@/components/ui/pago-paypal-row"
import { cn } from "@/lib/utils"
import { formatearMonto, precioDePlan, convertirUsdAArs } from "@/lib/pagos"
import { getDolarVentaBancoNacion } from "@/lib/dolar"
import { paypalConfig } from "@/lib/paypal/config"
import {
  datosPaypalEnlaces,
  esSoportePaypalElegible,
  paypalBlockDesdeConfig,
} from "@/lib/paypal/links-view"
import { mapearPagoHistorial } from "@/lib/paypal/view"
import {
  esPagoAjustablePaypal,
  montoDisponibleAjuste,
} from "@/lib/paypal/ajuste-view"

function mesesGuardados(valor: number | null | undefined): number {
  return typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor >= 1 &&
    valor <= 12
    ? valor
    : 1
}

const mapLabel = (e: string) => {
  switch (e) {
    case "ACTIVE": return "Activo"
    case "PAST_DUE": return "Vencido"
    case "CANCELED": return "Cancelado"
    case "PENDING": return "En desarrollo"
    case "READY": return "Entregado"
    case "PAUSED": return "Pausado"
    default: return e
  }
}

function pillOf(estado: string) {
  const label = mapLabel(estado)
  const cls =
    estado === "ACTIVE" || estado === "READY"
      ? "a-pill mint"
      : estado === "PAST_DUE"
        ? "a-pill red"
        : estado === "PENDING"
          ? "a-pill yellow"
          : "a-pill gray"
  return { cls, label }
}

export default async function ClienteDetalle({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const staff = await requireStaff()
  if (!staff) redirect("/admin")

  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: {
      suscripciones: {
        include: {
          servicio: { select: { nombre: true, precioUnico: true, precioBasico: true, precioMantenimiento: true } },
          enlacesPago: { where: { pasarela: "PAYPAL" }, orderBy: { creadoEn: "desc" } },
        },
        orderBy: { creadoEn: "desc" },
      },
      pagos: {
        orderBy: { creadoEn: "desc" },
        include: {
          suscripcion: { select: { servicio: { select: { nombre: true } } } },
          hito: { select: { titulo: true, proyecto: { select: { titulo: true } } } },
          // T-24: autor/envio del link, ajustes y eventos que exigen accion.
          // No se incluye al cliente ni email/telefono: el historial solo
          // muestra datos del pago y del staff que lo opero.
          enlacePago: {
            select: {
              concepto: true,
              descripcion: true,
              externalId: true,
              generadoPorNombre: true,
              enviadoPor: true,
              enviadoEn: true,
              canalEnvio: true,
              idioma: true,
              eventos: {
                where: { requiereAccion: true },
                orderBy: { creadoEn: "desc" },
                select: {
                  id: true,
                  tipo: true,
                  resultado: true,
                  motivo: true,
                  monto: true,
                  moneda: true,
                  creadoEn: true,
                },
              },
            },
          },
          ajustes: {
            orderBy: { creadoEn: "desc" },
            select: {
              id: true,
              tipo: true,
              monto: true,
              decision: true,
              motivo: true,
              creadoEn: true,
            },
          },
          eventos: {
            where: { requiereAccion: true },
            orderBy: { creadoEn: "desc" },
            select: {
              id: true,
              tipo: true,
              resultado: true,
              motivo: true,
              monto: true,
              moneda: true,
              creadoEn: true,
            },
          },
        },
      },
      proyectos: {
        include: {
          hitos: {
            orderBy: { orden: "asc" },
            include: {
              _count: { select: { pagos: true } },
              enlacesPago: { where: { pasarela: "PAYPAL" }, orderBy: { creadoEn: "desc" } },
            },
          },
          servicio: { select: { nombre: true } },
        },
        orderBy: { creadoEn: "desc" },
      },
    },
  })

  if (!cliente) notFound()

  const esAdmin = staff.esAdmin
  // PayPal lo opera todo el staff; el resto de acciones de gestion sigue
  // reservado al admin (RF-19/RF-24, plan §5.1).
  const puedeOperarPaypal = staff.rol === "admin" || staff.rol === "asistente"
  const paypal = paypalConfig()
  const paypalBlock = paypalBlockDesdeConfig(paypal)

  const [servicios, rate] = await Promise.all([
    prisma.servicio.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    getDolarVentaBancoNacion(),
  ])

  const pillCliente = cliente.activo ? { cls: "a-pill mint", label: "Cliente activo" } : { cls: "a-pill gray", label: "Inactivo" }

  // T-25: conceptos que el admin puede registrar a mano. Se listan hitos
  // pendientes y soportes elegibles para que el modal permita elegir entre
  // hito y soporte sin salir del detalle.
  const conceptosRegistroManual: PaypalManualConcepto[] = [
    ...cliente.proyectos.flatMap((proyecto) =>
      proyecto.hitos
        .filter((hito) => hito.estado === "PENDIENTE")
        .map((hito) => ({
          tipo: "hito" as const,
          hitoId: hito.id,
          titulo: `${proyecto.titulo} — ${hito.titulo}`,
          montoAcordadoCents: hito.monto,
        }))
    ),
    ...cliente.suscripciones
      .filter(
        (s) =>
          s.plan === "SOPORTE" &&
          (s.estado === "ACTIVE" || s.estado === "PAST_DUE")
      )
      .map((s) => {
        const precio = precioDePlan(s.plan, s.servicio, s.precioCustom)
        const meses = mesesGuardados(s.mpLinkMeses)
        return {
          tipo: "soporte" as const,
          suscripcionId: s.id,
          titulo: `Soporte ${s.servicio.nombre}`,
          montoAcordadoCents: precio * meses,
          montoMensualCents: precio,
          mesesDefault: meses,
        }
      }),
  ]

  return (
    <div>
      <div className="a-greet">
        <h1>{cliente.nombre}</h1>
        <p>{cliente.email}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
          {esAdmin && (
            <>
              <NuevoProyectoButton clienteId={cliente.id} servicios={servicios} />
              <AsignarProductoButton clienteId={cliente.id} servicios={servicios} />
              <EditarClienteButton cliente={{ id: cliente.id, nombre: cliente.nombre, email: cliente.email, empresa: cliente.empresa, telefono: cliente.telefono, notas: cliente.notas, activo: cliente.activo }} />
              {conceptosRegistroManual.length > 0 && (
                <RegistrarPagoPaypalButton
                  conceptos={conceptosRegistroManual}
                  feeBps={paypalBlock.feeBps}
                  feeFixedCents={paypalBlock.feeFixedCents}
                  puedeRegistrarManual={esAdmin}
                  ariaLabel={`Registrar pago PayPal — ${cliente.nombre}`}
                />
              )}
            </>
          )}
          <span className={cn("a-pill", pillCliente.cls)}><i />{pillCliente.label}</span>
        </div>
      </div>

      <div className="a-panel">
        <div className="a-head"><h3>Datos</h3></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Empresa</div>
            <div>{cliente.empresa || "—"}</div>
          </div>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Teléfono</div>
            <div>{cliente.telefono || "—"}</div>
          </div>
          <div>
            <div className="a-faint" style={{ marginBottom: 4 }}>Registrado</div>
            <div>{new Date(cliente.creadoEn).toLocaleDateString("es-AR")}</div>
          </div>
        </div>
        {cliente.notas && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="a-faint" style={{ marginBottom: 6 }}>Notas internas</div>
            <p style={{ fontSize: ".86rem", color: "var(--color-text-dim)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{cliente.notas}</p>
          </div>
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Proyectos</h3>
          <span className="a-faint">{cliente.proyectos.length}</span>
        </div>
        {cliente.proyectos.length === 0 ? (
          <p className="a-empty">Sin proyectos — creá el primero con &quot;Nuevo proyecto&quot;</p>
        ) : (
          <div style={{ marginTop: -18 }}>
            {cliente.proyectos.map((p) => (
              <ProyectoBlock
                key={p.id}
                proyecto={p}
                rate={rate}
                clienteTelefono={cliente.telefono}
                puedeGestionar={esAdmin}
                puedeOperarPaypal={puedeOperarPaypal}
                paypal={paypalBlock}
              />
            ))}
          </div>
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18 }}>
        <div className="a-head">
          <h3>Suscripciones (soporte)</h3>
          <span className="a-faint">{cliente.suscripciones.length}</span>
          {esAdmin && <ActivarSoporteButton clienteId={cliente.id} servicios={servicios} />}
        </div>
        {cliente.suscripciones.length === 0 ? (
          <p className="a-empty">Sin suscripciones</p>
        ) : (
          cliente.suscripciones.map((s) => {
            const pill = pillOf(s.estado)
            const precio = precioDePlan(s.plan, s.servicio, s.precioCustom)
            const precioArs = rate ? convertirUsdAArs(precio, rate) : null
            const paypalSoporte = datosPaypalEnlaces(s.enlacesPago)
            const soportePaypalElegible = esSoportePaypalElegible(s)
            return (
              <div key={s.id} className="a-prow" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div className="a-name">
                      {s.servicio.nombre}
                      {s.plan && <span style={{ color: "var(--color-text-dim)", fontWeight: 500, marginLeft: 8 }}>· {s.plan === "UNICO" ? "Pago único" : s.plan === "BASICO" ? "Básico" : s.plan === "SOPORTE" ? "Soporte" : "Mantenimiento"}</span>}
                    </div>
                    <div className="a-date">
                      {formatearMonto(precio, "usd")}
                      {s.plan === "UNICO" ? " pago único" : "/mes"}
                      {s.precioCustom ? " · acordado" : ""}
                      {s.proximoPago ? ` · vence ${new Date(s.proximoPago).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : ""}
                    </div>
                    {paypalSoporte.resumen && (
                      <div className="a-date" style={{ color: "var(--color-text-faint)" }}>
                        {paypalSoporte.resumen}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span className={cn("a-pill", pill.cls)}><i />{pill.label}</span>
                    {soportePaypalElegible && puedeOperarPaypal && (
                      <GenerarLinkPaypalButton
                        concepto={{ tipo: "soporte", suscripcionId: s.id, titulo: `Soporte ${s.servicio.nombre}` }}
                        montoAcordadoDefaultCents={precio}
                        montoMensualCents={precio}
                        mesesDefault={s.mpLinkMeses ?? 1}
                        feeBps={paypalBlock.feeBps}
                        feeFixedCents={paypalBlock.feeFixedCents}
                        paypalDisponible={paypalBlock.disponible}
                        enlaceExistente={paypalSoporte.enlaceExistente}
                        ultimoIntento={paypalSoporte.ultimoIntento}
                        clienteTelefono={cliente.telefono}
                        label="PayPal"
                        ariaLabel={`PayPal — Soporte ${s.servicio.nombre}`}
                      />
                    )}
                    {esAdmin && (
                      <>
                        {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                          <RegistrarPagoButton
                            suscripcionId={s.id}
                            servicio={s.servicio.nombre}
                            cliente={cliente.nombre}
                            precioUsd={precio}
                            precioArs={precioArs}
                            puedeRegistrar={esAdmin}
                          />
                        )}
                        {(s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                          <GenerarLinkMpButton
                            suscripcionId={s.id}
                            servicio={s.servicio.nombre}
                            cliente={cliente.nombre}
                            precioUsd={precio}
                            precioArs={precioArs}
                            clienteTelefono={cliente.telefono}
                            linkGuardado={s.mpLink}
                            linkExpira={s.mpLinkExpira ? new Date(s.mpLinkExpira).toISOString() : null}
                            mesesGuardados={s.mpLinkMeses}
                          />
                        )}
                        {s.estado !== "PENDING" && <SubscriptionActions suscripcionId={s.id} estado={s.estado} deploymentPlatform={s.deploymentPlatform} platformServiceId={s.platformServiceId} />}
                        {s.estado !== "PENDING" && (
                          <AjustesSuscripcionButton
                            suscripcionId={s.id}
                            precioCustom={s.precioCustom}
                            proximoPago={s.proximoPago ? s.proximoPago.toISOString() : null}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
                {esAdmin && s.estado === "PENDING" && (
                  <div style={{ marginTop: 10 }}>
                    <EntregarButton suscripcionId={s.id} />
                  </div>
                )}
                {esAdmin && (s.estado === "ACTIVE" || s.estado === "PAST_DUE") && (
                  <div style={{ marginTop: 10 }}>
                    <DeployConfig
                      suscripcionId={s.id}
                      deploymentId={s.deploymentId}
                      deploymentPlatform={s.deploymentPlatform}
                      platformServiceId={s.platformServiceId}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="a-panel" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="a-head" style={{ padding: "18px 22px 0" }}>
          <h3>Historial de pagos</h3>
          <span className="a-faint">{cliente.pagos.length}</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <caption className="sr-only">
              Historial de pagos con desglose, envío, revisión y recibo
            </caption>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Pasarela</th>
                <th>Fecha</th>
                <th>Desglose</th>
                <th>Envío / autor</th>
                <th>Estado / revisión</th>
                <th>Recibo</th>
                {esAdmin && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {cliente.pagos.length === 0 ? (
                <tr><td colSpan={7} className="a-empty">Sin pagos registrados</td></tr>
              ) : (
                cliente.pagos.map((p) => {
                  const eventos = [
                    ...(p.eventos ?? []),
                    ...(p.enlacePago?.eventos ?? []),
                  ].filter(
                    (evento, indice, todos) =>
                      todos.findIndex((otro) => otro.id === evento.id) === indice
                  )
                  // T-26: el boton solo se ofrece al admin sobre pagos PayPal
                  // ajustables; la API vuelve a validar rol, estado y monto.
                  const historial = mapearPagoHistorial(p)
                  const pagoAjuste: AjustePaypalPago = {
                    id: p.id,
                    monto: p.monto,
                    moneda: p.moneda,
                    montoAjustado: p.ajustes.reduce(
                      (total, ajuste) => total + ajuste.monto,
                      0
                    ),
                    tieneHito: Boolean(p.hitoId),
                    tieneSoporte: Boolean(p.suscripcionId),
                    estadoPago: p.estadoPago,
                    revisionEstado: p.revisionEstado,
                    concepto: historial.concepto.titulo,
                    referencia:
                      historial.referencias.principal?.etiqueta ?? null,
                    pasarela: p.pasarela,
                  }
                  const accion = esAdmin ? (
                    esPagoAjustablePaypal(pagoAjuste) &&
                    montoDisponibleAjuste(pagoAjuste) > 0 ? (
                      <AjustePaypalButton
                        pago={pagoAjuste}
                        puedeRegistrarAjuste
                        ariaLabel={`Ajuste — ${historial.concepto.titulo}`}
                      />
                    ) : (
                      <span className="a-faint">—</span>
                    )
                  ) : undefined

                  return (
                    <PagoPaypalRow
                      key={p.id}
                      pago={historial}
                      ajustes={p.ajustes}
                      eventos={eventos}
                      accion={accion}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
import { formatearMonto } from "@/lib/pagos"

export interface HitoResumen {
  cliente: string
  proyecto: string
  titulo: string
  monto: number
  vencimiento: Date | null
}

export interface SoporteResumen {
  cliente: string
  servicio: string
  monto: number
  proximoPago: Date | null
}

export interface PagoResumen {
  cliente: string
  monto: number
  moneda: string
  descripcion: string
}

export interface DigestData {
  hitosVencidos: HitoResumen[]
  hitosPorVencer: HitoResumen[]
  hitosSinFecha: HitoResumen[]
  soportesVencidos: SoporteResumen[]
  soportesPorVencer: SoporteResumen[]
  pagos24h: PagoResumen[]
}

function fecha(d: Date): string {
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  })
}

function lineaHito(h: HitoResumen): string {
  const venc = h.vencimiento ? `vence ${fecha(h.vencimiento)}` : "sin fecha"
  return `- ${h.cliente} · ${h.proyecto} · ${h.titulo}: ${formatearMonto(h.monto, "usd")} (${venc})`
}

function lineaSoporte(s: SoporteResumen): string {
  const venc = s.proximoPago ? `vence ${fecha(s.proximoPago)}` : "sin fecha"
  return `- ${s.cliente} · Soporte ${s.servicio}: ${formatearMonto(s.monto, "usd")}/mes (${venc})`
}

export function armarDigest(data: DigestData): { subject: string; text: string } {
  const vencidos = data.hitosVencidos.length + data.soportesVencidos.length
  const porVencer = data.hitosPorVencer.length + data.soportesPorVencer.length

  const totalUsd =
    [...data.hitosVencidos, ...data.hitosPorVencer, ...data.hitosSinFecha].reduce((s, h) => s + h.monto, 0) +
    [...data.soportesVencidos, ...data.soportesPorVencer].reduce((s, x) => s + x.monto, 0)

  const cobradoUsd = data.pagos24h.filter((p) => p.moneda === "usd").reduce((s, p) => s + p.monto, 0)
  const cobradoArs = data.pagos24h.filter((p) => p.moneda === "ars").reduce((s, p) => s + p.monto, 0)

  const subject =
    vencidos > 0
      ? `📋 Cobros PixelArch — ${vencidos} vencido${vencidos === 1 ? "" : "s"} · ${formatearMonto(totalUsd, "usd")} pendiente`
      : porVencer > 0
        ? `📋 Cobros PixelArch — ${porVencer} por vencer esta semana`
        : `✅ Cobros PixelArch — sin pendientes (${fecha(new Date())})`

  const lineas: string[] = []
  lineas.push(`Resumen diario de cobros — ${fecha(new Date())}`)
  lineas.push("")

  if (vencidos > 0) {
    lineas.push(`🔴 VENCIDOS (${vencidos})`)
    data.hitosVencidos.forEach((h) => lineas.push(lineaHito(h)))
    data.soportesVencidos.forEach((s) => lineas.push(lineaSoporte(s)))
    lineas.push("")
  }

  if (porVencer > 0) {
    lineas.push(`🟡 POR VENCER — próximos 7 días (${porVencer})`)
    data.hitosPorVencer.forEach((h) => lineas.push(lineaHito(h)))
    data.soportesPorVencer.forEach((s) => lineas.push(lineaSoporte(s)))
    lineas.push("")
  }

  if (data.hitosSinFecha.length > 0) {
    lineas.push(`⚪ HITOS SIN FECHA (${data.hitosSinFecha.length})`)
    data.hitosSinFecha.forEach((h) => lineas.push(lineaHito(h)))
    lineas.push("")
  }

  if (vencidos === 0 && porVencer === 0 && data.hitosSinFecha.length === 0) {
    lineas.push("Sin cobros pendientes ni vencimientos próximos. 🎉")
    lineas.push("")
  }

  if (data.pagos24h.length > 0) {
    lineas.push(`✅ COBRADO ÚLTIMAS 24H (${data.pagos24h.length})`)
    data.pagos24h.forEach((p) => lineas.push(`- ${p.cliente} · ${p.descripcion}: ${formatearMonto(p.monto, p.moneda)}`))
    lineas.push("")
  }

  const totales: string[] = []
  if (totalUsd > 0) totales.push(`pendiente US$${(totalUsd / 100).toFixed(2)}`)
  if (cobradoUsd > 0) totales.push(`cobrado 24h US$${(cobradoUsd / 100).toFixed(2)}`)
  if (cobradoArs > 0) totales.push(`cobrado 24h $${Math.round(cobradoArs / 100).toLocaleString("es-AR")} ARS`)
  if (totales.length > 0) {
    lineas.push(`Totales: ${totales.join(" · ")}`)
    lineas.push("")
  }

  lineas.push("Ver en el panel: https://pixelarch.dev/admin/cobros")

  return { subject, text: lineas.join("\n") }
}

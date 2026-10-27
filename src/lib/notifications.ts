import { resend } from "@/lib/resend"
import { logger } from "@/lib/logger"
import { formatearMonto } from "@/lib/pagos"

const FROM = "PixelArch <noreply@pixelarch.dev>"

function alertRecipient(): string | undefined {
  return process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL
}

function ahoraTexto(): string {
  return new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
}

async function sendEmail(to: string, subject: string, text: string) {
  const r = resend()
  if (!r) return
  try {
    await r.emails.send({ from: FROM, to, subject, text })
  } catch (e) {
    logger.error("Error sending email", { error: String(e) })
  }
}

export type ResultadoEnvioPaypalEmail = "ENVIADO" | "NO_CONFIGURADO" | "ERROR"

/**
 * Envia el email canonico de un cobro PayPal (T-09, AC-3).
 *
 * A diferencia de `sendEmail`, devuelve el resultado para que la ruta solo
 * registre `enviadoPor`/`enviadoEn`/`canalEnvio`/`idioma` cuando Resend confirma
 * el envio. No loguea el destinatario ni el asunto: el asunto incluye el
 * concepto del cliente y el email es PII.
 */
export async function sendPaypalPaymentEmail(params: {
  to: string
  asunto: string
  cuerpo: string
}): Promise<ResultadoEnvioPaypalEmail> {
  const r = resend()
  if (!r) return "NO_CONFIGURADO"

  try {
    const { error } = await r.emails.send({
      from: FROM,
      to: params.to,
      subject: params.asunto,
      text: params.cuerpo,
    })

    if (error) {
      logger.error("Error sending PayPal payment email", { error: error.name })
      return "ERROR"
    }

    return "ENVIADO"
  } catch (e) {
    logger.error("Error sending PayPal payment email", {
      error: e instanceof Error ? e.name : "Error desconocido",
    })
    return "ERROR"
  }
}

export async function sendPaymentReceipt(
  email: string,
  nombre: string,
  monto: number,
  moneda: string,
  servicio: string
) {
  if (!process.env.RESEND_API_KEY) return
  await sendEmail(
    email,
    `Recibo de pago — ${servicio}`,
    `Hola ${nombre},\n\nTu pago de ${formatearMonto(monto, moneda)} por ${servicio} fue procesado exitosamente.\n\nSaludos,\nEquipo PixelArch`
  )
}

export async function sendPaymentReminder(
  email: string,
  nombre: string,
  servicio: string,
  montoTexto: string,
  fechaTexto: string
) {
  if (!process.env.RESEND_API_KEY) return
  await sendEmail(
    email,
    `Recordatorio de pago — ${servicio}`,
    `Hola ${nombre},\n\nTe recordamos que el plan de ${servicio} tiene un pago pendiente de ${montoTexto} con vencimiento ${fechaTexto}.\n\nCuando quieras te pasamos los datos para el pago respondiendo este correo o por WhatsApp.\n\nSaludos,\nEquipo PixelArch`
  )
}

export async function sendUptimeAlert(servicio: string, statusCode: number | null, latenciaMs: number) {
  if (!process.env.RESEND_API_KEY) return
  const to = alertRecipient()
  if (!to) return
  const detalle = statusCode ? `HTTP ${statusCode}` : "sin respuesta"
  await sendEmail(
    to,
    `🔴 ${servicio} no responde — PixelArch`,
    `El servicio "${servicio}" no está respondiendo.\n\nDetalle: ${detalle} (${latenciaMs}ms)\nChequeado: ${ahoraTexto()}\n\nVas a recibir un aviso cuando se recupere.\nEstado: https://pixelarch.dev/estado`
  )
}

export async function sendUptimeRecovery(servicio: string) {
  if (!process.env.RESEND_API_KEY) return
  const to = alertRecipient()
  if (!to) return
  await sendEmail(
    to,
    `🟢 ${servicio} se recuperó — PixelArch`,
    `El servicio "${servicio}" volvió a responder normalmente.\n\nChequeado: ${ahoraTexto()}\nEstado: https://pixelarch.dev/estado`
  )
}
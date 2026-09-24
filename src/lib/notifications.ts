import { resend } from "@/lib/resend"
import { logger } from "@/lib/logger"

const FROM = "PixelArch <noreply@pixelarch.dev>"

async function sendEmail(to: string, subject: string, text: string) {
  const r = resend()
  if (!r) return
  try {
    await r.emails.send({ from: FROM, to, subject, text })
  } catch (e) {
    logger.error("Error sending email", { error: String(e) })
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
  const formatted = (monto / 100).toFixed(2)
  await sendEmail(
    email,
    `Recibo de pago — ${servicio}`,
    `Hola ${nombre},\n\nTu pago de $${formatted} ${moneda.toUpperCase()} por ${servicio} fue procesado exitosamente.\n\nSaludos,\nEquipo PixelArch`
  )
}
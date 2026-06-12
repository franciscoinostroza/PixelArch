import { resend } from "@/lib/resend"

const FROM = "PixelArch <noreply@pixelarch.dev>"

async function sendEmail(to: string, subject: string, text: string) {
  const r = resend()
  if (!r) return
  try {
    await r.emails.send({ from: FROM, to, subject, text })
  } catch (e) {
    console.error("Error sending email:", e)
  }
}

export async function sendWelcomeEmail(email: string, nombre: string) {
  if (!process.env.RESEND_API_KEY) return
  await sendEmail(
    email,
    "Bienvenido a PixelArch",
    `Hola ${nombre},\n\nGracias por registrarte en PixelArch. Ya podes explorar nuestros productos y contratar el que mejor se adapte a tu negocio.\n\nSaludos,\nEquipo PixelArch`
  )
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

export async function sendPaymentFailed(
  email: string,
  nombre: string,
  servicio: string
) {
  if (!process.env.RESEND_API_KEY) return
  await sendEmail(
    email,
    "Pago rechazado — actualiza tu metodo de pago",
    `Hola ${nombre},\n\nTu pago por ${servicio} fue rechazado. Por favor actualiza tu metodo de pago en el portal para evitar la interrupcion del servicio.\n\nSaludos,\nEquipo PixelArch`
  )
}

export async function sendSubscriptionCanceled(
  email: string,
  nombre: string,
  servicio: string
) {
  if (!process.env.RESEND_API_KEY) return
  await sendEmail(
    email,
    `Suscripcion cancelada — ${servicio}`,
    `Hola ${nombre},\n\nTu suscripcion a ${servicio} fue cancelada. Si fue un error, podes volver a contratarla cuando quieras desde nuestro catalogo.\n\nVer productos: ${process.env.NEXT_PUBLIC_URL}/productos\n\nSaludos,\nEquipo PixelArch`
  )
}

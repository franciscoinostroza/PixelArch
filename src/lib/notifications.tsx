import { render } from "@react-email/components"
import { resend } from "@/lib/resend"
import { logger } from "@/lib/logger"
import WelcomeEmail from "@/emails/welcome"
import PaymentReceipt from "@/emails/payment-receipt"
import PaymentFailed from "@/emails/payment-failed"
import SubscriptionCanceled from "@/emails/subscription-canceled"
import ProjectReady from "@/emails/project-ready"

const FROM = "PixelArch <hola@pixelarch.dev>"
const REPLY_TO = "hola@pixelarch.dev"

async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const r = resend()
  if (!r) return
  try {
    await r.emails.send({ from: FROM, to, replyTo: REPLY_TO, subject, html, text })
  } catch (e) {
    logger.error("Error sending email", { error: String(e), to, subject })
  }
}

export async function sendWelcomeEmail(email: string, nombre: string) {
  if (!process.env.RESEND_API_KEY) return
  const html = await render(<WelcomeEmail nombre={nombre} />)
  await sendEmail(
    email,
    "Bienvenido a PixelArch",
    html,
    `Hola ${nombre},\n\nGracias por registrarte en PixelArch. Ya podes explorar nuestros productos y contratar el que mejor se adapte a tu negocio.\n\nVer productos: ${process.env.NEXT_PUBLIC_URL}/productos\n\nEquipo PixelArch`,
  )
}

export async function sendPaymentReceipt(
  email: string,
  nombre: string,
  monto: number,
  moneda: string,
  servicio: string,
) {
  if (!process.env.RESEND_API_KEY) return
  const formatted = (monto / 100).toFixed(2)
  const html = await render(
    <PaymentReceipt nombre={nombre} monto={formatted} moneda={moneda.toUpperCase()} servicio={servicio} />,
  )
  await sendEmail(
    email,
    `Recibo de pago — ${servicio}`,
    html,
    `Hola ${nombre},\n\nRecibimos tu pago de ${formatted} ${moneda.toUpperCase()} por ${servicio}.\n\nGracias por confiar en PixelArch.\n\nEquipo PixelArch`,
  )
}

export async function sendPaymentFailed(
  email: string,
  nombre: string,
  servicio: string,
) {
  if (!process.env.RESEND_API_KEY) return
  const html = await render(<PaymentFailed nombre={nombre} servicio={servicio} />)
  await sendEmail(
    email,
    "Pago rechazado — actualiza tu metodo de pago",
    html,
    `Hola ${nombre},\n\nTu pago por ${servicio} fue rechazado. Por favor actualiza tu metodo de pago en el portal para evitar la interrupcion del servicio.\n\nActualizar metodo: ${process.env.NEXT_PUBLIC_URL}/portal/facturacion\n\nEquipo PixelArch`,
  )
}

export async function sendSubscriptionCanceled(
  email: string,
  nombre: string,
  servicio: string,
) {
  if (!process.env.RESEND_API_KEY) return
  const html = await render(<SubscriptionCanceled nombre={nombre} servicio={servicio} />)
  await sendEmail(
    email,
    `Suscripcion cancelada — ${servicio}`,
    html,
    `Hola ${nombre},\n\nTu suscripcion a ${servicio} fue cancelada. Si fue un error, podes volver a contratarla cuando quieras desde nuestro catalogo.\n\nVer productos: ${process.env.NEXT_PUBLIC_URL}/productos\n\nEquipo PixelArch`,
  )
}

export async function sendProjectReady(
  email: string,
  nombre: string,
  proyecto: string,
  url?: string,
) {
  if (!process.env.RESEND_API_KEY) return
  const html = await render(<ProjectReady nombre={nombre} proyecto={proyecto} url={url} />)
  await sendEmail(
    email,
    "Tu proyecto esta listo",
    html,
    `Hola ${nombre},\n\nTu proyecto "${proyecto}" esta listo.${url ? `\n\nPodes verlo en: ${url}` : ""}\n\nEquipo PixelArch`,
  )
}

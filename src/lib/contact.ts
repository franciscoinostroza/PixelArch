export const WHATSAPP_NUMBER = "5491132464045"
export const WHATSAPP_MESSAGE = "Hola! Vengo de pixelarch.dev y quiero hacer una consulta."
export const AUDIT_MESSAGE = "Hola! Vi pixelarch.dev y quiero mi auditoría gratuita."

export function whatsappUrl(message?: string): string {
  const text = encodeURIComponent(message ?? WHATSAPP_MESSAGE)
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`
}

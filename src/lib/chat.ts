export type ChatIntent =
  | "precios"
  | "tiempos"
  | "cancelar"
  | "moneda"
  | "hosting"
  | "humano"

export interface ChatAnswer {
  intent: ChatIntent
  text: string
  whatsapp?: boolean
}

export const CHAT_ANSWERS: Record<ChatIntent, ChatAnswer> = {
  precios: {
    intent: "precios",
    text: "Los planes van desde US$15/mes (una landing) hasta US$45/mes (automatizaciones). Todos incluyen hosting, SSL y soporte. ¿Querés los detalles por WhatsApp?",
  },
  tiempos: {
    intent: "tiempos",
    text: "Una landing: 1 a 2 semanas. Un sitio web completo: 3 a 6 semanas. Un agente de IA: 4 a 8 semanas. Con cronograma al arrancar.",
  },
  cancelar: {
    intent: "cancelar",
    text: "Podés cancelar desde tu portal con 7 días de aviso. Sin permanencia ni penalidades.",
  },
  moneda: {
    intent: "moneda",
    text: "El cobro se realiza en USD. En la web ves el equivalente en ARS según el dólar del día.",
  },
  hosting: {
    intent: "hosting",
    text: "Cada plan mensual incluye hosting, SSL, monitoreo activo y soporte continuo.",
  },
  humano: {
    intent: "humano",
    text: "¡Dale! Te paso con una persona. Escribinos por WhatsApp y te respondemos en menos de 24hs.",
    whatsapp: true,
  },
}

const FALLBACK_ANSWER: ChatAnswer = {
  intent: "humano",
  text: "Buena consulta. Para darte una respuesta exacta, escribinos por WhatsApp y te respondemos en menos de 24hs.",
  whatsapp: true,
}

const RULES: { intents: ChatIntent[]; pattern: RegExp }[] = [
  { intents: ["humano"], pattern: /(humano|persona|hablar|asesor|real|agente humano)/ },
  { intents: ["precios"], pattern: /(precio|precios|costo|tarifa|cuesta|plan|valor|usd|ars|presupuesto)/ },
  { intents: ["tiempos"], pattern: /(cuanto|cuánto|tarda|demora|tiempo|tiempos|entrega|plazo|semanas|dias|días)/ },
  { intents: ["cancelar"], pattern: /(cancel|cancela|cancelo|baja|dejar|terminar|salir)/ },
  { intents: ["moneda"], pattern: /(moneda|dolar|dólar|dolares|dólares|peso|pago|factura)/ },
  { intents: ["hosting"], pattern: /(hosting|soporte|mantenimiento|ssl|monitoreo|incluye)/ },
]

export function matchIntent(input: string): ChatAnswer {
  const text = input.toLowerCase()
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return CHAT_ANSWERS[rule.intents[0]]
    }
  }
  return FALLBACK_ANSWER
}

export const CHAT_QUICK_REPLIES: { label: string; answer: ChatAnswer }[] = [
  { label: "Precios", answer: CHAT_ANSWERS.precios },
  { label: "Tiempos", answer: CHAT_ANSWERS.tiempos },
  { label: "Cancelar", answer: CHAT_ANSWERS.cancelar },
  { label: "Moneda", answer: CHAT_ANSWERS.moneda },
  { label: "Hablar con alguien", answer: CHAT_ANSWERS.humano },
]

export const CHAT_GREETING = "¡Hola! 👋 Soy el demo del bot que también ofrecemos. Preguntame por precios, tiempos o cómo se cancela — o toca un atajo."
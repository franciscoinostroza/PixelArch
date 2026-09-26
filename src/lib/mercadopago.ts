import { MercadoPagoConfig, Preference, Payment } from "mercadopago"

let _client: MercadoPagoConfig | null = null

export function mpClient(): MercadoPagoConfig | null {
  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) return null
  if (!_client) {
    _client = new MercadoPagoConfig({ accessToken })
  }
  return _client
}

export interface LinkPagoInput {
  externalReference: string
  titulo: string
  montoArsCents: number
  metadata: Record<string, unknown>
  expiraEn?: Date
}

export async function crearLinkDePago(input: LinkPagoInput): Promise<{ url: string; preferenceId: string } | null> {
  const client = mpClient()
  if (!client) return null

  const base = process.env.NEXT_PUBLIC_URL || "https://pixelarch.dev"
  const preference = new Preference(client)

  const result = await preference.create({
    body: {
      items: [
        {
          id: input.externalReference,
          title: input.titulo,
          quantity: 1,
          unit_price: Math.round(input.montoArsCents) / 100,
          currency_id: "ARS",
        },
      ],
      external_reference: input.externalReference,
      metadata: input.metadata,
      notification_url: `${base}/api/webhooks/mercadopago`,
      back_urls: {
        success: `${base}/gracias`,
        pending: `${base}/gracias`,
        failure: `${base}/gracias`,
      },
      auto_return: "approved",
      statement_descriptor: "PIXELARCH",
      ...(input.expiraEn
        ? {
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: input.expiraEn.toISOString(),
          }
        : {}),
    },
  })

  if (!result.init_point) return null
  return { url: result.init_point, preferenceId: String(result.id) }
}

export interface PagoMp {
  id: string
  status: string | null
  externalReference: string | null
  transactionAmount: number | null
  tipo: string | null
  meses: number
}

export async function obtenerPagoMp(id: string): Promise<PagoMp | null> {
  const client = mpClient()
  if (!client) return null

  const payment = new Payment(client)
  const p = await payment.get({ id })

  const metadata = (p.metadata || {}) as Record<string, unknown>
  const mesesRaw = Number(metadata.meses)

  return {
    id: String(p.id),
    status: p.status ?? null,
    externalReference: p.external_reference ?? null,
    transactionAmount: typeof p.transaction_amount === "number" ? p.transaction_amount : null,
    tipo: typeof metadata.tipo === "string" ? metadata.tipo : null,
    meses: Number.isFinite(mesesRaw) ? mesesRaw : 1,
  }
}
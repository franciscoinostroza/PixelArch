const COMPARADOLAR_URL = "https://api.comparadolar.ar/usd"
const REVALIDATE_SECONDS = 3600

interface ComparaDolarProvider {
  slug: string
  bid: number | null
  ask: number | null
}

export async function getDolarVentaBancoNacion(): Promise<number | null> {
  try {
    const res = await fetch(COMPARADOLAR_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const providers = (await res.json()) as ComparaDolarProvider[]
    const bancoNacion = providers.find((p) => p.slug === "banco-nacion")
    const ask = bancoNacion?.ask ?? null
    return typeof ask === "number" && ask > 0 ? ask : null
  } catch {
    return null
  }
}

export function formatARS(centsUSD: number, rate: number): string {
  const ars = (centsUSD / 100) * rate
  const rounded = Math.ceil(ars / 500) * 500
  return `$${rounded.toLocaleString("es-AR")}`
}

export function formatUSD(cents: number): string {
  if (!cents) return "US$0"
  return `US$${(cents / 100).toFixed(0)}`
}

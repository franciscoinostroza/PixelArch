import { createClient } from "next-sanity"

let _client: ReturnType<typeof createClient> | null = null

function getClient() {
  if (_client) return _client

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production"

  if (!projectId || projectId === "") {
    _client = null as never
    return null
  }

  _client = createClient({
    projectId,
    dataset,
    apiVersion: "2024-01-01",
    useCdn: process.env.NODE_ENV === "production",
  })
  return _client
}

export async function sanityFetch<T>(
  query: string,
  params?: Record<string, unknown>
): Promise<T | null> {
  const client = getClient()
  if (!client) return null

  return client.fetch<T>(query, params || {}, {
    next: { revalidate: 60 },
  })
}

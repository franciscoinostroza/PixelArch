/**
 * Migra todos los usuarios de Clerk a la BD de Prisma
 * Uso: npx tsx src/scripts/sync-clerk-users.ts
 */
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const CLERK_KEY = process.env.CLERK_SECRET_KEY
const DATABASE_URL = process.env.DATABASE_URL

if (!CLERK_KEY) throw new Error("CLERK_SECRET_KEY no configurada")
if (!DATABASE_URL) throw new Error("DATABASE_URL no configurada")

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
})

async function fetchAllClerkUsers() {
  const users: unknown[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const res = await fetch(
      `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}&order_by=-created_at`,
      {
        headers: {
          Authorization: `Bearer ${CLERK_KEY}`,
          "Content-Type": "application/json",
        },
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Clerk API error: ${res.status} ${text}`)
    }

    const data: unknown[] = await res.json()
    if (!Array.isArray(data)) throw new Error("Unexpected Clerk API response")

    users.push(...data)
    console.log(`  Fetched ${data.length} users`)

    if (data.length < limit) break
    offset += limit
  }

  return users as Array<{
    id: string
    email_addresses: Array<{ email_address: string }>
    first_name: string | null
    last_name: string | null
    public_metadata: { role?: string }
  }>
}

async function sync() {
  console.log("Fetching Clerk users...")
  const users = await fetchAllClerkUsers()
  console.log(`\nFound ${users.length} users. Syncing...\n`)

  let created = 0
  let updated = 0

  for (const u of users) {
    const email = u.email_addresses?.[0]?.email_address ?? ""
    const nombre = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || email
    const role = (u.public_metadata as { role?: string } | undefined)?.role ?? "cliente"

    const existing = await prisma.cliente.findUnique({
      where: { clerkUserId: u.id },
    })

    if (existing) {
      await prisma.cliente.update({
        where: { clerkUserId: u.id },
        data: { email, nombre },
      })
      updated++
    } else {
      await prisma.cliente.create({
        data: { clerkUserId: u.id, email, nombre, activo: true },
      })
      created++
    }

    console.log(`  ${role === "admin" ? "🔧" : "👤"} ${nombre} (${email})${role === "admin" ? " [ADMIN]" : ""}`)
  }

  console.log(`\nDone. ${created} created, ${updated} updated.`)
  await prisma.$disconnect()
}

sync()

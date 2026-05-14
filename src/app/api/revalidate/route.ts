import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const secret = req.headers.get("x-revalidate-secret")

  if (secret !== process.env.SANITY_REVALIDATE_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  revalidatePath("/", "layout")
  revalidatePath("/servicios", "layout")

  return NextResponse.json({ revalidated: true })
}

import { NextResponse } from "next/server"

interface GoogleReview {
  author: string
  avatar: string
  rating: number
  text: string
  time: number
}

const CID = "0x28e46b0532f441a3"

export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?cid=${encodeURIComponent(CID)}&fields=place_id,rating,user_ratings_total,name,reviews&key=${apiKey}&language=en`

    const res = await fetch(url)
    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Places API failed: ${err}` }, { status: res.status })
    }

    const data = await res.json()
    if (data.status !== "OK" || !data.result) {
      return NextResponse.json({ error: `Place not found: ${data.status}` }, { status: 404 })
    }

    const place = data.result

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reviews: GoogleReview[] = (place.reviews || []).map((r: any) => ({
      author: r.author_name || "Cliente",
      avatar: r.profile_photo_url || "",
      rating: r.rating || 5,
      text: r.text || "",
      time: r.time ? r.time * 1000 : Date.now(),
    }))

    return NextResponse.json({
      placeId: place.place_id,
      name: place.name || "PixelArch",
      rating: place.rating || 0,
      totalReviews: place.user_ratings_total || 0,
      reviews,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

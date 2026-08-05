import { NextResponse } from "next/server"

interface GoogleReview {
  author: string
  avatar: string
  rating: number
  text: string
  time: number
}

export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  try {
    // Step 1: Search for PixelArch to get place_id
    const searchRes = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName",
        },
        body: JSON.stringify({
          textQuery: "PixelArch",
          maxResultCount: 1,
        }),
      }
    )

    if (!searchRes.ok) {
      const err = await searchRes.text()
      return NextResponse.json({ error: `Search failed: ${err}` }, { status: searchRes.status })
    }

    const searchData = await searchRes.json()
    const place = searchData.places?.[0]
    if (!place) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 })
    }

    const placeId = place.id

    // Step 2: Fetch place details with reviews
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "displayName,rating,userRatingCount,reviews",
        },
      }
    )

    if (!detailsRes.ok) {
      const err = await detailsRes.text()
      return NextResponse.json({ error: `Details failed: ${err}` }, { status: detailsRes.status })
    }

    const details = await detailsRes.json()

    const reviews: GoogleReview[] = (details.reviews || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => ({
        author: r.authorAttribution?.displayName || "Cliente",
        avatar:
          r.authorAttribution?.photoUri ||
          "",
        rating: r.rating || 5,
        text: r.text?.text || "",
        time: r.publishTime ? new Date(r.publishTime).getTime() : Date.now(),
      })
    )

    return NextResponse.json({
      placeId,
      name: details.displayName?.text || "PixelArch",
      rating: details.rating || 0,
      totalReviews: details.userRatingCount || 0,
      reviews,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

interface PortableTextSpan {
  _type?: string
  text?: string
}

interface PortableTextBlockLike {
  _type?: string
  children?: PortableTextSpan[]
}

export function portableTextToPlain(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ""
  const parts: string[] = []
  for (const block of blocks as PortableTextBlockLike[]) {
    if (!block || !Array.isArray(block.children)) continue
    for (const child of block.children) {
      if (child && typeof child.text === "string") parts.push(child.text)
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

export function estimateReadingMinutes(input: unknown, wordsPerMinute = 200): number {
  const text = typeof input === "string" ? input : portableTextToPlain(input)
  if (!text) return 1
  const words = text.split(" ").filter(Boolean).length
  return Math.max(1, Math.round(words / wordsPerMinute))
}

export function readingTimeLabel(minutes: number): string {
  return `${minutes} min de lectura`
}
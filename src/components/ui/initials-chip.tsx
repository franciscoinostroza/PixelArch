export function InitialsChip({
  label,
  size = "md",
}: {
  label: string
  size?: "sm" | "md"
}) {
  const initials = label
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  const dims = size === "sm" ? { w: 32, h: 32, fs: 11 } : { w: 44, h: 44, fs: 13 }

  return (
    <span
      className="flex shrink-0 items-center justify-center font-display font-bold text-[#07060c]"
      style={{
        width: dims.w,
        height: dims.h,
        borderRadius: 12,
        fontSize: dims.fs,
        background: "linear-gradient(135deg, #8b5cf6, #22d3ee)",
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

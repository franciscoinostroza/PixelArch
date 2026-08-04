import SpaceCanvas from "@/components/layout/space-canvas"

export default function PropuestaGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SpaceCanvas />
      {children}
    </>
  )
}

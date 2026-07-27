import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function NotFound() {
  return (
    <div style={{ position: "relative", zIndex: 1, overflow: "hidden", minHeight: "100svh", display: "flex", flexDirection: "column" }}>
      <div className="section-glow section-glow--violet" style={{ width: "400px", height: "400px", left: "50%", top: "40%", transform: "translate(-50%,-50%)" }} aria-hidden="true" />
      <div className="flex min-h-screen flex-col items-center justify-center px-6" style={{ position: "relative", zIndex: 2 }}>
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-violet/10 text-4xl font-bold text-violet font-display">
            404
          </div>
          <h1 className="text-3xl font-bold text-text font-display md:text-4xl">
            Página no encontrada
          </h1>
          <p className="mt-3 text-sm text-text-dim font-mono leading-relaxed">
            La página que buscas no existe, fue movida o nunca estuvo ahí. 
            Puede que el enlace esté desactualizado.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-violet px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-violet/90 hover:shadow-[0_0_20px_rgba(139,92,246,0.3)]"
            >
              <ArrowLeft size={16} />
              Volver al inicio
            </Link>
            <Link
              href="/productos"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-6 py-3 text-sm font-medium text-text transition-all hover:bg-panel"
            >
              Ver productos
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

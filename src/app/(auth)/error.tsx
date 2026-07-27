"use client"

export default function AuthError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ position: "relative", zIndex: 1, overflow: "hidden", minHeight: "100svh" }}>
      <div className="section-glow section-glow--violet" style={{ width: "400px", height: "400px", left: "50%", top: "40%", transform: "translate(-50%,-50%)" }} aria-hidden="true" />
      <div className="flex flex-col items-center justify-center min-h-screen px-4" style={{ position: "relative", zIndex: 2 }}>
        <span className="text-red-500 font-mono text-sm mb-4">Error del portal</span>
        <h1 className="font-display text-4xl font-bold text-text mb-3">
          Error de autenticacion
        </h1>
        <p className="text-text-dim text-center max-w-md mb-8 font-mono text-sm">
          Ocurrio un error al verificar tu sesion. Intenta iniciar sesion nuevamente.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
        >
          Intentar de nuevo
        </button>
      </div>
    </div>
  )
}

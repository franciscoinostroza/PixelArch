"use client"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <span className="text-red-500 font-mono text-sm mb-4">Error</span>
      <h1 className="font-display text-4xl font-bold text-text mb-3">
        Algo salio mal
      </h1>
      <p className="text-text-dim text-center max-w-md mb-8 font-mono text-sm">
        Ocurrio un error inesperado. Si el problema persiste, contactanos.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-lg bg-violet px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
      >
        Intentar de nuevo
      </button>
    </div>
  )
}

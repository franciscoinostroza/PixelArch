import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <span className="text-accent font-mono text-sm mb-4">404</span>
      <h1 className="font-display text-4xl font-bold text-text mb-3">
        Pagina no encontrada
      </h1>
      <p className="text-muted text-center max-w-md mb-8 font-mono text-sm">
        La pagina que buscas no existe o fue movida.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
      >
        Volver al inicio
      </Link>
    </div>
  )
}

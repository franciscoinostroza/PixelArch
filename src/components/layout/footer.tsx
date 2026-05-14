import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div>
            <Link href="/" className="font-display text-lg font-bold text-text">
              PixelArch
            </Link>
            <p className="mt-1 text-sm text-muted font-mono">
              Desarrollo web · Chatbots · Agentes IA
            </p>
          </div>
          <div className="flex gap-6 text-sm text-muted font-mono">
            <Link href="/" className="hover:text-text transition-colors">
              Inicio
            </Link>
            <Link href="/servicios" className="hover:text-text transition-colors">
              Servicios
            </Link>
            <Link href="/#contacto" className="hover:text-text transition-colors">
              Contacto
            </Link>
          </div>
        </div>
        <div className="mt-8 border-t border-border pt-6 text-center text-xs text-muted font-mono">
          &copy; {new Date().getFullYear()} PixelArch. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  )
}

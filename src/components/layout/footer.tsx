import Link from "next/link"
import { whatsappUrl } from "@/lib/contact"

const PRODUCTOS = [
  { href: "/productos/desarrollo-web", label: "Desarrollo Web" },
  { href: "/productos/chatbot", label: "Chatbot Inteligente" },
  { href: "/productos/agentes-ia", label: "Agentes de IA" },
  { href: "/productos/landing-pages", label: "Landing Pages" },
  { href: "/productos/automatizaciones", label: "Automatizaciones" },
  { href: "/productos/integraciones", label: "Integraciones" },
]

const EMPRESA = [
  { href: "/nosotros", label: "Nosotros" },
  { href: "/proyectos", label: "Proyectos" },
  { href: "/estado", label: "Estado del servicio" },
  { href: "/blog", label: "Blog" },
  { href: "/#contacto", label: "Contacto" },
]

const RECURSOS = [
  { href: "/precios", label: "Precios" },
  { href: "/faq", label: "Preguntas frecuentes" },
  { href: "/auditoria", label: "Auditoría gratis" },
  { href: "/calculadora", label: "Calculadora de ahorro" },
  { href: "/rss.xml", label: "RSS del blog" },
]

const LEGAL = [
  { href: "/terminos", label: "Términos" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/reembolsos", label: "Reembolsos" },
]

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link href="/#inicio" className="footer-logo" aria-label="PixelArch — Inicio">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="4" y="4" width="11" height="11" rx="2" fill="url(#footerLogoGrad)"/>
              <rect x="17" y="17" width="11" height="11" rx="2" fill="url(#footerLogoGrad)" opacity=".5"/>
              <defs>
                <linearGradient id="footerLogoGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#8b5cf6"/>
                  <stop offset="1" stopColor="#22d3ee"/>
                </linearGradient>
              </defs>
            </svg>
            <span>Pixel<span className="footer-logo-accent">Arch</span></span>
          </Link>
          <p>Software y la red que lo sostiene. Desarrollo full-stack e infraestructura monitoreada.</p>
          <div className="footer-socials">
            <a href="https://github.com/franciscoinostroza" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.8A5.3 5.3 0 0 0 19.9 5 5 5 0 0 0 19.8 1S18.6.6 16 2.5a13.4 13.4 0 0 0-7 0C6.4.6 5.2 1 5.2 1a5 5 0 0 0-.1 4 5.3 5.3 0 0 0-1.4 3.7c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.6V22"/></svg>
            </a>
            <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.6 0-3.1-.4-4.4-1.2L3 20l1.4-5A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3.2a8.4 8.4 0 0 1 8.5 8.3z"/></svg>
            </a>
            <a href="mailto:hola@pixelarch.dev" aria-label="Email">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6L22 7"/></svg>
            </a>
          </div>
        </div>

        <nav className="footer-col" aria-label="Productos">
          <h4>Productos</h4>
          {PRODUCTOS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
        </nav>

        <nav className="footer-col" aria-label="Empresa">
          <h4>Empresa</h4>
          {EMPRESA.map((l) => (
            <Link key={l.label} href={l.href}>{l.label}</Link>
          ))}
        </nav>

        <nav className="footer-col" aria-label="Recursos">
          <h4>Recursos</h4>
          {RECURSOS.map((l) => (
            <Link key={l.label} href={l.href}>{l.label}</Link>
          ))}
        </nav>

        <nav className="footer-col" aria-label="Legal">
          <h4>Legal</h4>
          {LEGAL.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
        </nav>
      </div>

      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} PixelArch · hola@pixelarch.dev</span>
        <span className="footer-status">
          <span className="footer-status-dot" aria-hidden="true" />
          Disponible para nuevos proyectos
        </span>
        <Link href="/estado" className="footer-estado-link">Estado del servicio →</Link>
      </div>

      <style>{`
        .site-footer {
          position: relative;
          z-index: 1;
          border-top: 1px solid rgba(255,255,255,0.08);
          background: rgba(7,6,12,0.9);
          padding: 52px 0 26px;
        }
        .footer-inner {
          max-width: var(--maxw, 1180px);
          margin-inline: auto;
          padding-inline: clamp(20px, 5vw, 56px);
          display: grid;
          grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr;
          gap: 30px;
        }
        .footer-brand .footer-logo {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          font-size: 1.05rem;
          font-weight: 700;
        }
        .footer-logo-accent {
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .footer-brand p {
          color: var(--color-text-dim);
          font-size: 0.86rem;
          line-height: 1.8;
          margin: 14px 0 18px;
          max-width: 30ch;
        }
        .footer-socials { display: flex; gap: 10px }
        .footer-socials a {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-dim);
          transition: border-color 0.2s, color 0.2s, transform 0.2s;
        }
        .footer-socials a:hover { border-color: rgba(139,92,246,0.5); color: var(--color-cyan); transform: translateY(-2px) }
        .footer-socials svg {
          width: 17px;
          height: 17px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .footer-col h4 {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--color-text-faint);
          margin-bottom: 14px;
          font-weight: 500;
        }
        .footer-col a {
          display: block;
          color: var(--color-text-dim);
          font-size: 0.86rem;
          margin-bottom: 9px;
          transition: color 0.2s;
        }
        .footer-col a:hover { color: var(--color-cyan) }
        .footer-bottom {
          max-width: var(--maxw, 1180px);
          margin: 40px auto 0;
          padding: 22px clamp(20px, 5vw, 56px) 0;
          border-top: 1px solid rgba(255,255,255,0.07);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .footer-bottom span {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-faint);
        }
        .footer-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--color-mint, #34d399) !important;
        }
        .footer-estado-link {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          color: var(--color-text-faint);
          transition: color 0.2s;
        }
        .footer-estado-link:hover { color: var(--color-cyan) }
        .footer-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 8px rgba(52,211,153,0.7);
          flex-shrink: 0;
        }
        @media (max-width: 980px) {
          .footer-inner { grid-template-columns: 1fr 1fr 1fr }
        }
        @media (max-width: 680px) {
          .footer-inner { grid-template-columns: 1fr 1fr; gap: 24px }
          .footer-brand { grid-column: 1 / -1 }
          .footer-bottom { justify-content: center; text-align: center }
        }
      `}</style>
    </footer>
  )
}
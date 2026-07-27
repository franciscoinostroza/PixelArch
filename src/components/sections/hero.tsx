"use client"

interface HeroProps {
  titulo?: string
  subtitulo?: string
  ctaPrimario?: string
  ctaSecundario?: string
}

export function Hero({
  titulo = "Construimos el software. Diseñamos la red que lo sostiene.",
  subtitulo = "Desarrollo full-stack e ingeniería de redes en un mismo equipo. No solo programamos tu producto: pensamos dónde corre, cómo escala y qué pasa el día que algo falla.",
  ctaPrimario = "Hablemos de tu proyecto",
  ctaSecundario = "Ver productos",
}: HeroProps) {
  const gradientText = titulo.split("la red que lo sostiene")
  const hasGradient = gradientText.length === 2

  return (
    <section className="hero" id="inicio">
      <div className="hero-inner">
        <h1 className="hero-title reveal is-visible" style={{ transitionDelay: "0.08s" }}>
          {hasGradient ? (
            <>
              {gradientText[0]}
              <span className="grad">la red que lo sostiene</span>
              {gradientText[1]}
            </>
          ) : (
            titulo
          )}
        </h1>
        <p className="hero-sub reveal is-visible" style={{ transitionDelay: "0.16s" }}>
          {subtitulo}
        </p>
        <div className="hero-cta reveal is-visible" style={{ transitionDelay: "0.24s" }}>
          <a href="#contacto" className="btn btn-primary">
            {ctaPrimario} <span className="btn-arrow" aria-hidden="true">→</span>
          </a>
          <a href="#productos" className="btn btn-ghost">{ctaSecundario}</a>
        </div>
      </div>

      <div className="scroll-cue">
        <span className="scroll-cue-label">Scroll</span>
        <span className="scroll-wheel"><span className="scroll-dot"></span></span>
      </div>

      <style>{`
        .hero {
          position: relative;
          z-index: 1;
          min-height: 100svh;
          display: flex;
          align-items: center;
          padding-top: 120px;
          overflow: hidden;
        }
        .hero::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(7,6,12,0.55) 0%, rgba(7,6,12,0.15) 42%, transparent 64%);
          pointer-events: none;
        }
        .hero-inner {
          position: relative;
          z-index: 2;
          max-width: var(--maxw, 1180px);
          margin-inline: auto;
          padding-inline: clamp(20px, 5vw, 56px);
          width: 100%;
        }
        .hero-title {
          font-family: var(--font-pixel-display);
          font-weight: 700;
          letter-spacing: 0;
          font-size: clamp(2.4rem, 5.6vw, 4.3rem);
          max-width: 16ch;
          margin-bottom: 26px;
        }
        .hero-title .grad {
          background: linear-gradient(135deg, #8b5cf6, #22d3ee);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hero-sub {
          font-size: clamp(1.02rem, 1.5vw, 1.18rem);
          color: var(--color-text-dim);
          max-width: 50ch;
          margin-bottom: 38px;
        }
        .hero-cta {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 64px;
        }
        .scroll-cue {
          position: absolute;
          left: 50%;
          bottom: 36px;
          transform: translateX(-50%);
          z-index: 3;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          opacity: 0;
          animation: cue-in 0.8s cubic-bezier(.19,1,.22,1) 1.2s forwards;
        }
        @keyframes cue-in { to { opacity: 1 } }
        .scroll-cue-label {
          font-family: var(--font-mono);
          font-size: 0.65rem;
          letter-spacing: 0.16em;
          color: var(--color-text-faint);
          text-transform: uppercase;
        }
        .scroll-wheel {
          width: 22px;
          height: 34px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          display: flex;
          justify-content: center;
          padding-top: 7px;
        }
        .scroll-dot {
          width: 3px;
          height: 7px;
          border-radius: 2px;
          background: var(--color-cyan);
          animation: scroll-bob 1.8s ease-in-out infinite;
        }
        @keyframes scroll-bob {
          0% { transform: translateY(0); opacity: 1 }
          70% { opacity: 1 }
          100% { transform: translateY(9px); opacity: 0 }
        }
        @media (prefers-reduced-motion: reduce) {
          .scroll-dot { animation: none }
        }
      `}</style>
    </section>
  )
}

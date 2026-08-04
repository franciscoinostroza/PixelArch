import Script from "next/script"

export function Reviews() {
  return (
    <section className="resenas" id="resenas">
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Reseñas</p>
          <h2>Lo que dicen quienes ya trabajaron con nosotros</h2>
          <p>Opiniones verificadas por Clutch, la plataforma líder de reseñas B2B.</p>
        </div>
      </div>

      <div className="mx-auto" style={{ maxWidth: "var(--maxw, 1180px)", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div
          className="clutch-widget"
          data-url="https://widget.clutch.co"
          data-widget-type="12"
          data-height="375"
          data-nofollow="false"
          data-expandifr="true"
          data-scale="100"
          data-reviews=""
          data-clutchcompany-id="2694102"
        />
      </div>

      <div className="mt-12 text-center">
        <p style={{ fontFamily: "var(--font-mono)", fontSize: ".68rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: "16px" }}>
          ¿Trabajaste con nosotros?
        </p>
        <a
          href="https://review.clutch.co/review?provider_id=277f4f12-3fd1-4cca-907e-35d3a73e7f9a"
          target="_blank"
          rel="noopener"
          className="btn btn-primary"
          style={{ display: "inline-flex" }}
        >
          Dejar reseña en Clutch →
        </a>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: ".62rem", color: "var(--color-text-faint)", marginTop: "12px" }}>
          5 minutos · Verificación por Clutch · Sin registro
        </p>
      </div>

      <Script src="https://widget.clutch.co/static/js/widget.js" strategy="lazyOnload" />

      <style>{`
        .resenas {
          position: relative;
          z-index: 1;
          overflow: hidden;
          background: rgba(7,6,12,0.88);
          backdrop-filter: blur(3px);
          padding-bottom: clamp(60px, 7vw, 88px);
        }
        .resenas .section-head { margin-bottom: 44px }
        .clutch-widget {
          max-width: 100%;
          margin-inline: auto;
        }
        .clutch-widget iframe {
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
        }
      `}</style>
    </section>
  )
}

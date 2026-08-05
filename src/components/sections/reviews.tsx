import Script from "next/script"

const REVIEW_LINK = "https://www.google.com/maps/place/PixelArch/@-6.38645,-57.00805,3z/data=!3m1!4b1!4m6!3m5!1s0x61d1c2d233fe189b:0x28e46b0532f441a3!8m2!3d-6.38645!4d-57.00805!16s%2Fg%2F11ntp6dvhm?hl=es&entry=ttu"

function StarRating({ rating }: { rating: number }) {
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 20 20" fill={i <= Math.round(rating) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1" style={{ color: "#22d3ee" }}>
          <path d="M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L10 14.9 4.4 18l1.4-6.2L1 7.5l6.4-.6L10 1z"/>
        </svg>
      ))}
    </div>
  )
}

export function Reviews() {
  return (
    <section className="resenas" id="resenas">
      <div className="section-divider section-divider--violet" aria-hidden="true" />
      <div className="section-band section-band--violet" aria-hidden="true" />
      <div className="section-glow section-glow--violet" style={{ width: "380px", height: "380px", left: "-120px", top: "20%" }} aria-hidden="true" />
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Reviews</p>
          <h2>What our clients say</h2>
          <p>Verified reviews from real clients.</p>
        </div>
      </div>

      {/* Clutch widget */}
      <div className="mx-auto mb-12" style={{ maxWidth: "var(--maxw, 1180px)", paddingInline: "clamp(20px, 5vw, 56px)" }}>
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

      <Script src="https://widget.clutch.co/static/js/widget.js" strategy="lazyOnload" />

      {/* Google reviews — loaded via API */}
      <div className="mx-auto mb-12" style={{ maxWidth: "var(--maxw, 1180px)", paddingInline: "clamp(20px, 5vw, 56px)" }}>
        <div id="google-reviews" data-api="/api/reviews/google" />
      </div>

      {/* CTA */}
      <div className="text-center mt-10">
        <p style={{ fontFamily: "var(--font-mono)", fontSize: ".68rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--color-text-faint)", marginBottom: "16px" }}>
          Worked with us?
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
          <a
            href="https://review.clutch.co/review?provider_id=277f4f12-3fd1-4cca-907e-35d3a73e7f9a"
            target="_blank"
            rel="noopener"
            className="btn btn-primary"
            style={{ display: "inline-flex" }}
          >
            Review on Clutch →
          </a>
          <a
            href={REVIEW_LINK}
            target="_blank"
            rel="noopener"
            className="btn btn-ghost"
            style={{ display: "inline-flex" }}
          >
            Review on Google →
          </a>
        </div>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: ".62rem", color: "var(--color-text-faint)", marginTop: "12px" }}>
          5 minutes · Verified reviews · No signup
        </p>
      </div>

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
